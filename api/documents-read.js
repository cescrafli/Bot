import Busboy from "busboy";
import { getDocumentProxy, extractText } from "unpdf";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { GoogleGenAI } from "@google/genai";
import { createHmac, timingSafeEqual } from "node:crypto";

const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK..
const CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // Compound File Binary

function safeTimingMatch(a, b) {
  const ba = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (!ba.length || ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function resolveApiAuthSecret() {
  const configured = (process.env.AUTH_SECRET || "").trim();
  if (configured) return configured;
  const envSeed = (
    process.env.TURSO_AUTH_TOKEN ||
    process.env.GEMINI_API_KEY ||
    process.env.GEMINI_API_KEYS ||
    process.env.ADMIN_PASSWORD ||
    ""
  ).trim();
  if (envSeed) {
    return createHmac("sha256", "celyn-session-signing-salt-2026").update(envSeed).digest("hex");
  }
  return "celyn-secret-session-key-2026";
}

function verifyEnvPassword(rawPass) {
  const trimmed = String(rawPass || "").trim();
  if (!trimmed) return null;
  const adminPass = (process.env.ADMIN_PASSWORD || "").trim();
  const userPass = (process.env.USER_PASSWORD || "").trim();

  if (adminPass) {
    if (safeTimingMatch(trimmed, adminPass)) return "jocelyn";
  } else if (safeTimingMatch(trimmed.toLowerCase(), "admin")) {
    return "jocelyn";
  }

  if (userPass) {
    if (safeTimingMatch(trimmed, userPass)) return "default";
  } else if (safeTimingMatch(trimmed.toLowerCase(), "login")) {
    return "default";
  }

  return null;
}

function applyCors(req, res, methods = "POST, OPTIONS") {
  const origin = typeof req.headers?.origin === "string" ? req.headers.origin.trim() : "";
  const allowed = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const host = typeof req.headers?.host === "string" ? req.headers.host.trim() : "";
  const isSameHost = Boolean(host && (origin === `https://${host}` || origin === `http://${host}`));
  const isVercelUrl = Boolean(
    origin &&
      ((process.env.VERCEL_URL && origin === `https://${process.env.VERCEL_URL}`) ||
        (process.env.VERCEL_PROJECT_PRODUCTION_URL &&
          origin === `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`))
  );
  const isLocalDev =
    process.env.NODE_ENV !== "production" &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);

  if (origin && (allowed.includes(origin) || isSameHost || isVercelUrl || isLocalDev)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-password, x-gemini-key");
}

function verifyAuth(req) {
  const secret = resolveApiAuthSecret();

  // Check Bearer Token
  const authHeader = req.headers["authorization"] || "";
  if (secret && authHeader.startsWith("Bearer ")) {
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
  const mode = verifyEnvPassword(directPass);
  if (mode) {
    return { valid: true, mode };
  }

  return { valid: false };
}

// Text/plaintext extensions that need no magic-byte check
const TEXT_EXTS = new Set(["csv", "tsv", "txt", "md", "rtf"]);
// OOXML-family extensions treated as ZIP (macro-enabled / template are still ZIP containers)
const OOXML_EXTS = new Set(["docx", "xlsx", "xlsm", "xlsb", "docm", "dotx"]);
// Legacy CFB binary extensions
const CFB_EXTS = new Set(["doc", "xls"]);
// Image extensions (Foto & Gambar)
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp"]);

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

const PE_MAGIC = Buffer.from([0x4d, 0x5a]); // MZ executable
const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]); // ELF executable

function isValidTextBuffer(buffer) {
  if (!buffer || buffer.length === 0) return true;
  // Reject executables
  if (buffer.length >= 2 && buffer.subarray(0, 2).equals(PE_MAGIC)) return false;
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(ELF_MAGIC)) return false;

  // Accept valid BOMs (UTF-16 LE, UTF-16 BE, UTF-8)
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return true; // UTF-16 LE BOM
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return true; // UTF-16 BE BOM
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return true; // UTF-8 BOM

  // Heuristic for UTF-16 LE without BOM
  if (buffer.length >= 4 && buffer[1] === 0x00 && buffer[3] === 0x00) return true;

  // Check for 4+ consecutive null bytes
  let consecutiveNulls = 0;
  const checkLen = Math.min(buffer.length, 512);
  for (let i = 0; i < checkLen; i++) {
    if (buffer[i] === 0x00) {
      consecutiveNulls++;
      if (consecutiveNulls >= 4) return false;
    } else {
      consecutiveNulls = 0;
    }
  }
  return true;
}

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout setelah ${ms}ms`)), ms)),
  ]);

function decodeTextBuffer(buffer) {
  if (!buffer || buffer.length === 0) return "";
  // UTF-16 LE BOM
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return Buffer.from(buffer.subarray(2)).toString("utf16le");
  }
  // UTF-16 BE BOM
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buffer.subarray(2));
  }
  // UTF-8 BOM
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return Buffer.from(buffer.subarray(3)).toString("utf8");
  }
  // UTF-16 LE without BOM
  if (buffer.length >= 4 && buffer[1] === 0x00 && buffer[3] === 0x00) {
    return Buffer.from(buffer).toString("utf16le");
  }
  return Buffer.from(buffer).toString("utf8").replace(/\0/g, "");
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
    if (!isValidTextBuffer(buffer)) {
      return { valid: false, error: "File teks tidak valid atau merupakan file biner/executable yang salah ekstensi." };
    }
    return { valid: true, kind: ext, mime: "text/plain" };
  }

  // Foto & Gambar (PNG, JPG, JPEG, WEBP, GIF, BMP)
  if (IMAGE_EXTS.has(ext)) {
    let imgMime = "image/jpeg";
    if (ext === "png") imgMime = "image/png";
    else if (ext === "webp") imgMime = "image/webp";
    else if (ext === "gif") imgMime = "image/gif";
    else if (ext === "bmp") imgMime = "image/bmp";

    const isPng = head.length >= 8 && head.subarray(0, 8).equals(PNG_MAGIC);
    const isJpg = head.length >= 3 && head.subarray(0, 3).equals(JPEG_MAGIC);
    const isGif = head.length >= 4 && head.subarray(0, 4).toString("ascii").startsWith("GIF8");
    const isWebp = head.length >= 12 && head.subarray(0, 4).toString("ascii") === "RIFF" && head.subarray(8, 12).toString("ascii") === "WEBP";
    const isBmp = head.length >= 2 && head[0] === 0x42 && head[1] === 0x4d;

    if (isPng || isJpg || isGif || isWebp || isBmp) {
      return { valid: true, kind: "image", mime: imgMime };
    }
    // Fallback: jika ekstensi cocok dan bukan biner executable (PE/ELF)
    if (!head.subarray(0, 2).equals(PE_MAGIC) && !head.subarray(0, 4).equals(ELF_MAGIC)) {
      return { valid: true, kind: "image", mime: imgMime };
    }
    return { valid: false, error: `Bukan file gambar .${ext} yang valid` };
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

async function extractDoc(buffer, fileName, mimeType, apiKeysInput) {
  const keys = Array.isArray(apiKeysInput)
    ? apiKeysInput.filter(Boolean)
    : [apiKeysInput].filter(Boolean);

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
  const isImage = IMAGE_EXTS.has(ext) || (mimeType && mimeType.startsWith("image/"));

  if (isImage) {
    if (keys.length > 0) {
      const modelsToTry = [
        "gemini-flash-lite-latest",
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-3-flash-preview",
        process.env.DOC_VISION_MODEL || process.env.TEXT_MODEL,
        "gemini-3.8-flash",
      ].filter(Boolean);
      const uniqueModels = [...new Set(modelsToTry)];

      const startTime = Date.now();
      const MAX_IMAGE_TIME_BUDGET_MS = 12000;
      let visualText = "";

      for (const modelToTry of uniqueModels) {
        if (Date.now() - startTime > MAX_IMAGE_TIME_BUDGET_MS - 2500) break;
        for (const key of keys) {
          if (Date.now() - startTime > MAX_IMAGE_TIME_BUDGET_MS - 2500) break;
          try {
            const ai = new GoogleGenAI({ apiKey: key });
            const resp = await withTimeout(
              ai.models.generateContent({
                model: modelToTry,
                contents: [
                  {
                    inlineData: {
                      data: buffer.toString("base64"),
                      mimeType: mimeType || "image/jpeg",
                    },
                  },
                  {
                    text: `Anda adalah asisten peneliti dan analis visual tingkat pakar Celyn. Lakukan pembacaan dan analisis mendalam terhadap foto/gambar '${fileName}' ini dengan ketelitian mikro:
1. PEMBACAAN TEKS & ANGKA DETAIL (OCR PARIPURNA): Baca dan transkripsikan SELURUH teks, angka, simbol matematika/keuangan, satuan, label sumbu grafik, indikator teknikal, kode, dan detail kecil tanpa ada yang terlewat. Pertahankan struktur aslinya (sajikan dalam format Markdown Table jika berupa tabel data atau kisi matriks).
2. DEKOMPOSISI VISUAL, GRAFIK & DIAGRAM: Bedah konten visual secara presisi (identifikasi jenis diagram/chart, arah tren garis/candlestick, level support/resistance, label perbandingan, diagram alur/arsitektur, atau skema konsep).
3. SINTESIS RISET & KESIMPULAN BERDASARKAN GAMBAR: Formulasikan temuan visual menjadi data terstruktur dan ringkasan eksekutif yang siap digunakan langsung sebagai dasar riset komprehensif, perhitungan akurat, atau perumusan jawaban profesional.
4. DETEKSI SOAL, TUGAS, ATAU INSTRUKSI: Jika gambar berisi soal ujian, latihan hitungan, studi kasus, atau pertanyaan tugas, uraikan setiap butir soal secara lengkap beserta angka, pilihan jawaban (jika ada), dan instruksi pengerjaannya agar dapat diselesaikan secara solutif dan runtut.`,
                  },
                ],
              }),
              6500
            );
            const text = (resp?.text || "").trim();
            if (text) {
              visualText = text;
              break;
            }
          } catch (e) {
            console.warn(`[documents-read] OCR foto model ${modelToTry} key ${key.slice(0, 8)}... error:`, e?.message || e);
          }
        }
        if (visualText) break;
      }

      if (visualText) {
        return {
          fileName,
          mimeType: mimeType || "image/jpeg",
          markdownContent: visualText,
          usedOcr: true,
          totalPages: 1,
          pages: 1,
          truncated: false,
          characterCount: visualText.length,
        };
      }
    }
    return {
      fileName,
      mimeType: mimeType || "image/jpeg",
      markdownContent: `Foto '${fileName}' berhasil diunggah dan siap dianalisis atau diedit oleh Celyn.`,
      usedOcr: false,
      totalPages: 1,
      pages: 1,
      truncated: false,
      characterCount: 0,
    };
  }

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
        totalPages,
        pages: totalPages,
        truncated: false,
        characterCount: cleanText.length,
      };
    }

    if (keys.length > 0) {
      const modelsToTry = [
        "gemini-2.5-flash",
        process.env.DOC_OCR_MODEL || process.env.TEXT_MODEL,
        "gemini-3.8-flash",
        "gemini-3-flash-preview",
      ].filter(Boolean);
      const uniqueModels = [...new Set(modelsToTry)];

      const pdfStartTime = Date.now();
      const MAX_PDF_TIME_BUDGET_MS = 14000;
      let ocrText = "";

      for (const modelToTry of uniqueModels) {
        if (Date.now() - pdfStartTime > MAX_PDF_TIME_BUDGET_MS - 3000) break;
        for (const key of keys) {
          if (Date.now() - pdfStartTime > MAX_PDF_TIME_BUDGET_MS - 3000) break;
          try {
            const ai = new GoogleGenAI({ apiKey: key });
            const resp = await withTimeout(
              ai.models.generateContent({
                model: modelToTry,
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
              }),
              7000
            );
            const text = (resp?.text || "").trim();
            if (text) {
              ocrText = text;
              break;
            }
          } catch (e) {
            console.warn(`[documents-read] OCR PDF model ${modelToTry} key ${key.slice(0, 8)}... error:`, e?.message || e);
          }
        }
        if (ocrText) break;
      }

      if (ocrText) {
        return {
          fileName,
          mimeType: "application/pdf",
          markdownContent: ocrText,
          usedOcr: true,
          totalPages,
          pages: totalPages,
          truncated: false,
          characterCount: ocrText.length,
        };
      }
    }

    return {
      fileName,
      mimeType: "application/pdf",
      markdownContent: cleanText || "(PDF kosong atau berupa gambar pindai)",
      usedOcr: false,
      totalPages,
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

  // ── Helper: Parse delimited text (CSV / TSV) → Markdown ───────────────────
  function delimitedToMarkdown(buffer, ext) {
    const text = decodeTextBuffer(buffer);
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

  // ── XLSX / XLSM / XLSB (modern Excel via ExcelJS) ──────────────────────────
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
      console.warn("[documents-read] ExcelJS gagal memproses berkas Excel:", excelJsErr?.message);
      return {
        fileName,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        markdownContent: `### Dokumen Excel: ${fileName}\n\n*Berkas lembar kerja tidak dapat diekstrak secara otomatis. Pastikan dokumen valid dan tidak dilindungi kata sandi.*`,
        usedOcr: false,
        truncated: false,
        characterCount: 0,
      };
    }
  }

  // ── XLS legacy (Excel 97-2003) ─────────────────────────────────────────────
  if (isXls) {
    const text = `# Dokumen Excel Legacy (.xls)\n\nFile "${fileName}" berformat biner Excel 97-2003 (.xls). Untuk kecepatan analisis dan kompatibilitas penuh, silakan simpan atau ekspor sebagai berkas modern **.xlsx** atau konversi ke format **CSV**.`;
    return {
      fileName,
      mimeType: "application/vnd.ms-excel",
      markdownContent: text,
      usedOcr: false,
      truncated: false,
      characterCount: text.length,
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
    const text = decodeTextBuffer(buffer).trim();
    return { fileName, mimeType: "text/plain", markdownContent: text || "(File kosong)", usedOcr: false, truncated: false, characterCount: text.length };
  }

  // ── RTF (strip control codes) ────────────────────────────────────────────────
  if (isRtf) {
    const raw = decodeTextBuffer(buffer);
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
  applyCors(req, res, "POST, OPTIONS");

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
    const customKey = (req.headers["x-gemini-key"] || req.query?.apiKey || "").trim();
    const rawEnvKeys = [
      process.env.GEMINI_API_KEYS,
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_API_KEY_FALLBACK,
      process.env.GEMINI_API_KEY_SECRET,
    ]
      .filter(Boolean)
      .join(",");
    const envKeys = rawEnvKeys
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    const sortedEnvKeys = [...new Set(envKeys)].sort((a, b) => {
      if (a.startsWith("AIzaSy") && !b.startsWith("AIzaSy")) return -1;
      if (!a.startsWith("AIzaSy") && b.startsWith("AIzaSy")) return 1;
      return 0;
    });
    const candidateKeys = customKey ? [customKey, ...sortedEnvKeys] : sortedEnvKeys;
    const document = await extractDoc(uploaded.buffer, uploaded.fileName, uploaded.mimeType, candidateKeys);

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
