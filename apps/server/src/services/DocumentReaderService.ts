import { extractText, getDocumentProxy } from "unpdf";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import TurndownService from "turndown";
// @ts-expect-error turndown-plugin-gfm does not have bundled TS types in some versions
import { gfm } from "turndown-plugin-gfm";
import * as XLSX from "xlsx";
// @ts-expect-error word-extractor has no bundled types
import WordExtractor from "word-extractor";
import { GoogleGenAI } from "@google/genai";
import { ParsedDocument, detectDocumentProtection } from "@celyn/shared";
import { config } from "../config.js";

export class DocumentReaderService {
  private turndown: TurndownService;
  private ai: GoogleGenAI | null = null;
  private maxContextChars: number;

  constructor(apiKey?: string, maxContextChars?: number) {
    const key = apiKey || config.geminiApiKey;
    if (key) {
      this.ai = new GoogleGenAI({ apiKey: key });
    }
    this.maxContextChars = maxContextChars || config.docMaxContextChars || 60000;

    this.turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
    });

    // Pasang ekstensi GFM agar tag <table> terkonversi menjadi Markdown Table yang rapi
    if (gfm) {
      this.turndown.use(gfm);
    }
  }

  /**
   * Router Utama Pembaca Dokumen (Universal)
   */
  async readDocument(
    buffer: Buffer,
    fileName: string,
    mimeType: string
  ): Promise<ParsedDocument> {
    // 0. Deteksi proteksi password
    const protection = await detectDocumentProtection(buffer, fileName);
    if (protection.isProtected) {
      throw new Error("PASSWORD_REQUIRED");
    }

    const lowerName = fileName.toLowerCase();
    const ext = (lowerName.split(".").pop() || "") as string;

    const isPdf = ext === "pdf" || mimeType === "application/pdf";
    const isExcel = ["xlsx", "xlsm", "xlsb"].includes(ext) ||
      mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const isXls = ext === "xls";
    const isWord = ["docx", "docm", "dotx"].includes(ext) ||
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const isDoc = ext === "doc";
    const isCsv = ext === "csv";
    const isTsv = ext === "tsv";
    const isTxt = ext === "txt" || ext === "md";
    const isRtf = ext === "rtf";

    let result: ParsedDocument;

    if (isPdf) {
      result = await this.readPdfHybrid(buffer, fileName);
    } else if (isExcel) {
      result = await this.readExcel(buffer, fileName);
    } else if (isXls) {
      result = await this.readSpreadsheetLegacy(buffer, fileName);
    } else if (isWord) {
      result = await this.readWord(buffer, fileName);
    } else if (isDoc) {
      result = await this.readWordLegacy(buffer, fileName);
    } else if (isCsv || isTsv) {
      result = this.readDelimited(buffer, fileName, ext);
    } else if (isTxt || isRtf) {
      result = this.readPlainText(buffer, fileName, ext);
    } else {
      throw new Error(`Format dokumen tidak didukung (${mimeType || fileName})`);
    }

    // Batasi panjang karakter jika melebihi kuota konteks
    if (result.markdownContent.length > this.maxContextChars) {
      result.markdownContent =
        result.markdownContent.slice(0, this.maxContextChars) +
        "\n\n*(Catatan: Sebagian isi dokumen dipotong karena batas maksimum konteks)*";
      result.truncated = true;
    }
    result.characterCount = result.markdownContent.length;

    return result;
  }

  /**
   * 1. BACA PDF (HYBRID: Ekstraksi Teks Digital -> Fallback ke Gemini Vision Multimodal OCR)
   */
  private async readPdfHybrid(buffer: Buffer, fileName: string): Promise<ParsedDocument> {
    let cleanText = "";
    let totalPages = 1;

    try {
      const uint8Array = new Uint8Array(buffer);
      const res = await extractText(uint8Array, { mergePages: true });
      totalPages = res.totalPages || 1;
      cleanText = (res.text || "").trim();
    } catch (e: any) {
      if (e?.name === "PasswordException" || String(e?.message).toLowerCase().includes("password")) {
        throw new Error("PASSWORD_REQUIRED");
      }
      console.warn(`[DocumentReader] Gagal ekstraksi teks digital PDF (${fileName}):`, e?.message);
    }

    // Ambang batas cerdas: jika rata-rata karakter per halaman >= 30 dan total > 40 karakter,
    // anggap PDF digital asli dengan teks layer utuh
    const avgCharsPerPage = cleanText.length / Math.max(totalPages, 1);
    const isDigitalPdf = avgCharsPerPage >= 30 && cleanText.length >= 40;

    if (isDigitalPdf) {
      return {
        fileName,
        mimeType: "application/pdf",
        markdownContent: cleanText,
        usedOcr: false,
        totalPages,
        truncated: false,
        characterCount: cleanText.length,
      };
    }

    // Jalur OCR via Gemini Multimodal Vision (jika PDF scan / teks kosong)
    if (!this.ai) {
      return {
        fileName,
        mimeType: "application/pdf",
        markdownContent: cleanText || "(PDF ini berisi scan atau gambar tanpa lapisan teks digital)",
        usedOcr: false,
        totalPages,
        truncated: false,
        characterCount: cleanText.length,
      };
    }

    console.log(`[DocumentReader] PDF ${fileName} terdeteksi minim teks (${avgCharsPerPage.toFixed(1)} chars/page). Mengalihkan ke Celyn OCR Engine...`);

    try {
      const ocrModel = config.docOcrModel || config.textModel || "gemini-3-flash-preview";
      const response = await this.ai.models.generateContent({
        model: ocrModel,
        contents: [
          {
            inlineData: {
              data: buffer.toString("base64"),
              mimeType: "application/pdf",
            },
          },
          {
            text: "Lakukan OCR secara presisi pada dokumen PDF ini. Pertahankan struktur judul, paragraf, daftar poin, dan ubah semua tabel menjadi Markdown Table yang rapi. Jawab hanya dengan teks isi dokumen tanpa salam atau pengantar tambahan.",
          },
        ],
      });

      const ocrText = (response.text || "").trim();
      return {
        fileName,
        mimeType: "application/pdf",
        markdownContent: ocrText || cleanText || "(Isi dokumen PDF tidak dapat dibaca oleh OCR)",
        usedOcr: true,
        totalPages,
        truncated: false,
        characterCount: ocrText.length,
      };
    } catch (ocrErr: any) {
      console.error(`[DocumentReader] Gagal melakukan Gemini OCR pada PDF (${fileName}):`, ocrErr?.message);
      // Fallback ke teks apa pun yang sempat diekstrak
      return {
        fileName,
        mimeType: "application/pdf",
        markdownContent: cleanText || "(Gagal melakukan OCR pada dokumen PDF yang diunggah)",
        usedOcr: false,
        totalPages,
        truncated: false,
        characterCount: cleanText.length,
      };
    }
  }

  /**
   * 2. BACA EXCEL (.xlsx) -> Konversi tiap Sheet ke Markdown Table (termasuk hidden sheet, rumus, dan komentar)
   */
  private async readExcel(buffer: Buffer, fileName: string): Promise<ParsedDocument> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const markdownSections: string[] = [];

    workbook.eachSheet((sheet) => {
      const sheetName = sheet.name;
      const isHidden = sheet.state === "hidden";
      const rowsMarkdown: string[] = [
        `### Sheet: ${sheetName}${isHidden ? " [TERSEMBUNYI]" : ""}\n`,
      ];

      // Tentukan batas kolom aktual
      let maxCols = 0;
      sheet.eachRow({ includeEmpty: false }, (row) => {
        if (row.actualCellCount > maxCols) maxCols = row.actualCellCount;
      });
      maxCols = Math.max(maxCols, sheet.columnCount || 0, 1);

      let isFirstRow = true;

      sheet.eachRow({ includeEmpty: false }, (row) => {
        const cellValues: string[] = [];
        for (let col = 1; col <= maxCols; col++) {
          const cell = row.getCell(col);
          let val = cell.value;

          // Ambil formula dan hasil jika ada
          if (val && typeof val === "object") {
            if ("result" in val && val.result !== undefined && val.result !== null) {
              const formulaNote = (val as any).formula ? ` [Rumus: =${(val as any).formula}]` : "";
              val = `${val.result}${formulaNote}`;
            } else if ("text" in val && typeof (val as any).text === "string") {
              val = (val as any).text;
            } else if ("richText" in val && Array.isArray((val as any).richText)) {
              val = (val as any).richText.map((rt: any) => rt.text || "").join("");
            }
          }

          if (val instanceof Date) {
            val = val.toISOString().split("T")[0];
          }

          let strVal = val === null || val === undefined ? "" : String(val);
          // Lampirkan komentar sel jika ada
          if (cell.note) {
            strVal += ` [Komentar: ${cell.note}]`;
          }

          // Bersihkan karakter pipe dan newline agar tidak merusak format markdown table
          strVal = strVal.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ").trim();
          cellValues.push(strVal);
        }

        rowsMarkdown.push(`| ${cellValues.join(" | ")} |`);

        if (isFirstRow) {
          rowsMarkdown.push(`| ${cellValues.map(() => "---").join(" | ")} |`);
          isFirstRow = false;
        }
      });

      markdownSections.push(rowsMarkdown.join("\n"));
    });

    const fullMarkdown = markdownSections.join("\n\n---\n\n").trim();

    return {
      fileName,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      markdownContent: fullMarkdown || "(Dokumen Excel kosong atau tidak memiliki sel berisi data)",
      usedOcr: false,
      truncated: false,
      characterCount: fullMarkdown.length,
    };
  }

  /**
   * 3. BACA WORD (.docx) -> HTML -> Markdown Table & Heading
   */
  private async readWord(buffer: Buffer, fileName: string): Promise<ParsedDocument> {
    // Abaikan gambar biner agar tidak membengkak dalam format base64
    const result = await mammoth.convertToHtml(
      { buffer },
      {
        ignoreEmptyParagraphs: true,
        convertImage: (mammoth.images as any).imgElement(() => Promise.resolve({ src: "" })),
      }
    );

    const html = result.value || "";
    // Konversi HTML terstruktur ke Markdown dengan dukungan GFM table
    const markdown = this.turndown.turndown(html).trim();

    return {
      fileName,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      markdownContent: markdown || "(Dokumen Word kosong atau tidak memiliki teks yang dapat diekstrak)",
      usedOcr: false,
      truncated: false,
      characterCount: markdown.length,
    };
  }

  /**
   * 4. BACA XLS legacy (.xls) via SheetJS
   */
  private async readSpreadsheetLegacy(buffer: Buffer, fileName: string): Promise<ParsedDocument> {
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const lines: string[] = [];

    for (const sheetName of wb.SheetNames) {
      lines.push(`### Sheet: ${sheetName}\n`);
      const ws = wb.Sheets[sheetName];
      const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      if (data.length > 0) {
        const maxCols = Math.max(...data.map((r) => r.length));
        const pad = (row: any[]) => {
          const r = [...row];
          while (r.length < maxCols) r.push("");
          return r.map((v) => {
            if (v instanceof Date) return v.toISOString().slice(0, 10);
            return String(v ?? "").replace(/\|/g, "\\|").trim();
          });
        };
        const header = pad(data[0]);
        lines.push(`| ${header.join(" | ")} |`);
        lines.push(`| ${header.map(() => "---").join(" | ")} |`);
        const displayRows = data.slice(1, 251);
        for (const row of displayRows) lines.push(`| ${pad(row).join(" | ")} |`);
        if (data.length > 251) lines.push(`\n*(Menampilkan 250 dari ${data.length - 1} baris data)*`);
      }
      lines.push("");
    }

    const fullContent = lines.join("\n").trim();
    return {
      fileName,
      mimeType: "application/vnd.ms-excel",
      markdownContent: fullContent || "(Excel kosong)",
      usedOcr: false,
      truncated: false,
      characterCount: fullContent.length,
    };
  }

  /**
   * 5. BACA DOC legacy (.doc) via word-extractor
   */
  private async readWordLegacy(buffer: Buffer, fileName: string): Promise<ParsedDocument> {
    const extractor = new WordExtractor();
    const extracted = await extractor.extract(buffer);
    const body = (extracted.getBody() || "").trim();
    const footnotes = (extracted.getFootnotes() || "").trim();
    const endnotes = (extracted.getEndnotes() || "").trim();
    const parts = [
      body,
      footnotes && `---\n**Catatan Kaki:**\n${footnotes}`,
      endnotes && `---\n**Catatan Akhir:**\n${endnotes}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      fileName,
      mimeType: "application/msword",
      markdownContent: parts || "(Dokumen Word lama kosong)",
      usedOcr: false,
      truncated: false,
      characterCount: parts.length,
    };
  }

  /**
   * 6. BACA CSV / TSV via delimiter parser
   */
  private readDelimited(buffer: Buffer, fileName: string, ext: string): ParsedDocument {
    const text = buffer.toString("utf8");
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) {
      return { fileName, mimeType: "text/plain", markdownContent: "(File kosong)", usedOcr: false, truncated: false, characterCount: 0 };
    }

    const firstLine = lines[0];
    let delim = ",";
    if (ext === "tsv") {
      delim = "\t";
    } else {
      const tabCount = (firstLine.match(/\t/g) || []).length;
      const semiCount = (firstLine.match(/;/g) || []).length;
      const commaCount = (firstLine.match(/,/g) || []).length;
      if (tabCount > commaCount && tabCount > semiCount) delim = "\t";
      else if (semiCount > commaCount) delim = ";";
    }

    const parseRow = (line: string): string[] => {
      const cells: string[] = [];
      let cur = "";
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"' && !inQuote) { inQuote = true; continue; }
        if (ch === '"' && inQuote) {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else { inQuote = false; }
          continue;
        }
        if (!inQuote && ch === delim) { cells.push(cur.trim()); cur = ""; continue; }
        cur += ch;
      }
      cells.push(cur.trim());
      return cells;
    };

    const displayLines = lines.slice(0, 251);
    const rows = displayLines.map(parseRow);
    const maxCols = Math.max(...rows.map((r) => r.length));
    const pad = (row: string[]) => {
      const r = [...row];
      while (r.length < maxCols) r.push("");
      return r.map((v) => String(v).replace(/\|/g, "\\|"));
    };
    const header = pad(rows[0]);
    const mdLines = [
      `| ${header.join(" | ")} |`,
      `| ${header.map(() => "---").join(" | ")} |`,
      ...rows.slice(1).map((r) => `| ${pad(r).join(" | ")} |`),
    ];
    if (lines.length > 251) mdLines.push(`\n*(Menampilkan 250 dari ${lines.length - 1} baris data)*`);
    const md = mdLines.join("\n");

    return {
      fileName,
      mimeType: ext === "tsv" ? "text/tab-separated-values" : "text/csv",
      markdownContent: md,
      usedOcr: false,
      truncated: false,
      characterCount: md.length,
    };
  }

  /**
   * 7. BACA TXT / MD / RTF (plaintext)
   */
  private readPlainText(buffer: Buffer, fileName: string, ext: string): ParsedDocument {
    let text = buffer.toString("utf8").trim();
    if (ext === "rtf") {
      text = text
        .replace(/\\[a-z*]+[-]?[0-9]*/gi, " ")
        .replace(/\{[^{}]*\}/g, "")
        .replace(/\\/g, "")
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    }
    return {
      fileName,
      mimeType: "text/plain",
      markdownContent: text || "(File kosong)",
      usedOcr: false,
      truncated: false,
      characterCount: text.length,
    };
  }
}

export const documentReaderService = new DocumentReaderService();
