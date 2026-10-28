/**
 * Vercel Serverless Function: GET /api/health
 * Memberikan diagnosa real-time status API, Gemini, dan konektivitas Turso Cloud di Vercel.
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY);
  const hasTursoUrl = Boolean(process.env.TURSO_DATABASE_URL);
  const hasTursoToken = Boolean(process.env.TURSO_AUTH_TOKEN);
  const hasAdminPass = Boolean(process.env.ADMIN_PASSWORD);

  let tursoStatus = "not_configured";
  let userProfileCount = 0;

  if (hasTursoUrl && hasTursoToken) {
    try {
      const { createClient } = await import("@libsql/client");
      const db = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
      });
      const rs = await db.execute("SELECT count(*) as count FROM user_profile");
      userProfileCount = Number(rs.rows[0]?.count ?? 0);
      tursoStatus = "connected";
    } catch (err) {
      tursoStatus = `connection_error: ${err?.message || "Unknown"}`;
    }
  }

  return res.status(200).json({
    status: "ok",
    service: "Celyn AI Bot Vercel Serverless",
    timestamp: new Date().toISOString(),
    environment: {
      geminiConfigured: hasGeminiKey,
      tursoConfigured: hasTursoUrl && hasTursoToken,
      tursoDatabaseUrlSet: hasTursoUrl,
      tursoAuthTokenSet: hasTursoToken,
      tursoLiveStatus: tursoStatus,
      userProfileRecords: userProfileCount,
      adminPasswordCustomized: hasAdminPass,
    },
    config: {
      model: process.env.GEMINI_MODEL || "gemini-3.8-live",
      voice: process.env.GEMINI_VOICE || process.env.GEMINI_VOICE_NAME || "Aoede",
    },
    diagnostics: {
      isReadyForAutonomousMemory: hasGeminiKey && hasTursoUrl && hasTursoToken && tursoStatus === "connected",
      message: (hasTursoUrl && hasTursoToken && tursoStatus === "connected")
        ? "Turso Cloud terhubung sempurna. Celyn AI siap menyimpan memori secara mandiri."
        : "PERINGATAN: TURSO_DATABASE_URL atau TURSO_AUTH_TOKEN belum terpasang di Vercel Environment Variables!"
    }
  });
}
