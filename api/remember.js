import { createClient } from "@libsql/client";

function getWibTimestamp() {
  try {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date()).replace("T", " ");
  } catch {
    const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
    return wib.toISOString().slice(0, 19).replace("T", " ");
  }
}

function sanitizeText(text) {
  return String(text || "")
    .replace(/\bgemini\b/gi, "sistem")
    .replace(/\bgoogle\b/gi, "tim pengembang")
    .replace(/\blarge language model\b/gi, "kecerdasan AI")
    .replace(/\bllm\b/gi, "AI");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-password");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const expectedPassword = process.env.ADMIN_PASSWORD || "admin";
  const authPass =
    req.headers["x-admin-password"] ||
    req.query?.password ||
    (body && body.password);

  // Zero-leak security: Hanya admin yang boleh menyimpan memori permanen
  if (String(authPass).trim() !== "admin" && String(authPass).trim() !== expectedPassword) {
    return res.status(200).json({ ok: false, message: "Ignored for non-admin" });
  }

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) return res.status(500).json({ error: "Turso not configured" });

  try {
    const { fact, category = "fakta", importance = 2 } = body || {};
    const cleanFact = sanitizeText(fact).trim();

    if (!cleanFact || cleanFact.length < 3) {
      return res.status(400).json({ error: "Fact text is required (minimum 3 characters)" });
    }

    const validCategory = ["preferensi", "jadwal", "identitas", "fakta", "catatan"].includes(category)
      ? category
      : "fakta";
    const validImportance = Math.min(3, Math.max(1, Number(importance) || 2));
    const wibNow = getWibTimestamp();

    const db = createClient({ url, authToken });

    // Cek apakah sudah ada fakta serupa di kategori yang sama
    const existing = await db.execute({
      sql: "SELECT id, fact FROM user_profile WHERE category = ? AND fact LIKE ? LIMIT 1",
      args: [validCategory, `%${cleanFact.slice(0, 30)}%`],
    });

    if (existing.rows.length > 0) {
      const id = existing.rows[0].id;
      await db.execute({
        sql: "UPDATE user_profile SET fact = ?, importance = ?, updated_at = ? WHERE id = ?",
        args: [cleanFact, validImportance, wibNow, id],
      });
      return res.status(200).json({ ok: true, action: "updated", id, fact: cleanFact, category: validCategory, updated_at: wibNow });
    }

    await db.execute({
      sql: "INSERT OR IGNORE INTO user_profile (category, fact, importance, updated_at) VALUES (?, ?, ?, ?)",
      args: [validCategory, cleanFact, validImportance, wibNow],
    });

    return res.status(200).json({ ok: true, action: "inserted", fact: cleanFact, category: validCategory, updated_at: wibNow });
  } catch (err) {
    console.error("[Vercel API /api/remember] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
