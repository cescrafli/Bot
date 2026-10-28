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

const CLEANUP_FILLERS = /\s+(?:ya|nih|dong|lho|banget|sih|deh|kan|tuh|kok|hehe|haha|wkwk|tau|tahu|itu|ini)\s*$/i;

const INVALID_ITEM_RE =
  /^(?:apa|apakah|apaan|apa\s+ya|siapa|mana|gimana|bagaimana|berapa|kenapa|mengapa|kapan|sesuatu|hal|makanan|minuman|kopi|makanan\s+apa|minuman\s+apa|kopi\s+apa|apa\s+saja|apapun|itu|ini|dia|kamu|aku|saya|bukan|ku|nya)$/i;

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

function isInterrogativeOrRecallQuestion(text) {
  if (!text || typeof text !== "string") return false;
  const clean = text.trim();

  // Jika ada direktif eksplisit simpan (tolong ingat/catat), bukan sekadar pertanyaan
  if (
    /(?:tolong|bisa|coba|tolong\s+bisa)\s+(?:kamu\s+)?(?:ingat|catat|simpan|rekam|ingetin)/i.test(clean) &&
    !/(?:ingat\s+(?:nggak|gak|enggak)|tahu\s+(?:nggak|gak|enggak)|coba\s+tebak)/i.test(clean)
  ) {
    return false;
  }

  // Pola pertanyaan recall / tebak-tebakan seputar preferensi / identitas
  if (
    /\b(?:tebak|coba\s+tebak|kamu\s+(?:tahu|tau)|(?:tahu|tau|ingat|inget)\s+(?:nggak|gak|enggak)|tahu\s+enggak|tau\s+enggak|ingat\s+enggak|inget\s+enggak)\b/i.test(clean)
  ) {
    return true;
  }

  // Pola kalimat tanya preferensi (misal: "saya suka makanan apa?", "minuman kesukaan saya apa?", "makanan apa yang saya suka?")
  if (
    /\b(?:apa\s+(?:makanan|minuman|kopi|hobi|jadwal|kegiatan)|(?:makanan|minuman|kopi|hobi|jadwal)\s+(?:kesukaan|favorit)(?:ku|nya)?\s+apa|(?:makanan|minuman|kopi)\s+apa|suka\s+(?:makanan|minuman)?\s*apa)\b/i.test(clean)
  ) {
    return true;
  }

  // Jika diakhiri tanda tanya dan mengandung kata tanya
  if (
    /\?\s*$/.test(clean) &&
    /\b(?:apa|apakah|siapa|mana|gimana|bagaimana|berapa|kenapa|mengapa|kapan)\b/i.test(clean)
  ) {
    return true;
  }

  return false;
}

function detectFactSubject(fact) {
  if (!fact || typeof fact !== "string") return "rafli";
  const clean = fact.trim().toLowerCase();
  if (/^(?:celyn\b|kesukaan\s+celyn|minuman\s+celyn|makanan\s+celyn|kopi\s+celyn)/i.test(clean)) {
    return "celyn";
  }
  if (/^(?:rafli\b|tugas\/pr\s+penting\s+rafli|rencana\s+rafli|catatan\s+penting\s+rafli|proyek\s+rafli|proyek\/pekerjaan\s+rafli|informasi\s+personal\s+rafli|cerita\/pengalaman\s+rafli|cerita\/kejadian\s+harian\s+rafli|pengguna\b)/i.test(clean)) {
    return "rafli";
  }
  if ((clean.includes("celyn") || clean.includes("orang terkasih")) && !clean.includes("rafli")) {
    return "celyn";
  }
  return "rafli";
}

function isTechnicalOrGenericQuestion(text) {
  if (!text || typeof text !== "string") return false;
  const clean = text.trim();

  if (
    /(?:tolong|bisa|coba|tolong\s+bisa)\s+(?:ingat|catat|simpan|rekam|ingetin)/i.test(clean) ||
    /^(?:ingat(?:kan|in|en)?|catat|simpan|rekam|ingetin)(?:\s+(?:ya|nih|dong|deh))?\s+(?:aku|saya|kalau|bahwa|soal|tentang)/i.test(clean)
  ) {
    return false;
  }

  if (
    /\b(?:ada\s+PR|punya\s+PR|ada\s+tugas|punya\s+tugas|ngerjain\s+PR|ngerjain\s+tugas|soal\s+ujianku|tugas\s+kuliah|tugas\s+sekolah|tugas\s+kantor)\b/i.test(clean)
  ) {
    return false;
  }

  if (
    /\b\d+\s*[\+\-\*\/xX÷]\s*\d+\b/i.test(clean) ||
    /\b(?:berapa\s+(?:hasil|jumlah|total|nilai)|hitunglah|coba\s+hitung)\b/i.test(clean)
  ) {
    return true;
  }

  if (/^\s*\d+(?:[.,]\d+)?\s*$/.test(clean)) {
    return true;
  }

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

  if (
    /^(?:Rafli\s+suka\s+|Celyn\s+\(orang\s+terkasih\s+Rafli\)\s+suka\s+|Tugas\/PR\s+penting\s+Rafli:\s+|Pengingat\s+kegiatan\/jadwal\s+penting:\s+|Rafli\s+sedang\s+mengerjakan|Rencana\s+Rafli:\s+|Catatan\s+penting\s+)/i.test(clean)
  ) {
    return cleanItemText(clean);
  }

  let prev = "";
  while (prev !== clean) {
    prev = clean;
    for (const pat of PREAMBLE_PATTERNS) {
      clean = clean.replace(pat, "").trim();
    }
  }

  const lower = clean.toLowerCase();
  const isCelyn =
    lower.includes("celyn") ||
    lower.includes("jocelyn") ||
    lower.includes("orang terkasih") ||
    lower.includes("kekasih") ||
    lower.includes("ayang") ||
    lower.includes("pacar");
  const subjek = isCelyn ? "Celyn (orang terkasih Rafli)" : "Rafli";

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
    if (item.length >= 2 && !INVALID_ITEM_RE.test(item)) {
      return `${subjek} suka ${action} ${item} (${tag})`;
    }
  }

  if (/\b(?:PR|tugas|soal\s+ujian)\b/i.test(clean)) {
    let task = cleanSubjectAndAux(clean);
    task = task.replace(/^(?:ada|punya|ngerjain|mengerjakan)\s+/i, "").trim();
    if (task.length >= 2 && !INVALID_ITEM_RE.test(task)) {
      return `Tugas/PR penting Rafli: ${task}`;
    }
  }

  const timeMatch = clean.match(
    /(?:jam\s+\d+(?::\d+)?(?:\s*(?:pagi|siang|sore|malam))?)|(?:pukul\s+\d+)|(?:besok\s+\w+)/i
  );
  if (timeMatch && (defaultCategory === "jadwal" || /jadwal|meeting|pertemuan|agenda/i.test(clean))) {
    let activity = cleanSubjectAndAux(clean);
    activity = activity.replace(/^(?:jadwal|agenda|ada|pengingat)\s+/i, "").trim();
    return `Pengingat kegiatan/jadwal penting: ${activity}`;
  }

  if (
    /ngerjain|mengerjakan|bikin|membuat|ngoding|proyek|project/i.test(clean) ||
    defaultCategory === "proyek"
  ) {
    let proj = cleanSubjectAndAux(clean);
    proj = proj.replace(/^(?:lagi|sedang)?\s*(?:ngerjain|mengerjakan|bikin|membuat|garap|ngoding)\s+/i, "").trim();
    if (proj.length >= 2 && !INVALID_ITEM_RE.test(proj)) {
      return `Rafli sedang mengerjakan/membuat ${proj}`;
    }
  }

  const cleanedItem = cleanSubjectAndAux(clean);
  if (INVALID_ITEM_RE.test(cleanedItem)) return "";
  return `Catatan penting ${subjek}: ${cleanedItem}`;
}

async function smartUpsertUserProfile(db, fact, category = "fakta", importance = 2, wibNow) {
  const cleanFact = String(fact || "").trim();
  if (!cleanFact || cleanFact.length < 3) return null;

  // Anti-corruption guardrail: refuse to store questions, recall tests, or garbage items
  if (
    isInterrogativeOrRecallQuestion(cleanFact) ||
    /\b(?:makan\s+apa|minum\s+apa|suka\s+apa|apa\s+ya)\b/i.test(cleanFact) ||
    /\?\s*$/.test(cleanFact)
  ) {
    return null;
  }

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
  const subject = detectFactSubject(cleanFact);
  const isCelyn = subject === "celyn";

  let existingTargetId = null;

  // Domain A: Preferensi Minuman / Kopi
  const isDrink = /minum|kopi|minuman|americano|espresso|latte|teh|jus|boba|air|ngopi/i.test(cleanFact);
  if (isDrink && (validCategory === "preferensi" || /suka\s+minum|minuman|kopi/i.test(cleanFact))) {
    const candidate = isCelyn
      ? await db.execute(
          "SELECT id, fact FROM user_profile WHERE (category = 'preferensi' OR fact LIKE '%minum%' OR fact LIKE '%kopi%') AND fact LIKE 'Celyn%' AND (fact LIKE '%minum%' OR fact LIKE '%kopi%' OR fact LIKE '%minuman%') LIMIT 1"
        )
      : await db.execute(
          "SELECT id, fact FROM user_profile WHERE (category = 'preferensi' OR fact LIKE '%minum%' OR fact LIKE '%kopi%') AND fact NOT LIKE 'Celyn%' AND (fact LIKE '%minum%' OR fact LIKE '%kopi%' OR fact LIKE '%minuman%') LIMIT 1"
        );
    if (candidate.rows.length > 0) {
      existingTargetId = Number(candidate.rows[0].id);
    }
  }

  // Domain B: Preferensi Makanan (Non-Reason)
  const isFood = /makan|makanan|doyan|sate|ikan|mie|ayam|nasi|sushi|sayur|buah|daging|steak|pizza|rendang|roti|bakso|soto|bebek/i.test(cleanFact);
  const isReason = /alasan\s+kesukaan|karena\s+kenangan|karena\s+nenek|alasan\s+suka/i.test(cleanFact);
  if (!existingTargetId && isFood && !isReason && (validCategory === "preferensi" || /suka\s+makan|makanan/i.test(cleanFact))) {
    const candidate = isCelyn
      ? await db.execute(
          "SELECT id, fact FROM user_profile WHERE (category = 'preferensi' OR fact LIKE '%makan%') AND fact LIKE 'Celyn%' AND (fact LIKE '%makan%' OR fact LIKE '%makanan%') AND fact NOT LIKE '%alasan kesukaan%' LIMIT 1"
        )
      : await db.execute(
          "SELECT id, fact FROM user_profile WHERE (category = 'preferensi' OR fact LIKE '%makan%') AND fact NOT LIKE 'Celyn%' AND (fact LIKE '%makan%' OR fact LIKE '%makanan%') AND fact NOT LIKE '%alasan kesukaan%' LIMIT 1"
        );
    if (candidate.rows.length > 0) {
      existingTargetId = Number(candidate.rows[0].id);
    }
  }

  // Domain B2: Alasan Preferensi Sentimental
  if (!existingTargetId && isReason && (validCategory === "preferensi" || /alasan/i.test(cleanFact))) {
    const candidate = isCelyn
      ? await db.execute(
          "SELECT id, fact FROM user_profile WHERE (category = 'preferensi' OR fact LIKE '%alasan%') AND fact LIKE 'Celyn%' AND fact LIKE '%alasan kesukaan%' LIMIT 1"
        )
      : await db.execute(
          "SELECT id, fact FROM user_profile WHERE (category = 'preferensi' OR fact LIKE '%alasan%') AND fact NOT LIKE 'Celyn%' AND fact LIKE '%alasan kesukaan%' LIMIT 1"
        );
    if (candidate.rows.length > 0) {
      existingTargetId = Number(candidate.rows[0].id);
    }
  }

  // Domain C: Proyek & Pekerjaan yang Sedang Digarap
  const isProject = validCategory === "proyek" || /mengerjakan|proyek|project|pekerjaan|ngoding|garap/i.test(cleanFact);
  if (!existingTargetId && isProject) {
    const candidate = await db.execute(
      "SELECT id, fact FROM user_profile WHERE category = 'proyek' OR fact LIKE '%mengerjakan%' OR fact LIKE '%proyek%' OR fact LIKE '%pekerjaan%' LIMIT 1"
    );
    if (candidate.rows.length > 0) {
      existingTargetId = Number(candidate.rows[0].id);
    }
  }

  // Domain D: Catatan Tugas / PR Pengguna
  const isHomework = /\b(?:PR|tugas|soal\s+ujian)\b/i.test(cleanFact) || /Tugas\/PR\s+penting/i.test(cleanFact);
  if (!existingTargetId && isHomework) {
    const candidate = await db.execute(
      "SELECT id, fact FROM user_profile WHERE fact LIKE '%Tugas/PR%' OR fact LIKE '%ada PR%' OR fact LIKE '%tugas penting%' LIMIT 1"
    );
    if (candidate.rows.length > 0) {
      existingTargetId = Number(candidate.rows[0].id);
    }
  }

  // Domain E: Catatan Kesehatan & Alergi
  const isAllergy = /alergi|pantangan|tidak bisa makan|nggak bisa makan/i.test(cleanFact);
  if (!existingTargetId && isAllergy) {
    const candidate = isCelyn
      ? await db.execute(
          "SELECT id, fact FROM user_profile WHERE fact LIKE 'Celyn%' AND (fact LIKE '%alergi%' OR fact LIKE '%pantangan%') LIMIT 1"
        )
      : await db.execute(
          "SELECT id, fact FROM user_profile WHERE fact NOT LIKE 'Celyn%' AND (fact LIKE '%alergi%' OR fact LIKE '%pantangan%') LIMIT 1"
        );
    if (candidate.rows.length > 0) {
      existingTargetId = Number(candidate.rows[0].id);
    }
  }

  // Domain F: Jadwal & Pengingat Waktu
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
    if (!existingTargetId) {
      const candidate = await db.execute(
        "SELECT id, fact FROM user_profile WHERE category = 'jadwal' OR fact LIKE '%Pengingat kegiatan%' LIMIT 1"
      );
      if (candidate.rows.length > 0) {
        existingTargetId = Number(candidate.rows[0].id);
      }
    }
  }

  // Domain G: Topik Pembahasan
  const isTopic = validCategory === "topik" || /topik\s+yang\s+dibahas/i.test(cleanFact);
  if (!existingTargetId && isTopic) {
    const candidate = await db.execute(
      "SELECT id, fact FROM user_profile WHERE category = 'topik' OR fact LIKE '%Topik yang dibahas%' LIMIT 1"
    );
    if (candidate.rows.length > 0) {
      existingTargetId = Number(candidate.rows[0].id);
    }
  }

  // Domain H: Pencocokan Kata Kunci Entitas Non-Stopwords
  if (!existingTargetId) {
    const stopwords = new Set([
      "suka", "minum", "makan", "adalah", "kopi", "kesukaan", "favorit", "utamanya",
      "orang", "terkasih", "pengguna", "bernama", "seorang", "celyn", "rafli", "minuman", "makanan",
      "saya", "aku", "gue", "gw", "kamu", "dia", "itu", "ini", "pada", "yang", "juga", "dari", "banget", "paling",
      "sedang", "mengerjakan", "membuat", "bikin", "rencana", "topik", "dibahas", "bersama", "cerita", "pengalaman",
      "catatan", "fakta", "informasi", "kegiatan", "penting", "karena", "untuk", "dengan", "dan"
    ]);
    const words = cleanFact
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !stopwords.has(w));

    for (const kw of words) {
      const candidate = isCelyn
        ? await db.execute({
            sql: "SELECT id, fact FROM user_profile WHERE fact LIKE 'Celyn%' AND fact LIKE ? LIMIT 1",
            args: [`%${kw}%`],
          })
        : await db.execute({
            sql: "SELECT id, fact FROM user_profile WHERE fact NOT LIKE 'Celyn%' AND fact LIKE ? LIMIT 1",
            args: [`%${kw}%`],
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
1. Buat ringkasan padat obrolan ini dalam 1-2 kalimat bahasa Indonesia santai (fokus pada topik personal yang dibahas).
2. Deteksi mood dominan pengguna (misal: "santai", "semangat", "lelah", "senang", "fokus").
3. Ekstrak kata kunci topik (pisahkan dengan koma).
4. Ekstrak fakta baru tentang DIRI PENGGUNA (personalities/preferensi makanan & minuman, cerita pribadi, tugas/PR yang harus dikerjakan, jadwal/janji).
   PENTING: JANGAN PERNAH mengekstrak soal teknikal, hitungan matematika (seperti 5x5, 25), pertanyaan koding umum, atau definisi materi sebagai fakta, KECUALI jika pengguna meminta eksplisit untuk diingat.
   Fakta WAJIB dirangkum menjadi intisari kalimat padat: [Subjek] [predikat] [objek].
   JANGAN PERNAH menyertakan kata "Gemini" atau "Google".

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
        if (typeof fact === "string" && fact.length > 3) {
          if (isTechnicalOrGenericQuestion(fact) || isInterrogativeOrRecallQuestion(fact)) continue;
          const isDrinkOrFood = /minum|kopi|minuman|makan|makanan|doyan/i.test(fact);
          const defaultCat = isDrinkOrFood ? "preferensi" : "catatan";
          const distilled = summarizeFactEssence(fact, defaultCat);
          if (distilled && distilled.length > 5) {
            await smartUpsertUserProfile(db, distilled, defaultCat, 2, wibNow);
          }
        }
      }
    }

    return res.status(200).json({ ok: true, summary: parsed.summary, created_at: wibNow });
  } catch (err) {
    console.error("[Vercel API /api/summarize] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
