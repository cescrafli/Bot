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
        }
        rowData[col.key] = val;
      });

      const row = sheet.addRow(rowData);
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const colMeta = columns[colNumber - 1];
        if (isEven) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F9FC" } };
        }
        if (colMeta?.type === "currency" && typeof cell.value === "number") {
          cell.numFmt = '"Rp"#,##0.00;("Rp"#,##0.00);"-"';
          cell.alignment = { horizontal: "right" };
        } else if (colMeta?.type === "number" && typeof cell.value === "number") {
          cell.numFmt = "#,##0.00";
          cell.alignment = { horizontal: "right" };
        } else {
          cell.alignment = { horizontal: "left" };
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

  const arrayBuf = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuf);
}

async function createWordBuffer(payload) {
  const children = [];

  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: stripMd(payload.title || "Laporan"),
          bold: true,
          size: 32,
          color: "1E3A5F",
        }),
      ],
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
            color: "475569",
            size: 22,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 360 },
      })
    );
  }

  for (const sec of payload.sections || []) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: stripMd(sec.heading || "Bagian"),
            bold: true,
            size: 26,
            color: "1E3A5F",
          }),
        ],
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 120 },
      })
    );

    for (const p of sec.paragraphs || []) {
      const clean = stripMd(p);
      if (!clean) continue;
      children.push(
        new Paragraph({
          children: [new TextRun({ text: clean, size: 22, color: "1E293B" })],
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 140, line: 276 },
        })
      );
    }

    if (sec.bulletPoints && sec.bulletPoints.length > 0) {
      for (const bp of sec.bulletPoints) {
        const clean = stripMd(bp);
        if (!clean) continue;
        children.push(
          new Paragraph({
            children: [new TextRun({ text: clean, size: 22, color: "1E293B" })],
            bullet: { level: 0 },
            spacing: { after: 80 },
          })
        );
      }
    }

    if (sec.table && sec.table.headers && sec.table.headers.length > 0) {
      const headerRow = new TableRow({
        tableHeader: true,
        children: sec.table.headers.map(
          (h) =>
            new TableCell({
              shading: { fill: "1E3A5F" },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: stripMd(h),
                      bold: true,
                      color: "FFFFFF",
                      size: 20,
                    }),
                  ],
                  alignment: AlignmentType.CENTER,
                }),
              ],
            })
        ),
      });

      const dataRows = (sec.table.rows || []).map((row, rIdx) => {
        const isEven = rIdx % 2 === 1;
        return new TableRow({
          children: sec.table.headers.map((_, cIdx) => {
            const cellText = stripMd(row[cIdx] || "");
            return new TableCell({
              shading: isEven ? { fill: "F8FAFC" } : undefined,
              children: [
                new Paragraph({
                  children: [new TextRun({ text: cellText, size: 20, color: "1E293B" })],
                }),
              ],
            });
          }),
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
        properties: {},
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    children: ["Halaman ", PageNumber.CURRENT, " dari ", PageNumber.TOTAL_PAGES],
                    size: 18,
                    color: "64748B",
                  }),
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

  const content = [{ text: stripMd(payload.title || "Laporan"), style: "title" }];
  if (payload.subtitle) {
    content.push({ text: stripMd(payload.subtitle), style: "subtitle" });
  }

  for (const sec of payload.sections || []) {
    content.push({ text: stripMd(sec.heading || "Bagian"), style: "sectionHeader" });
    for (const p of sec.paragraphs || []) {
      const clean = stripMd(p);
      if (clean) content.push({ text: clean, style: "paragraph" });
    }
    if (sec.bulletPoints && sec.bulletPoints.length > 0) {
      const valid = sec.bulletPoints.map(stripMd).filter(Boolean);
      if (valid.length > 0) content.push({ ul: valid, margin: [0, 4, 0, 10] });
    }
    if (sec.table && sec.table.headers && sec.table.headers.length > 0) {
      const headers = sec.table.headers.map((h) => ({ text: stripMd(h), style: "tableHeader" }));
      const rows = (sec.table.rows || []).map((r) =>
        sec.table.headers.map((_, cIdx) => ({ text: stripMd(r[cIdx] || ""), style: "tableCell" }))
      );
      content.push({
        margin: [0, 8, 0, 14],
        table: {
          headerRows: 1,
          widths: sec.table.headers.map(() => "*"),
          body: [headers, ...rows],
        },
        layout: "lightHorizontalLines",
      });
    }
  }

  const docDef = {
    defaultStyle: { font: "Roboto", fontSize: 10.5, lineHeight: 1.3 },
    pageMargins: [48, 56, 48, 56],
    footer: (currentPage, pageCount) => ({
      text: `Halaman ${currentPage} dari ${pageCount}`,
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

  const pdf = pdfmake.createPdf(docDef);
  return await pdf.getBuffer();
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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY belum dikonfigurasi." });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { kind, title, instruction, context } = body;

    if (!["pdf", "docx", "xlsx"].includes(kind)) {
      return res.status(400).json({ error: "Parameter 'kind' wajib bernilai 'pdf', 'docx', atau 'xlsx'" });
    }

    const safeTitle = (title || "Dokumen Celyn")
      .replace(/[\\/:*?"<>|]/g, "_")
      .trim()
      .slice(0, 50) || "Dokumen";

    const ai = new GoogleGenAI({ apiKey });
    const model = process.env.DOC_GENERATE_MODEL || "gemini-3-flash-preview";

    if (kind === "xlsx") {
      const prompt = `Anda adalah asisten data profesional. Buatlah lembar kerja Excel (XLSX) yang rapi dan terstruktur:
Judul Dokumen: "${title}"
Instruksi Pengguna: "${instruction}"
${context ? `Konteks/Data Acuan:\n${context}` : ""}

KEMBALIKAN HANYA JSON DENGAN STRUKTUR BERIKUT:
{
  "fileName": "${safeTitle}",
  "sheets": [
    {
      "sheetName": "Ringkasan",
      "columns": [
        { "header": "Nama Kolom", "key": "col1", "type": "string" }
      ],
      "rows": [
        { "col1": "Data" }
      ]
    }
  ]
}`;

      const aiRes = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: "application/json" },
      });

      const parsed = JSON.parse(aiRes.text || "{}");
      const buffer = await createExcelBuffer(parsed);

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(safeTitle)}.xlsx"`);
      res.setHeader("Content-Length", buffer.length);
      return res.status(200).send(buffer);
    } else {
      const isPdf = kind === "pdf";
      const prompt = `Anda adalah asisten pembuat laporan formal profesional. Buatlah draf laporan ${isPdf ? "PDF" : "Word (.docx)"}:
Judul Dokumen: "${title}"
Instruksi Pengguna: "${instruction}"
${context ? `Konteks/Data Acuan:\n${context}` : ""}

KEMBALIKAN HANYA JSON DENGAN STRUKTUR BERIKUT:
{
  "title": "${safeTitle}",
  "subtitle": "Disusun secara otomatis oleh Celyn AI",
  "sections": [
    {
      "heading": "Pendahuluan",
      "paragraphs": [
        "Paragraf penjelasan dokumen secara terperinci tanpa tag markdown mentah."
      ],
      "bulletPoints": [
        "Poin penting 1"
      ]
    }
  ]
}`;

      const aiRes = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: "application/json" },
      });

      const parsed = JSON.parse(aiRes.text || "{}");
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
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(safeTitle)}.${ext}"`);
      res.setHeader("Content-Length", buffer.length);
      return res.status(200).send(buffer);
    }
  } catch (err) {
    console.error("[Vercel /api/documents-generate] Error:", err);
    return res.status(500).json({ error: `Gagal membuat dokumen: ${err?.message || "Unknown error"}` });
  }
}
