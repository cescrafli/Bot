import { GoogleGenAI } from "@google/genai";

// In-memory IP rate limiter sederhana (maks 15 token / menit per IP pada warm instance)
const rateLimitMap = new Map();

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

    return res.status(200).json({
      token: tokenResource.name,
      model,
      voice,
      expireTime,
    });
  } catch (err) {
    console.error("[Vercel API /api/token] Error:", err);
    return res.status(500).json({
      error: `Gagal membuat Ephemeral Token Gemini: ${err?.message || "Unknown error"}`,
    });
  }
}
