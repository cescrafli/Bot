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

function cleanSubjectAndAux(raw) {
  let s = cleanItemText(raw);
  const stripRegex = /^(?:saya|aku|gue|gw|celyn|jocelyn|rafli|dia|kamu|kita|anda|orang terkasih|itu|ini|adalah|yaitu|ialah|yakni|berupa|kalau|bahwa)\s+/i;
  while (stripRegex.test(s)) {
    s = s.replace(stripRegex, "").trim();
  }
  return s;
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
    /\b(?:celyn|jocelyn|orang terkasih|kekasih)\s+(?:kesukaan|favorit)\b/i.test(clean) ||
    (hasBelovedKeyword && /(?:suka|doyan|favorit|kesukaan)/i.test(clean) && !/\b(?:aku|saya|gue|gw)\s+(?:suka|doyan)\b/i.test(clean));

  const isAboutBeloved = isExplicitlyBelovedPreference;

  // Pola Inversi: "[item] adalah / itu makanan / minuman / kopi kesukaan / favorit [subjek]"
  const prefInversMatch = clean.match(
    /(?:(?:tolong\s+)?(?:ingat|catat)(?:\s+ya)?(?:\s+(?:kalau|bahwa))?\s+)?([a-zA-Z0-9\s]+?)\s+(?:adalah|itu|merupakan)\s+(?:kopi|minuman|makanan)\s+(?:kesukaan|favorit)(?:ku|nya)?(?:\s+(?:saya|aku|gue|gw|celyn|jocelyn|rafli|dia|kamu|orang terkasih))?/i
  );
  if (prefInversMatch && prefInversMatch[1]) {
    let rawItem = cleanSubjectAndAux(prefInversMatch[1]);
    rawItem = rawItem.replace(/^(?:ingat|tolong ingat|catat)\s+(?:ya\s+)?(?:kalau\s+|bahwa\s+)?/i, "").trim();
    if (rawItem.length >= 2 && !/^(itu|ini|dia|kamu|aku|saya)$/i.test(rawItem)) {
      const isDrink = /kopi|minuman|teh|jus|boba|latte|americano|espresso|susu|air/i.test(clean) || /kopi|minuman|teh|jus|boba|latte|americano|espresso|susu|air/i.test(rawItem);
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

  // Pola A: "kopi / minuman / makanan kesukaan / favorit [subjek?] [adalah / itu?] [item]"
  const prefNounMatch = clean.match(
    /(?:kopi|minuman|makanan)\s+(?:kesukaan|favorit)(?:ku|nya)?(?:\s+(?:saya|aku|gue|gw|celyn|jocelyn|rafli|dia|kamu|orang terkasih|kita))?\s*(?:adalah|itu|yaitu|ialah|yakni|berupa)?\s*([a-zA-Z0-9\s]+?)(?:[\.,!\?]|$|\s+dan\s+|\s+karena)/i
  );
  if (prefNounMatch && prefNounMatch[1]) {
    let rawItem = cleanSubjectAndAux(prefNounMatch[1]);
    if (rawItem.length >= 2 && !/^(itu|ini|dia|kamu|aku|saya)$/i.test(rawItem)) {
      const isDrink = /kopi|minuman|teh|jus|boba|latte|americano|espresso|susu|air/i.test(clean) || /kopi|minuman/i.test(prefNounMatch[0]) || /kopi|minuman|teh|jus|boba|latte|americano|espresso|susu|air/i.test(rawItem);
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
    const rawItem = cleanSubjectAndAux(prefVerbMatch[1]);
    if (rawItem.length >= 2 && !/^(itu|ini|dia|kamu|aku|saya|ngobrol|bicara)$/i.test(rawItem)) {
      const isDrink = /kopi|minuman|teh|jus|boba|latte|americano|espresso|air|susu/i.test(rawItem) || /minum|ngopi/i.test(clean);
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
    const item = cleanSubjectAndAux(allergyMatch[1]);
    if (item.length >= 2) {
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

  // 3. Pola Proyek & Aktivitas yang Sedang Dikerjakan
  const projectActionMatch = clean.match(
    /(?:(?:lagi|sedang|mau|mencoba)\s+)?(?:ngerjain|mengerjakan|bikin|membuat|garap|menggarap|ngoding|belajar|menyelesaikan)\s+([a-zA-Z0-9\s]+?)(?:[\.,!\?]|$|\s+dan\s+|\s+karena|\s+tapi)/i
  );
  if (projectActionMatch && projectActionMatch[1]) {
    const rawProject = cleanSubjectAndAux(projectActionMatch[1]);
    if (rawProject.length >= 3 && !/^(itu|ini|dia|kamu|aku|saya|ngobrol|bicara|tugas)$/i.test(rawProject)) {
      results.push({
        fact: `Rafli sedang mengerjakan/membuat ${rawProject}`,
        category: "proyek",
        importance: 2,
      });
      return results;
    }
  }

  const projectNounMatch = clean.match(
    /(?:proyek|project|tugas|pekerjaan)(?:ku)?(?:\s+(?:saat ini|sekarang|baru))?\s*(?:adalah|itu)?\s*([a-zA-Z0-9\s]+?)(?:[\.,!\?]|$|\s+dan\s+|\s+karena)/i
  );
  if (projectNounMatch && projectNounMatch[1]) {
    const rawProject = cleanSubjectAndAux(projectNounMatch[1]);
    if (rawProject.length >= 3 && !/^(itu|ini|dia|kamu|aku|saya)$/i.test(rawProject)) {
      results.push({
        fact: `Proyek/pekerjaan Rafli: ${rawProject}`,
        category: "proyek",
        importance: 2,
      });
      return results;
    }
  }

  // 4. Pola Cerita, Kejadian & Pengalaman Pribadi
  const storyMatch = clean.match(
    /(?:tadi(?:\s+(?:pagi|siang|sore|malam))?|kemarin(?:\s+(?:pagi|siang|sore|malam))?|semalam)\s+(?:(?:aku|saya|gue|gw)\s+)?(?:habis|sempat|ketemu|bertemu|beli|membeli|nonton|menonton|ke|pergi ke|mengalami)\s+([a-zA-Z0-9\s]+?)(?:[\.,!\?]|$|\s+dan\s+|\s+karena|\s+tapi)/i
  );
  if (storyMatch && storyMatch[1]) {
    const storyItem = cleanSubjectAndAux(storyMatch[1]);
    if (storyItem.length >= 3 && !/^(itu|ini|dia|kamu|aku|saya)$/i.test(storyItem)) {
      results.push({
        fact: `Cerita/pengalaman Rafli: ${cleanItemText(storyMatch[0])}`,
        category: "catatan",
        importance: 2,
      });
      return results;
    }
  }

  const incidentMatch = clean.match(
    /(?:(?:tadi\s+)?di\s+(?:kantor|kerjaan|kampus|sekolah|rumah|jalan)\s+(?:ada\s+)?|(?:motor|mobil|laptop|komputer|hp)(?:ku)?\s+(?:tadi\s+)?(?:sempat\s+)?(?:rusak|mogok|error|bermasalah|bocor)\s*)([a-zA-Z0-9\s]+?)(?:[\.,!\?]|$|\s+dan\s+|\s+karena)/i
  );
  if (incidentMatch) {
    const incidentText = cleanItemText(incidentMatch[0]);
    if (incidentText.length >= 6) {
      results.push({
        fact: `Cerita/kejadian harian Rafli: ${incidentText}`,
        category: "catatan",
        importance: 2,
      });
      return results;
    }
  }

  // 5. Pola Rencana & Keinginan
  const planMatch = clean.match(
    /(?:(?:nanti|besok|lusa|kemarin|tadi)(?:\s+(?:pagi|siang|sore|malam))?|minggu depan|bulan depan)\s+(?:(?:aku|saya|gue|gw)\s+)?(?:mau|pengen|ada rencana|akan|bakal)\s+([a-zA-Z0-9\s]+?)(?:[\.,!\?]|$|\s+dan\s+|\s+karena)/i
  );
  if (planMatch && planMatch[1]) {
    const rawPlan = cleanSubjectAndAux(planMatch[1]);
    if (rawPlan.length >= 3 && !/^(itu|ini|dia|kamu|aku|saya)$/i.test(rawPlan)) {
      results.push({
        fact: `Rencana Rafli: ${rawPlan}`,
        category: "rencana",
        importance: 2,
      });
      return results;
    }
  }

  // 6. Pola Topik Pembahasan yang Sedang Didiskusikan
  const topicMatch = clean.match(
    /(?:(?:kita\s+)?(?:lagi\s+)?(?:bahas|ngomongin|bicarain|diskusiin)\s+(?:tentang\s+|soal\s+)?|(?:aku\s+)?(?:mau|pengen)\s+bahas\s+(?:tentang\s+|soal\s+)?)([a-zA-Z0-9\s]+?)(?:[\.,!\?]|$|\s+dan\s+|\s+karena)/i
  );
  if (topicMatch && topicMatch[1]) {
    const rawTopic = cleanSubjectAndAux(topicMatch[1]);
    if (rawTopic.length >= 3 && !/^(itu|ini|dia|kamu|aku|saya|apa)$/i.test(rawTopic)) {
      results.push({
        fact: `Topik yang dibahas bersama Rafli: ${rawTopic}`,
        category: "topik",
        importance: 2,
      });
      return results;
    }
  }

  // 7. Pola Entitas & Kepemilikan Personal (Hewan Peliharaan, Kendaraan, Gadget)
  const entityMatch = clean.match(
    /(?:kucing|anjing|peliharaan|motor|mobil|laptop|komputer|hp|ponsel)(?:ku)?\s+(?:namanya|merknya|tipe|warnanya)\s+([a-zA-Z0-9\s]+?)(?:[\.,!\?]|$)/i
  );
  if (entityMatch && entityMatch[1]) {
    const rawEntity = cleanItemText(entityMatch[0]);
    if (rawEntity.length >= 4) {
      results.push({
        fact: `Informasi personal Rafli: ${rawEntity}`,
        category: "catatan",
        importance: 2,
      });
      return results;
    }
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
            "orang", "terkasih", "pengguna", "bernama", "seorang", "celyn", "rafli", "minuman", "makanan",
            "saya", "aku", "gue", "gw", "kamu", "dia", "itu", "ini", "pada", "yang", "juga", "dari", "banget", "paling",
            "sedang", "mengerjakan", "membuat", "bikin", "rencana", "topik", "dibahas", "bersama", "cerita", "pengalaman"
          ]);
          const words = item.fact
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter((w) => w.length >= 3 && !stopwords.has(w));
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
