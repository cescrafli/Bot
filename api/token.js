import { GoogleGenAI } from "@google/genai";
import { createClient } from "@libsql/client";

// In-memory IP rate limiter sederhana (maks 15 token / menit per IP pada warm instance)
const rateLimitMap = new Map();

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
        "SELECT role, content, created_at FROM chat_logs ORDER BY id DESC LIMIT 25"
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-password, authorization");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed. Gunakan GET atau POST." });
  }

  // Verifikasi Kata Sandi ('admin' atau 'login')
  const expectedPassword = process.env.ADMIN_PASSWORD || "admin";
  const validPasswords = ["admin", "login", expectedPassword];
  const providedPassword =
    req.headers["x-admin-password"] ||
    req.query?.password ||
    req.query?.key;

  if (!providedPassword || !validPasswords.includes(String(providedPassword).trim())) {
    return res.status(401).json({
      error: "Akses ditolak: Kata sandi valid ('admin' atau 'login') diperlukan.",
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

  const apiKey = process.env.GEMINI_API_KEY || "";
  const model = process.env.GEMINI_MODEL || "gemini-3.8-live";
  const requestedVoice = req.query?.voice || (req.body && typeof req.body === "object" ? req.body.voice : "");
  const voice = requestedVoice || process.env.GEMINI_VOICE || process.env.GEMINI_VOICE_NAME || "Aoede";

  if (!apiKey) {
    return res.status(500).json({
      error:
        "GEMINI_API_KEY belum dipasang di Environment Variables Vercel. Silakan buka Vercel Dashboard -> Settings -> Environment Variables dan tambahkan GEMINI_API_KEY.",
    });
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: "v1alpha" },
    });

    const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const tokenResource = await ai.authTokens.create({
      config: {
        uses: 5,
        expireTime,
      },
    });

    const isAdmin =
      String(providedPassword).trim() === "admin" ||
      String(providedPassword).trim() === expectedPassword;
    const memoryContext = isAdmin ? await getTursoMemoryBlock() : null;

    return res.status(200).json({
      token: tokenResource.name,
      model,
      voice,
      expireTime,
      memoryContext,
    });
  } catch (err) {
    console.error("[Vercel API /api/token] Error:", err);
    return res.status(500).json({
      error: `Gagal membuat Ephemeral Token Gemini: ${err?.message || "Unknown error"}`,
    });
  }
}
