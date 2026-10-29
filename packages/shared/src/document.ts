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

/**
 * Membentuk ringkasan konteks dokumen yang aman untuk disuntikkan ke sesi audio Gemini Live.
 * Sesi WebSocket Live memiliki batas kuota TPM (Token Per Minute) ketat per turn audio.
 * Jika dokumen sangat besar (seperti PDF buku / clinical guidelines 127 halaman ~600.000 karakter),
 * fungsi ini mengekstrak bagian kepala (judul, ringkasan eksekutif, bab awal) dan kesimpulan,
 * serta menyematkan ringkasan jumlah halaman & karakter. Teks lengkap tetap utuh di `doc.markdownContent`
 * untuk pemrosesan tool / dokumen penuh.
 */
export function buildSafeLiveDocumentContext(
  doc: ParsedDocument,
  maxSafeChars: number = 20000
): string {
  const content = doc.markdownContent || "";
  const totalChars = doc.characterCount || content.length;
  const pages = doc.totalPages || 1;

  let injectedText = content;
  let isTruncatedForLive = false;

  if (content.length > maxSafeChars) {
    isTruncatedForLive = true;
    const headChars = Math.floor(maxSafeChars * 0.72); // ~14.400 karakter
    const tailChars = Math.floor(maxSafeChars * 0.28); // ~5.600 karakter

    const head = content.slice(0, headChars).trim();
    const tail = content.slice(-tailChars).trim();

    injectedText = `${head}\n\n... [Bagian isi tengah dokumen (halaman 2 s.d ${Math.max(2, pages - 2)}) tersimpan lengkap di memori Celyn (${totalChars.toLocaleString("id-ID")} karakter). Teks lengkap siap digunakan untuk analisis mendalam, perangkuman bab spesifik, atau ekspor.] ...\n\n${tail}`;
  }

  return `[PENGGUNA MENGUNGGAH DOKUMEN: ${doc.fileName}]
Informasi Dokumen: ${pages} Halaman, ${totalChars.toLocaleString("id-ID")} Karakter${isTruncatedForLive ? " (Dokumen Komprehensif / Lengkap)" : ""}.
Berikut adalah intisari isi dokumen yang baru saja dibaca:

<document_context fileName="${doc.fileName}" pages="${pages}" characters="${totalChars}">
${injectedText}
</document_context>

INSTRUKSI RESPON WAJIB: Dokumen '${doc.fileName}' (${pages} halaman, ${totalChars.toLocaleString("id-ID")} karakter) baru saja diunggah oleh pengguna dan seluruh teks lengkapnya telah tersimpan di memorimu. Segera respon secara lisan dengan hangat, ramah, dan natural dalam Bahasa Indonesia bahwa kamu sudah membaca tuntas dokumen '${doc.fileName}' tersebut (sebutkan topik/judul utamanya jika tampak dari isi dokumen), lalu tanyakan kepada pengguna dokumen ini mau diapakan (contohnya: mau dirangkum poin-poin utamanya, dicari rekomendasi terapi atau bab tertentu, diedit isinya, atau diekspor ke PDF/Word/Excel). JANGAN membaca seluruh isi dokumen kata per kata, cukup sapa dan tanyakan rencana pengguna terhadap dokumen ini.`;
}

/**
 * Membentuk konteks dokumen yang aman untuk pembuatan dokumen (PDF, Word, Excel)
 * tanpa menabrak batas payload HTTP 4.5 MB Vercel Serverless maupun batas token model.
 * Jika dokumen di bawah batas aman (default 1.500.000 karakter ~ 1.5 MB),
 * 100% teks lengkap disertakan secara utuh.
 */
export function buildSafeDocumentGenerationContext(
  docs: ParsedDocument[],
  maxSafeChars: number = 1500000
): string {
  if (!docs || docs.length === 0) return "";

  // Bagi kapasitas secara adil per dokumen (minimal 50.000 karakter per doc)
  const perDocBudget = Math.max(50000, Math.floor((maxSafeChars - docs.length * 200) / docs.length));

  return docs
    .map((d) => {
      const rawContent = d.markdownContent || "";
      const totalChars = d.characterCount || rawContent.length;
      const pages = d.totalPages || 1;
      let text = rawContent;

      if (rawContent.length > perDocBudget) {
        const headLen = Math.floor(perDocBudget * 0.7);
        const tailLen = Math.floor(perDocBudget * 0.3);
        text = `${rawContent.slice(0, headLen)}\n\n... [Bagian tengah dokumen (${(
          totalChars - headLen - tailLen
        ).toLocaleString("id-ID")} karakter) diringkas secara cerdas untuk batas kapasitas pemrosesan Celyn AI] ...\n\n${rawContent.slice(-tailLen)}`;
      }

      return `# Dokumen: ${d.fileName} (${pages} Halaman, ${totalChars.toLocaleString("id-ID")} Karakter)\n\n${text}`;
    })
    .join("\n\n---\n\n");
}
