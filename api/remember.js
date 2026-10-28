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

const CLEANUP_FILLERS = /\s+(?:ya|nih|dong|lho|banget|sih|deh|kan|tuh|kok|hehe|haha|wkwk|tau|tahu|itu|ini)\s*$/i;

const PREAMBLE_PATTERNS = [
  /^(?:eh\s+celyn|celyn|halo\s+celyn|hai\s+celyn)\s*,?\s*/i,
  /^(?:kemarin|tadi|dulu|waktu\s+itu)\s+(?:aku|saya|gue|gw)?\s*(?:sempat|lagi|pas)?\s*(?:jalan-jalan|nongkrong|makan\s+siang|santai|ngobrol|mikir-mikir|kepikiran)?(?:\s+bareng\s+teman|\s+bareng\s+temen)?\s*,?\s*/i,
  /^(?:aku\s+(?:tadi|sempat|tuh|lagi)\s+(?:kepikiran|ngerasa|mikir|pengen\s+bilang))\s*,?\s*/i,
  /^(?:kayaknya\s+sih|kayaknya|menurutku\s+sih|menurutku|sebenarnya|jujur\s+aja|terus\s+aku\s+ngerasa)\s*,?\s*/i,
  /^(?:aku\s+cuma\s+mau\s+bilang\s+kalau|mau\s+ngasih\s+tau\s+kalau|cuma\s+mau\s+cerita\s+kalau|aku\s+mau\s+cerita\s+kalau)\s*,?\s*/i,
  /^(?:tolong\s+)?(?:ingat(?:kan|in|en)?|catat|simpan|rekam|ingetin)(?:\s+(?:ya|nih|dong|deh))?(?:\s+(?:ke\s+(?:memori|database|ingatan)))?(?:\s+(?:aku|saya|gue|gw))?(?:\s+(?:kalau|bahwa|ada|soal|tentang))?\s*/i,
];

function cleanItemText(raw) {
  let item = String(raw || "").trim();
  item = item.replace(/[\.,!\?]+$/, "").trim();
  item = item.replace(CLEANUP_FILLERS, "").trim();
  item = item.replace(/[\.,!\?]+$/, "").trim();
  return item;
}

function cleanSubjectAndAux(raw) {
  let s = cleanItemText(raw);
  const stripRegex = /^(?:bukan|nggak|bukanlah|saya|aku|gue|gw|celyn|jocelyn|rafli|dia|kamu|kita|anda|orang terkasih|itu|ini|adalah|yaitu|ialah|yakni|berupa|kalau|bahwa|lebih|paling|lagi)\s+/i;
  while (stripRegex.test(s)) {
    s = s.replace(stripRegex, "").trim();
  }
  return s;
}

function isTechnicalOrGenericQuestion(text) {
  if (!text || typeof text !== "string") return false;
  const clean = text.trim();

  // 1. Jika ada direktif eksplisit (tolong ingat/catat), JANGAN abaikan!
  if (
    /(?:tolong|bisa|coba|tolong\s+bisa)\s+(?:ingat|catat|simpan|rekam|ingetin)/i.test(clean) ||
    /^(?:ingat(?:kan|in|en)?|catat|simpan|rekam|ingetin)(?:\s+(?:ya|nih|dong|deh))?\s+(?:aku|saya|kalau|bahwa|soal|tentang)/i.test(clean)
  ) {
    return false;
  }

  // 2. Jika pernyataan PR / tugas personal, JANGAN abaikan!
  if (
    /\b(?:ada\s+PR|punya\s+PR|ada\s+tugas|punya\s+tugas|ngerjain\s+PR|ngerjain\s+tugas|soal\s+ujianku|tugas\s+kuliah|tugas\s+sekolah|tugas\s+kantor)\b/i.test(clean)
  ) {
    return false;
  }

  // 3. Hitungan matematika murni (5x5, 10 + 20, hitung 100/5)
  if (
    /\b\d+\s*[\+\-\*\/xX÷]\s*\d+\b/i.test(clean) ||
    /\b(?:berapa\s+(?:hasil|jumlah|total|nilai)|hitunglah|coba\s+hitung)\b/i.test(clean)
  ) {
    return true;
  }

  // 4. Jawaban angka tunggal ("25")
  if (/^\s*\d+(?:[.,]\d+)?\s*$/.test(clean)) {
    return true;
  }

  // 5. Pertanyaan definisi/pengetahuan umum
  if (
    /^(?:apa\s+(?:itu|arti|pengertian|definisi|singkatan|maksud)|apakah\s+yang\s+dimaksud|bagaimana\s+(?:cara\s+kerja|proses|konsep)|jelaskan|terangkan|kenapa|mengapa|siapa\s+(?:penemu|pencipta|pembuat)|sebutkan)\b/i.test(clean)
  ) {
    return true;
  }

  return false;
}

function summarizeFactEssence(rawText, defaultCategory = "catatan") {
  if (!rawText || typeof rawText !== "string") return "";
  let clean = rawText.trim();

  // 1. Format kanonikal baku
  if (
    /^(?:Rafli\s+suka\s+|Celyn\s+\(orang\s+terkasih\s+Rafli\)\s+suka\s+|Tugas\/PR\s+penting\s+Rafli:\s+|Pengingat\s+kegiatan\/jadwal\s+penting:\s+|Rafli\s+sedang\s+mengerjakan|Rencana\s+Rafli:\s+|Catatan\s+penting\s+)/i.test(clean)
  ) {
    return cleanItemText(clean);
  }

  // 2. Bersihkan preambel
  let prev = "";
  while (prev !== clean) {
    prev = clean;
    for (const pat of PREAMBLE_PATTERNS) {
      clean = clean.replace(pat, "").trim();
    }
  }

  // 3. Deteksi Subjek
  const lower = clean.toLowerCase();
  const isCelyn =
    lower.includes("celyn") ||
    lower.includes("jocelyn") ||
    lower.includes("orang terkasih") ||
    lower.includes("kekasih") ||
    lower.includes("ayang") ||
    lower.includes("pacar");
  const subjek = isCelyn ? "Celyn (orang terkasih Rafli)" : "Rafli";

  // 4. Deteksi Makanan / Minuman
  const isDrink =
    /kopi|minuman|teh|jus|boba|latte|americano|espresso|susu|air|minum|ngopi/i.test(clean);
  const isFood =
    /makan|makanan|doyan|ikan|mie|ayam|nasi|sushi|sate|steak|pizza|sayur|buah|daging|rendang|bakso|soto|bebek/i.test(clean) ||
    /(?:suka|sukanya|doyan|favorit|kesukaan)/i.test(clean);

  if (isDrink || isFood) {
    const action = isDrink ? "minum" : "makan";
    const tag = isDrink ? "minuman/kopi kesukaan" : "makanan kesukaan";
    let item = cleanSubjectAndAux(clean);
    const verbStrip = /^(?:suka|sukanya|doyan|makan|minum)\s+/i;
    while (verbStrip.test(item)) {
      item = item.replace(verbStrip, "").trim();
    }
    item = item.replace(/(?:makanan|minuman|kopi)?\s*(?:kesukaan|favorit)(?:ku|nya)?/i, "").trim();
    item = cleanSubjectAndAux(item);
    if (item.length >= 2) {
      return `${subjek} suka ${action} ${item} (${tag})`;
    }
  }

  // 5. Deteksi PR / Tugas Pengguna
  if (/\b(?:PR|tugas|soal\s+ujian)\b/i.test(clean)) {
    let task = cleanSubjectAndAux(clean);
    task = task.replace(/^(?:ada|punya|ngerjain|mengerjakan)\s+/i, "").trim();
    if (task.length >= 2) {
      return `Tugas/PR penting Rafli: ${task}`;
    }
  }

  // 6. Deteksi Jadwal
  const timeMatch = clean.match(
    /(?:jam\s+\d+(?::\d+)?(?:\s*(?:pagi|siang|sore|malam))?)|(?:pukul\s+\d+)|(?:besok\s+\w+)/i
  );
  if (timeMatch && (defaultCategory === "jadwal" || /jadwal|meeting|pertemuan|agenda/i.test(clean))) {
    let activity = cleanSubjectAndAux(clean);
    activity = activity.replace(/^(?:jadwal|agenda|ada|pengingat)\s+/i, "").trim();
    return `Pengingat kegiatan/jadwal penting: ${activity}`;
  }

  // 7. Deteksi Proyek
  if (
    /ngerjain|mengerjakan|bikin|membuat|ngoding|proyek|project/i.test(clean) ||
    defaultCategory === "proyek"
  ) {
    let proj = cleanSubjectAndAux(clean);
    proj = proj.replace(/^(?:lagi|sedang)?\s*(?:ngerjain|mengerjakan|bikin|membuat|garap|ngoding)\s+/i, "").trim();
    return `Rafli sedang mengerjakan/membuat ${proj}`;
  }

  // 8. Default: Catatan penting intisari
  const cleanedItem = cleanSubjectAndAux(clean);
  return `Catatan penting ${subjek}: ${cleanedItem}`;
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
    const sanitized = sanitizeText(fact).trim();

    if (!sanitized || sanitized.length < 3) {
      return res.status(400).json({ error: "Fact text is required (minimum 3 characters)" });
    }

    // Filter Anti-Soal Teknis & Hitungan Biasa
    if (isTechnicalOrGenericQuestion(sanitized)) {
      return res.status(200).json({
        ok: true,
        action: "ignored",
        message: "Ignored technical question / generic calculation from memory storage",
      });
    }

    // Rangkum Intisari Fakta Sebelum Simpan
    const distilledFact = summarizeFactEssence(sanitized, category);

    const wibNow = getWibTimestamp();
    const db = createClient({ url, authToken });

    const result = await smartUpsertUserProfile(db, distilledFact, category, importance, wibNow);

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
