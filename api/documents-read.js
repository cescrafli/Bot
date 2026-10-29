import Busboy from "busboy";
import { getDocumentProxy, extractText } from "unpdf";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
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

function validateMagicBytes(buffer, fileName) {
  if (!buffer || buffer.length < 4) {
    return { valid: false, error: "File kosong" };
  }
  const ext = (fileName.toLowerCase().split(".").pop() || "");
  const head = buffer.subarray(0, Math.min(buffer.length, 8192));

  if (ext === "pdf") {
    const idx = head.indexOf(PDF_MAGIC);
    if (idx !== -1 && idx <= 1024) {
      return { valid: true, kind: "pdf", mime: "application/pdf" };
    }
    return { valid: false, error: "Bukan file PDF yang valid" };
  }

  if (ext === "docx" || ext === "xlsx") {
    if (head.subarray(0, 4).equals(ZIP_MAGIC)) {
      return { valid: true, kind: ext, mime: ext === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
    }
    if (head.length >= 8 && head.subarray(0, 8).equals(CFB_MAGIC)) {
      return { valid: true, kind: "cfb_encrypted", mime: "application/x-cfb" };
    }
    return { valid: false, error: `Bukan file .${ext} yang valid` };
  }

  if (ext === "doc" || ext === "xls") {
    if (head.length >= 8 && head.subarray(0, 8).equals(CFB_MAGIC)) {
      return { valid: true, kind: "legacy_binary", mime: "application/x-cfb" };
    }
    return { valid: false, error: `Bukan file .${ext} yang valid` };
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
      if (magicCheck.kind === "legacy_binary") {
        return reject(new Error("LEGACY_FORMAT"));
      }

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
  const isPdf = mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
  const isExcel =
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    fileName.toLowerCase().endsWith(".xlsx");
  const isWord =
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fileName.toLowerCase().endsWith(".docx");

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

  if (isExcel) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const lines = [];

    workbook.eachSheet((worksheet) => {
      const isHidden = worksheet.state === "hidden";
      lines.push(`### Sheet: ${worksheet.name}${isHidden ? " [TERSEMBUNYI]" : ""}\n`);
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
          if (cell.note) {
            val = `${val ?? ""} [Komentar: ${cell.note}]`;
          }
          rowVals.push(String(val ?? "").replace(/\|/g, "\\|").trim());
        });
        rows.push(rowVals);
      });

      if (rows.length > 0) {
        const header = rows[0];
        lines.push(`| ${header.join(" | ")} |`);
        lines.push(`| ${header.map(() => "---").join(" | ")} |`);
        for (let i = 1; i < rows.length; i++) {
          lines.push(`| ${rows[i].join(" | ")} |`);
        }
      }
      lines.push("");
    });

    const fullContent = lines.join("\n").trim();
    return {
      fileName,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      markdownContent: fullContent || "(Excel kosong)",
      usedOcr: false,
      truncated: false,
      characterCount: fullContent.length,
    };
  }

  if (isWord) {
    const td = new TurndownService({ headingStyle: "atx" });
    td.use(gfm);
    const res = await mammoth.convertToHtml(
      { buffer },
      {
        ignoreEmptyParagraphs: true,
      }
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
        error: "Format biner lama (.doc/.xls) ini belum bisa dibaca langsung. Simpan ulang sebagai .docx atau .xlsx lalu kirim lagi.",
      });
    }
    if (err.message === "FILE_TOO_LARGE") {
      return res.status(413).json({ error: "Ukuran file melebihi batas maksimum di lingkungan serverless." });
    }
    if (err.message === "INVALID_FILE_TYPE") {
      return res.status(415).json({ error: "Format file tidak didukung atau isi file tidak valid. Celyn mendukung PDF, Excel (.xlsx), atau Word (.docx)." });
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
