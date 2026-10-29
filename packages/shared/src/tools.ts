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
      "Lakukan riset mendalam atau pencarian fakta dan informasi terkini di web. PENTING: Saat melakukan riset (saham, hukum, kedokteran/kesehatan, teknologi, bisnis, dsb), kamu WAJIB langsung berperan sebagai pakar/ahli paling profesional dan senior di bidang tersebut (misal analis saham CFA, dokter spesialis, pengacara senior) bukan riset asal-asalan. Kamu juga siap menyusun hasilnya dalam format dokumen PDF (.pdf) atau Word (.docx) jika diminta.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description:
            "Topik atau kueri pencarian riset yang ingin dicari informasinya secara akurat dan mendalam",
        },
      },
      required: ["query"],
    },
  },
];

export interface ExpertPersonaInfo {
  domain: string;
  fieldLabel: string;
  persona: string;
  promptGuide: string;
}

/**
 * Mendeteksi domain keahlian profesional berdasarkan topik/kueri riset pengguna.
 * Menjamin Celyn langsung mengadopsi persona pakar paling senior & berwibawa (bukan riset dangkal/ngasal).
 */
export function inferExpertPersona(query: string): ExpertPersonaInfo {
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

  // 7. Sains, Riset Ilmiah, Fisika, Kimia, Biologi & Laboratorium
  if (
    /(sains|fisika|kimia|biologi|astronomi|geologi|penelitian\s*ilmiah|metodologi|jurnal|akademis|laboratorium|eksperimen|peer-reviewed|ilmiah)/i.test(
      q
    )
  ) {
    return {
      domain: "science",
      fieldLabel: "Sains & Riset Akademis Ilmiah",
      persona:
        "Ilmuwan Riset Senior & Peneliti Akademis Tingkat Doktoral (PhD)",
      promptGuide:
        "Analisis berbasis metodologi ilmiah yang ketat, bukti eksperimental empiris, konsistensi data, telaah literatur primer, dan verifikasi hipotesis.",
    };
  }

  // 8. Pendidikan, Kurikulum & Pedagogi
  if (
    /(pendidikan|kurikulum|pedagogi|pembelajaran|sekolah|kuliah|mahasiswa|guru|dosen|silabus|akademik|edukasi)/i.test(
      q
    )
  ) {
    return {
      domain: "education",
      fieldLabel: "Pendidikan & Pengembangan Kurikulum",
      persona:
        "Pakar Pedagogi Senior & Konsultan Kurikulum Akademis",
      promptGuide:
        "Analisis taksonomi pembelajaran, efektivitas metodologi pengajaran, penyusunan kurikulum modern, dan evaluasi hasil belajar holistik.",
    };
  }

  // 9. Fallback: Riset Spesialis & Analisis Mendalam
  return {
    domain: "general",
    fieldLabel: "Riset Spesialis & Analisis Mendalam",
    persona: "Peneliti Senior & Analis Spesialis Berpengalaman",
    promptGuide:
      "Analisis komprehensif, terstruktur, kritis, objektif, berbasis data dan fakta terverifikasi, bukan sekadar rangkuman umum.",
  };
}

/**
 * Roadmap Fitur Masa Depan: Edit Foto & Manipulasi Gambar AI
 */
export interface EditImageParams {
  fileName: string;
  instruction: string;
  maskPrompt?: string;
  outputFormat?: "png" | "jpeg" | "webp";
}
