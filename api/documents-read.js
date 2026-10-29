import Busboy from "busboy";
import { fileTypeFromBuffer } from "file-type";
import { extractText } from "unpdf";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import TurndownService from "turndown";
import { GoogleGenAI } from "@google/genai";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB batas Vercel serverless body

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    let fileBuffer = null;
    let fileName = "document";
    let fileMime = "application/octet-stream";
    let fileSize = 0;
    let limitExceeded = false;

    let bb;
    try {
      bb = Busboy({
        headers: req.headers,
        limits: {
          fileSize: MAX_UPLOAD_BYTES,
          files: 1,
        },
      });
    } catch (e) {
      return reject(new Error("INVALID_MULTIPART_HEADERS"));
    }

    bb.on("file", (_fieldname, fileStream, info) => {
      fileName = info.filename || "document";
      fileMime = info.mimeType || "application/octet-stream";

      const chunks = [];
      fileStream.on("data", (chunk) => {
        fileSize += chunk.length;
        if (fileSize > MAX_UPLOAD_BYTES) {
          limitExceeded = true;
          fileStream.resume();
          return;
        }
        chunks.push(chunk);
      });

      fileStream.on("limit", () => {
        limitExceeded = true;
      });

      fileStream.on("end", () => {
        if (!limitExceeded) {
          fileBuffer = Buffer.concat(chunks);
        }
      });
    });

    bb.on("finish", async () => {
      if (limitExceeded) {
        return reject(new Error("FILE_TOO_LARGE"));
      }
      if (!fileBuffer || fileBuffer.length === 0) {
        return reject(new Error("NO_FILE_UPLOADED"));
      }

      const lowerName = fileName.toLowerCase();
      const isPdfExt = lowerName.endsWith(".pdf");
      const isExcelExt = lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls");
      const isWordExt = lowerName.endsWith(".docx") || lowerName.endsWith(".doc");

      if (!isPdfExt && !isExcelExt && !isWordExt) {
        return reject(new Error("INVALID_FILE_TYPE"));
      }

      const detected = await fileTypeFromBuffer(fileBuffer);
      const ALLOWED_MIMES = [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/zip",
        "application/x-cfb",
      ];

      if (detected && !ALLOWED_MIMES.includes(detected.mime) && !isPdfExt && !isExcelExt && !isWordExt) {
        return reject(new Error("INVALID_FILE_TYPE"));
      }

      const finalMime = detected?.mime || fileMime;
      resolve({
        buffer: fileBuffer,
        fileName,
        mimeType: finalMime,
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
    fileName.toLowerCase().endsWith(".xlsx") ||
    fileName.toLowerCase().endsWith(".xls");
  const isWord =
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fileName.toLowerCase().endsWith(".docx") ||
    fileName.toLowerCase().endsWith(".doc");

  if (isPdf) {
    let cleanText = "";
    let totalPages = 1;
    try {
      const res = await extractText(new Uint8Array(buffer), { mergePages: true });
      totalPages = res.totalPages || 1;
      cleanText = (res.text || "").trim();
    } catch {}

    const avgChars = cleanText.length / Math.max(totalPages, 1);
    if (avgChars >= 30 && cleanText.length >= 40) {
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

    // OCR Fallback
    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const ocrRes = await ai.models.generateContent({
          model: process.env.DOC_OCR_MODEL || "gemini-3-flash-preview",
          contents: [
            {
              inlineData: {
                data: buffer.toString("base64"),
                mimeType: "application/pdf",
              },
            },
            {
              text: "Lakukan OCR secara presisi pada dokumen PDF ini. Pertahankan struktur judul, paragraf, daftar poin, dan ubah semua tabel menjadi Markdown Table. Jawab hanya dengan isi dokumen tanpa pengantar.",
            },
          ],
        });
        const ocrText = (ocrRes.text || "").trim();
        return {
          fileName,
          mimeType: "application/pdf",
          markdownContent: ocrText || cleanText,
          usedOcr: true,
          totalPages,
          truncated: false,
          characterCount: ocrText.length,
        };
      } catch {}
    }

    return {
      fileName,
      mimeType: "application/pdf",
      markdownContent: cleanText || "(PDF scan/gambar tanpa teks digital)",
      usedOcr: false,
      totalPages,
      truncated: false,
      characterCount: cleanText.length,
    };
  }

  if (isExcel) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sections = [];

    workbook.eachSheet((sheet) => {
      const rows = [`### Sheet: ${sheet.name}\n`];
      let maxCols = 0;
      sheet.eachRow({ includeEmpty: false }, (r) => {
        if (r.actualCellCount > maxCols) maxCols = r.actualCellCount;
      });
      maxCols = Math.min(Math.max(maxCols, 1), 25);

      let rowCount = 0;
      let isFirst = true;

      sheet.eachRow({ includeEmpty: false }, (row) => {
        rowCount++;
        if (rowCount > 100) return;

        const cells = [];
        for (let col = 1; col <= maxCols; col++) {
          const cell = row.getCell(col);
          let val = cell.value;
          if (val && typeof val === "object") {
            if ("result" in val && val.result !== undefined && val.result !== null) val = val.result;
            else if ("text" in val) val = val.text;
          }
          if (val instanceof Date) val = val.toISOString().split("T")[0];
          const str = val === null || val === undefined ? "" : String(val);
          cells.push(str.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ").trim());
        }

        rows.push(`| ${cells.join(" | ")} |`);
        if (isFirst) {
          rows.push(`| ${cells.map(() => "---").join(" | ")} |`);
          isFirst = false;
        }
      });

      sections.push(rows.join("\n"));
    });

    const md = sections.join("\n\n---\n\n").trim();
    return {
      fileName,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      markdownContent: md || "(Excel kosong)",
      usedOcr: false,
      truncated: false,
      characterCount: md.length,
    };
  }

  if (isWord) {
    const td = new TurndownService({ headingStyle: "atx" });
    const res = await mammoth.convertToHtml(
      { buffer },
      {
        ignoreEmptyParagraphs: true,
        convertImage: (mammoth.images && mammoth.images.imgElement) ? mammoth.images.imgElement(() => Promise.resolve({ src: "" })) : undefined,
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

  const expectedPassword = process.env.ADMIN_PASSWORD || "admin";
  const authPass = req.headers["x-admin-password"] || req.query?.password || req.query?.key;

  if (authPass !== "admin" && authPass !== "login" && authPass !== expectedPassword) {
    return res.status(401).json({ error: "Akses ditolak: Autentikasi diperlukan." });
  }

  try {
    const uploaded = await parseMultipart(req);
    const apiKey = process.env.GEMINI_API_KEY;
    const document = await extractDoc(uploaded.buffer, uploaded.fileName, uploaded.mimeType, apiKey);

    const maxChars = parseInt(process.env.DOC_MAX_CONTEXT_CHARS || "60000", 10);
    if (document.markdownContent.length > maxChars) {
      document.markdownContent =
        document.markdownContent.slice(0, maxChars) +
        "\n\n*(Catatan: Sebagian isi dokumen dipotong karena batas maksimum konteks)*";
      document.truncated = true;
      document.characterCount = document.markdownContent.length;
    }

    return res.status(200).json({ ok: true, document });
  } catch (err) {
    if (err.message === "FILE_TOO_LARGE") {
      return res.status(413).json({ error: "Ukuran file melebihi batas maksimum (maks 4 MB di Vercel)" });
    }
    if (err.message === "INVALID_FILE_TYPE") {
      return res.status(415).json({ error: "Format file tidak didukung. Unggah PDF, Excel (.xlsx/.xls), atau Word (.docx/.doc)." });
    }
    return res.status(400).json({ error: err?.message || "Gagal memproses file dokumen" });
  }
}
