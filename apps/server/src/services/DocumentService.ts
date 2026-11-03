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
  editMode?: string;
  targetPart?: string;
  targetBoxes?: Array<{ ymin: number; xmin: number; ymax: number; xmax: number }>;
  excludeBoxes?: Array<{ ymin: number; xmin: number; ymax: number; xmax: number }>;
  samplePoints?: Array<{ x: number; y: number }>;
  sourceColorsHex?: string[];
  targetColorHex?: string;
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
Aksi mentah: "${action}".
Warna latar yang diinginkan (jika ada): "${userBgColor}".

Tugas Anda:
1. Klasifikasikan jenis pengeditan ke dalam "editMode":
   - "recolor_part": Jika pengguna ingin mengubah warna bagian tertentu dari subjek atau objek (misal: warna rambut jadi putih/merah/hitam, warna jas/baju/kaos, dasi, kupu-kupu, topi, dsb). Latar belakang dan bagian lain foto TIDAK BOLEH diubah!
   - "replace_background": Jika pengguna ingin mengganti warna latar belakang polos (pasfoto biru/merah) atau mengganti seluruh pemandangan latar belakang.
   - "add_background_object": Jika pengguna secara eksplisit meminta menambahkan objek baru di belakang subjek (seperti pohon di belakang, bunga di belakang, awan).
   - "filter_adjust": Jika pengguna meminta efek filter global (hitam-putih, kecerahan, putar, dsb).

2. Jika editMode === "recolor_part":
   - targetPart: "hair" | "clothes" | "accessory" | "object".
   - targetBoxes (skala 0..1000): array kotak area bagian target. PENTING: Untuk rambut ('hair'), kotak HARUS mencakup puncak paling atas kepala (top crown / ubun-ubun) hingga ujung rambut bagian bawah dan samping! Berikan margin atas dan samping yang cukup agar tidak ada rambut yang terpotong. Untuk pakaian/baju ('clothes'), sertakan seluruh area pakaian yang diminta.
   - excludeBoxes (skala 0..1000): array kotak area yang WAJIB dilindungi dan TIDAK BOLEH terkena perubahan warna. PENTING: Saat mengubah rambut ('hair'), WAJIB sertakan kotak wajah bagian dalam (mata, hidung, mulut, kacamata, pipi, dahi) dan kotak pakaian/tubuh di bawah leher agar warna tidak tumpah ke pakaian.
   - samplePoints (skala 0..1000): 4-6 titik koordinat tepat di atas permukaan bagian target yang tersebar merata: untuk rambut, tempatkan titik di mahkota atas rambut, sisi kiri rambut, sisi kanan rambut, bagian tengah rambut, dan highlight/jambul rambut (jika ada).
   - sourceColorsHex: daftar warna hex asli dari bagian tersebut (misal rambut cokelat gelap & abu-abu: ["#4f2d1c", "#322c13", "#c5a79e"]).
   - targetColorHex: kode hex warna tujuan (contoh: "#ffffff" untuk putih, "#dc2626" untuk merah, "#1d4ed8" untuk biru).

3. Jika editMode === "replace_background" atau ada permintaan ganti warna latar:
   - backgroundColorHex: kode hex warna latar baru.
   - subjectBox (skala 0..1000): kotak batas subjek utama di depan.

4. HANYA JIKA editMode === "add_background_object":
   - Buat visualScenePrompt dan svgSceneMarkup elemen objek/latar belakang dalam SVG dengan viewBox="0 0 1000 750" yang diletakkan di belakang subjek. (JANGAN buat svgSceneMarkup jika editMode !== "add_background_object"!).

5. Berikan penjelasan singkat, ramah, dan santai dalam Bahasa Indonesia (explanation) yang menjelaskan perubahan apa saja yang telah dilakukan.

KEMBALIKAN HANYA JSON VALID:
{
  "editMode": "recolor_part",
  "targetPart": "hair",
  "targetBoxes": [{ "ymin": 160, "xmin": 190, "ymax": 470, "xmax": 500 }],
  "excludeBoxes": [
    { "ymin": 250, "xmin": 285, "ymax": 445, "xmax": 440 },
    { "ymin": 450, "xmin": 220, "ymax": 950, "xmax": 580 }
  ],
  "samplePoints": [
    { "x": 340, "y": 210 },
    { "x": 250, "y": 340 },
    { "x": 440, "y": 340 },
    { "x": 380, "y": 260 },
    { "x": 330, "y": 430 }
  ],
  "sourceColorsHex": ["#4f2d1c", "#322c13", "#301c13", "#c5a79e"],
  "targetColorHex": "#ffffff",
  "subjectBox": { "ymin": 120, "xmin": 180, "ymax": 950, "xmax": 820 },
  "explanation": "Warna rambut subjek di foto telah berhasil diubah menjadi putih."
}`;

    const isHairIntent = /rambut/i.test(rawInstruction);
    const isClothesIntent = /baju|jas|celana|kaos|pakaian|dasi/i.test(rawInstruction);
    const isRecolorIntent = isHairIntent || isClothesIntent || /sepatu|kupu|warna\s+(rambut|baju|jas|celana)/i.test(rawInstruction);
    let visionResult: any = {
      editMode: isRecolorIntent
        ? "recolor_part"
        : action === "add_object"
        ? "add_background_object"
        : action === "background_color"
        ? "replace_background"
        : "transform",
      targetPart: isHairIntent
        ? "hair"
        : isClothesIntent
        ? "clothes"
        : "object",
      targetBoxes: isHairIntent
        ? [{ ymin: 160, xmin: 180, ymax: 470, xmax: 510 }]
        : [{ ymin: 360, xmin: 240, ymax: 850, xmax: 600 }],
      excludeBoxes: isHairIntent
        ? [
            { ymin: 250, xmin: 280, ymax: 445, xmax: 440 },
            { ymin: 450, xmin: 220, ymax: 950, xmax: 580 }
          ]
        : [{ ymin: 150, xmin: 220, ymax: 380, xmax: 480 }],
      samplePoints: isHairIntent
        ? [
            { x: 340, y: 210 },
            { x: 250, y: 340 },
            { x: 440, y: 340 },
            { x: 380, y: 260 },
            { x: 330, y: 430 }
          ]
        : [
            { x: 350, y: 480 },
            { x: 400, y: 550 }
          ],
      sourceColorsHex: isHairIntent
        ? ["#4f2d1c", "#322c13", "#301c13", "#302623", "#c5a79e"]
        : ["#2b1c17", "#1d4ed8"],
      targetColorHex: /putih/i.test(rawInstruction)
        ? "#ffffff"
        : /merah/i.test(rawInstruction)
        ? "#dc2626"
        : /biru/i.test(rawInstruction)
        ? "#1d4ed8"
        : "#ffffff",
      subjectBox: { ymin: 120, xmin: 180, ymax: 950, xmax: 820 },
      backgroundColorHex: userBgColor || undefined,
      visualScenePrompt: rawInstruction,
      svgSceneMarkup: undefined,
      explanation: `Perubahan visual pada foto '${params.fileName || "foto"}' telah diterapkan.`,
    };

    try {
      const keys =
        config.geminiApiKeys && config.geminiApiKeys.length > 0
          ? config.geminiApiKeys
          : [config.geminiApiKey];

      const candidateModels = [
        "gemini-flash-lite-latest",
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-3-flash-preview",
      ];

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

      let visionSucceeded = false;
      for (const modelToTry of candidateModels) {
        if (visionSucceeded) break;
        for (const key of keys) {
          if (!key) continue;
          try {
            const ai = new GoogleGenAI({ apiKey: key });
            const resp = (await Promise.race([
              ai.models.generateContent({
                model: modelToTry,
                contents,
                config: {
                  responseMimeType: "application/json",
                },
              }),
              new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 4500)),
            ])) as any;
            const rawText = cleanJson(resp?.text || "");
            if (rawText) {
              let parsed = JSON.parse(rawText);
              if (Array.isArray(parsed)) parsed = parsed[0];
              if (parsed && typeof parsed === "object") {
                visionResult = { ...visionResult, ...parsed };
                visionSucceeded = true;
                break;
              }
            }
          } catch (kErr) {
            console.warn("[DocumentService processImageEdit] Key failed:", (kErr as any)?.message || kErr);
          }
        }
      }
    } catch (err) {
      console.warn("[DocumentService processImageEdit] Vision fallback:", err);
    }

    let generatedImageDataUrl: string | null = null;
    if (
      visionResult.visualScenePrompt &&
      (action === "add_object" ||
        action === "replace_background" ||
        visionResult.editMode === "add_background_object")
    ) {
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
      editMode: visionResult.editMode,
      targetPart: visionResult.targetPart,
      targetBoxes: visionResult.targetBoxes,
      excludeBoxes: visionResult.excludeBoxes,
      samplePoints: visionResult.samplePoints,
      sourceColorsHex: visionResult.sourceColorsHex,
      targetColorHex: visionResult.targetColorHex,
      subjectBox: visionResult.subjectBox,
      backgroundColorHex: visionResult.backgroundColorHex || userBgColor,
      backgroundImageDataUrl: generatedImageDataUrl,
      svgSceneMarkup:
        visionResult.editMode === "add_background_object"
          ? visionResult.svgSceneMarkup
          : undefined,
      explanation: visionResult.explanation,
    };
  }
}

export const documentService = new DocumentService();
