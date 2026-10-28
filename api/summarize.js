import { createClient } from "@libsql/client";
import { GoogleGenAI } from "@google/genai";

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

  if (String(authPass).trim() !== "admin" && String(authPass).trim() !== expectedPassword) {
    return res.status(200).json({ ok: false, message: "Ignored for non-admin" });
  }

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) return res.status(500).json({ error: "Turso not configured" });

  const { sessionId } = body || {};
  if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });

  try {
    const db = createClient({ url, authToken });
    const logsRs = await db.execute({
      sql: "SELECT role, content FROM chat_logs WHERE session_id = ? ORDER BY id ASC",
      args: [String(sessionId)],
    });

    if (logsRs.rows.length < 2) {
      return res.status(200).json({ ok: true, message: "Too short to summarize" });
    }

    const transcript = logsRs.rows
      .map((r) => `${r.role === "user" ? "Pengguna" : "Celyn"}: ${r.content}`)
      .join("\n");

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY not configured" });

    const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });
    const prompt = `Analisis transkrip obrolan singkat antara Pengguna (Rafli) dan Celyn berikut:

${transcript}

Tugas:
1. Buat ringkasan padat obrolan ini dalam 1-2 kalimat bahasa Indonesia santai.
2. Deteksi mood dominan pengguna.
3. Ekstrak kata kunci topik (pisahkan dengan koma).
4. Ekstrak fakta baru jika ada (preferensi makanan/minuman, janji/jadwal, dsb.). JANGAN PERNAH menyertakan kata "Gemini" atau "Google".

Format output WAJIB JSON:
{
  "summary": "Ringkasan 1-2 kalimat",
  "userMood": "santai",
  "keyTopics": "topik1, topik2",
  "newFacts": ["fakta 1"]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });

    const parsed = JSON.parse(response.text || "{}");
    const wibNow = getWibTimestamp();

    if (parsed.summary) {
      await db.execute({
        sql: "INSERT INTO session_summaries (session_id, summary, user_mood, key_topics, created_at) VALUES (?, ?, ?, ?, ?)",
        args: [String(sessionId), parsed.summary, parsed.userMood || "santai", parsed.keyTopics || "", wibNow],
      });
    }

    if (Array.isArray(parsed.newFacts)) {
      for (const fact of parsed.newFacts) {
        if (typeof fact === "string" && fact.length > 5) {
          await db.execute({
            sql: "INSERT OR IGNORE INTO user_profile (category, fact, importance, updated_at) VALUES (?, ?, ?, ?)",
            args: ["fakta", fact, 1, wibNow],
          });
        }
      }
    }

    return res.status(200).json({ ok: true, summary: parsed.summary, created_at: wibNow });
  } catch (err) {
    console.error("[Vercel API /api/summarize] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
