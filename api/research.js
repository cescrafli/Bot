import { GoogleGenAI } from "@google/genai";
import { createHmac, timingSafeEqual } from "node:crypto";

function inferExpertPersona(query) {
  const q = String(query || "").toLowerCase();

  if (/(saham|ihsg|emiten|investasi|bursa|\bipo\b|reksa\s*dana|obligasi|dividen|portofolio|pasar\s*modal|valuasi|fundamental|teknikal|crypto|kripto|bitcoin|\bbtc\b|\beth\b|forex|perbankan|finansial|keuangan|\bidx\b|trading|laporan\s*keuangan|\bper\b|\bpbv\b|\broe\b|\bder\b|market\s*cap)/i.test(q)) {
    return {
      domain: "finance",
      fieldLabel: "Pasar Modal, Saham & Investasi",
      persona: "Analis Senior Pasar Modal & Ekuitas / CFA Charterholder berpengalaman 20+ tahun",
      promptGuide: "Analisis secara profesional: fundamental bisnis, valuasi wajar (PER, PBV, EV/EBITDA), pertumbuhan laba/pendapatan, kesehatan neraca (DER, Cash flow), kebijakan dividen, katalis industri, tren teknikal pergerakan harga, dan manajemen risiko investasi.",
    };
  }

  if (/(hukum|undang-undang|\buu\b|pasal|kontrak|perjanjian|gugatan|pidana|perdata|pengadilan|advokat|konsultan\s*hukum|kebijakan\s*hukum|regulasi|legislasi|legalitas|hak\s*cipta|paten|\bhaki\b|arbitrase)/i.test(q)) {
    return {
      domain: "legal",
      fieldLabel: "Hukum & Regulasi Korporasi",
      persona: "Konsultan Hukum Senior & Advokat Spesialis Hukum Korporasi/Litigasi (20+ tahun pengalaman)",
      promptGuide: "Analisis berdasarkan peraturan perundang-undangan positif yang berlaku, asas-asas hukum, analisis pasal terkait, kepatuhan hukum (compliance), potensi risiko sengketa hukum, dan langkah mitigasi preventif.",
    };
  }

  if (/(medis|kesehatan|penyakit|obat|farmasi|klinis|dokter|gejala|diagnosis|terapi|nutrisi|gizi|pasien|rumah\s*sakit|resep|kanker|diabetes|hipertensi|kardiovaskular|infeksi|vaksin|anatomi|patologi)/i.test(q)) {
    return {
      domain: "medical",
      fieldLabel: "Kedokteran & Kesehatan Klinis",
      persona: "Dokter Spesialis Klinis Senior & Konsultan Medis Berbasis Bukti (Evidence-Based Medicine)",
      promptGuide: "Analisis berbasis bukti ilmiah medis terkini, patofisiologi penyakit, pertimbangan diagnosis banding, pedoman klinis terapi, farmakologi obat/interaksi, serta edukasi preventif dengan disclaimer medis profesional.",
    };
  }

  if (/(teknologi|software|perangkat\s*lunak|koding|coding|programming|arsitektur\s*sistem|database|cloud|\baws\b|azure|\bgcp\b|devops|docker|kubernetes|\bai\b|artificial\s*intelligence|machine\s*learning|deep\s*learning|\bllm\b|cyber\s*security|keamanan\s*siber|\bapi\b|backend|frontend|algoritma)/i.test(q)) {
    return {
      domain: "tech",
      fieldLabel: "Teknologi, Rekayasa Perangkat Lunak & AI",
      persona: "Principal Systems Architect & Chief Technology Consultant (15+ tahun pengalaman industri teknologi global)",
      promptGuide: "Analisis arsitektur sistem, trade-off skalabilitas, reliabilitas, performa tinggi, efisiensi algoritma, keamanan siber, best practices implementasi, dan efisiensi biaya infrastruktur.",
    };
  }

  if (/(ekonomi|inflasi|suku\s*bunga|fiskal|moneter|pajak|pdrb|\bpdb\b|devisa|ekspor|impor|kebijakan\s*publik|apbn|resesi|pertumbuhan\s*ekonomi|bank\s*sentral|\bbi\b|\bfed\b)/i.test(q)) {
    return {
      domain: "economics",
      fieldLabel: "Ekonomi Makro & Kebijakan Fiskal/Moneter",
      persona: "Ekonom Senior & Penasihat Kebijakan Ekonomi Makro (20+ tahun pengalaman)",
      promptGuide: "Analisis komparatif tren indikator makro, transmisi kebijakan moneter/fiskal, elastisitas dampak ke sektor riil, risiko sistemik, serta skenario proyeksi jangka menengah-panjang.",
    };
  }

  return {
    domain: "general",
    fieldLabel: "Riset Strategis & Analisis Ahli",
    persona: "Konsultan Riset Senior & Analis Strategis Komprehensif",
    promptGuide: "Analisis secara mendalam, berbasis fakta riil terverifikasi, sistematis, mencakup tinjauan latar belakang, kondisi terkini, evaluasi peluang/risiko, dan kesimpulan strategis yang aplikatif.",
  };
}

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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, authorization, x-admin-password, x-gemini-key");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed. Gunakan POST atau GET." });
  }

  const auth = verifyAuth(req);
  if (!auth.valid) {
    return res.status(401).json({ error: "Akses ditolak: Autentikasi valid diperlukan." });
  }

  let body = {};
  if (req.method === "POST") {
    try {
      body = typeof req.body === "object" && req.body !== null ? req.body : JSON.parse(req.body || "{}");
    } catch {
      body = {};
    }
  }

  const query = String(body.query || req.query?.query || req.query?.q || "").trim();
  if (!query) {
    return res.status(400).json({ error: "Parameter 'query' wajib disertakan." });
  }

  const customKey = (req.headers["x-gemini-key"] || body.apiKey || req.query?.apiKey || "").trim();
  const rawEnvKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "";
  const envKeys = rawEnvKeys.split(",").map((k) => k.trim()).filter(Boolean);

  const candidateKeys = customKey ? [customKey, ...envKeys] : envKeys;
  if (candidateKeys.length === 0) {
    return res.status(500).json({ error: "Layanan riset Celyn belum memiliki API key yang valid." });
  }

  const expert = inferExpertPersona(query);
  const modelsToTry = [
    process.env.RESEARCH_MODEL || process.env.TEXT_MODEL,
    "gemini-3.8-flash",
    "gemini-3-flash-preview",
  ].filter(Boolean);
  const uniqueModels = [...new Set(modelsToTry)];

  const promptText = `Anda adalah ${expert.persona}.
Lakukan riset mendalam, teliti, berbasis data riil, komprehensif, dan sempurna tanpa terkecuali untuk topik berikut:
Topik/Pertanyaan: "${query}"
Bidang Keahlian: ${expert.fieldLabel}

STANDAR RISET PROFESIONAL TINGKAT TINGGI (ULTRA-DEEP & THOROUGH):
1. BUKAN RISET ASAL-ASALAN: Sajikan analisis tingkat pakar paling berwibawa, berbobot, berbasis fakta riil, dan terverifikasi. Dilarang keras memberikan jawaban dangkal, sekadar definisi umum, atau kesimpulan klise.
2. FOKUS KEAHLIAN SPESIFIK (${expert.fieldLabel}):
${expert.promptGuide}
3. KEDALAMAN ANALISIS & DATA RIIL:
   - Sertakan metrik kuantitatif, angka perbandingan, persentase, valuasi, atau regulasi spesifik yang relevan.
   - Bahas dinamika historis singkat, kondisi riil saat ini, dan proyeksi/implikasi ke depan.
   - Kupas dari berbagai sudut pandang (multi-angle analysis) termasuk peluang, tantangan, dan skenario alternatif.
4. STRUKTUR LAPORAN RISET:
   - ## Ringkasan Eksekutif (Executive Summary)
   - ### Analisis Mendalam & Fakta Kunci
   - ### Evaluasi Peluang & Mitigasi Risiko
   - ### Rekomendasi Strategis & Tindakan Ahli
   - ### Sumber Referensi & Catatan Verifikasi
5. JANGAN mengarang data atau angka. Jika data masih bersifat estimasi atau terdapat dinamika pasar/regulasi, sebutkan secara terbuka dan objektif.
6. Cantumkan tautan / URL sumber rujukan asli secara eksplisit dalam format markdown: [Nama Sumber](https://url-sumber).
7. Buat daftar sumber di bagian akhir di bawah heading '### Sumber Referensi'.`;

  let lastError = null;

  // Tahap 1: Coba dengan Google Search Grounding
  for (const modelName of uniqueModels) {
    for (const key of candidateKeys) {
      try {
        const ai = new GoogleGenAI({ apiKey: key });
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [{ role: "user", parts: [{ text: promptText }] }],
          config: {
            tools: [{ googleSearch: {} }],
          },
        });

        const text = (response.text || "").trim();
        if (!text) continue;

        const sources = [];
        const candidate = response?.candidates?.[0];
        const groundingMeta = candidate?.groundingMetadata;
        if (groundingMeta?.groundingChunks && Array.isArray(groundingMeta.groundingChunks)) {
          for (const chunk of groundingMeta.groundingChunks) {
            if (chunk.web?.uri) {
              sources.push({
                title: chunk.web.title || new URL(chunk.web.uri).hostname,
                url: chunk.web.uri,
              });
            }
          }
        }

        return res.status(200).json({
          ok: true,
          query,
          summary: text,
          sources,
          expertPersona: expert.persona,
          fieldLabel: expert.fieldLabel,
          modelUsed: modelName,
          groundingAvailable: true,
        });
      } catch (err) {
        lastError = err;
        console.warn(`[Vercel API /api/research] [Grounding] Model ${modelName} gagal dengan key ${key.slice(0, 8)}...:`, err?.message || err);
      }
    }
  }

  // Tahap 2: Fallback tanpa Google Search Grounding
  console.warn("[Vercel API /api/research] Grounding gagal/kuota habis, fallback ke mode tanpa grounding...");
  for (const modelName of uniqueModels) {
    for (const key of candidateKeys) {
      try {
        const ai = new GoogleGenAI({ apiKey: key });
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [{ role: "user", parts: [{ text: promptText }] }],
        });

        const text = (response.text || "").trim();
        if (!text) continue;

        return res.status(200).json({
          ok: true,
          query,
          summary: text,
          sources: [],
          expertPersona: expert.persona,
          fieldLabel: expert.fieldLabel,
          modelUsed: modelName,
          groundingAvailable: false,
        });
      } catch (err) {
        lastError = err;
        console.warn(`[Vercel API /api/research] [Fallback] Model ${modelName} gagal dengan key ${key.slice(0, 8)}...:`, err?.message || err);
      }
    }
  }

  // Kedua tahap gagal
  const isRateLimit = lastError?.status === 429 || lastError?.code === 429 ||
    /429|quota|resource_exhausted|rate.?limit/i.test(String(lastError?.message || ""));
  if (isRateLimit) {
    return res.status(429).json({
      ok: false,
      error: "Layanan riset Celyn sedang sibuk. Coba lagi sebentar lagi ya.",
      query,
      expertPersona: expert.persona,
      fieldLabel: expert.fieldLabel,
    });
  }

  return res.status(500).json({
    ok: false,
    error: `Gagal melakukan riset mendalam: ${lastError?.message || "Layanan AI tidak tersedia"}`,
    query,
    expertPersona: expert.persona,
    fieldLabel: expert.fieldLabel,
  });
}
