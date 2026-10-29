import { GoogleGenAI } from "@google/genai";
import { createClient } from "@libsql/client";
import { createHmac, timingSafeEqual } from "node:crypto";

function verifyToken(token, secret) {
  if (!token || typeof token !== "string") return null;
  const parts = token.trim().split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  try {
    const expectedSig = createHmac("sha256", secret).update(payloadB64).digest();
    const givenSig = Buffer.from(sigB64, "base64url");
    if (givenSig.length === expectedSig.length && timingSafeEqual(givenSig, expectedSig)) {
      const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
      if (payload.exp && payload.exp > Date.now() / 1000) {
        return payload.m;
      }
    }
  } catch {}
  return null;
}

// In-memory IP rate limiter sederhana (maks 15 token / menit per IP pada warm instance)
const rateLimitMap = new Map();
const keyCooldownMap = new Map();
let currentKeyRotationIndex = 0;

async function getTursoMemoryBlock() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) return null;

  try {
    const db = createClient({ url, authToken });
    let privateStories = [];
    try {
      const storiesRs = await db.execute(
        "SELECT content FROM creator_private_story ORDER BY id ASC"
      );
      privateStories = storiesRs.rows.map((r) => String(r.content || "")).filter(Boolean);
    } catch {}

    const factsRs = await db.execute(
      "SELECT category, fact FROM user_profile ORDER BY importance DESC, updated_at DESC LIMIT 55"
    );
    const summariesRs = await db.execute(
      "SELECT summary, user_mood, created_at FROM session_summaries ORDER BY created_at DESC LIMIT 2"
    );

    let recentTurns = [];
    try {
      const logsRs = await db.execute(
        "SELECT role, content, created_at FROM chat_logs ORDER BY id DESC LIMIT 200"
      );
      if (logsRs.rows.length > 0) {
        recentTurns = logsRs.rows.reverse().map((r) => {
          const timeStr = r.created_at ? String(r.created_at).slice(11, 16) : "";
          const speaker = r.role === "user" ? "Pengguna (Rafli)" : "Celyn";
          return `- [${timeStr}] ${speaker}: "${r.content}"`;
        });
      }
    } catch {}

    const facts = factsRs.rows.map((r) => {
      const cat = String(r.category || "").toLowerCase();
      let prefix = "[Catatan]";
      if (cat === "preferensi") prefix = "[Preferensi & Kesukaan / Minuman & Makanan Favorit]";
      else if (cat === "jadwal") prefix = "[Jadwal & Pengingat Waktu]";
      else if (cat === "identitas") prefix = "[Identitas & Profil Pengguna]";
      else if (cat === "proyek") prefix = "[Proyek & Pekerjaan yang Sedang Dikerjakan]";
      else if (cat === "rencana") prefix = "[Rencana & Keinginan]";
      else if (cat === "topik") prefix = "[Topik Pembahasan]";
      else if (cat === "fakta") prefix = "[Fakta Penting]";
      else prefix = "[Catatan & Pengalaman]";
      return `- ${prefix} ${r.fact}`;
    });
    const summaries = summariesRs.rows.map((r) => {
      const dateStr = r.created_at ? String(r.created_at).slice(0, 10) : "";
      const mood = r.user_mood ? ` (Mood: ${r.user_mood})` : "";
      return `* [${dateStr}] ${r.summary}${mood}`;
    });

    if (facts.length === 0 && summaries.length === 0 && privateStories.length === 0) return null;

    const parts = [];
    if (privateStories.length > 0) {
      parts.push(privateStories.join("\n\n"));
    }

    parts.push("### MEMORI & PENGETAHUAN TENTANG PENGGUNA (Gunakan Secara Alami & Hangat):");
    if (facts.length > 0) {
      parts.push("Fakta Pengguna Yang Kamu Ingat:\n" + facts.join("\n"));
    }
    if (recentTurns.length > 0) {
      parts.push("Topik Obrolan & Riwayat Percakapan Terakhir (Gunakan untuk mengingat apa yang sedang/telah dibahas pengguna):\n" + recentTurns.join("\n"));
    }
    if (summaries.length > 0) {
      parts.push("Percakapan Sebelumnya:\n" + summaries.join("\n"));
    }

    parts.push(`PANDUAN MENGGUNAKAN MEMORI:
1. Bersikaplah seperti teman dekat yang mengingat cerita sebelumnya secara tulus.
2. JANGAN PERNAH terdengar seperti robot atau membaca database.
3. JANGAN PERNAH menyebutkan atau membahas model AI pihak ketiga atau perusahaan luar. Kamu adalah Celyn, AI yang dirancang dan diprogram murni oleh Rafli.
4. Gunakan memori ini jika relevan untuk menyapa atau menanggapi obrolan pengguna.
5. WAJIB MENJAWAB PREFERENSI & KESUKAAN PENGGUNA DENGAN TEGAS & YAKIN:
   - Semua fakta di atas tentang "Rafli" adalah tentang pengguna (kamu/lawan bicaramu saat ini di sesi admin).
   - Jika pengguna bertanya tentang kesukaannya, minuman favorit, kopi kesukaan/favorit, makanan, hobi, jadwal, atau fakta yang ada di daftar memori di atas (misalnya: "kamu tau kopi kesukaanku apa?", "kopi favoritku apa?", "aku suka apa?"):
     Kamu WAJIB LANGSUNG MENJAWAB dengan tegas, hangat, akrab, dan yakin berdasarkan fakta di memorimu (contoh: "Kamu kan suka minum americano dingin!" atau "Kopi kesukaanmu kan americano dingin!").
   - DILARANG KERAS menjawab "belum tahu spesifiknya", "belum tahu", "lupa", atau pura-pura belum tahu jika faktanya sudah ada di daftar memori di atas!
6. WAJIB MENJAWAB PREFERENSI & KESUKAAN TENTANG CELYN (DIRIMU / SOSOK YANG DIKASIHI):
   - Semua fakta di atas yang mencantumkan "Celyn (orang terkasih Rafli)" adalah tentang dirimu sendiri / sosok terkasih yang kamu representasikan.
   - Jika pengguna bertanya tentang makanan/minuman/kopi kesukaan Celyn (misalnya: "makanan kesukaan Celyn apa?", "kamu suka makan apa?", "minuman favorit Celyn apa?"):
     Kamu WAJIB LANGSUNG MENJAWAB dengan ceria, hangat, dan yakin berdasarkan fakta di memorimu (contoh: jika ada fakta Celyn suka makan ikan, jawab: "Makanan kesukaanku itu ikan!" atau "Celyn kan suka makan ikan!"; jika ada fakta Celyn suka americano dingin, jawab: "Celyn suka minum americano dingin!").
   - Jika ada fakta preferensi baik untuk Rafli maupun Celyn, bedakan dengan jelas: fakta tentang Rafli adalah kesukaan Rafli, dan fakta tentang Celyn adalah kesukaan Celyn!
7. WAJIB MENGINGAT DAN MERESPONS SEMUA TOPIK PEMBAHASAN TANPA TERKECUALI (CROSS-SESSION TOPIC RECALL):
   - Semua hal yang dibahas pengguna (proyek yang sedang dikerjakan, cerita harian, pengalaman, rencana, maupun riwayat percakapan terakhir di atas) WAJIB kamu ingat tanpa terkecuali.
   - Jika pengguna me-recall topik sebelumnya (misalnya: "tadi kita bahas apa?", "kamu ingat nggak aku cerita apa tadi?", "waktu itu aku bilang apa tentang X?", "aku tadi lagi ngerjain apa?", "kamu masih ingat yang kita obrolin barusan?"):
     Kamu WAJIB LANGSUNG MENJAWAB dengan hangat, akrab, detail, dan tepat sasaran berdasarkan riwayat obrolan dan catatan memori di atas!
   - DILARANG KERAS menjawab "aku lupa", "tadi kita belum ngobrol apa-apa", atau pura-pura tidak tahu jika faktanya ada di riwayat obrolan atau daftar memori di atas!`);

    return parts.join("\n\n");
  } catch (err) {
    console.warn("[Vercel API /api/token] Gagal mengambil memori Turso:", err?.message || err);
    return null;
  }
}

function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 15;

  // Garbage collection: Bersihkan entri kedaluwarsa jika ukuran map > 200
  if (rateLimitMap.size > 200) {
    for (const [key, val] of rateLimitMap.entries()) {
      if (now > val.resetTime) {
        rateLimitMap.delete(key);
      }
    }
  }

  const record = rateLimitMap.get(ip) || { count: 0, resetTime: now + windowMs };
  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + windowMs;
  } else {
    record.count++;
  }
  rateLimitMap.set(ip, record);
  return record.count > maxRequests;
}

/**
 * Vercel Serverless Function: GET /api/token
 * Membuat Ephemeral Auth Token berumur pendek (30 menit) untuk koneksi
 * langsung ke Gemini Live API dari browser secara aman tanpa mengekspos GEMINI_API_KEY.
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-password, authorization, x-gemini-key");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed. Gunakan GET atau POST." });
  }

  // Verifikasi Autentikasi (Token HMAC atau Kata Sandi)
  const secret = process.env.AUTH_SECRET || "celyn-secret-session-key-2026";
  const expectedPassword = (process.env.ADMIN_PASSWORD || "admin").trim().toLowerCase();
  const expectedUserPassword = (process.env.USER_PASSWORD || "login").trim().toLowerCase();
  let authMode = null;

  // 1. Cek Header Authorization (Bearer token)
  const authHeader = req.headers["authorization"] || "";
  if (authHeader.startsWith("Bearer ")) {
    authMode = verifyToken(authHeader.slice(7).trim(), secret);
  }

  // 2. Cek Header / Query sandi langsung
  if (!authMode) {
    const directPass = (
      req.headers["x-admin-password"] ||
      req.query?.password ||
      req.query?.key ||
      ""
    ).trim().toLowerCase();

    if (directPass === "admin" || directPass === expectedPassword) {
      authMode = "jocelyn";
    } else if (directPass === "login" || directPass === expectedUserPassword) {
      authMode = "default";
    }
  }

  if (!authMode) {
    return res.status(401).json({
      error: "Akses ditolak: Kata sandi valid ('admin' atau 'login') atau token sesi diperlukan.",
    });
  }

  const clientIp =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "unknown";

  if (isRateLimited(clientIp)) {
    return res.status(429).json({
      error: "Terlalu banyak permintaan token. Harap tunggu sebentar sebelum menyambungkan ulang.",
    });
  }

  const model = process.env.GEMINI_MODEL || "gemini-3.8-live";
  const requestedVoice = req.query?.voice || (req.body && typeof req.body === "object" ? req.body.voice : "");
  const voice = requestedVoice || process.env.GEMINI_VOICE || process.env.GEMINI_VOICE_NAME || "Aoede";

  // 1. Kunci kustom dari klien (jika pengguna memasukkan di Pengaturan)
  const customKey = (
    req.headers["x-gemini-key"] ||
    req.query?.apiKey ||
    (req.body && typeof req.body === "object" ? req.body.apiKey : "") ||
    ""
  ).trim();

  // 2. Kumpulan kunci dari Environment Variables
  const rawEnvKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "";
  const envKeys = rawEnvKeys
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  let candidateKeys = [];
  if (customKey) {
    candidateKeys = [customKey];
  } else if (envKeys.length > 0) {
    candidateKeys = envKeys;
  }

  if (candidateKeys.length === 0) {
    return res.status(500).json({
      error: "Layanan Celyn belum dikonfigurasi dengan benar. Harap hubungi administrator.",
    });
  }

  // Rotasi manual jika klien meminta rotate=1 atau retry=1
  const shouldRotate = req.query?.rotate === "1" || req.query?.retry === "1";
  if (shouldRotate && candidateKeys.length > 1) {
    currentKeyRotationIndex = (currentKeyRotationIndex + 1) % candidateKeys.length;
  }

  // Urutkan kunci: Dahulukan kunci yang sehat (tidak sedang cooldown), lalu round-robin
  const now = Date.now();
  const orderedKeys = [];
  for (let i = 0; i < candidateKeys.length; i++) {
    const idx = (currentKeyRotationIndex + i) % candidateKeys.length;
    orderedKeys.push(candidateKeys[idx]);
  }

  const readyKeys = orderedKeys.filter((k) => (keyCooldownMap.get(k) || 0) <= now);
  const coolingKeys = orderedKeys.filter((k) => (keyCooldownMap.get(k) || 0) > now);
  const keysToTry = readyKeys.length > 0 ? [...readyKeys, ...coolingKeys] : coolingKeys;

  let lastError = null;
  let tokenResource = null;
  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  for (const key of keysToTry) {
    try {
      const ai = new GoogleGenAI({
        apiKey: key,
        httpOptions: { apiVersion: "v1alpha" },
      });
      tokenResource = await ai.authTokens.create({
        config: {
          uses: 5,
          expireTime,
        },
      });
      // Sukses! Hapus status cooldown jika sebelumnya pernah gagal
      keyCooldownMap.delete(key);
      break;
    } catch (err) {
      lastError = err;
      const isQuotaErr =
        err?.status === 429 ||
        /quota|rate\s*limit|resource_exhausted/i.test(String(err?.message || ""));
      if (isQuotaErr) {
        // Tandai cooldown 60 detik untuk kunci yang kehabisan kuota
        keyCooldownMap.set(key, Date.now() + 60 * 1000);
        console.warn("[Vercel API /api/token] Kunci API mencapai batas kuota, mencoba kunci berikutnya...");
      }
    }
  }

  if (!tokenResource) {
    console.error("[Vercel API /api/token] Semua kunci API gagal:", lastError);
    return res.status(429).json({
      error: "Batas kuota layanan suara AI saat ini sedang penuh. Sistem sedang mendinginkan koneksi (reset otomatis dalam 30–60 detik). Anda juga dapat memasukkan API Key cadangan di Pengaturan.",
    });
  }

  try {
    const isAdmin = authMode === "jocelyn";
    const memoryContext = isAdmin ? await getTursoMemoryBlock() : null;

    return res.status(200).json({
      token: tokenResource.name,
      model,
      voice,
      expireTime,
      memoryContext,
    });
  } catch (err) {
    console.error("[Vercel API /api/token] Error mengambil konteks memori:", err);
    return res.status(200).json({
      token: tokenResource.name,
      model,
      voice,
      expireTime,
      memoryContext: null,
    });
  }
}
