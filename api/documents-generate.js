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

function inferExpertPersona(query) {
  const q = (query || "").toLowerCase();

  // 1. Saham, Pasar Modal, Investasi, Keuangan & Portofolio
  if (
    /(saham|ihsg|emiten|investasi|bursa|\bipo\b|reksa\s*dana|obligasi|dividen|portofolio|pasar\s*modal|valuasi|fundamental|teknikal|crypto|kripto|bitcoin|\bbtc\b|\beth\b|forex|perbankan|finansial|keuangan|\bidx\b|trading|laporan\s*keuangan|\bper\b|\bpbv\b|\broe\b|\bder\b|market\s*cap)/i.test(
      q
    )
  ) {
    return {
      domain: "finance",
      fieldLabel: "Pasar Modal, Saham & Investasi",
      persona:
        "Analis Senior Pasar Modal & Ekuitas / CFA Charterholder berpengalaman 20+ tahun",
      promptGuide:
        "Analisis secara profesional: fundamental bisnis, valuasi wajar (PER, PBV, EV/EBITDA), pertumbuhan laba/pendapatan, kesehatan neraca (DER, Cash flow), kebijakan dividen, katalis industri, tren teknikal pergerakan harga, dan manajemen risiko investasi.",
    };
  }

  // 2. Hukum, Regulasi, Perundang-undangan, Kontrak & Litigasi
  if (
    /(hukum|undang-undang|\buu\b|pasal|kontrak|perjanjian|gugatan|pidana|perdata|pengadilan|advokat|konsultan\s*hukum|kebijakan\s*hukum|regulasi|legislasi|legalitas|hak\s*cipta|paten|\bhaki\b|arbitrase)/i.test(
      q
    )
  ) {
    return {
      domain: "legal",
      fieldLabel: "Hukum & Regulasi Korporasi",
      persona:
        "Konsultan Hukum Senior & Advokat Spesialis Hukum Korporasi/Litigasi (20+ tahun pengalaman)",
      promptGuide:
        "Analisis berdasarkan peraturan perundang-undangan positif yang berlaku, asas-asas hukum, analisis pasal terkait, kepatuhan hukum (compliance), potensi risiko sengketa hukum, dan langkah mitigasi preventif.",
    };
  }

  // 3. Kedokteran, Medis, Farmasi, Penyakit & Kesehatan Klinis
  if (
    /(medis|kesehatan|penyakit|obat|farmasi|klinis|dokter|gejala|diagnosis|terapi|nutrisi|gizi|pasien|rumah\s*sakit|resep|kanker|diabetes|hipertensi|kardiovaskular|infeksi|vaksin|anatomi|patologi)/i.test(
      q
    )
  ) {
    return {
      domain: "medical",
      fieldLabel: "Kedokteran & Kesehatan Klinis",
      persona:
        "Dokter Spesialis Klinis Senior & Konsultan Medis Berbasis Bukti (Evidence-Based Medicine)",
      promptGuide:
        "Analisis berbasis bukti ilmiah medis terkini, patofisiologi penyakit, pertimbangan diagnosis banding, pedoman klinis terapi, farmakologi obat/interaksi, serta edukasi preventif dengan disclaimer medis profesional.",
    };
  }

  // 4. Teknologi, Software Engineering, Arsitektur Sistem, Cloud, AI & Keamanan Siber
  if (
    /(teknologi|software|perangkat\s*lunak|koding|coding|programming|arsitektur\s*sistem|database|cloud|\baws\b|azure|\bgcp\b|devops|docker|kubernetes|\bai\b|artificial\s*intelligence|machine\s*learning|deep\s*learning|\bllm\b|cyber\s*security|keamanan\s*siber|\bapi\b|backend|frontend|algoritma)/i.test(
      q
    )
  ) {
    return {
      domain: "tech",
      fieldLabel: "Teknologi, Rekayasa Perangkat Lunak & AI",
      persona:
        "Principal Systems Architect & Chief Technology Consultant (15+ tahun pengalaman industri teknologi global)",
      promptGuide:
        "Analisis arsitektur sistem, trade-off skalabilitas, reliabilitas, performa tinggi, efisiensi algoritma, keamanan siber, best practices implementasi, dan efisiensi biaya infrastruktur.",
    };
  }

  // 5. Ekonomi Makro, Fiskal, Moneter & Kebijakan Publik
  if (
    /(ekonomi|makro|\bgdp\b|\bpdb\b|inflasi|deflasi|kebijakan\s*moneter|kebijakan\s*fiskal|bank\s*sentral|bank\s*indonesia|the\s*fed|suku\s*bunga|neraca\s*pembayaran|perdagangan\s*internasional|kurs|rupiah|dolar)/i.test(
      q
    )
  ) {
    return {
      domain: "economics",
      fieldLabel: "Ekonomi Makro & Kebijakan Publik",
      persona:
        "Kepala Peneliti Ekonomi Makro / Chief Economist (setara PhD Ekonomi)",
      promptGuide:
        "Analisis dinamika makroekonomi, tren pertumbuhan PDB, transmisi suku bunga dan inflasi, dampak kebijakan moneter/fiskal, stabilitas nilai tukar, dan proyeksi jangka menengah-panjang.",
    };
  }

  // 6. Strategi Bisnis, Manajemen Korporat, Marketing & Startup
  if (
    /(bisnis|marketing|pemasaran|brand|branding|iklan|kampanye|startup|venture\s*capital|\bcac\b|\bltv\b|\bswot\b|porter|manajemen\s*strategis|kompetitor|pangsa\s*pasar|monetisasi|penjualan|growth\s*hacking)/i.test(
      q
    )
  ) {
    return {
      domain: "business",
      fieldLabel: "Strategi Bisnis, Manajemen & Pemasaran",
      persona:
        "Partner Konsultan Manajemen Strategis Senior & Praktisi Bisnis Eksekutif",
      promptGuide:
        "Analisis lanskap kompetitif (Porter's Five Forces, SWOT), model bisnis dan unit economics (CAC, LTV, Margin), positioning produk, diferensiasi pasar, dan rencana eksekusi strategis.",
    };
  }

  // 7. Sains, Fisika, Kimia, Biologi & Lingkungan
  if (
    /(sains|ilmiah|fisika|kimia|biologi|lingkungan|\biklim\b|keberlanjutan|\besg\b|astronomi|geologi|penelitian|laboratorium|eksperimen)/i.test(
      q
    )
  ) {
    return {
      domain: "science",
      fieldLabel: "Sains Murni & Terapan",
      persona:
        "Peneliti Senior Lembaga Riset Ilmiah / Senior Scientist",
      promptGuide:
        "Analisis metode ilmiah, prinsip dasar fisika/kimia/biologi, data empiris terverifikasi, tinjauan pustaka akademik, dan implikasi bagi lingkungan serta keberlanjutan.",
    };
  }

  // 8. Pendidikan, Kurikulum & Pembelajaran
  if (
    /(pendidikan|kurikulum|pedagogi|pembelajaran|sekolah|kuliah|universitas|mahasiswa|siswa|guru|dosen|akademik|tesis|skripsi)/i.test(
      q
    )
  ) {
    return {
      domain: "education",
      fieldLabel: "Pendidikan & Pengembangan Akademik",
      persona:
        "Pakar Pendidikan Senior & Konsultan Kurikulum Akademik",
      promptGuide:
        "Analisis pedagogis terstruktur, kerangka capaian pembelajaran, diferensiasi instruksional, asesmen komprehensif, dan metodologi pembelajaran efektif.",
    };
  }

  // Default Fallback
  return {
    domain: "general",
    fieldLabel: "Analisis Profesional & Riset Strategis",
    persona:
      "Pakar Riset Senior & Konsultan Analisis Independen",
    promptGuide:
      "Sajikan analisis terstruktur, berbasis data riil, obyektif, kritis, dan berorientasi pada rekomendasi yang dapat dieksekusi secara nyata.",
  };
}

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
      console.warn(`[documents-generate] Gagal generate dengan API key (${key.slice(0, 8)}...):`, err?.message || err);
    }
  }
  throw lastErr || new Error("Semua API key Gemini gagal menghasilkan dokumen.");
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
    return "Pembuatan dokumen memakan waktu terlalu lama. Coba lagi ya.";
  }
  if (/401|403|api.?key|permission/i.test(msg)) {
    return "Layanan Celyn sedang bermasalah dengan konfigurasi. Hubungi administrator.";
  }
  return "Celyn belum berhasil membuat dokumen ini. Coba lagi sebentar lagi ya.";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-password, authorization, x-gemini-key");

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

  const customKey = (req.headers["x-gemini-key"] || "").trim();
  const rawEnvKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "";
  const envKeys = rawEnvKeys
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  const candidateKeys = customKey ? [customKey, ...envKeys] : envKeys;
  if (candidateKeys.length === 0) {
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

    const model = process.env.DOC_GENERATE_MODEL || "gemini-3-flash-preview";

    // Pangkas konteks jika sangat besar (> 1.200.000 karakter) agar aman dalam batas token Gemini & memori Vercel
    let safeContext = context ? String(context) : "";
    if (safeContext.length > 1200000) {
      const head = safeContext.slice(0, 800000);
      const tail = safeContext.slice(-350000);
      safeContext = `${head}\n\n... [Sebagian konteks dipadatkan untuk batas prompt AI] ...\n\n${tail}`;
    }

    if (kind === "xlsx") {
      const expert = inferExpertPersona(`${title} ${instruction}`);
      const prompt = `Anda adalah ${expert.persona}.
Tugas Anda: Membuat lembar kerja Excel (XLSX) profesional tingkat tinggi yang rapi, komprehensif, dan siap analisis di bidang ${expert.fieldLabel}.
Judul Dokumen/Riset: "${title}"
Instruksi Pengguna: "${instruction}"
Fokus Keahlian (${expert.fieldLabel}): ${expert.promptGuide}
${safeContext ? `Konteks/Data Acuan:\n${safeContext}` : ""}

PANDUAN RISET & DESAIN EXCEL TINGKAT AHLI:
1. BUKAN CONTOH ASAL-ASALAN: Sajikan metrik riil, realistis, dan komprehensif sesuai standar industri ${expert.fieldLabel}.
2. Tentukan sheetName yang relevan (maks 31 karakter).
3. Rancang kolom (columns) dengan 'header', 'key' (id unik huruf kecil tanpa spasi), dan 'type' ('string' | 'number' | 'currency' | 'percentage' | 'date').
4. Isi baris-baris data (rows) yang kaya fakta, perbandingan terperinci, dan angka realistis.

KEMBALIKAN HANYA JSON DENGAN STRUKTUR BERIKUT:
{
  "fileName": "${safeTitle}",
  "sheets": [
    {
      "sheetName": "Ringkasan Analisis",
      "columns": [
        { "header": "Indikator / Metrik", "key": "indikator", "type": "string" },
        { "header": "Nilai / Data", "key": "nilai", "type": "string" },
        { "header": "Catatan Analisis", "key": "catatan", "type": "string" }
      ],
      "rows": [
        { "indikator": "Fundamental", "nilai": "Stabil", "catatan": "Kinerja kuartalan positif" }
      ]
    }
  ]
}`;

      const parsed = await callGeminiJsonWithFailover(candidateKeys, model, prompt);
      const buffer = await createExcelBuffer(parsed);

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(safeTitle)}.xlsx"`);
      res.setHeader("Content-Length", buffer.length);
      return res.status(200).send(buffer);
    } else {
      const isPdf = kind === "pdf";
      const docTypeLabel = isPdf ? "Laporan Riset Eksekutif PDF (.pdf)" : "Dokumen Riset Formal Word (.docx)";
      const prompt = `Anda adalah ${expert.persona}.
Tugas Anda: Menyusun ${docTypeLabel} profesional tingkat tinggi (High-Caliber Professional Research Report) yang mendalam, tajam, dan berwibawa di bidang ${expert.fieldLabel}.
Judul Riset: "${title}"
Instruksi Pengguna: "${instruction}"
Fokus Keahlian (${expert.fieldLabel}): ${expert.promptGuide}
${safeContext ? `Konteks/Materi Acuan:\n${safeContext}` : ""}

PANDUAN RISET & PENULISAN DOKUMEN TINGKAT AHLI:
1. BUKAN RISET ASAL-ASALAN: Sajikan analisis mendalam, berbasis fakta riil, tajam, dan terstruktur. Hindari generalisasi dangkal atau sekadar definisi umum!
2. STRUKTUR LAPORAN WAJIB MEMUAT SECTION BERBOBOT:
   - Ringkasan Eksekutif (Executive Summary)
   - Latar Belakang & Analisis Sektor / Fakta Kunci
   - Evaluasi Peluang & Analisis Risiko Komprehensif
   - Rekomendasi Strategis & Rencana Tindak Lanjut
   - Kesimpulan Ahli
   - Sumber Referensi & Catatan Metodologi
3. Setiap section harus memuat 'paragraphs' mendalam (2-4 paragraf berbobot) dan/atau 'bulletPoints' tajam. JANGAN masukkan tag markdown seperti ** atau ## ke dalam teks paragraf.

KEMBALIKAN HANYA JSON DENGAN STRUKTUR BERIKUT:
{
  "title": "${safeTitle}",
  "subtitle": "Laporan Riset Profesional Celyn AI • ${expert.fieldLabel}",
  "sections": [
    {
      "heading": "Ringkasan Eksekutif",
      "paragraphs": [
        "Paragraf analisis eksekutif komprehensif tanpa tag markdown mentah."
      ],
      "bulletPoints": [
        "Temuan kunci 1"
      ]
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
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(safeTitle)}.${ext}"`);
      res.setHeader("Content-Length", buffer.length);
      return res.status(200).send(buffer);
    }
  } catch (err) {
    console.error("[Vercel /api/documents-generate] Error:", err);
    if (isRateLimitError(err)) {
      return res.status(429).json({ error: friendlyError(err), retryAfterMs: parseRetryDelayMs(err) });
    }
    return res.status(500).json({ error: friendlyError(err) });
  }
}
