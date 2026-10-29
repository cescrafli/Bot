import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
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
  BorderStyle,
} from "docx";
import pdfmake from "pdfmake";
import {
  ReportPayload,
  ExcelPayload,
  stripMarkdownFormatting,
} from "@celyn/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Lokasi font TrueType Roboto
const fontDir = path.resolve(__dirname, "../../assets/fonts");

// Inisialisasi konfigurasi font pdfmake secara aman
try {
  const pmAny = pdfmake as any;
  if (pmAny.setUrlAccessPolicy) {
    pmAny.setUrlAccessPolicy(() => false);
  }
  if (pmAny.setLocalAccessPolicy) {
    pmAny.setLocalAccessPolicy(() => true);
  }

  const robotoRegular = path.join(fontDir, "Roboto-Regular.ttf");
  if (fs.existsSync(robotoRegular)) {
    pmAny.fonts = {
      Roboto: {
        normal: path.join(fontDir, "Roboto-Regular.ttf"),
        bold: path.join(fontDir, "Roboto-Medium.ttf"),
        italics: path.join(fontDir, "Roboto-Italic.ttf"),
        bolditalics: path.join(fontDir, "Roboto-MediumItalic.ttf"),
      },
    };
  }
} catch (e: any) {
  console.warn("[DocumentWriter] Inisialisasi font pdfmake fallback:", e?.message);
}

export class DocumentWriterService {
  /**
   * 1. MEMBUAT LEMBAR KERJA EXCEL RAPI (.xlsx)
   */
  async createExcel(payload: ExcelPayload): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Celyn AI Bot";
    workbook.created = new Date();

    for (const sheetData of payload.sheets) {
      const sheet = workbook.addWorksheet(sheetData.sheetName || "Sheet1", {
        views: [{ state: "frozen", ySplit: 1 }],
      });

      // Konfigurasi kolom
      sheet.columns = sheetData.columns.map((col) => ({
        header: col.header,
        key: col.key,
        width: Math.max(col.header.length + 5, 15),
      }));

      // Styling Header Row
      const headerRow = sheet.getRow(1);
      headerRow.height = 26;
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11, name: "Calibri" };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.border = {
          top: { style: "thin", color: { argb: "FF0F172A" } },
          left: { style: "thin", color: { argb: "FF0F172A" } },
          bottom: { style: "medium", color: { argb: "FF0F172A" } },
          right: { style: "thin", color: { argb: "FF0F172A" } },
        };
      });

      // Data Rows
      sheetData.rows.forEach((rowObj, idx) => {
        const isEven = idx % 2 === 1;

        // Normalisasi nilai berdasarkan tipe kolom
        const rowData: Record<string, any> = {};
        for (const col of sheetData.columns) {
          let val = rowObj[col.key];

          if (col.type === "currency" || col.type === "number") {
            if (typeof val === "string") {
              const cleaned = val.replace(/[^0-9.-]+/g, "");
              const num = parseFloat(cleaned);
              if (!isNaN(num)) val = num;
            }
          } else if (col.type === "percentage") {
            if (typeof val === "string") {
              const cleaned = val.replace(/[^0-9.-]+/g, "");
              const num = parseFloat(cleaned);
              if (!isNaN(num)) val = num > 1 ? num / 100 : num;
            } else if (typeof val === "number" && val > 1) {
              val = val / 100;
            }
          }

          rowData[col.key] = val;
        }

        const row = sheet.addRow(rowData);
        row.height = 20;

        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const colMeta = sheetData.columns[colNumber - 1];

          // Zebra striping lembut
          if (isEven) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F9FC" } };
          }

          cell.border = {
            top: { style: "thin", color: { argb: "FFE2E8F0" } },
            left: { style: "thin", color: { argb: "FFE2E8F0" } },
            bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
            right: { style: "thin", color: { argb: "FFE2E8F0" } },
          };

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

      // Auto-fit lebar kolom secara cerdas
      sheet.columns.forEach((column) => {
        let maxLen = 12;
        column.eachCell?.({ includeEmpty: false }, (cell) => {
          const valStr = cell.value ? String(cell.value) : "";
          if (valStr.length > maxLen) maxLen = valStr.length;
        });
        column.width = Math.min(Math.max(maxLen + 4, 14), 48);
      });

      // Pasang auto-filter di header
      if (sheetData.columns.length > 0) {
        sheet.autoFilter = {
          from: { row: 1, column: 1 },
          to: { row: 1, column: sheetData.columns.length },
        };
      }
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * 2. MEMBUAT DOKUMEN WORD (.docx)
   */
  async createWord(payload: ReportPayload): Promise<Buffer> {
    const children: any[] = [];

    // Judul Utama Dokumen
    const cleanTitle = stripMarkdownFormatting(payload.title);
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: cleanTitle,
            bold: true,
            size: 32, // 16pt
            color: "1E3A5F",
          }),
        ],
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { before: 100, after: 120 },
      })
    );

    // Subjudul / Keterangan
    if (payload.subtitle) {
      const cleanSub = stripMarkdownFormatting(payload.subtitle);
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: cleanSub,
              italics: true,
              color: "475569",
              size: 22, // 11pt
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 360 },
        })
      );
    }

    // Iterasi Bagian (Sections)
    for (const sec of payload.sections) {
      const cleanHeading = stripMarkdownFormatting(sec.heading);
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: cleanHeading,
              bold: true,
              size: 26, // 13pt
              color: "1E3A5F",
            }),
          ],
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 280, after: 140 },
        })
      );

      // Paragraf
      for (const p of sec.paragraphs) {
        const cleanPara = stripMarkdownFormatting(p);
        if (!cleanPara) continue;

        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: cleanPara,
                size: 22, // 11pt
                color: "1E293B",
              }),
            ],
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 160, line: 276 }, // Line spacing 1.15
          })
        );
      }

      // Poin-poin Penting
      if (sec.bulletPoints && sec.bulletPoints.length > 0) {
        for (const bp of sec.bulletPoints) {
          const cleanBp = stripMarkdownFormatting(bp);
          if (!cleanBp) continue;

          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: cleanBp,
                  size: 22,
                  color: "1E293B",
                }),
              ],
              bullet: { level: 0 },
              spacing: { after: 100 },
            })
          );
        }
      }

      // Tabel Data Pendukung
      if (sec.table && sec.table.headers.length > 0) {
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
                        text: stripMarkdownFormatting(h),
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

        const dataRows = sec.table.rows.map((r, rIdx) => {
          const isEven = rIdx % 2 === 1;
          return new TableRow({
            children: sec.table!.headers.map((_, cIdx) => {
              const cellText = stripMarkdownFormatting(r[cIdx] || "");
              return new TableCell({
                shading: isEven ? { fill: "F8FAFC" } : undefined,
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: cellText,
                        size: 20,
                        color: "1E293B",
                      }),
                    ],
                    alignment: AlignmentType.LEFT,
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

        // Beri spasi setelah tabel
        children.push(new Paragraph({ spacing: { after: 200 } }));
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
                      children: [
                        "Halaman ",
                        PageNumber.CURRENT,
                        " dari ",
                        PageNumber.TOTAL_PAGES,
                      ],
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

  /**
   * 3. MEMBUAT DOKUMEN PDF RAPI (.pdf)
   */
  async createPdf(payload: ReportPayload): Promise<Buffer> {
    const cleanTitle = stripMarkdownFormatting(payload.title);
    const content: any[] = [{ text: cleanTitle, style: "title" }];

    if (payload.subtitle) {
      content.push({
        text: stripMarkdownFormatting(payload.subtitle),
        style: "subtitle",
      });
    }

    for (const sec of payload.sections) {
      content.push({
        text: stripMarkdownFormatting(sec.heading),
        style: "sectionHeader",
      });

      for (const p of sec.paragraphs) {
        const cleanP = stripMarkdownFormatting(p);
        if (cleanP) {
          content.push({ text: cleanP, style: "paragraph" });
        }
      }

      if (sec.bulletPoints && sec.bulletPoints.length > 0) {
        const validBullets = sec.bulletPoints
          .map(stripMarkdownFormatting)
          .filter(Boolean);
        if (validBullets.length > 0) {
          content.push({ ul: validBullets, margin: [0, 4, 0, 10] });
        }
      }

      if (sec.table && sec.table.headers.length > 0) {
        const cleanHeaders = sec.table.headers.map((h) => ({
          text: stripMarkdownFormatting(h),
          style: "tableHeader",
        }));

        const cleanRows = sec.table.rows.map((row) =>
          sec.table!.headers.map((_, cIdx) => ({
            text: stripMarkdownFormatting(row[cIdx] || ""),
            style: "tableCell",
          }))
        );

        content.push({
          margin: [0, 8, 0, 14],
          table: {
            headerRows: 1,
            widths: sec.table.headers.map(() => "*"),
            body: [cleanHeaders, ...cleanRows],
          },
          layout: "lightHorizontalLines",
        });
      }
    }

    const docDefinition: any = {
      defaultStyle: { font: "Roboto", fontSize: 10.5, lineHeight: 1.3 },
      pageMargins: [48, 56, 48, 56],
      footer: (currentPage: number, pageCount: number) => ({
        text: `Halaman ${currentPage} dari ${pageCount}`,
        alignment: "right",
        margin: [0, 16, 48, 0],
        fontSize: 9,
        color: "#64748B",
      }),
      content,
      styles: {
        title: {
          fontSize: 18,
          bold: true,
          alignment: "center",
          margin: [0, 0, 0, 6],
          color: "#0F172A",
        },
        subtitle: {
          fontSize: 11,
          italics: true,
          alignment: "center",
          margin: [0, 0, 0, 20],
          color: "#475569",
        },
        sectionHeader: {
          fontSize: 13,
          bold: true,
          margin: [0, 14, 0, 6],
          color: "#1E3A5F",
        },
        paragraph: { margin: [0, 0, 0, 8], alignment: "justify", color: "#1E293B" },
        tableHeader: {
          bold: true,
          fontSize: 10,
          color: "#FFFFFF",
          fillColor: "#1E3A5F",
          alignment: "center",
        },
        tableCell: { fontSize: 9.5, color: "#1E293B" },
      },
    };

    if (typeof (pdfmake as any).createPdf === "function") {
      const pdf = (pdfmake as any).createPdf(docDefinition);
      return await pdf.getBuffer();
    } else {
      const PrinterClass: any = typeof pdfmake === "function" ? pdfmake : ((pdfmake as any).default || pdfmake);
      const fonts = {
        Roboto: {
          normal: "Helvetica",
          bold: "Helvetica-Bold",
          italics: "Helvetica-Oblique",
          bolditalics: "Helvetica-BoldOblique",
        },
      };
      const printer = new PrinterClass(fonts);
      const pdfDoc = printer.createPdfKitDocument(docDefinition);
      return new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        pdfDoc.on("data", (chunk: Buffer) => chunks.push(chunk));
        pdfDoc.on("end", () => resolve(Buffer.concat(chunks)));
        pdfDoc.on("error", (err: any) => reject(err));
        pdfDoc.end();
      });
    }
  }
}

export const documentWriterService = new DocumentWriterService();
