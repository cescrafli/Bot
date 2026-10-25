import { GoogleGenAI } from "@google/genai";

/**
 * Vercel Serverless Function: GET /api/token
 * Membuat Ephemeral Auth Token berumur pendek (30 menit) untuk koneksi
 * langsung ke Gemini Live API dari browser secara aman tanpa mengekspos GEMINI_API_KEY.
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const apiKey = process.env.GEMINI_API_KEY || "";
  const model = process.env.GEMINI_MODEL || "gemini-3.8-live";
  const voice = process.env.GEMINI_VOICE || process.env.GEMINI_VOICE_NAME || "Aoede";

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
