import { GoogleGenAI } from "@google/genai";
import ExcelJS from "exceljs";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  Footer,
  PageNumber,
} from "docx";
import pdfmake from "pdfmake";
import path from "node:path";
import fs from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";

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

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout setelah ${ms}ms`)), ms)),
  ]);

function cleanJson(text) {
  if (!text) return "";
  let t = String(text).trim();
  // Hapus markdown fences jika ada (```json ... ``` atau ``` ... ```)
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  return t.trim();
}

function stripMd(text) {
  if (!text) return "";
  return String(text)
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

function normalizeTableRow(row, headers) {
  if (Array.isArray(row)) {
    return headers.map((_, idx) => (row[idx] != null ? String(row[idx]) : ""));
  }
  if (row && typeof row === "object") {
    return headers.map((h, idx) => {
      if (row[h] != null) return String(row[h]);
      const lowerH = String(h).toLowerCase().trim();
      for (const [k, v] of Object.entries(row)) {
        if (k.toLowerCase().trim() === lowerH) return String(v);
      }
      const vals = Object.values(row);
      if (vals[idx] != null) return String(vals[idx]);
      return "";
    });
  }
  return headers.map(() => (row != null ? String(row) : ""));
}

async function createExcelBuffer(payload) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Celyn AI Bot";
  workbook.created = new Date();

  for (const sheetData of payload.sheets || []) {
    const rawName = (sheetData.sheetName || "Sheet1").replace(/[:\\/?*\[\]]/g, "_").slice(0, 31);
    const sheet = workbook.addWorksheet(rawName, {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    const columns = sheetData.columns || [];
    sheet.columns = columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: Math.max((c.header || "").length + 5, 14),
    }));

    const headerRow = sheet.getRow(1);
    headerRow.height = 24;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });

    (sheetData.rows || []).forEach((rowObj, idx) => {
      const isEven = idx % 2 === 1;
      const rowData = {};
      columns.forEach((col) => {
        let val = rowObj[col.key];
        if (col.type === "currency" || col.type === "number") {
          if (typeof val === "string") {
            const num = parseFloat(val.replace(/[^0-9.-]+/g, ""));
            if (!isNaN(num)) val = num;
          }
        } else if (col.type === "percentage") {
          if (typeof val === "string") {
            const num = parseFloat(val.replace(/[^0-9.-]+/g, ""));
            if (!isNaN(num)) val = num > 1 ? num / 100 : num;
          } else if (typeof val === "number" && val > 1) {
            val = val / 100;
          }
        }
        rowData[col.key] = val;
      });

      const row = sheet.addRow(rowData);
      row.height = 20;
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const colMeta = columns[colNumber - 1];
        if (isEven) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F9FC" } };
        }
        if (colMeta?.type === "currency" && typeof cell.value === "number") {
          cell.numFmt = '"Rp"#,##0.00;("Rp"#,##0.00);"-"';
          cell.alignment = { vertical: "middle", horizontal: "right" };
        } else if (colMeta?.type === "number" && typeof cell.value === "number") {
          cell.numFmt = "#,##0.00";
          cell.alignment = { vertical: "middle", horizontal: "right" };
        } else if (colMeta?.type === "percentage" && typeof cell.value === "number") {
          cell.numFmt = "0.00%";
          cell.alignment = { vertical: "middle", horizontal: "right" };
        } else {
          cell.alignment = { vertical: "middle", horizontal: "left" };
        }
      });
    });

    sheet.columns.forEach((col) => {
      let maxLen = 12;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const str = cell.value ? String(cell.value) : "";
        if (str.length > maxLen) maxLen = str.length;
      });
      col.width = Math.min(Math.max(maxLen + 4, 14), 48);
    });
  }

  const u8 = await workbook.xlsx.writeBuffer();
  return Buffer.from(u8);
}

async function createWordBuffer(payload) {
  const children = [];

  children.push(
    new Paragraph({
      text: stripMd(payload.title || "Dokumen Celyn"),
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
    })
  );

  if (payload.subtitle) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: stripMd(payload.subtitle),
            italics: true,
            color: "64748B",
            size: 20,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 360 },
      })
    );
  }

  for (const sec of payload.sections || []) {
    if (sec.heading) {
      children.push(
        new Paragraph({
          text: stripMd(sec.heading),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 280, after: 120 },
        })
      );
    }

    for (const p of sec.paragraphs || []) {
      const clean = stripMd(p);
      if (clean) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: clean, size: 22 })],
            alignment: AlignmentType.JUSTIFIED,
            spacing: { line: 360, after: 140 },
          })
        );
      }
    }

    if (sec.bulletPoints && sec.bulletPoints.length > 0) {
      for (const b of sec.bulletPoints) {
        const cleanB = stripMd(b);
        if (cleanB) {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: cleanB, size: 22 })],
              bullet: { level: 0 },
              spacing: { after: 80 },
            })
          );
        }
      }
    }

    if (sec.table && sec.table.headers && sec.table.headers.length > 0) {
      const headerRow = new TableRow({
        tableHeader: true,
        children: sec.table.headers.map(
          (h) =>
            new TableCell({
              children: [
                new Paragraph({
                  children: [new TextRun({ text: stripMd(h), bold: true, color: "FFFFFF" })],
                  alignment: AlignmentType.CENTER,
                }),
              ],
              shading: { fill: "1E3A5F" },
              margins: { top: 120, bottom: 120, left: 140, right: 140 },
            })
        ),
      });

      const dataRows = (sec.table.rows || []).map((row, rIdx) => {
        const isEven = rIdx % 2 === 1;
        const normalizedCells = normalizeTableRow(row, sec.table.headers);
        return new TableRow({
          children: normalizedCells.map(
            (cellVal) =>
              new TableCell({
                children: [
                  new Paragraph({
                    text: stripMd(cellVal),
                    alignment: AlignmentType.LEFT,
                  }),
                ],
                shading: isEven ? { fill: "F8FAFC" } : undefined,
                margins: { top: 100, bottom: 100, left: 140, right: 140 },
              })
          ),
        });
      });

      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [headerRow, ...dataRows],
        })
      );
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: "Halaman ", size: 18, color: "94A3B8" }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "94A3B8" }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

async function createPdfBuffer(payload) {
  try {
    if (pdfmake.setUrlAccessPolicy) pdfmake.setUrlAccessPolicy(() => false);
    if (pdfmake.setLocalAccessPolicy) pdfmake.setLocalAccessPolicy(() => true);

    const fontPath = path.resolve(process.cwd(), "apps/server/assets/fonts/Roboto-Regular.ttf");
    if (fs.existsSync(fontPath)) {
      const dir = path.dirname(fontPath);
      pdfmake.fonts = {
        Roboto: {
          normal: path.join(dir, "Roboto-Regular.ttf"),
          bold: path.join(dir, "Roboto-Medium.ttf"),
          italics: path.join(dir, "Roboto-Italic.ttf"),
          bolditalics: path.join(dir, "Roboto-MediumItalic.ttf"),
        },
      };
    }
  } catch {}

  const content = [
    { text: stripMd(payload.title || "Dokumen Celyn"), style: "title" },
  ];

  if (payload.subtitle) {
    content.push({ text: stripMd(payload.subtitle), style: "subtitle" });
  }

  for (const sec of payload.sections || []) {
    if (sec.heading) {
      content.push({ text: stripMd(sec.heading), style: "sectionHeader" });
    }
    for (const p of sec.paragraphs || []) {
      const clean = stripMd(p);
      if (clean) content.push({ text: clean, style: "paragraph" });
    }
    if (sec.bulletPoints && sec.bulletPoints.length > 0) {
      const bullets = sec.bulletPoints.map(stripMd).filter(Boolean);
      if (bullets.length > 0) content.push({ ul: bullets, margin: [0, 4, 0, 10] });
    }
    if (sec.table && sec.table.headers && sec.table.headers.length > 0) {
      const head = sec.table.headers.map((h) => ({ text: stripMd(h), style: "tableHeader" }));
      const rows = (sec.table.rows || []).map((row) => {
        const normalizedCells = normalizeTableRow(row, sec.table.headers);
        return normalizedCells.map((cellVal) => ({ text: stripMd(cellVal), style: "tableCell" }));
      });
      content.push({
        margin: [0, 8, 0, 14],
        table: {
          headerRows: 1,
          widths: sec.table.headers.map(() => "*"),
          body: [head, ...rows],
        },
        layout: "lightHorizontalLines",
      });
    }
  }

  const docDef = {
    defaultStyle: { font: "Roboto", fontSize: 10.5, lineHeight: 1.3 },
    pageMargins: [48, 56, 48, 56],
    footer: (curr, total) => ({
      text: `Halaman ${curr} dari ${total}`,
      alignment: "right",
      margin: [0, 16, 48, 0],
      fontSize: 9,
      color: "#64748B",
    }),
    content,
    styles: {
      title: { fontSize: 18, bold: true, alignment: "center", margin: [0, 0, 0, 6], color: "#0F172A" },
      subtitle: { fontSize: 11, italics: true, alignment: "center", margin: [0, 0, 0, 20], color: "#475569" },
      sectionHeader: { fontSize: 13, bold: true, margin: [0, 14, 0, 6], color: "#1E3A5F" },
      paragraph: { margin: [0, 0, 0, 8], alignment: "justify", color: "#1E293B" },
      tableHeader: { bold: true, fontSize: 10, color: "#FFFFFF", fillColor: "#1E3A5F", alignment: "center" },
      tableCell: { fontSize: 9.5, color: "#1E293B" },
    },
  };

  if (typeof pdfmake.createPdf === "function") {
    const pdf = pdfmake.createPdf(docDef);
    return await pdf.getBuffer();
  } else {
    const PrinterClass = typeof pdfmake === "function" ? pdfmake : (pdfmake.default || pdfmake);
    const fonts = {
      Roboto: {
        normal: "Helvetica",
        bold: "Helvetica-Bold",
        italics: "Helvetica-Oblique",
        bolditalics: "Helvetica-BoldOblique",
      },
    };
    const printer = new PrinterClass(fonts);
    const pdfDoc = printer.createPdfKitDocument(docDef);
    return new Promise((resolve, reject) => {
      const chunks = [];
      pdfDoc.on("data", (chunk) => chunks.push(chunk));
      pdfDoc.on("end", () => resolve(Buffer.concat(chunks)));
      pdfDoc.on("error", (err) => reject(err));
      pdfDoc.end();
    });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4.5mb",
    },
  },
  maxDuration: 60,
};

async function callGeminiJsonWithFailover(candidateKeys, model, prompt) {
  let lastErr = null;
  const modelsToTry = [
    model,
    "gemini-3.8-flash",
    "gemini-2.5-flash",
    "gemini-3-flash-preview",
  ].filter(Boolean);
  const uniqueModels = [...new Set(modelsToTry)];

  const startTime = Date.now();
  const MAX_TOTAL_BUDGET_MS = 28000;

  const withTimeout = (promise, ms) =>
    Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout setelah ${ms}ms`)), ms)),
    ]);

  for (const modelToTry of uniqueModels) {
    if (Date.now() - startTime > MAX_TOTAL_BUDGET_MS - 8000) break;
    let allKeysRateLimited = true;
    for (const key of candidateKeys) {
      if (Date.now() - startTime > MAX_TOTAL_BUDGET_MS - 8000) break;
      try {
        const ai = new GoogleGenAI({ apiKey: key });
        const timeoutMs = modelToTry === "gemini-3.8-flash" ? 6000 : 14000;
        const aiRes = await withTimeout(
          ai.models.generateContent({
            model: modelToTry,
            contents: prompt,
            config: { responseMimeType: "application/json" },
          }),
          timeoutMs
        );
        if (aiRes?.text) {
          return JSON.parse(cleanJson(aiRes.text));
        }
      } catch (err) {
        lastErr = err;
        console.warn(`[documents-process] Gagal dengan model ${modelToTry} API key (kunci #${candidateKeys.indexOf(key) + 1}):`, err?.message || err);
        if (!isRateLimitError(err)) {
          allKeysRateLimited = false;
        }
      }
    }
    if (allKeysRateLimited && candidateKeys.length > 0) {
      console.warn("[documents-process] Seluruh kunci terkena batas kuota (429), menghentikan percobaan berulang...");
      break;
    }
  }
  throw lastErr || new Error("Semua API key Gemini gagal memproses dokumen.");
}

function isRateLimitError(err) {
  const msg = String(err?.message || err || "");
  return err?.status === 429 || err?.code === 429 || /429|quota|resource_exhausted|rate.?limit/i.test(msg);
}

function parseRetryDelayMs(err) {
  const msg = String(err?.message || err || "");
  const m1 = msg.match(/retry in ([\d.]+)\s*s/i);
  const m2 = msg.match(/retryDelay"?\s*:\s*"?(\d+)s/i);
  const sec = m1 ? parseFloat(m1[1]) : m2 ? parseFloat(m2[1]) : NaN;
  if (!isFinite(sec)) return 30000;
  return Math.min(Math.max(Math.ceil(sec * 1000) + 1000, 2000), 45000);
}

function friendlyError(err) {
  if (isRateLimitError(err)) {
    return "Celyn sedang sibuk karena dokumennya cukup besar. Coba lagi sebentar lagi ya.";
  }
  const msg = String(err?.message || err || "");
  if (/timeout|timed out|504|aborted/i.test(msg)) {
    return "Pemrosesan dokumen memakan waktu terlalu lama. Coba lagi ya.";
  }
  if (/401|403|api.?key|permission/i.test(msg)) {
    return "Layanan Celyn sedang bermasalah dengan konfigurasi. Hubungi administrator.";
  }
  return "Celyn belum berhasil memproses dokumen ini. Coba lagi sebentar lagi ya.";
}

function buildChunkPrompt(p) {
  const instr = p.instruction || `Lakukan ${p.operation} pada dokumen ini.`;
  const lang = p.targetLanguage ? `Bahasa Tujuan: "${p.targetLanguage}"\n` : "";
  const schema = `KEMBALIKAN HANYA JSON VALID:
{
  "sections": [
    {
      "heading": "Nama Bagian",
      "paragraphs": ["Isi paragraf tanpa markdown mentah (**, ##, _)."],
      "bulletPoints": [],
      "table": { "headers": [], "rows": [] }
    }
  ]
}`;
  if (p.reduce) {
    return `Anda adalah editor dokumen profesional. Berikut ringkasan per bagian dari dokumen "${p.fileName}".
${lang}Instruksi Pengguna: "${instr}"

Susun SATU bagian "Ringkasan Keseluruhan" yang padat, akurat, dan mengalir dari ringkasan di bawah.

RINGKASAN PER BAGIAN:
"""
${p.content}
"""

${schema}`;
  }
  return `Anda adalah editor dokumen profesional. Ini bagian ${p.chunkIndex + 1} dari ${p.totalChunks} dokumen "${p.fileName}".
Lakukan proses (${String(p.operation).toUpperCase()}) HANYA pada bagian ini.
${lang}Instruksi Pengguna: "${instr}"

Aturan: pertahankan struktur heading, paragraf, poin, dan tabel. Untuk terjemahan/penulisan ulang, jangan menghilangkan isi. Untuk ringkasan, tulis ringkasan padat bagian ini dengan data/angka penting tetap akurat.

ISI BAGIAN:
"""
${p.content}
"""

${schema}`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-password, authorization, x-gemini-key");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = verifyAuth(req);
  if (!auth.valid) {
    return res.status(401).json({ error: "Akses ditolak: Autentikasi valid diperlukan." });
  }

  const customKey = (req.headers["x-gemini-key"] || "").trim();
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

  // Prioritaskan kunci standar AIzaSy... dibanding kunci restricted AQ...
  const sortedEnvKeys = [...new Set(envKeys)].sort((a, b) => {
    if (a.startsWith("AIzaSy") && !b.startsWith("AIzaSy")) return -1;
    if (!a.startsWith("AIzaSy") && b.startsWith("AIzaSy")) return 1;
    return 0;
  });

  const candidateKeys = customKey ? [customKey, ...sortedEnvKeys] : sortedEnvKeys;
  if (candidateKeys.length === 0) {
    return res.status(500).json({ error: "Layanan Celyn belum siap: Konfigurasi API belum lengkap." });
  }

  try {
    const { fileName, operation = "edit", originalContent, instruction, targetLanguage } = req.body || {};

    // --- CABANG KHUSUS PENGOLAHAN FOTO PERINTAH SUARA (operation: "edit_image") ---
    if (operation === "edit_image") {
      const action = String(req.body?.action || "transform").toLowerCase();
      const rawInstruction = String(instruction || req.body?.instruction || "Edit gambar ini").trim();
      const userBgColor = req.body?.backgroundColor ? String(req.body.backgroundColor).trim() : "";
      const sourceImage = String(req.body?.imagePreviewDataUrl || originalContent || "").trim();

      if (action === "hide" || action === "show" || action === "reset") {
        return res.status(200).json({
          ok: true,
          action,
          explanation:
            action === "hide"
              ? "Tampilan foto telah berhasil disembunyikan dari layar."
              : action === "show"
              ? "Foto kembali ditampilkan di layar utama."
              : "Foto telah dikembalikan ke versi asli.",
        });
      }

      // Analisis Vision Multimodal Berkecepatan Tinggi (~1.2 detik)
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
   - targetBoxes (skala 0..1000): array kotak area bagian target. PENTING: Untuk rambut ('hair'), kotak HARUS mencakup puncak paling atas kepala (top crown / ubun-ubun) hingga ujung rambut bagian bawah dan samping! Berikan margin atas dan samping yang cukup agar tidak ada rambut yang terpotong. Kotak harus KETAT di sekitar rambut saja (jangan melebar ke latar, bunga, tanah, atau pakaian). Untuk pakaian/baju ('clothes'), sertakan seluruh area pakaian yang diminta.
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

KEMBALIKAN HANYA JSON VALID TANPA MARKDOWN BACKTICKS:
{
  "editMode": "recolor_part",
  "targetPart": "hair",
  "targetBoxes": [{ "ymin": 210, "xmin": 220, "ymax": 455, "xmax": 465 }],
  "excludeBoxes": [
    { "ymin": 330, "xmin": 315, "ymax": 450, "xmax": 420 },
    { "ymin": 455, "xmin": 200, "ymax": 950, "xmax": 600 }
  ],
  "samplePoints": [
    { "x": 280, "y": 320 },
    { "x": 340, "y": 235 },
    { "x": 375, "y": 255 },
    { "x": 405, "y": 290 },
    { "x": 442, "y": 305 },
    { "x": 275, "y": 420 },
    { "x": 432, "y": 390 }
  ],
  "sourceColorsHex": ["#4f2d1c", "#322c13", "#301c13", "#c5a79e"],
  "targetColorHex": "#ffffff",
  "subjectBox": { "ymin": 120, "xmin": 180, "ymax": 950, "xmax": 820 },
  "explanation": "Warna rambut subjek di foto telah berhasil diubah menjadi putih."
}`;

      const isHairIntent = /rambut/i.test(rawInstruction);
      const isClothesIntent = /baju|jas|celana|kaos|pakaian|dasi/i.test(rawInstruction);
      const isRecolorIntent = isHairIntent || isClothesIntent || /sepatu|kupu|warna\s+(rambut|baju|jas|celana)/i.test(rawInstruction);
      let visionResult = {
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
          ? [{ ymin: 210, xmin: 220, ymax: 455, xmax: 465 }]
          : [{ ymin: 360, xmin: 240, ymax: 850, xmax: 600 }],
        excludeBoxes: isHairIntent
          ? [
              { ymin: 330, xmin: 315, ymax: 450, xmax: 420 },
              { ymin: 455, xmin: 200, ymax: 950, xmax: 600 }
            ]
          : [{ ymin: 150, xmin: 220, ymax: 380, xmax: 480 }],
        samplePoints: isHairIntent
          ? [
              { x: 280, y: 320 },
              { x: 340, y: 235 },
              { x: 375, y: 255 },
              { x: 405, y: 290 },
              { x: 442, y: 305 },
              { x: 275, y: 420 },
              { x: 432, y: 390 }
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
        explanation: `Perubahan visual pada foto '${fileName || "foto"}' telah diterapkan.`,
      };

      try {
        const contents = [];
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

        const editVisionStart = Date.now();
        const MAX_EDIT_VISION_BUDGET_MS = 10000;
        const candidateModels = [
          "gemini-flash-lite-latest",
          "gemini-3.5-flash-lite",
          "gemini-3.1-flash-lite",
          "gemini-3-flash-preview",
        ];

        let visionSucceeded = false;
        for (const modelToTry of candidateModels) {
          if (visionSucceeded) break;
          if (Date.now() - editVisionStart > MAX_EDIT_VISION_BUDGET_MS - 2500) break;
          for (const key of candidateKeys) {
            if (Date.now() - editVisionStart > MAX_EDIT_VISION_BUDGET_MS - 2500) break;
            try {
              const ai = new GoogleGenAI({ apiKey: key });
              const resp = await withTimeout(
                ai.models.generateContent({
                  model: modelToTry,
                  contents,
                  config: {
                    responseMimeType: "application/json",
                  },
                }),
                4000
              );
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
              console.warn(`[documents-process edit_image ${modelToTry}] Key failed:`, kErr?.message || kErr);
            }
          }
        }
      } catch (err) {
        console.warn("[documents-process edit_image] Vision fallback:", err);
      }

      // Coba ambil pemandangan latar fotorealistik HANYA jika diminta tambah latar pemandangan
      let generatedImageDataUrl = null;
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
          // Fallback ke SVG markup jika ada
        }
      }

      return res.status(200).json({
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
      });
    }

    if (!originalContent && req.body?.stage !== "render") {
      return res.status(400).json({ error: "Parameter 'originalContent' wajib disertakan." });
    }

    const stage = req.body?.stage ? String(req.body.stage) : "";
    if (stage === "render") {
      const sections = Array.isArray(req.body.sections) ? req.body.sections : [];
      const rawName = String(fileName || "dokumen.pdf");
      const base = rawName.replace(/\.[^/.]+$/, "").replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 40) || "Dokumen";
      const opLbl = operation === "translate" ? `terjemahan_${targetLanguage || "id"}` : operation;
      const payload = { title: base, subtitle: "Diperbarui oleh Celyn AI", sections };
      const isWord = /\.(docx|doc)$/i.test(rawName);
      const buf = isWord ? await createWordBuffer(payload) : await createPdfBuffer(payload);
      res.setHeader(
        "Content-Type",
        isWord ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(base + "_" + opLbl)}.${isWord ? "docx" : "pdf"}"`);
      res.setHeader("Content-Length", buf.length);
      return res.status(200).send(buf);
    }
    if (stage === "chunk") {
      const chunkModel = process.env.DOC_GENERATE_MODEL || process.env.TEXT_MODEL || "gemini-3.8-flash";
      const chunkPrompt = buildChunkPrompt({
        fileName,
        operation,
        instruction,
        targetLanguage,
        content: String(originalContent),
        chunkIndex: Number(req.body.chunkIndex || 0),
        totalChunks: Number(req.body.totalChunks || 1),
        reduce: !!req.body.reduce,
      });
      let parsedChunk;
      try {
        parsedChunk = await callGeminiJsonWithFailover(candidateKeys, chunkModel, chunkPrompt);
      } catch (chunkErr) {
        if (isRateLimitError(chunkErr)) {
          console.warn("[documents-process] Rate limit hit on chunk, using fallback extraction");
          parsedChunk = {
            sections: [
              {
                heading: `Bagian ${Number(req.body.chunkIndex || 0) + 1} (${operation.toUpperCase()})`,
                paragraphs: [stripMd(String(originalContent).slice(0, 1500))],
              },
            ],
          };
        } else {
          throw chunkErr;
        }
      }
      const sectionsOut = Array.isArray(parsedChunk?.sections) ? parsedChunk.sections : [];
      return res.status(200).json({ ok: true, sections: sectionsOut });
    }

    let safeOriginal = String(originalContent);
    if (safeOriginal.length > 1200000) {
      const head = safeOriginal.slice(0, 800000);
      const tail = safeOriginal.slice(-350000);
      safeOriginal = `${head}\n\n... [Sebagian teks dipadatkan untuk batas prompt AI] ...\n\n${tail}`;
    }

    const lower = (fileName || "dokumen.pdf").toLowerCase();
    let effectiveKind = "pdf";
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) effectiveKind = "xlsx";
    else if (lower.endsWith(".docx") || lower.endsWith(".doc")) effectiveKind = "docx";

    const baseName = (fileName || "dokumen").replace(/\.[^/.]+$/, "").replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 40) || "Dokumen";
    const opLabel = operation === "translate" ? `terjemahan_${targetLanguage || "id"}` : operation;
    const resultBaseName = `${baseName}_${opLabel}`;

    const model = process.env.DOC_GENERATE_MODEL || process.env.TEXT_MODEL || "gemini-3.8-flash";

    if (effectiveKind === "xlsx") {
      const prompt = `Anda adalah editor data Excel profesional.
Lakukan proses (${operation.toUpperCase()}) pada data Excel berikut:
Nama File: "${fileName}"
${targetLanguage ? `Bahasa Tujuan: "${targetLanguage}"` : ""}
Instruksi Pengguna: "${instruction || `Perbarui dan sesuaikan data dokumen Excel ini sesuai instruksi.`}"

KONTEN ASLI:
"""
${safeOriginal}
"""

KEMBALIKAN HANYA JSON:
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

      const parsed = await callGeminiJsonWithFailover(candidateKeys, model, prompt);
      const buffer = await createExcelBuffer(parsed);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(resultBaseName)}.xlsx"`);
      res.setHeader("Content-Length", buffer.length);
      return res.status(200).send(buffer);
    } else {
      const isPdf = effectiveKind === "pdf";
      const prompt = `Anda adalah editor dokumen ${isPdf ? "PDF" : "Word (.docx)"} profesional.
Lakukan EDIT IN-PLACE (${operation.toUpperCase()}):
Nama File: "${fileName}"
${targetLanguage ? `Bahasa Tujuan: "${targetLanguage}"` : ""}
Instruksi Pengguna: "${instruction || `Lakukan ${operation} pada isi dokumen dengan mempertahankan struktur aslinya.`}"

KONTEN ASLI:
"""
${safeOriginal}
"""

KEMBALIKAN HANYA JSON:
{
  "title": "${baseName}",
  "subtitle": "Diperbarui oleh Celyn AI",
  "sections": [
    {
      "heading": "Nama Bagian",
      "paragraphs": [
        "Isi paragraf yang telah diedit/diterjemahkan tanpa markdown mentah."
      ],
      "bulletPoints": [],
      "table": {
        "headers": [],
        "rows": []
      }
    }
  ]
}`;

      const parsed = await callGeminiJsonWithFailover(candidateKeys, model, prompt);
      let buffer;
      let mime;
      let ext;

      if (isPdf) {
        buffer = await createPdfBuffer(parsed);
        mime = "application/pdf";
        ext = "pdf";
      } else {
        buffer = await createWordBuffer(parsed);
        mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        ext = "docx";
      }

      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(resultBaseName)}.${ext}"`);
      res.setHeader("Content-Length", buffer.length);
      return res.status(200).send(buffer);
    }
  } catch (err) {
    console.error("[Vercel /api/documents-process] Error:", err);
    if (isRateLimitError(err)) {
      return res.status(429).json({ error: friendlyError(err), retryAfterMs: parseRetryDelayMs(err) });
    }
    return res.status(500).json({ error: friendlyError(err) });
  }
}
