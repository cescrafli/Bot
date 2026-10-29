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

    (sheetData.rows || []).forEach((row, idx) => {
      const isEven = idx % 2 === 1;
      const r = sheet.addRow(row);
      r.height = 20;
      r.eachCell((cell) => {
        if (isEven) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
        }
      });
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
        return new TableRow({
          children: sec.table.headers.map(
            (_, cIdx) =>
              new TableCell({
                children: [
                  new Paragraph({
                    text: stripMd(row[cIdx] || ""),
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
      const rows = (sec.table.rows || []).map((row) =>
        sec.table.headers.map((_, i) => ({ text: stripMd(row[i] || ""), style: "tableCell" }))
      );
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
  for (const key of candidateKeys) {
    try {
      const ai = new GoogleGenAI({ apiKey: key });
      const aiRes = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: "application/json" },
      });
      return JSON.parse(aiRes.text || "{}");
    } catch (err) {
      lastErr = err;
      console.warn(`[documents-process] Gagal dengan API key (${key.slice(0, 8)}...):`, err?.message || err);
    }
  }
  throw lastErr || new Error("Semua API key Gemini gagal memproses dokumen.");
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

  const authHeader = req.headers.authorization;
  const legacyPassword = req.headers["x-admin-password"];
  const adminPass = process.env.ADMIN_PASSWORD || "admin";
  const userPass = process.env.USER_PASSWORD || "login";

  let isAuth = false;
  if (legacyPassword === adminPass || legacyPassword === userPass) {
    isAuth = true;
  } else if (authHeader && authHeader.startsWith("Bearer ")) {
    isAuth = true;
  }

  if (!isAuth) {
    return res.status(401).json({ error: "Akses ditolak: Autentikasi diperlukan." });
  }

  const customKey = (req.headers["x-gemini-key"] || "").trim();
  const rawEnvKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "";
  const envKeys = rawEnvKeys
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  const candidateKeys = customKey ? [customKey, ...envKeys] : envKeys;
  if (candidateKeys.length === 0) {
    return res.status(500).json({ error: "Layanan Celyn belum siap: Konfigurasi API belum lengkap." });
  }

  try {
    const { fileName, operation = "edit", originalContent, instruction, targetLanguage } = req.body || {};
    if (!originalContent) {
      return res.status(400).json({ error: "Parameter 'originalContent' wajib disertakan." });
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

    const model = process.env.DOC_GENERATE_MODEL || process.env.TEXT_MODEL || "gemini-3-flash-preview";

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
    return res.status(500).json({ error: `Gagal memproses dokumen in-place: ${err?.message || "Unknown error"}` });
  }
}
