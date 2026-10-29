import { z } from "zod";

// =========================================================================
// SKEMA LAPORAN TEKS / DOKUMEN (WORD .docx & PDF .pdf)
// =========================================================================

export const DocumentSectionSchema = z.object({
  heading: z.string().describe("Subjudul bagian dokumen"),
  paragraphs: z.array(z.string()).describe("Daftar paragraf penjelasan"),
  bulletPoints: z.array(z.string()).nullable().optional().describe("Poin-poin penting (opsional)"),
  table: z
    .object({
      headers: z.array(z.string()),
      rows: z.array(z.array(z.string())),
    })
    .nullable()
    .optional()
    .describe("Tabel data pendukung jika ada"),
});

export const ReportPayloadSchema = z.object({
  title: z.string().describe("Judul utama dokumen"),
  subtitle: z.string().nullable().optional().describe("Subjudul atau keterangan tambahan"),
  sections: z.array(DocumentSectionSchema).min(1).describe("Daftar bab/bagian isi dokumen"),
});

export type DocumentSection = z.infer<typeof DocumentSectionSchema>;
export type ReportPayload = z.infer<typeof ReportPayloadSchema>;

// =========================================================================
// SKEMA LEMBAR KERJA (EXCEL .xlsx)
// =========================================================================

// Karakter terlarang di nama sheet Excel: : \ / ? * [ ]
function sanitizeSheetName(name: string): string {
  const cleaned = (name || "Sheet1")
    .replace(/[:\\/?*\[\]]/g, "_")
    .trim()
    .slice(0, 31);
  return cleaned || "Sheet1";
}

export const ExcelColumnSchema = z.object({
  header: z.string().describe("Nama judul kolom"),
  key: z.string().describe("Kunci id kolom unik (contoh: 'nama', 'harga')"),
  type: z
    .enum(["string", "number", "currency", "percentage", "date"])
    .default("string")
    .describe("Format data kolom"),
});

export const ExcelSheetSchema = z.object({
  sheetName: z
    .string()
    .max(31)
    .default("Sheet1")
    .transform(sanitizeSheetName)
    .describe("Nama sheet (maks 31 karakter, karakter invalid otomatis diganti)"),
  columns: z.array(ExcelColumnSchema).min(1).describe("Daftar definisi kolom"),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()])))
    .describe("Baris-baris data sheet"),
});

export const ExcelPayloadSchema = z.object({
  fileName: z.string().describe("Nama file output tanpa ekstensi"),
  sheets: z.array(ExcelSheetSchema).min(1).describe("Daftar sheet pada workbook"),
});

export type ExcelColumn = z.infer<typeof ExcelColumnSchema>;
export type ExcelSheet = z.infer<typeof ExcelSheetSchema>;
export type ExcelPayload = z.infer<typeof ExcelPayloadSchema>;

// =========================================================================
// TIPE HASIL EKSTRAKSI PEMBACA DOKUMEN (READER & HYBRID OCR)
// =========================================================================

export interface ParsedDocument {
  fileName: string;
  mimeType: string;
  markdownContent: string;
  usedOcr: boolean;
  totalPages?: number;
  truncated: boolean;
  characterCount: number;
}

// =========================================================================
// TIPE TOOL CALL DOKUMEN GEMINI LIVE
// =========================================================================

export type DocumentKind = "pdf" | "docx" | "xlsx";

export interface CreateDocumentArgs {
  kind: DocumentKind;
  title: string;
  instruction: string;
}

// =========================================================================
// UTILITAS SANITASI MARKDOWN -> TEKS BERSIH
// =========================================================================

/**
 * Membersihkan format Markdown mentah (seperti **, ##, _, `, [link](url))
 * agar teks yang masuk ke elemen Word atau PDF tampil murni dan profesional.
 */
export function stripMarkdownFormatting(rawText: string): string {
  if (!rawText) return "";
  return rawText
    .replace(/^#+\s+/gm, "") // Heading #
    .replace(/\*\*([^*]+)\*\*/g, "$1") // Bold **
    .replace(/\*([^*]+)\*/g, "$1") // Italic *
    .replace(/__([^_]+)__/g, "$1") // Bold __
    .replace(/_([^_]+)_/g, "$1") // Italic _
    .replace(/~~([^~]+)~~/g, "$1") // Strikethrough ~~
    .replace(/`([^`]+)`/g, "$1") // Inline code `
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Link [text](url)
    .replace(/^[*-]\s+/gm, "") // List bullets
    .trim();
}
