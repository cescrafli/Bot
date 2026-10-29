/**
 * Single source of truth for Celyn AI Tools
 * Used in server GeminiSession, client DirectSession, and test suites.
 */

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: "OBJECT";
    properties: Record<string, any>;
    required?: string[];
  };
}

export const CELYN_CORE_TOOLS: ToolDeclaration[] = [
  {
    name: "set_expression",
    description:
      "Ubah ekspresi wajah visual avatar Celyn secara langsung untuk merespons emosi percakapan.",
    parameters: {
      type: "OBJECT",
      properties: {
        emotion: {
          type: "STRING",
          description: "Nama ekspresi avatar: happy, sad, thinking, surprised, shy, neutral",
        },
        intensity: {
          type: "NUMBER",
          description: "Intensitas ekspresi dari 0.0 sampai 1.0 (default 0.8)",
        },
      },
      required: ["emotion"],
    },
  },
  {
    name: "point_at_screen",
    description:
      "Tunjuk ke koordinat tertentu pada layar atau dokumen pengguna saat sedang screen sharing.",
    parameters: {
      type: "OBJECT",
      properties: {
        x: {
          type: "NUMBER",
          description: "Koordinat horizontal normalisasi (0.0 = paling kiri, 1.0 = paling kanan)",
        },
        y: {
          type: "NUMBER",
          description: "Koordinat vertikal normalisasi (0.0 = paling atas, 1.0 = paling bawah)",
        },
        description: {
          type: "STRING",
          description: "Penjelasan singkat elemen atau teks yang sedang ditunjuk",
        },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "remember_fact",
    description:
      "Simpan fakta penting, preferensi, jadwal, atau intisari cerita pengguna ke memori jangka panjang.",
    parameters: {
      type: "OBJECT",
      properties: {
        fact: {
          type: "STRING",
          description: "Intisari fakta yang sudah diringkas padat, singkat, dan jelas.",
        },
        category: {
          type: "STRING",
          description:
            "Kategori fakta: preferensi, jadwal, identitas, proyek, rencana, topik, catatan, atau fakta",
        },
        importance: {
          type: "NUMBER",
          description: "Skala prioritas fakta dari 1 (ringan) hingga 3 (sangat penting)",
        },
      },
      required: ["fact"],
    },
  },
  {
    name: "create_document",
    description:
      "Buat file dokumen baru dari awal berupa Word (.docx), Excel (.xlsx), atau PDF (.pdf).",
    parameters: {
      type: "OBJECT",
      properties: {
        kind: {
          type: "STRING",
          description: "Jenis file yang ingin dibuat: pdf, docx, atau xlsx",
        },
        title: {
          type: "STRING",
          description: "Judul utama dokumen",
        },
        instruction: {
          type: "STRING",
          description: "Instruksi detail isi dan struktur dokumen yang ingin dihasilkan",
        },
      },
      required: ["kind", "title", "instruction"],
    },
  },
  {
    name: "process_document",
    description:
      "Proses dokumen yang sudah diunggah: summarize (meringkas), translate (menerjemahkan), paraphrase (parafrase), edit (mengubah isi dengan menjaga format), atau custom (analisis bebas).",
    parameters: {
      type: "OBJECT",
      properties: {
        docId: {
          type: "STRING",
          description: "Nama file atau ID dokumen yang ingin diproses",
        },
        operation: {
          type: "STRING",
          description: "Operasi: summarize, translate, paraphrase, edit, atau custom",
        },
        targetLanguage: {
          type: "STRING",
          description: "Bahasa tujuan khusus untuk operasi translate (misal: 'Bahasa Inggris', 'Bahasa Jepang'). TANYAKAN dulu ke pengguna jika belum disebutkan.",
        },
        instruction: {
          type: "STRING",
          description: "Instruksi spesifik atau panduan pengeditan/analisis dokumen",
        },
      },
      required: ["docId", "operation"],
    },
  },
  {
    name: "research",
    description:
      "Lakukan riset mendalam atau pencarian fakta dan informasi terkini di web. Kembalikan temuan beserta link/tautan sumber rujukan.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "Topik atau kueri pencarian riset yang ingin dicari informasinya secara akurat",
        },
      },
      required: ["query"],
    },
  },
];
