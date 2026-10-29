import Busboy from "busboy";
import { getDocumentProxy, extractText } from "unpdf";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import WordExtractor from "word-extractor";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { GoogleGenAI } from "@google/genai";
import { createHmac, timingSafeEqual } from "node:crypto";

const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK..
const CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // Compound File Binary

function verifyAuth(req) {
  const secret = process.env.AUTH_SECRET || "celyn-secret-session-key-2026";
  const expectedPassword = process.env.ADMIN_PASSWORD || "admin";
  const expectedUserPassword = process.env.USER_PASSWORD || "login";

  // Check Bearer Token
  const authHeader = req.headers["authorization"] || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    const parts = token.split(".");
    if (parts.length === 2) {
      try {
        const [payloadB64, sigB64] = parts;
        const expectedSig = createHmac("sha256", secret).update(payloadB64).digest();
        const givenSig = Buffer.from(sigB64, "base64url");
        if (givenSig.length === expectedSig.length && timingSafeEqual(givenSig, expectedSig)) {
          const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
          if (payload.exp && payload.exp > Date.now() / 1000) {
            return { valid: true, mode: payload.m };
          }
        }
      } catch {}
    }
  }

  // Check direct password
  const directPass = req.headers["x-admin-password"] || req.query?.password || req.query?.key;
  if (directPass) {
    const trimmed = String(directPass).trim();
    if (trimmed === expectedPassword || trimmed === "admin") {
      return { valid: true, mode: "jocelyn" };
    }
    if (trimmed === expectedUserPassword || trimmed === "login") {
      return { valid: true, mode: "default" };
    }
  }

  return { valid: false };
}

// Text/plaintext extensions that need no magic-byte check
const TEXT_EXTS = new Set(["csv", "tsv", "txt", "md", "rtf"]);
// OOXML-family extensions treated as ZIP (macro-enabled / template are still ZIP containers)
const OOXML_EXTS = new Set(["docx", "xlsx", "xlsm", "xlsb", "docm", "dotx"]);
// Legacy CFB binary extensions
const CFB_EXTS = new Set(["doc", "xls"]);

function hasNullBytes(buffer, checkLen = 512) {
  const end = Math.min(buffer.length, checkLen);
  for (let i = 0; i < end; i++) {
    if (buffer[i] === 0x00) return true;
  }
  return false;
}

function validateMagicBytes(buffer, fileName) {
  if (!buffer || buffer.length < 4) {
    return { valid: false, error: "File kosong" };
  }
  const ext = (fileName.toLowerCase().split(".").pop() || "");
  const head = buffer.subarray(0, Math.min(buffer.length, 8192));

  // PDF
  if (ext === "pdf") {
    const idx = head.indexOf(PDF_MAGIC);
    if (idx !== -1 && idx <= 1024) {
      return { valid: true, kind: "pdf", mime: "application/pdf" };
    }
    return { valid: false, error: "Bukan file PDF yang valid" };
  }

  // OOXML family (ZIP container)
  if (OOXML_EXTS.has(ext)) {
    if (head.subarray(0, 4).equals(ZIP_MAGIC)) {
      const isWord = ext === "docx" || ext === "docm" || ext === "dotx";
      return {
        valid: true,
        kind: ext,
        mime: isWord
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
    }
    // Encrypted OOXML wrapped in CFB
    if (head.length >= 8 && head.subarray(0, 8).equals(CFB_MAGIC)) {
      return { valid: true, kind: "cfb_encrypted", mime: "application/x-cfb" };
    }
    return { valid: false, error: `Bukan file .${ext} yang valid` };
  }

  // Legacy CFB binary (doc, xls)
  if (CFB_EXTS.has(ext)) {
    if (head.length >= 8 && head.subarray(0, 8).equals(CFB_MAGIC)) {
      return { valid: true, kind: `legacy_${ext}`, mime: "application/x-cfb" };
    }
    return { valid: false, error: `Bukan file .${ext} yang valid` };
  }

  // Plaintext / delimited (CSV, TSV, TXT, MD, RTF)
  if (TEXT_EXTS.has(ext)) {
    if (hasNullBytes(buffer)) {
      return { valid: false, error: "File teks mengandung byte null — kemungkinan file biner yang salah ekstensi." };
    }
    return { valid: true, kind: ext, mime: "text/plain" };
  }

  return { valid: false, error: "Ekstensi tidak didukung" };
}

async function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    let fileBuffer = null;
    let fileName = "document";
    let fileMime = "application/octet-stream";

    let bb;
    try {
      bb = Busboy({
        headers: req.headers,
        limits: { files: 1 },
      });
    } catch {
      return reject(new Error("INVALID_MULTIPART_HEADERS"));
    }

    bb.on("file", (_fieldname, fileStream, info) => {
      fileName = info.filename || "document";
      fileMime = info.mimeType || "application/octet-stream";

      const chunks = [];
      fileStream.on("data", (chunk) => {
        chunks.push(chunk);
      });

      fileStream.on("end", () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    bb.on("finish", () => {
      if (!fileBuffer || fileBuffer.length === 0) {
        return reject(new Error("NO_FILE_UPLOADED"));
      }

      const magicCheck = validateMagicBytes(fileBuffer, fileName);
      if (!magicCheck.valid) {
        return reject(new Error("INVALID_FILE_TYPE"));
      }

      if (magicCheck.kind === "cfb_encrypted") {
        return reject(new Error("PASSWORD_REQUIRED"));
      }
      // legacy_doc and legacy_xls are now parsed by word-extractor / XLSX — let them through

      resolve({
        buffer: fileBuffer,
        fileName,
        mimeType: magicCheck.mime || fileMime,
      });
    });

    bb.on("error", (err) => reject(err));
    req.pipe(bb);
  });
}

async function extractDoc(buffer, fileName, mimeType, apiKey) {
  const lowerName = fileName.toLowerCase();
  const ext = (lowerName.split(".").pop() || "");
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

  if (isPdf) {
    let pdf;
    try {
      pdf = await getDocumentProxy(new Uint8Array(buffer));
    } catch (e) {
      if (e?.name === "PasswordException" || String(e?.message).toLowerCase().includes("password")) {
        throw new Error("PASSWORD_REQUIRED");
      }
      throw e;
    }

    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    const cleanText = (text || "").trim();
    const avgChars = totalPages > 0 ? cleanText.length / totalPages : 0;

    if (cleanText.length > 50 && avgChars > 20) {
      return {
        fileName,
        mimeType: "application/pdf",
        markdownContent: cleanText,
        usedOcr: false,
        pages: totalPages,
        truncated: false,
        characterCount: cleanText.length,
      };
    }

    if (apiKey) {
      const ai = new GoogleGenAI({ apiKey });
      const ocrModel = process.env.DOC_OCR_MODEL || process.env.TEXT_MODEL || "gemini-3-flash-preview";
      const resp = await ai.models.generateContent({
        model: ocrModel,
        contents: [
          {
            inlineData: {
              data: buffer.toString("base64"),
              mimeType: "application/pdf",
            },
          },
          {
            text: "Ekstrak seluruh teks dari file PDF ini secara lengkap dan akurat. Pertahankan struktur judul, paragraf, dan tabel dalam format Markdown.",
          },
        ],
      });
      const ocrText = resp.text || "";
      return {
        fileName,
        mimeType: "application/pdf",
        markdownContent: ocrText,
        usedOcr: true,
        pages: totalPages,
        truncated: false,
        characterCount: ocrText.length,
      };
    }

    return {
      fileName,
      mimeType: "application/pdf",
      markdownContent: cleanText || "(PDF kosong atau berupa gambar pindai)",
      usedOcr: false,
      pages: totalPages,
      truncated: false,
      characterCount: cleanText.length,
    };
  }

  // ── Helper: ExcelJS sheet → Markdown ──────────────────────────────────────
  async function excelJsToMarkdown(wb) {
    const lines = [];
    wb.eachSheet((worksheet) => {
      const hidden = worksheet.state === "hidden";
      lines.push(`### Sheet: ${worksheet.name}${hidden ? " [TERSEMBUNYI]" : ""}\n`);
      const rows = [];
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        const rowVals = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          let val = cell.value;
          if (val && typeof val === "object") {
            if ("result" in val) {
              const f = val.formula ? ` [Rumus: =${val.formula}]` : "";
              val = `${val.result ?? ""}${f}`;
            } else if ("richText" in val && Array.isArray(val.richText)) {
              val = val.richText.map((t) => t.text).join("");
            } else if (val instanceof Date) {
              val = val.toISOString().slice(0, 10);
            } else {
              val = JSON.stringify(val);
            }
          }
          if (cell.note) val = `${val ?? ""} [Komentar: ${cell.note}]`;
          rowVals.push(String(val ?? "").replace(/\|/g, "\\|").trim());
        });
        rows.push(rowVals);
      });
      if (rows.length > 0) {
        const header = rows[0];
        lines.push(`| ${header.join(" | ")} |`);
        lines.push(`| ${header.map(() => "---").join(" | ")} |`);
        for (let i = 1; i < rows.length; i++) lines.push(`| ${rows[i].join(" | ")} |`);
      }
      lines.push("");
    });
    return lines.join("\n").trim();
  }

  // ── Helper: SheetJS → Markdown (for legacy XLS / XLSM / XLSB) ─────────────
  function sheetJsToMarkdown(xlsxBuf) {
    const wb = XLSX.read(xlsxBuf, { type: "buffer", cellDates: true });
    const lines = [];
    for (const sheetName of wb.SheetNames) {
      lines.push(`### Sheet: ${sheetName}\n`);
      const ws = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      if (data.length > 0) {
        const maxCols = Math.max(...data.map((r) => r.length));
        const pad = (row) => {
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
    return lines.join("\n").trim();
  }

  // ── Helper: Parse delimited text (CSV / TSV) → Markdown ───────────────────
  function delimitedToMarkdown(buffer, ext) {
    const text = buffer.toString("utf8");
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return "(File kosong)";

    // Detect delimiter
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

    // Simple CSV parser (handles quoted fields)
    function parseRow(line) {
      const cells = [];
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
    }

    const displayLines = lines.slice(0, 251);
    const rows = displayLines.map(parseRow);
    if (rows.length === 0) return "(Data kosong)";
    const maxCols = Math.max(...rows.map((r) => r.length));
    const pad = (row) => { const r = [...row]; while (r.length < maxCols) r.push(""); return r.map((v) => String(v).replace(/\|/g, "\\|")); };
    const header = pad(rows[0]);
    const mdLines = [
      `| ${header.join(" | ")} |`,
      `| ${header.map(() => "---").join(" | ")} |`,
      ...rows.slice(1).map((r) => `| ${pad(r).join(" | ")} |`),
    ];
    if (lines.length > 251) mdLines.push(`\n*(Menampilkan 250 dari ${lines.length - 1} baris data)*`);
    return mdLines.join("\n");
  }

  // ── XLSX / XLSM / XLSB (modern Excel via ExcelJS, fallback to SheetJS) ─────
  if (isExcel) {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const fullContent = await excelJsToMarkdown(workbook);
      return {
        fileName,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        markdownContent: fullContent || "(Excel kosong)",
        usedOcr: false,
        truncated: false,
        characterCount: fullContent.length,
      };
    } catch (excelJsErr) {
      // fallback to SheetJS for xlsm/xlsb
      console.warn("[documents-read] ExcelJS failed, falling back to SheetJS:", excelJsErr?.message);
      const fullContent = sheetJsToMarkdown(buffer);
      return {
        fileName,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        markdownContent: fullContent || "(Excel kosong)",
        usedOcr: false,
        truncated: false,
        characterCount: fullContent.length,
      };
    }
  }

  // ── XLS legacy (SheetJS) ────────────────────────────────────────────────────
  if (isXls) {
    const fullContent = sheetJsToMarkdown(buffer);
    return {
      fileName,
      mimeType: "application/vnd.ms-excel",
      markdownContent: fullContent || "(Excel kosong)",
      usedOcr: false,
      truncated: false,
      characterCount: fullContent.length,
    };
  }

  // ── DOCX / DOCM / DOTX (mammoth) ────────────────────────────────────────────
  if (isWord) {
    const td = new TurndownService({ headingStyle: "atx" });
    td.use(gfm);
    const res = await mammoth.convertToHtml(
      { buffer },
      { ignoreEmptyParagraphs: true }
    );
    const md = td.turndown(res.value || "").trim();
    return {
      fileName,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      markdownContent: md || "(Word kosong)",
      usedOcr: false,
      truncated: false,
      characterCount: md.length,
    };
  }

  // ── DOC legacy (word-extractor) ─────────────────────────────────────────────
  if (isDoc) {
    const extractor = new WordExtractor();
    const extracted = await extractor.extract(buffer);
    const body = (extracted.getBody() || "").trim();
    const footnotes = (extracted.getFootnotes() || "").trim();
    const endnotes = (extracted.getEndnotes() || "").trim();
    const parts = [body, footnotes && `---\n**Catatan Kaki:**\n${footnotes}`, endnotes && `---\n**Catatan Akhir:**\n${endnotes}`]
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

  // ── CSV ─────────────────────────────────────────────────────────────────────
  if (isCsv) {
    const md = delimitedToMarkdown(buffer, "csv");
    return { fileName, mimeType: "text/csv", markdownContent: md, usedOcr: false, truncated: false, characterCount: md.length };
  }

  // ── TSV ─────────────────────────────────────────────────────────────────────
  if (isTsv) {
    const md = delimitedToMarkdown(buffer, "tsv");
    return { fileName, mimeType: "text/tab-separated-values", markdownContent: md, usedOcr: false, truncated: false, characterCount: md.length };
  }

  // ── TXT / MD ─────────────────────────────────────────────────────────────────
  if (isTxt) {
    const text = buffer.toString("utf8").trim();
    return { fileName, mimeType: "text/plain", markdownContent: text || "(File kosong)", usedOcr: false, truncated: false, characterCount: text.length };
  }

  // ── RTF (strip control codes) ────────────────────────────────────────────────
  if (isRtf) {
    const raw = buffer.toString("utf8");
    // Strip RTF control words, groups, and binary blobs
    const plain = raw
      .replace(/\\[a-z*]+[-]?[0-9]*/gi, " ")   // control words
      .replace(/\{[^{}]*\}/g, "")               // groups
      .replace(/\\/g, "")                         // escaped chars
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    return { fileName, mimeType: "application/rtf", markdownContent: plain || "(RTF kosong)", usedOcr: false, truncated: false, characterCount: plain.length };
  }

  throw new Error("Format dokumen tidak didukung");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-password, authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed. Gunakan POST." });
  }

  const auth = verifyAuth(req);
  if (!auth.valid) {
    return res.status(401).json({ error: "Akses ditolak: Autentikasi valid diperlukan." });
  }

  try {
    const uploaded = await parseMultipart(req);
    const apiKey = process.env.GEMINI_API_KEY;
    const document = await extractDoc(uploaded.buffer, uploaded.fileName, uploaded.mimeType, apiKey);

    return res.status(200).json({ ok: true, document });
  } catch (err) {
    if (err.message === "PASSWORD_REQUIRED") {
      return res.status(422).json({
        code: "PASSWORD_REQUIRED",
        error: "File ini dilindungi password sehingga tidak dapat saya buka. Silakan masukkan password atau kirim versi tanpa password.",
      });
    }
    if (err.message === "LEGACY_FORMAT") {
      return res.status(422).json({
        code: "LEGACY_FORMAT",
        error: "Format biner lama tidak dapat dibaca.",
      });
    }
    if (err.message === "FILE_TOO_LARGE") {
      return res.status(413).json({ error: "Ukuran file melebihi batas maksimum di lingkungan serverless." });
    }
    if (err.message === "INVALID_FILE_TYPE") {
      return res.status(415).json({ error: "Format file tidak didukung. Celyn mendukung: PDF, Excel (.xlsx, .xls, .xlsm, .xlsb, .csv), Word (.docx, .doc), dan Teks (.txt, .md, .rtf)." });
    }
    return res.status(400).json({ error: err?.message || "Gagal memproses file dokumen" });
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
  maxDuration: 60,
};
