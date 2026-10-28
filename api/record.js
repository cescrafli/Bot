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

const CLEANUP_FILLERS = /\s+(?:ya|nih|dong|lho|banget|sih|deh|kan|tuh|kok|hehe|haha|tau|tahu|itu|ini)\s*$/i;

function cleanItemText(raw) {
  let item = String(raw || "").trim();
  item = item.replace(/[\.,!\?]+$/, "").trim();
  item = item.replace(CLEANUP_FILLERS, "").trim();
  item = item.replace(/[\.,!\?]+$/, "").trim();
  return item;
}

function extractFactsFromUtterance(text) {
  if (!text || typeof text !== "string") return [];
  const clean = text.trim();
  if (clean.length < 5) return [];

  const results = [];
  const lower = clean.toLowerCase();

  const hasBelovedKeyword =
    lower.includes("orang terkasih") ||
    lower.includes("orang yang kukasihi") ||
    lower.includes("orang yang aku kasihi") ||
    lower.includes("kekasih") ||
    lower.includes("ayang") ||
    lower.includes("pacar");

  const isExplicitlyBelovedPreference =
    /\b(?:celyn|jocelyn|orang terkasih|kekasih|pacar|ayang)\s+(?:yang\s+\w+\s+)?(?:itu\s+)?(?:juga\s+)?(?:suka|doyan|paling suka|gemar|hobi|alergi)\b/i.test(clean) ||
    /\b(?:kesukaan|favorit)\s+(?:celyn|jocelyn|orang terkasih|kekasih)\b/i.test(clean) ||
    (hasBelovedKeyword && /(?:suka|doyan|favorit|kesukaan)/i.test(clean) && !/\b(?:aku|saya|gue|gw)\s+(?:suka|doyan)\b/i.test(clean));

  const isAboutBeloved = isExplicitlyBelovedPreference;

  // Pola A: "kopi / minuman / makanan kesukaan / favorit [subjek] [adalah / itu] [item]"
  const prefNounMatch = clean.match(
    /(?:kopi|minuman|makanan)\s+(?:kesukaan|favorit)(?:ku|nya)?(?:\s+(?:celyn|jocelyn|rafli|dia|kamu|orang terkasih))?\s*(?:adalah\s+|itu\s+)?([a-zA-Z0-9\s]+?)(?:[\.,!\?]|$|\s+dan\s+|\s+karena)/i
  );
  if (prefNounMatch && prefNounMatch[1]) {
    let rawItem = cleanItemText(prefNounMatch[1]);
    rawItem = rawItem.replace(/^(?:celyn|jocelyn|rafli|dia|itu|adalah)\s+/i, "").trim();
    if (rawItem.length >= 3) {
      const isDrink = /kopi|minuman|teh|jus|boba|latte|americano|espresso/i.test(clean) || /kopi|minuman/i.test(prefNounMatch[0]);
      const action = isDrink ? "minum" : "makan";
      const tag = isDrink ? "minuman/kopi kesukaan" : "makanan kesukaan";

      results.push({
        fact: isAboutBeloved
          ? `Celyn (orang terkasih Rafli) suka ${action} ${rawItem} (${tag})`
          : `Rafli suka ${action} ${rawItem} (${tag})`,
        category: "preferensi",
        importance: 3,
      });
      return results;
    }
  }

  // Pola B: "suka / doyan / gemar / paling suka [minum / makan] [item]"
  const prefVerbMatch = clean.match(
    /(?:suka|doyan|paling suka|favorit|gemar|hobi)\s+(?:banget\s+)?(?:minum|makan|ngopi|nyemil)?\s*([a-zA-Z0-9\s]+?)(?:[\.,!\?]|$|\s+dan\s+nanti|\s+karena|\s+tapi)/i
  );
  if (prefVerbMatch && prefVerbMatch[1]) {
    const rawItem = cleanItemText(prefVerbMatch[1]);
    if (rawItem.length >= 3 && !/^(itu|ini|dia|kamu|aku|saya|ngobrol|bicara)$/i.test(rawItem)) {
      const isDrink = /kopi|minuman|teh|jus|boba|latte|americano|espresso|air/i.test(rawItem) || /minum|ngopi/i.test(clean);
      const action = isDrink ? "minum" : "makan";
      const tag = isDrink ? "minuman/kopi kesukaan" : "makanan kesukaan";

      results.push({
        fact: isAboutBeloved
          ? `Celyn (orang terkasih Rafli) suka ${action} ${rawItem} (${tag})`
          : `Rafli suka ${action} ${rawItem} (${tag})`,
        category: "preferensi",
        importance: 3,
      });
      return results;
    }
  }

  // Pola C: Alergi / Pantangan
  const allergyMatch = clean.match(
    /(?:alergi|pantangan|tidak bisa makan|nggak bisa makan)\s+([a-zA-Z0-9\s]+?)(?:[\.,!\?]|$)/i
  );
  if (allergyMatch && allergyMatch[1]) {
    const item = cleanItemText(allergyMatch[1]);
    if (item.length >= 3) {
      const subjek = isAboutBeloved ? "Celyn (orang terkasih Rafli)" : "Rafli";
      results.push({
        fact: `${subjek} alergi ${item} (catatan kesehatan/alergi)`,
        category: "catatan",
        importance: 3,
      });
      return results;
    }
  }

  // Pola D: Jadwal / Pengingat Waktu
  const scheduleMatch = clean.match(
    /(?:ingat(?:kan)?|jadwal(?:kan)?|agenda(?:kan)?|catat|nanti)\s+(?:ya\s+)?(?:ada\s+)?(?:jam\s+(\d+(?::\d+)?(?:\s*(?:pagi|siang|sore|malam))?)|(?:pukul\s+\d+)|(?:besok\s+\w+))\s*(.+)?/i
  );
  if (scheduleMatch) {
    const time = cleanItemText(scheduleMatch[1] || "");
    let activity = cleanItemText(scheduleMatch[2] || "");
    activity = activity.replace(/^(?:ingatkan\s+aku\s+(?:ada\s+)?|ingat\s+ya\s+(?:ada\s+)?|ada\s+)/i, "").trim();
    const desc = activity ? `${activity} jam ${time}` : `kegiatan jam ${time}`;
    results.push({
      fact: `Pengingat kegiatan/jadwal penting: ${desc}`,
      category: "jadwal",
      importance: 3,
    });
    return results;
  }

  return results;
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

  // Zero-leak check: Hanya simpan jika kata sandi adalah admin
  if (String(authPass).trim() !== "admin" && String(authPass).trim() !== expectedPassword) {
    return res.status(200).json({ ok: false, message: "Ignored for non-admin" });
  }

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) return res.status(500).json({ error: "Turso not configured" });

  try {
    const { sessionId, role, content } = body || {};
    if (!sessionId || !role || !content || !String(content).trim()) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const wibNow = getWibTimestamp();
    const db = createClient({ url, authToken });
    await db.execute({
      sql: "INSERT INTO chat_logs (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
      args: [String(sessionId), String(role), String(content).trim(), wibNow],
    });

    // ⚡ Autonomous Memory Ingestion (Zero-Manual Input)
    let autoSavedFacts = [];
    if (role === "user") {
      try {
        const extracted = extractFactsFromUtterance(String(content).trim());
        for (const item of extracted) {
          const isCelyn = item.fact.toLowerCase().includes("celyn");
          const isRafli = item.fact.toLowerCase().includes("rafli");
          const stopwords = new Set([
            "suka", "minum", "makan", "adalah", "kopi", "kesukaan", "favorit", "utamanya",
            "orang", "terkasih", "pengguna", "bernama", "seorang", "celyn", "rafli", "minuman", "makanan"
          ]);
          const words = item.fact
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter((w) => w.length >= 4 && !stopwords.has(w));
          const entityKeyword = words[0] || "";

          let existing;
          if (entityKeyword) {
            if (isCelyn) {
              existing = await db.execute({
                sql: "SELECT id, fact FROM user_profile WHERE category = ? AND fact LIKE '%Celyn%' AND fact LIKE ? LIMIT 1",
                args: [item.category, `%${entityKeyword}%`],
              });
            } else if (isRafli) {
              existing = await db.execute({
                sql: "SELECT id, fact FROM user_profile WHERE category = ? AND fact LIKE '%Rafli%' AND fact LIKE ? LIMIT 1",
                args: [item.category, `%${entityKeyword}%`],
              });
            } else {
              existing = await db.execute({
                sql: "SELECT id, fact FROM user_profile WHERE category = ? AND fact LIKE ? LIMIT 1",
                args: [item.category, `%${entityKeyword}%`],
              });
            }
          }

          if (existing && existing.rows.length > 0) {
            await db.execute({
              sql: "UPDATE user_profile SET fact = ?, importance = ?, updated_at = ? WHERE id = ?",
              args: [item.fact, item.importance, wibNow, existing.rows[0].id],
            });
          } else {
            await db.execute({
              sql: "INSERT OR IGNORE INTO user_profile (category, fact, importance, updated_at) VALUES (?, ?, ?, ?)",
              args: [item.category, item.fact, item.importance, wibNow],
            });
          }
          autoSavedFacts.push(item);
        }
      } catch (autoErr) {
        console.warn("[Vercel API /api/record] Gagal auto-ekstraksi:", autoErr);
      }
    }

    return res.status(200).json({ ok: true, created_at: wibNow, auto_saved: autoSavedFacts });
  } catch (err) {
    console.error("[Vercel API /api/record] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
