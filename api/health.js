/**
 * Vercel Serverless Function: GET /api/health
 */
export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.status(200).json({
    status: "ok",
    service: "Celyn AI Bot Vercel Serverless",
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    model: process.env.GEMINI_MODEL || "gemini-3.8-live",
    voice: process.env.GEMINI_VOICE || process.env.GEMINI_VOICE_NAME || "Aoede",
  });
}
