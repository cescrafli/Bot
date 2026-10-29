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
} from "@celyn/shared";
import { config } from "../config.js";
import { documentWriterService } from "./DocumentWriterService.js";

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
    const model = config.docGenerateModel || "gemini-3-flash-preview";
    const prompt = buildDocumentChunkPrompt(params);
    const res = await this.callGeminiJson(model, prompt);
    const parsed = JSON.parse(res.text || "{}");
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
    const model = config.docGenerateModel || "gemini-3-flash-preview";
    const safeTitle = (title || "Dokumen")
      .replace(/[\\/:*?"<>|]/g, "_")
      .trim()
      .slice(0, 50) || "Dokumen";

    const expert = inferExpertPersona(`${title} ${instruction}`);

    if (kind === "xlsx") {
      // 1. GENERATE EXCEL VIA GEMINI JSON DENGAN PERSONA PAKAR SENIOR
      const prompt = `Anda adalah ${expert.persona}.
Tugas Anda: Membuat data lembar kerja Excel (XLSX) profesional tingkat tinggi yang komprehensif, rapi, dan siap analisis di bidang ${expert.fieldLabel}.
Judul/Nama Dokumen Riset: "${title}"
Instruksi Pengguna: "${instruction}"
Fokus Keahlian (${expert.fieldLabel}): ${expert.promptGuide}
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
      const parsed = JSON.parse(res.text || "{}");
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
3. Setiap section harus memuat 'paragraphs' mendalam (2-4 paragraf berbobot) dan/atau 'bulletPoints' tajam. JANGAN masukkan tag markdown seperti ** atau ## ke dalam teks paragraf.
4. 'table': (Opsional) Tabel data pendukung dengan 'headers' dan 'rows' jika relevan.

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
      const parsed = JSON.parse(res.text || "{}");
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
      const parsed = JSON.parse(res.text || "{}");
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
      const parsed = JSON.parse(res.text || "{}");
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
}

export const documentService = new DocumentService();
