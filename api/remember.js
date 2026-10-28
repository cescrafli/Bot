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

async function smartUpsertUserProfile(db, fact, category = "fakta", importance = 2, wibNow) {
  const cleanFact = String(fact || "").trim();
  if (!cleanFact || cleanFact.length < 3) return null;

  const validCategory = [
    "preferensi", "jadwal", "identitas", "fakta", "catatan", "topik", "proyek", "rencana"
  ].includes(category) ? category : "catatan";
  const validImportance = Math.min(3, Math.max(1, Number(importance) || 2));

  // 1. Level 1: Filter Sebelum Simpan - Exact Match Check (case-insensitive & trimmed)
  const exactMatch = await db.execute({
    sql: "SELECT id, importance FROM user_profile WHERE LOWER(TRIM(fact)) = LOWER(TRIM(?)) LIMIT 1",
    args: [cleanFact],
  });

  if (exactMatch.rows.length > 0) {
    const existingId = Number(exactMatch.rows[0].id);
    const existingImp = Number(exactMatch.rows[0].importance || 1);
    const finalImp = Math.max(existingImp, validImportance);
    await db.execute({
      sql: "UPDATE user_profile SET importance = ?, updated_at = ? WHERE id = ?",
      args: [finalImp, wibNow, existingId],
    });
    return { action: "updated", id: existingId, fact: cleanFact, category: validCategory };
  }

  // 2. Level 2: Filter Konteks Cerdas (Smart Context Matching)
  const lowerFact = cleanFact.toLowerCase();
  const isCelyn = lowerFact.includes("celyn") || lowerFact.includes("orang terkasih");

  let existingTargetId = null;

  // Domain A: Preferensi Minuman / Kopi
  const isDrink = /minum|kopi|minuman|americano|espresso|latte|teh|jus|boba|air/i.test(cleanFact);
  if (validCategory === "preferensi" && isDrink) {
    const candidate = isCelyn
      ? await db.execute(
          "SELECT id, fact FROM user_profile WHERE category = 'preferensi' AND (fact LIKE '%Celyn%' OR fact LIKE '%orang terkasih%') AND (fact LIKE '%minum%' OR fact LIKE '%kopi%' OR fact LIKE '%minuman%') LIMIT 1"
        )
      : await db.execute(
          "SELECT id, fact FROM user_profile WHERE category = 'preferensi' AND fact NOT LIKE '%Celyn%' AND (fact LIKE '%minum%' OR fact LIKE '%kopi%' OR fact LIKE '%minuman%') LIMIT 1"
        );
    if (candidate.rows.length > 0) {
      existingTargetId = Number(candidate.rows[0].id);
    }
  }

  // Domain B: Preferensi Makanan
  const isFood = /makan|makanan|doyan|sate|ikan|mie|ayam|nasi|sushi|sayur|buah|daging|steak|pizza|rendang|roti|bakso|soto|bebek/i.test(cleanFact);
  if (!existingTargetId && validCategory === "preferensi" && isFood) {
    const candidate = isCelyn
      ? await db.execute(
          "SELECT id, fact FROM user_profile WHERE category = 'preferensi' AND (fact LIKE '%Celyn%' OR fact LIKE '%orang terkasih%') AND (fact LIKE '%makan%' OR fact LIKE '%makanan%') LIMIT 1"
        )
      : await db.execute(
          "SELECT id, fact FROM user_profile WHERE category = 'preferensi' AND fact NOT LIKE '%Celyn%' AND (fact LIKE '%makan%' OR fact LIKE '%makanan%') LIMIT 1"
        );
    if (candidate.rows.length > 0) {
      existingTargetId = Number(candidate.rows[0].id);
    }
  }

  // Domain C: Proyek & Pekerjaan yang Sedang Digarap
  const isProject = validCategory === "proyek" || /mengerjakan|proyek|project|pekerjaan|ngoding|garap/i.test(cleanFact);
  if (!existingTargetId && isProject) {
    const candidate = await db.execute(
      "SELECT id, fact FROM user_profile WHERE category = 'proyek' OR fact LIKE '%mengerjakan%' OR fact LIKE '%proyek%' LIMIT 1"
    );
    if (candidate.rows.length > 0) {
      existingTargetId = Number(candidate.rows[0].id);
    }
  }

  // Domain D: Jadwal & Pengingat Waktu
  const isSchedule = validCategory === "jadwal" || /jadwal|pengingat|agenda/i.test(cleanFact);
  if (!existingTargetId && isSchedule) {
    const timeMatch = cleanFact.match(/(?:jam|pukul)\s*(\d+(?::\d+)?)/i);
    if (timeMatch && timeMatch[1]) {
      const candidate = await db.execute({
        sql: "SELECT id, fact FROM user_profile WHERE (category = 'jadwal' OR fact LIKE '%jadwal%' OR fact LIKE '%pengingat%') AND fact LIKE ? LIMIT 1",
        args: [`%${timeMatch[1]}%`],
      });
      if (candidate.rows.length > 0) {
        existingTargetId = Number(candidate.rows[0].id);
      }
    }
  }

  // Domain E: Pencocokan Kata Kunci Entitas Non-Stopwords
  if (!existingTargetId) {
    const stopwords = new Set([
      "suka", "minum", "makan", "adalah", "kopi", "kesukaan", "favorit", "utamanya",
      "orang", "terkasih", "pengguna", "bernama", "seorang", "celyn", "rafli", "minuman", "makanan",
      "saya", "aku", "gue", "gw", "kamu", "dia", "itu", "ini", "pada", "yang", "juga", "dari", "banget", "paling",
      "sedang", "mengerjakan", "membuat", "bikin", "rencana", "topik", "dibahas", "bersama", "cerita", "pengalaman",
      "catatan", "fakta", "informasi", "kegiatan", "penting"
    ]);
    const words = cleanFact
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !stopwords.has(w));

    for (const kw of words) {
      const candidate = isCelyn
        ? await db.execute({
            sql: "SELECT id, fact FROM user_profile WHERE category = ? AND (fact LIKE '%Celyn%' OR fact LIKE '%orang terkasih%') AND fact LIKE ? LIMIT 1",
            args: [validCategory, `%${kw}%`],
          })
        : await db.execute({
            sql: "SELECT id, fact FROM user_profile WHERE category = ? AND fact NOT LIKE '%Celyn%' AND fact LIKE ? LIMIT 1",
            args: [validCategory, `%${kw}%`],
          });
      if (candidate.rows.length > 0) {
        existingTargetId = Number(candidate.rows[0].id);
        break;
      }
    }
  }

  // Context exists -> UPDATE baris yang ada (jangan buat baris ganda)
  if (existingTargetId) {
    await db.execute({
      sql: "UPDATE user_profile SET fact = ?, importance = ?, updated_at = ? WHERE id = ?",
      args: [cleanFact, validImportance, wibNow, existingTargetId],
    });
    return { action: "updated", id: existingTargetId, fact: cleanFact, category: validCategory };
  }

  // Context baru -> INSERT baris baru
  await db.execute({
    sql: "INSERT OR IGNORE INTO user_profile (category, fact, importance, updated_at) VALUES (?, ?, ?, ?)",
    args: [validCategory, cleanFact, validImportance, wibNow],
  });
  return { action: "inserted", fact: cleanFact, category: validCategory };
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

    const wibNow = getWibTimestamp();
    const db = createClient({ url, authToken });

    const result = await smartUpsertUserProfile(db, cleanFact, category, importance, wibNow);

    return res.status(200).json({
      ok: true,
      action: result.action,
      id: result.id,
      fact: result.fact,
      category: result.category,
      updated_at: wibNow,
    });
  } catch (err) {
    console.error("[Vercel API /api/remember] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
