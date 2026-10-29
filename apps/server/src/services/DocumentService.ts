import { GoogleGenAI } from "@google/genai";
import {
  DocumentKind,
  ExcelPayload,
  ExcelPayloadSchema,
  ReportPayload,
  ReportPayloadSchema,
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

export class DocumentService {
  private ai: GoogleGenAI | null = null;

  constructor() {
    if (config.geminiApiKey) {
      this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    }
  }

  /**
   * Menghasilkan file dokumen (PDF, Word, atau Excel) secara cerdas menggunakan Gemini
   * dan langsung mengembalikan raw binary Buffer (stateless tanpa penyimpanan sementara).
   */
  async generateDocument(params: GenerateDocumentParams): Promise<GeneratedDocumentResult> {
    if (!this.ai) {
      throw new Error("GEMINI_API_KEY belum dikonfigurasi di server.");
    }

    const { kind, title, instruction, context } = params;
    const model = config.docGenerateModel || "gemini-3-flash-preview";
    const safeTitle = (title || "Dokumen")
      .replace(/[\\/:*?"<>|]/g, "_")
      .trim()
      .slice(0, 50) || "Dokumen";

    if (kind === "xlsx") {
      // 1. GENERATE EXCEL VIA GEMINI JSON
      const prompt = `Anda adalah asisten data profesional. Buatlah data lembar kerja Excel (XLSX) yang terstruktur dan rapi berdasarkan instruksi berikut:
Judul/Nama Dokumen: "${title}"
Instruksi Pengguna: "${instruction}"
${context ? `Konteks/Data Acuan:\n${context}` : ""}

PANDUAN PEMBUATAN EXCEL:
1. Tentukan sheetName yang relevan (maks 31 karakter).
2. Buat kolom (columns) dengan 'header', 'key' (id unik huruf kecil tanpa spasi), dan 'type' ('string' | 'number' | 'currency' | 'percentage' | 'date').
3. Isi baris-baris data (rows) sesuai format tipe kolom. Untuk kolom currency atau number, berikan angka murni (number). Untuk percentage berikan desimal (misal 0.15 untuk 15%).
4. Berikan data yang komprehensif, realistis, dan informatif.

KEMBALIKAN HANYA JSON SESUAI SKEMA BERIKUT:
{
  "fileName": "${safeTitle}",
  "sheets": [
    {
      "sheetName": "Ringkasan",
      "columns": [
        { "header": "Nama Kolom", "key": "nama_kolom", "type": "string" }
      ],
      "rows": [
        { "nama_kolom": "Contoh data" }
      ]
    }
  ]
}`;

      const res = await this.ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: "application/json" },
      });

      const parsed = JSON.parse(res.text || "{}");
      const validated: ExcelPayload = ExcelPayloadSchema.parse(parsed);

      const buffer = await documentWriterService.createExcel(validated);
      return {
        buffer,
        fileName: `${safeTitle}.xlsx`,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
    } else {
      // 2. GENERATE WORD (.docx) ATAU PDF (.pdf) VIA GEMINI JSON
      const isPdf = kind === "pdf";
      const docTypeLabel = isPdf ? "PDF" : "Word (.docx)";

      const prompt = `Anda adalah asisten penulisan laporan profesional. Buatlah draf dokumen laporan ${docTypeLabel} yang rapi, terstruktur, berbobot, dan formal berdasarkan instruksi berikut:
Judul Dokumen: "${title}"
Instruksi Pengguna: "${instruction}"
${context ? `Konteks/Materi Acuan:\n${context}` : ""}

PANDUAN PEMBUATAN DOKUMEN:
1. 'title': Judul utama dokumen yang elegan dan jelas.
2. 'subtitle': Subjudul, tanggal pembuatan, atau instansi/keterangan pembuat.
3. 'sections': Daftar bagian/bab isi dokumen. Tiap section memiliki:
   - 'heading': Subjudul bagian.
   - 'paragraphs': Daftar paragraf penjelasan yang mendalam, mengalir, dan komprehensif. JANGAN masukkan tag markdown seperti ** atau ## ke dalam teks paragraf.
   - 'bulletPoints': (Opsional) Poin-poin kesimpulan atau sorotan penting jika ada.
   - 'table': (Opsional) Tabel data pendukung dengan 'headers' dan 'rows' (array of string) jika relevan.

KEMBALIKAN HANYA JSON SESUAI SKEMA BERIKUT:
{
  "title": "${safeTitle}",
  "subtitle": "Disusun secara otomatis oleh Celyn AI",
  "sections": [
    {
      "heading": "Pendahuluan",
      "paragraphs": [
        "Paragraf pertama penjelasan dokumen secara terperinci."
      ],
      "bulletPoints": [
        "Poin penting 1"
      ]
    }
  ]
}`;

      const res = await this.ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: "application/json" },
      });

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
}

export const documentService = new DocumentService();
