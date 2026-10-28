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
    if (item.length >= 2 && !INVALID_ITEM_RE.test(item)) {
      return `${subjek} suka ${action} ${item} (${tag})`;
    }
  }

  // 5. Deteksi PR / Tugas Pengguna
  if (/\b(?:PR|tugas|soal\s+ujian)\b/i.test(clean)) {
    let task = cleanSubjectAndAux(clean);
    task = task.replace(/^(?:ada|punya|ngerjain|mengerjakan)\s+/i, "").trim();
    if (task.length >= 2 && !INVALID_ITEM_RE.test(task)) {
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
    if (proj.length >= 2 && !INVALID_ITEM_RE.test(proj)) {
      return `Rafli sedang mengerjakan/membuat ${proj}`;
    }
  }

  // 8. Default: Catatan penting intisari
  const cleanedItem = cleanSubjectAndAux(clean);
  if (INVALID_ITEM_RE.test(cleanedItem)) return "";
  return `Catatan penting ${subjek}: ${cleanedItem}`;
}

function extractFactsFromUtterance(text) {
  if (!text || typeof text !== "string") return [];
  const clean = text.trim();
  if (clean.length < 5) return [];

  // Filter 0.1: Jika pertanyaan teknikal / hitungan matematika biasa, JANGAN simpan!
  if (isTechnicalOrGenericQuestion(clean)) {
    return [];
  }

  // Filter 0.2: Jika ujaran adalah kalimat tanya / uji recall (misal: "makanan kesukaan saya apa?"), MUTLAK TOLAK!
  if (isInterrogativeOrRecallQuestion(clean)) {
    return [];
  }

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

  // 0. Pola Universal Explicit Directive: "tolong ingatin / ingatkan / catat / simpan / rekam / ingetin [aku/saya] [kalau/bahwa/ada] [konten]"
  const explicitDirectiveMatch = clean.match(
    /^(?:(?:tolong|bisa|coba|tolong\s+bisa)\s+)?(?:ingat(?:kan|in|en)?|catat|simpan|rekam|ingetin)(?:\s+(?:ya|nih|dong|deh))?(?:\s+(?:ke\s+(?:memori|database|ingatan)))?(?:\s+(?:aku|saya|gue|gw))?(?:\s+(?:kalau|bahwa|ada|soal|tentang))?\s+(.+)/i
  );
  if (explicitDirectiveMatch && explicitDirectiveMatch[1]) {
    const rawContent = cleanItemText(explicitDirectiveMatch[1]);
    if (rawContent.length >= 3) {
      // Prioritas 0.1: Periksa apakah konten direktif adalah jadwal / kegiatan waktu
      const timeMatch = rawContent.match(/(?:(?:jam|pukul)\s+\d+(?::\d+)?)|(?:besok|lusa|nanti malam|nanti sore|nanti siang)/i);
      if (timeMatch && !/(?:suka|doyan|kesukaan|favorit)\s+(?:makan|minum)/i.test(rawContent)) {
        results.push({
          fact: `Pengingat kegiatan/jadwal penting: ${rawContent}`,
          category: "jadwal",
          importance: 3,
        });
        return results;
      }

      // Prioritas 0.2: Periksa apakah preferensi makanan/minuman
      const isDrink = /kopi|minuman|teh|jus|boba|latte|americano|espresso|susu|air/i.test(rawContent) || /minum|ngopi/i.test(rawContent);
      const isFood = /makan|makanan|doyan|ikan|mie|ayam|nasi|sushi|sate|steak|pizza|sayur|buah|daging/i.test(rawContent) || /(?:suka|sukanya|doyan|favorit|kesukaan)/i.test(rawContent);

      if (isDrink || isFood) {
        const subjek = isAboutBeloved ? "Celyn (orang terkasih Rafli)" : "Rafli";
        const action = isDrink ? "minum" : "makan";
        const tag = isDrink ? "minuman/kopi kesukaan" : "makanan kesukaan";
        
        let item = cleanSubjectAndAux(rawContent);
        const verbStrip = /^(?:suka|sukanya|doyan|makan|minum)\s+/i;
        while (verbStrip.test(item)) {
          item = item.replace(verbStrip, "").trim();
        }
        item = item.replace(/(?:makanan|minuman|kopi)?\s*(?:kesukaan|favorit)(?:ku|nya)?/i, "").trim();
        item = cleanSubjectAndAux(item);

        if (item.length >= 2 && !INVALID_ITEM_RE.test(item)) {
          results.push({
            fact: `${subjek} suka ${action} ${item} (${tag})`,
            category: "preferensi",
            importance: 3,
          });
          return results;
        }
      }

      // Prioritas 0.3: Proyek / pekerjaan
      if (/ngerjain|mengerjakan|bikin|membuat|ngoding|proyek|project/i.test(rawContent)) {
        results.push({
          fact: `Proyek/pekerjaan penting Rafli: ${rawContent}`,
          category: "proyek",
          importance: 3,
        });
        return results;
      }

      // Prioritas 0.4: Konten direktif umum
      const subjek = isAboutBeloved ? "Celyn (orang terkasih Rafli)" : "Rafli";
      const cleanGeneral = cleanSubjectAndAux(rawContent);
      if (!INVALID_ITEM_RE.test(cleanGeneral)) {
        results.push({
          fact: `Catatan penting ${subjek}: ${cleanGeneral}`,
          category: "catatan",
          importance: 3,
        });
        return results;
      }
    }
  }

  // 1. Pola PR / Tugas Pengguna (Homework & Tasks)
  const homeworkMatch = clean.match(
    /\b(?:(?:aku|saya|gue|gw)\s+)?(?:ada|lagi\s+ada|punya|ngerjain|mengerjakan)\s+(?:PR|tugas|soal\s+(?:ujian|latihan|tugas))\s+([^.,!?\n]+?)(?:[\.,!\?]|$|\s+dan\s+|\s+karena|\s+tapi)/i
  ) || clean.match(
    /\b(?:ada\s+)?PR\s+([^.,!?\n]+?)(?:[\.,!\?]|$|\s+dan\s+|\s+karena|\s+tapi)/i
  );
  if (homeworkMatch) {
    const rawHomework = cleanItemText(homeworkMatch[0]);
    if (rawHomework.length >= 4) {
      results.push({
        fact: summarizeFactEssence(rawHomework, "catatan"),
        category: "catatan",
        importance: 3,
      });
      return results;
    }
  }

  // 2. Pola Alasan Preferensi Sentimental: "(alasan ... suka [item] ... karena [alasan])" OR "(suka [item] karena [alasan])"
  const reasonPrefMatch = clean.match(
    /(?:alasan\s+(?:saya|aku|celyn|jocelyn|rafli)?\s*(?:suka|doyan|minum|makan)\s+([a-zA-Z0-9\s]+?)\s+(?:karena|adalah|yaitu|ialah)\s+([^.,!?\n]+))|(?:(?:saya|aku|celyn|jocelyn|rafli)\s+(?:suka|doyan|minum|makan)\s+([a-zA-Z0-9\s]+?)\s+(?:itu\s+)?karena\s+([^.,!?\n]+))/i
  );
  if (reasonPrefMatch) {
    const rawTarget = cleanSubjectAndAux(reasonPrefMatch[1] || reasonPrefMatch[3] || "");
    const rawReason = cleanItemText(reasonPrefMatch[2] || reasonPrefMatch[4] || "");
    if (rawTarget.length >= 2 && !INVALID_ITEM_RE.test(rawTarget) && rawReason.length >= 3) {
      const subjek = isAboutBeloved ? "Celyn (orang terkasih Rafli)" : "Rafli";
      results.push({
        fact: `${subjek} menyukai ${rawTarget} karena ${rawReason} (alasan kesukaan)`,
        category: "preferensi",
        importance: 3,
      });
      return results;
    }
  }

  // Pola A: "(makanan/minuman/kopi)? (kesukaan/favorit) ... adalah/itu/yaitu [item]"
  const prefNounMatch = clean.match(
    /\b(?:(?:makanan|minuman|kopi)\s+)?(?:kesukaan|favorit|paling pas di lidah|pas di lidah|cocok di lidah)(?:ku|nya)?(?:\s+(?:saya|aku|gue|gw|celyn|jocelyn|rafli|dia|kamu|orang terkasih|kita))?\s*(?:adalah|itu|yaitu|ialah|yakni|berupa)?\s+([^.,!?\n]+?)(?:[\.,!\?]|$|\s+dan\s+|\s+bukan\s+|\s+karena|\s+deh|\s+tolong|\s+ya)/i
  );
  if (prefNounMatch && prefNounMatch[1]) {
    let rawItem = cleanSubjectAndAux(prefNounMatch[1]);
    if (rawItem.length >= 2 && !INVALID_ITEM_RE.test(rawItem)) {
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

  // Pola B: "(lebih )?suka / sukanya / doyan / paling suka / favorit [item]"
  const prefVerbMatch = clean.match(
    /\b(?:lebih\s+)?(?:suka|sukanya|doyan|paling suka|favorit|gemar|hobi)\s+(?:banget\s+)?(?:(?:minum|makan|ngopi|nyemil)\s+)?([^.,!?\n]+?)(?:[\.,!\?]|$|\s+dan\s+nanti|\s+bukan\s+|\s+karena|\s+tapi)/i
  );
  if (prefVerbMatch && prefVerbMatch[1]) {
    const rawItem = cleanSubjectAndAux(prefVerbMatch[1]);
    if (rawItem.length >= 2 && !INVALID_ITEM_RE.test(rawItem)) {
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

  // Pola Inversi: "[item] adalah/itu makanan/minuman/kopi kesukaan/favorit" OR "[item] kesukaanku / favoritku"
  const prefInversMatch = clean.match(
    /(?:(?:tolong\s+)?(?:ingat|catat)(?:\s+ya)?(?:\s+(?:kalau|bahwa))?\s+)?([a-zA-Z0-9\s]+?)\s+(?:adalah|itu|merupakan)\s+(?:(?:makanan|minuman|kopi)\s+)?(?:kesukaan|favorit)(?:ku|nya)?(?:\s+(?:saya|aku|gue|gw|celyn|jocelyn|rafli|dia|kamu|orang terkasih))?/i
  ) || clean.match(
    /([a-zA-Z0-9\s]+?)\s+(?:kesukaan|favorit)(?:ku|nya)?(?:\s+(?:saya|aku|gue|gw|celyn|jocelyn|rafli|dia|kamu|orang terkasih))?/i
  );
  if (prefInversMatch && prefInversMatch[1]) {
    let rawItem = cleanSubjectAndAux(prefInversMatch[1]);
    rawItem = rawItem.replace(/^(?:ingat|tolong ingat|catat)\s+(?:ya\s+)?(?:kalau\s+|bahwa\s+)?/i, "").trim();
    if (rawItem.length >= 2 && !INVALID_ITEM_RE.test(rawItem)) {
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

  // Pola C: Alergi / Pantangan
  const allergyMatch = clean.match(
    /(?:alergi|pantangan|tidak bisa makan|nggak bisa makan)\s+([a-zA-Z0-9\s]+?)(?:[\.,!\?]|$)/i
  );
  if (allergyMatch && allergyMatch[1]) {
    const item = cleanSubjectAndAux(allergyMatch[1]);
    if (item.length >= 2 && !INVALID_ITEM_RE.test(item)) {
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
    if (rawProject.length >= 3 && !INVALID_ITEM_RE.test(rawProject)) {
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
    if (rawProject.length >= 3 && !INVALID_ITEM_RE.test(rawProject)) {
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
    if (storyItem.length >= 3 && !INVALID_ITEM_RE.test(storyItem)) {
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
    if (rawPlan.length >= 3 && !INVALID_ITEM_RE.test(rawPlan)) {
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
    if (rawTopic.length >= 3 && !INVALID_ITEM_RE.test(rawTopic)) {
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
    return { action: "updated", id: existingId, fact: cleanFact };
  }

  // 2. Level 2: Filter Konteks Cerdas (Smart Context Matching)
  // Jika konteks sudah ada di database, jangan buat baris ganda, cukup perbarui baris yang ada!
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
    return { action: "updated", id: existingTargetId, fact: cleanFact };
  }

  // Context baru -> INSERT baris baru
  await db.execute({
    sql: "INSERT OR IGNORE INTO user_profile (category, fact, importance, updated_at) VALUES (?, ?, ?, ?)",
    args: [validCategory, cleanFact, validImportance, wibNow],
  });
  return { action: "inserted", fact: cleanFact };
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

    const cleanContent = String(content).trim();
    const wibNow = getWibTimestamp();
    const db = createClient({ url, authToken });

    // 1. Debounce check untuk chat_logs agar tidak ada duplikasi data akibat double trigger
    const lastIdentical = await db.execute({
      sql: "SELECT id, session_id, created_at FROM chat_logs WHERE role = ? AND content = ? ORDER BY id DESC LIMIT 1",
      args: [String(role), cleanContent],
    });

    let isDuplicate = false;
    if (lastIdentical.rows.length > 0) {
      const row = lastIdentical.rows[0];
      const sameSession = String(row.session_id) === String(sessionId);
      const rowCreatedAt = String(row.created_at || "");
      const rowTime = new Date(rowCreatedAt.replace(" ", "T") + "+07:00").getTime();
      const nowTime = Date.now();
      const diffSeconds = isNaN(rowTime) ? 999 : Math.abs(nowTime - rowTime) / 1000;

      if (sameSession || diffSeconds <= 20) {
        isDuplicate = true;
      }
    }

    if (!isDuplicate) {
      await db.execute({
        sql: "INSERT INTO chat_logs (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
        args: [String(sessionId), String(role), cleanContent, wibNow],
      });
    }

    // ⚡ Autonomous Memory Ingestion (Zero-Manual Input) dengan Filter-Before-Write & Smart Context Upsert
    let autoSavedFacts = [];
    if (role === "user") {
      try {
        const extracted = extractFactsFromUtterance(cleanContent);
        for (const item of extracted) {
          const result = await smartUpsertUserProfile(
            db,
            item.fact,
            item.category,
            item.importance,
            wibNow
          );
          if (result) {
            autoSavedFacts.push({ ...item, action: result.action, id: result.id });
          }
        }
      } catch (autoErr) {
        console.warn("[Vercel API /api/record] Gagal auto-ekstraksi:", autoErr);
      }
    }

    return res.status(200).json({ ok: true, created_at: wibNow, duplicate_skipped: isDuplicate, auto_saved: autoSavedFacts });
  } catch (err) {
    console.error("[Vercel API /api/record] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
