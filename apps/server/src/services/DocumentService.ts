import { GoogleGenAI } from "@google/genai";
import {
  DocumentKind,
  DocumentSection,
  buildDocumentChunkPrompt,
  isRateLimitError,
  parseRetryDelayMs,
  ExcelPayload,
  ExcelPayloadSchema,
  ReportPayload,
  ReportPayloadSchema,
  inferExpertPersona,
  getWibFormattedString,
} from "@celyn/shared";
import { config } from "../config.js";
import { documentWriterService } from "./DocumentWriterService.js";

function cleanJson(text: string): string {
  if (!text) return "";
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  return t.trim();
}

export interface GenerateDocumentParams {
  kind: DocumentKind;
  title: string;
  instruction: string;
  context?: string;
}

export interface GeneratedDocumentResult {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

export interface ProcessDocumentInPlaceParams {
  fileName: string;
  kind?: DocumentKind;
  operation: "edit" | "translate" | "summarize" | "paraphrase" | "custom";
  originalContent: string;
  instruction?: string;
  targetLanguage?: string;
}

export interface ProcessImageEditParams {
  fileName?: string;
  action?: string;
  instruction?: string;
  backgroundColor?: string;
  imagePreviewDataUrl?: string;
}

export interface ProcessImageEditResult {
  ok: boolean;
  action?: string;
  subjectBox?: { ymin: number; xmin: number; ymax: number; xmax: number };
  backgroundColorHex?: string;
  backgroundImageDataUrl?: string | null;
  svgSceneMarkup?: string;
  explanation: string;
}

export class DocumentService {
  constructor() {}

  /**
   * Pemanggilan model Gemini dengan otomatisasi multi-key failover jika terjadi 429 Quota Exceeded
   */
  private async callGeminiJson(model: string, prompt: string): Promise<any> {
    const keys =
      config.geminiApiKeys && config.geminiApiKeys.length > 0
        ? config.geminiApiKeys
        : [config.geminiApiKey];

    const modelsToTry = [
      model,
      "gemini-3.8-flash",
      "gemini-3-flash-preview",
    ].filter(Boolean);
    const uniqueModels = [...new Set(modelsToTry)];

    let lastErr: any;
    for (const modelToTry of uniqueModels) {
      for (const key of keys) {
        if (!key) continue;
        const ai = new GoogleGenAI({ apiKey: key });
        try {
          const res = (await Promise.race([
            ai.models.generateContent({
              model: modelToTry,
              contents: prompt,
              config: { responseMimeType: "application/json" },
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Timeout memanggil model")), 8000)
            ),
          ])) as any;
          if (res?.text) return res;
        } catch (err: any) {
          lastErr = err;
          if (err?.status === 404) {
            break;
          }
          if (isRateLimitError(err) || err?.status === 503 || String(err?.message || "").includes("Timeout")) {
            console.warn("[DocumentService] Kunci mencapai kuota/timeout, mencoba kunci berikutnya di pool...");
            continue;
          }
        }
      }
    }
    throw lastErr || new Error("Seluruh kunci layanan mencapai batas kuota");
  }

  /**
   * Tahap map/reduce: memproses SATU potongan teks dokumen dan mengembalikan section terstruktur.
   * Dipanggil berulang oleh klien (di latar belakang) agar tiap request kecil dan aman dari batas token/menit.
   */
  async processChunk(params: {
    fileName: string;
    operation: string;
    instruction?: string;
    targetLanguage?: string;
    content: string;
    chunkIndex: number;
    totalChunks: number;
    reduce?: boolean;
  }): Promise<DocumentSection[]> {
    const model = config.docGenerateModel || "gemini-3.8-flash";
    const prompt = buildDocumentChunkPrompt(params);
    const res = await this.callGeminiJson(model, prompt);
    const parsed = JSON.parse(cleanJson(res.text || "{}"));
    const sections = Array.isArray(parsed?.sections) ? parsed.sections : [];
    return ReportPayloadSchema.parse({ title: "x", sections: sections.length ? sections : [{ heading: "", paragraphs: [] }] })
      .sections;
  }

  /** Merender section hasil gabungan menjadi file PDF/Word sesuai format dokumen asal. */
  async renderSections(params: {
    fileName: string;
    operation: string;
    targetLanguage?: string;
    sections: DocumentSection[];
  }): Promise<GeneratedDocumentResult> {
    const { fileName, operation, targetLanguage, sections } = params;
    const baseName = fileName.replace(/\.[^/.]+$/, "").replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 40) || "Dokumen";
    const opLabel = operation === "translate" ? `terjemahan_${targetLanguage || "id"}` : operation;
    const resultBaseName = `${baseName}_${opLabel}`;
    const payload: ReportPayload = ReportPayloadSchema.parse({
      title: baseName,
      subtitle: "Diperbarui oleh Celyn AI",
      sections,
    });
    if (fileName.toLowerCase().endsWith(".docx") || fileName.toLowerCase().endsWith(".doc")) {
      return {
        buffer: await documentWriterService.createWord(payload),
        fileName: `${resultBaseName}.docx`,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      };
    }
    return {
      buffer: await documentWriterService.createPdf(payload),
      fileName: `${resultBaseName}.pdf`,
      mimeType: "application/pdf",
    };
  }

  /**
   * Menghasilkan file dokumen (PDF, Word, atau Excel) secara cerdas menggunakan Gemini
   * dan langsung mengembalikan raw binary Buffer (stateless tanpa penyimpanan sementara).
   */
  async generateDocument(params: GenerateDocumentParams): Promise<GeneratedDocumentResult> {
    const { kind, title, instruction, context } = params;
    const model = config.docGenerateModel || "gemini-3.8-flash";
    const safeTitle = (title || "Dokumen")
      .replace(/[\\/:*?"<>|]/g, "_")
      .trim()
      .slice(0, 50) || "Dokumen";

    const expert = inferExpertPersona(`${title} ${instruction}`);
    const wibDateStr = getWibFormattedString(new Date());

    if (kind === "xlsx") {
      // 1. GENERATE EXCEL VIA GEMINI JSON DENGAN PERSONA PAKAR SENIOR
      const prompt = `Anda adalah ${expert.persona}.
Tugas Anda: Membuat data lembar kerja Excel (XLSX) profesional tingkat tinggi yang komprehensif, rapi, dan siap analisis di bidang ${expert.fieldLabel}.
Judul/Nama Dokumen Riset: "${title}"
Instruksi Pengguna: "${instruction}"
Fokus Keahlian (${expert.fieldLabel}): ${expert.promptGuide}
Waktu Acuan (WIB / Jakarta, UTC+7): ${wibDateStr}
PENTING ZONA WAKTU: Gunakan waktu acuan Jakarta (WIB, UTC+7) di atas sebagai patokan resmi hari, tanggal, dan rentang waktu. JANGAN PERNAH mengikuti waktu UTC server.
${context ? `Konteks/Data Acuan:\n${context}` : ""}

PANDUAN RISET & DESAIN EXCEL TINGKAT AHLI:
1. BUKAN CONTOH ASAL-ASALAN: Sajikan metrik riil, realistis, dan komprehensif sesuai standar industri ${expert.fieldLabel}.
2. Tentukan sheetName yang relevan (maks 31 karakter).
3. Buat kolom (columns) dengan 'header', 'key' (id unik huruf kecil tanpa spasi), dan 'type' ('string' | 'number' | 'currency' | 'percentage' | 'date').
4. Isi baris-baris data (rows) sesuai format tipe kolom. Untuk kolom currency atau number, berikan angka murni (number). Untuk percentage berikan desimal (misal 0.15 untuk 15%).
5. Berikan data yang komprehensif, realistis, dan informatif.

KEMBALIKAN HANYA JSON SESUAI SKEMA BERIKUT:
{
  "fileName": "${safeTitle}",
  "sheets": [
    {
      "sheetName": "Ringkasan Analisis",
      "columns": [
        { "header": "Indikator / Metrik", "key": "indikator", "type": "string" },
        { "header": "Nilai / Data", "key": "nilai", "type": "string" },
        { "header": "Catatan Analisis", "key": "catatan", "type": "string" }
      ],
      "rows": [
        { "indikator": "Fundamental", "nilai": "Stabil", "catatan": "Kinerja kuartalan positif" }
      ]
    }
  ]
}`;

      const res = await this.callGeminiJson(model, prompt);
      const parsed = JSON.parse(cleanJson(res.text || "{}"));
      const validated: ExcelPayload = ExcelPayloadSchema.parse(parsed);

      const buffer = await documentWriterService.createExcel(validated);
      return {
        buffer,
        fileName: `${safeTitle}.xlsx`,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
    } else {
      // 2. GENERATE WORD (.docx) ATAU PDF (.pdf) VIA GEMINI JSON DENGAN PERSONA PAKAR SENIOR
      const isPdf = kind === "pdf";
      const docTypeLabel = isPdf ? "Laporan Riset Eksekutif PDF (.pdf)" : "Dokumen Riset Formal Word (.docx)";

      const prompt = `Anda adalah ${expert.persona}.
Tugas Anda: Menyusun ${docTypeLabel} profesional tingkat tinggi (High-Caliber Professional Research Report) yang mendalam, berbobot, tajam, dan formal di bidang ${expert.fieldLabel}.
Judul Dokumen/Riset: "${title}"
Instruksi Pengguna: "${instruction}"
Fokus Keahlian (${expert.fieldLabel}): ${expert.promptGuide}
Waktu Acuan (WIB / Jakarta, UTC+7): ${wibDateStr}
PENTING ZONA WAKTU: Gunakan waktu acuan Jakarta (WIB, UTC+7) di atas sebagai patokan resmi hari, tanggal, dan rentang waktu. JANGAN PERNAH mengikuti waktu UTC server.
${context ? `Konteks/Materi Acuan:\n${context}` : ""}

PANDUAN RISET & PENULISAN DOKUMEN TINGKAT AHLI:
1. BUKAN RISET ASAL-ASALAN: Sajikan analisis mendalam, berbasis fakta riil, tajam, dan terstruktur. Hindari generalisasi dangkal atau sekadar definisi umum!
2. STRUKTUR LAPORAN WAJIB MEMUAT SECTION BERBOBOT:
   - Ringkasan Eksekutif (Executive Summary)
   - Latar Belakang & Analisis Sektor / Fakta Kunci
   - Evaluasi Peluang & Analisis Risiko Komprehensif
   - Rekomendasi Strategis & Rencana Tindak Lanjut
   - Kesimpulan Ahli
   - Sumber Referensi & Catatan Metodologi
3. Setiap section harus memuat 1-2 paragraf padat-berbobot dan 2-3 temuan kunci (bulletPoints) tajam. JANGAN masukkan tag markdown seperti ** atau ## ke dalam teks paragraf.
4. TABEL DATA WAJIB DISERTAKAN: Sertakan minimal 1 objek "table" di bagian analisis/fakta kunci yang memuat data terstruktur dengan "headers" dan "rows" (misalnya: data pergerakan harian, perbandingan metrik kinerja saham/sektor, atau indikator finansial/teknikal). Jika pengguna meminta chart atau grafik perkembangan (seperti perkembangan mingguan dari hari ke hari atau perbandingan saham), sajikan tabel matriks komprehensif harian dan perbandingan emiten sebagai representasi visual data yang terstruktur.

KEMBALIKAN HANYA JSON SESUAI SKEMA BERIKUT:
{
  "title": "${safeTitle}",
  "subtitle": "Laporan Riset Profesional Celyn AI • ${expert.fieldLabel}",
  "sections": [
    {
      "heading": "Ringkasan Eksekutif",
      "paragraphs": [
        "Paragraf analisis eksekutif komprehensif tanpa tag markdown mentah."
      ],
      "bulletPoints": [
        "Temuan kunci 1"
      ]
    }
  ]
}`;

      const res = await this.callGeminiJson(model, prompt);
      const parsed = JSON.parse(cleanJson(res.text || "{}"));
      const validated: ReportPayload = ReportPayloadSchema.parse(parsed);

      let buffer: Buffer;
      let mimeType: string;
      let ext: string;

      if (isPdf) {
        buffer = await documentWriterService.createPdf(validated);
        mimeType = "application/pdf";
        ext = "pdf";
      } else {
        buffer = await documentWriterService.createWord(validated);
        mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        ext = "docx";
      }

      return {
        buffer,
        fileName: `${safeTitle}.${ext}`,
        mimeType,
      };
    }
  }

  /**
   * Mengedit atau memproses dokumen yang sudah ada secara langsung (In-Place)
   * PDF tetap menghasilkan PDF, Word tetap Word, Excel tetap Excel.
   */
  async processDocumentInPlace(params: ProcessDocumentInPlaceParams): Promise<GeneratedDocumentResult> {
    if (!config.geminiApiKey && (!config.geminiApiKeys || config.geminiApiKeys.length === 0)) {
      throw new Error("GEMINI_API_KEY belum dikonfigurasi di server.");
    }

    const { fileName, operation, originalContent, instruction, targetLanguage } = params;
    const model = config.docGenerateModel || "gemini-3-flash-preview";

    const lowerName = (fileName || "dokumen.pdf").toLowerCase();
    let effectiveKind: DocumentKind = params.kind || "pdf";
    if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
      effectiveKind = "xlsx";
    } else if (lowerName.endsWith(".docx") || lowerName.endsWith(".doc")) {
      effectiveKind = "docx";
    } else {
      effectiveKind = "pdf";
    }

    const baseName = fileName.replace(/\.[^/.]+$/, "").replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 40) || "Dokumen";
    const opLabel = operation === "translate" ? `terjemahan_${targetLanguage || "id"}` : operation;
    const resultBaseName = `${baseName}_${opLabel}`;

    if (effectiveKind === "xlsx") {
      const prompt = `Anda adalah editor data lembar kerja Excel profesional.
Lakukan pemrosesan (${operation.toUpperCase()}) pada data Excel berikut:
Nama File: "${fileName}"
${targetLanguage ? `Bahasa Tujuan: "${targetLanguage}"` : ""}
Instruksi Pengguna: "${instruction || `Perbarui dan sesuaikan data dokumen Excel ini sesuai instruksi.`}"

KONTEN / TABEL DATA ASLI:
"""
${originalContent}
"""

PETUNJUK:
1. Pertahankan struktur lembar kerja (sheets), nama kolom, dan tipe data ('string', 'number', 'currency', 'percentage', 'date').
2. Terapkan seluruh modifikasi atau perhitungan baru secara akurat.
3. Kembalikan HANYA JSON valid sesuai skema ExcelPayload:
{
  "fileName": "${resultBaseName}",
  "sheets": [
    {
      "sheetName": "Data",
      "columns": [{ "header": "Nama Kolom", "key": "nama_kolom", "type": "string" }],
      "rows": [{ "nama_kolom": "Nilai" }]
    }
  ]
}`;

      const res = await this.callGeminiJson(model, prompt);
      const parsed = JSON.parse(cleanJson(res.text || "{}"));
      const validated: ExcelPayload = ExcelPayloadSchema.parse(parsed);
      const buffer = await documentWriterService.createExcel(validated);
      return {
        buffer,
        fileName: `${resultBaseName}.xlsx`,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
    } else {
      // PDF ATAU WORD (.docx)
      const isPdf = effectiveKind === "pdf";
      const docTypeLabel = isPdf ? "PDF" : "Word (.docx)";

      const prompt = `Anda adalah editor dokumen ${docTypeLabel} profesional.
Lakukan proses EDIT IN-PLACE (${operation.toUpperCase()}) pada dokumen berikut:
Nama File: "${fileName}"
${targetLanguage ? `Bahasa Tujuan: "${targetLanguage}"` : ""}
Instruksi Pengguna: "${instruction || `Lakukan ${operation} pada isi dokumen dengan mempertahankan struktur aslinya.`}"

KONTEN ASLI DOKUMEN:
"""
${originalContent}
"""

PETUNJUK EDIT DOKUMEN IN-PLACE:
1. Pertahankan seluruh struktur asli dokumen: Judul (title), Subjudul (subtitle), dan Bagian-bagian (sections, headings, paragraphs, bullet points, dan tables).
2. Terapkan perubahan, terjemahan, ringkasan, atau penulisan ulang sesuai instruksi pengguna secara presisi.
3. JANGAN memasukkan format markdown mentah (seperti **, ##, _) ke dalam teks paragraphs atau headings.
4. Pastikan teks rapi, mengalir secara profesional, dan berbobot.

KEMBALIKAN HANYA JSON VALID SESUAI SKEMA REPORTPAYLOAD:
{
  "title": "${baseName}",
  "subtitle": "Diperbarui oleh Celyn AI",
  "sections": [
    {
      "heading": "Nama Bab",
      "paragraphs": [
        "Isi paragraf yang telah diperbarui atau diterjemahkan."
      ],
      "bulletPoints": [],
      "table": {
        "headers": [],
        "rows": []
      }
    }
  ]
}`;

      const res = await this.callGeminiJson(model, prompt);
      const parsed = JSON.parse(cleanJson(res.text || "{}"));
      const validated: ReportPayload = ReportPayloadSchema.parse(parsed);

      let buffer: Buffer;
      let mimeType: string;
      let ext: string;

      if (isPdf) {
        buffer = await documentWriterService.createPdf(validated);
        mimeType = "application/pdf";
        ext = "pdf";
      } else {
        buffer = await documentWriterService.createWord(validated);
        mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        ext = "docx";
      }

      return {
        buffer,
        fileName: `${resultBaseName}.${ext}`,
        mimeType,
      };
    }
  }

  /**
   * Pemrosesan Pengeditan Foto Berbasis Suara (Voice-Driven Photo Editing)
   * Menggunakan Gemini 2.5 Flash Vision untuk ekstraksi koordinat subjek dan sintesis scene
   * serta fallback pemandangan fotorealistik gratis.
   */
  async processImageEdit(params: ProcessImageEditParams): Promise<ProcessImageEditResult> {
    const action = String(params.action || "transform").toLowerCase();
    const rawInstruction = String(params.instruction || "Edit gambar ini").trim();
    const userBgColor = params.backgroundColor ? String(params.backgroundColor).trim() : "";
    const sourceImage = String(params.imagePreviewDataUrl || "").trim();

    if (action === "hide" || action === "show" || action === "reset") {
      return {
        ok: true,
        action,
        explanation:
          action === "hide"
            ? "Tampilan foto telah berhasil disembunyikan dari layar."
            : action === "show"
            ? "Foto kembali ditampilkan di layar utama."
            : "Foto telah dikembalikan ke versi asli.",
      };
    }

    const visionPrompt = `Anda adalah AI Vision & Graphic Designer Celyn.
Pengguna meminta pengeditan visual pada foto: "${rawInstruction}".
Aksi yang diminta: "${action}".
Warna latar yang diinginkan (jika ada): "${userBgColor}".

Tugas Anda:
1. Tentukan subjek utama foto (orang/objek di depan) dan berikan perkiraan subjectBox dalam skala 0..1000: {"ymin": 120, "xmin": 180, "ymax": 950, "xmax": 820}.
2. Jika diminta ganti warna latar belakang (misal biru, merah, putih, dsb), berikan kode hex backgroundColorHex yang tepat (contoh: "#1d4ed8" untuk pasfoto biru resmi, "#dc2626" untuk merah, "#ffffff" untuk putih).
3. Jika pengguna meminta menambahkan objek di belakang (misal pohon, tanaman, awan) atau mengganti suasana latar (pantai, taman, senja):
   - Buat englishVisualPrompt yang deskriptif dan estetis (contoh: "lush green tropical trees in the background, soft outdoor sunlight, high quality").
   - Buat svgSceneMarkup yang valid, indah, dan kaya detail berupa elemen pohon/taman/latar belakang dalam SVG dengan viewBox="0 0 1000 750" yang siap diletakkan di belakang subjek foto!
4. Berikan penjelasan singkat, ramah, dan santai dalam Bahasa Indonesia (explanation) yang menjelaskan perubahan apa saja yang telah dilakukan.

KEMBALIKAN HANYA JSON VALID TANPA MARKDOWN BACKTICKS:
{
  "subjectBox": { "ymin": 120, "xmin": 180, "ymax": 950, "xmax": 820 },
  "backgroundColorHex": "#1d4ed8",
  "visualScenePrompt": "lush green trees in background",
  "svgSceneMarkup": "<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 1000 750\\"><rect width=\\"1000\\" height=\\"750\\" fill=\\"#e0f2fe\\"/><g><path d=\\"M500 200 C300 200 200 400 350 550 C200 700 500 750 500 750 C500 750 800 700 650 550 C800 400 700 200 500 200 Z\\" fill=\\"#15803d\\"/><rect x=\\"470\\" y=\\"550\\" width=\\"60\\" height=\\"200\\" fill=\\"#78350f\\"/></g></svg>",
  "explanation": "Latar belakang foto sudah disesuaikan dan ditambahkan pepohonan hijau rindang di belakangmu!"
}`;

    let visionResult: any = {
      subjectBox: { ymin: 120, xmin: 180, ymax: 950, xmax: 820 },
      backgroundColorHex: userBgColor || undefined,
      visualScenePrompt: rawInstruction,
      svgSceneMarkup: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 750"><rect width="1000" height="750" fill="#f0fdf4"/><g opacity="0.95"><path d="M500 120 C320 120 220 320 360 480 C220 640 500 700 500 700 C500 700 780 640 640 480 C780 320 680 120 500 120 Z" fill="#16a34a"/><path d="M300 250 C180 250 120 380 220 500 C150 620 350 680 350 680 C350 680 500 620 420 500 C500 380 420 250 300 250 Z" fill="#15803d"/><rect x="465" y="520" width="70" height="230" fill="#78350f" rx="10"/></g></svg>`,
      explanation: `Perubahan visual pada foto '${params.fileName || "foto"}' telah diterapkan.`,
    };

    try {
      const keys =
        config.geminiApiKeys && config.geminiApiKeys.length > 0
          ? config.geminiApiKeys
          : [config.geminiApiKey];

      const contents: any[] = [];
      if (sourceImage.startsWith("data:image/")) {
        const match = sourceImage.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        if (match) {
          contents.push({
            inlineData: {
              mimeType: match[1],
              data: match[2],
            },
          });
        }
      }
      contents.push({ text: visionPrompt });

      for (const key of keys) {
        if (!key) continue;
        try {
          const ai = new GoogleGenAI({ apiKey: key });
          const resp = (await Promise.race([
            ai.models.generateContent({
              model: "gemini-2.5-flash",
              contents,
              config: {
                responseMimeType: "application/json",
              },
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 8000)),
          ])) as any;
          const rawText = cleanJson(resp?.text || "");
          if (rawText) {
            const parsed = JSON.parse(rawText);
            if (parsed && typeof parsed === "object") {
              visionResult = { ...visionResult, ...parsed };
              break;
            }
          }
        } catch (kErr) {
          console.warn("[DocumentService processImageEdit] Key failed:", (kErr as any)?.message || kErr);
        }
      }
    } catch (err) {
      console.warn("[DocumentService processImageEdit] Vision fallback:", err);
    }

    let generatedImageDataUrl: string | null = null;
    if (visionResult.visualScenePrompt && (action === "add_object" || action === "replace_background")) {
      try {
        const freeImgUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
          visionResult.visualScenePrompt + ", lush trees scenery, high quality photography"
        )}?width=800&height=600&nologo=true`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4500);
        const imgFetch = await fetch(freeImgUrl, { signal: controller.signal });
        clearTimeout(timer);
        if (imgFetch.ok) {
          const arrBuf = await imgFetch.arrayBuffer();
          const b64 = Buffer.from(arrBuf).toString("base64");
          generatedImageDataUrl = `data:image/jpeg;base64,${b64}`;
        }
      } catch (e) {
        // Fallback ke SVG scene markup
      }
    }

    return {
      ok: true,
      action,
      subjectBox: visionResult.subjectBox,
      backgroundColorHex: visionResult.backgroundColorHex || userBgColor,
      backgroundImageDataUrl: generatedImageDataUrl,
      svgSceneMarkup: visionResult.svgSceneMarkup,
      explanation: visionResult.explanation,
    };
  }
}

export const documentService = new DocumentService();
