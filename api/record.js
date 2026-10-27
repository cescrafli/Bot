import { createClient } from "@libsql/client";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-password");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const expectedPassword = process.env.ADMIN_PASSWORD || "admin";
  const authPass =
    req.headers["x-admin-password"] ||
    req.query?.password ||
    (req.body && req.body.password);

  // Zero-leak check: Hanya simpan jika kata sandi adalah admin
  if (String(authPass).trim() !== "admin" && String(authPass).trim() !== expectedPassword) {
    return res.status(200).json({ ok: false, message: "Ignored for non-admin" });
  }

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) return res.status(500).json({ error: "Turso not configured" });

  try {
    const { sessionId, role, content } = req.body || {};
    if (!sessionId || !role || !content || !String(content).trim()) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const db = createClient({ url, authToken });
    await db.execute({
      sql: "INSERT INTO chat_logs (session_id, role, content) VALUES (?, ?, ?)",
      args: [String(sessionId), String(role), String(content).trim()],
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[Vercel API /api/record] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
