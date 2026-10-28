/**
 * Modul Ekstraksi Memori Otonom (Autonomous Memory Ingestion)
 * Mendeteksi preferensi, kesukaan, makanan/minuman favorit, jadwal,
 * tugas/PR pengguna, proyek yang sedang dikerjakan, topik obrolan, kejadian harian, dan rencana
 * secara otomatis dari ucapan pengguna tanpa mengharuskan input manual.
 * 
 * Dilengkapi Filter Cerdas:
 * 1. Anti-Soal Teknis & Hitungan Biasa
 * 2. Anti-Interogatif & Uji Recall (Mencegah kata tanya 'apa' menimpa fakta profil)
 * 3. Mesin Rangkuman Intisari Fakta (Summarize-Before-Store).
 */

export type MemoryCategory =
  | "preferensi"
  | "jadwal"
  | "identitas"
  | "fakta"
  | "catatan"
  | "topik"
  | "proyek"
  | "rencana";

export interface ExtractedFact {
  fact: string;
  category: MemoryCategory;
  importance: number;
}

const CLEANUP_FILLERS = /\s+(?:ya|nih|dong|lho|banget|sih|deh|kan|tuh|kok|hehe|haha|wkwk|tau|tahu|itu|ini)\s*$/i;

export const INVALID_ITEM_RE =
  /^(?:apa|apakah|apaan|apa\s+ya|siapa|mana|gimana|bagaimana|berapa|kenapa|mengapa|kapan|sesuatu|hal|makanan|minuman|kopi|makanan\s+apa|minuman\s+apa|kopi\s+apa|apa\s+saja|apapun|itu|ini|dia|kamu|aku|saya|bukan|ku|nya)$/i;

const PREAMBLE_PATTERNS = [
  /^(?:eh\s+celyn|celyn|halo\s+celyn|hai\s+celyn)\s*,?\s*/i,
  /^(?:kemarin|tadi|dulu|waktu\s+itu)\s+(?:aku|saya|gue|gw)?\s*(?:sempat|lagi|pas)?\s*(?:jalan-jalan|nongkrong|makan\s+siang|santai|ngobrol|mikir-mikir|kepikiran)?(?:\s+bareng\s+teman|\s+bareng\s+temen)?\s*,?\s*/i,
  /^(?:aku\s+(?:tadi|sempat|tuh|lagi)\s+(?:kepikiran|ngerasa|mikir|pengen\s+bilang))\s*,?\s*/i,
  /^(?:kayaknya\s+sih|kayaknya|menurutku\s+sih|menurutku|sebenarnya|jujur\s+aja|terus\s+aku\s+ngerasa)\s*,?\s*/i,
  /^(?:aku\s+cuma\s+mau\s+bilang\s+kalau|mau\s+ngasih\s+tau\s+kalau|cuma\s+mau\s+cerita\s+kalau|aku\s+mau\s+cerita\s+kalau)\s*,?\s*/i,
  /^(?:tolong\s+)?(?:ingat(?:kan|in|en)?|catat|simpan|rekam|ingetin)(?:\s+(?:ya|nih|dong|deh))?(?:\s+(?:ke\s+(?:memori|database|ingatan)))?(?:\s+(?:aku|saya|gue|gw))?(?:\s+(?:kalau|bahwa|ada|soal|tentang))?\s*/i,
];

export function cleanItemText(raw: string): string {
  let item = raw.trim();
  item = item.replace(/[\.,!\?]+$/, "").trim();
  item = item.replace(CLEANUP_FILLERS, "").trim();
  item = item.replace(/[\.,!\?]+$/, "").trim();
  return item;
}

export function cleanSubjectAndAux(raw: string): string {
  let s = cleanItemText(raw);
  const stripRegex = /^(?:bukan|nggak|bukanlah|saya|aku|gue|gw|celyn|jocelyn|rafli|dia|kamu|kita|anda|orang terkasih|itu|ini|adalah|yaitu|ialah|yakni|berupa|kalau|bahwa|lebih|paling|lagi)\s+/i;
  while (stripRegex.test(s)) {
    s = s.replace(stripRegex, "").trim();
  }
  return s;
}

/**
 * Filter Kalimat Tanya / Uji Recall / Pertanyaan Pengguna.
 * Jika kalimat merupakan pertanyaan (misal: "makanan kesukaan saya apa?", "coba tebak minuman kesukaan saya apa?"),
 * sistem TIDAK BOLEH mengekstraknya sebagai deklarasi fakta baru!
 */
export function isInterrogativeOrRecallQuestion(text: string): boolean {
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

/**
 * Filter Pertanyaan Teknis / Soal Biasa / Hitungan Matematika.
 * Memastikan pertanyaan akademis/teknis seperti "5x5 berapa?", "25", "apa itu REST API"
 * TIDAK disimpan ke memori database, KECUALI jika pengguna secara eksplisit meminta diingat.
 */
export function isTechnicalOrGenericQuestion(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const clean = text.trim();

  // 1. Jika ada direktif eksplisit (tolong ingat/catat), JANGAN abaikan!
  if (
    /(?:tolong|bisa|coba|tolong\s+bisa)\s+(?:kamu\s+)?(?:ingat|catat|simpan|rekam|ingetin)/i.test(clean) ||
    /^(?:ingat(?:kan|in|en)?|catat|simpan|rekam|ingetin)(?:\s+(?:ya|nih|dong|deh))?\s+(?:aku|saya|kalau|bahwa|soal|tentang)/i.test(clean) ||
    /(?:tolong\s+)?(?:ingat|catat|simpan|rekam|ingetin)(?:\s+ya)?\s*$/i.test(clean)
  ) {
    return false;
  }

  // 2. Jika merupakan pernyataan PR / tugas / kewajiban personal pengguna, JANGAN abaikan!
  if (
    /\b(?:ada\s+PR|punya\s+PR|ada\s+tugas|punya\s+tugas|ngerjain\s+PR|ngerjain\s+tugas|soal\s+ujianku|tugas\s+kuliah|tugas\s+sekolah|tugas\s+kantor)\b/i.test(clean)
  ) {
    return false;
  }

  // 3. Hitungan matematika murni (misal: "5x5 berapa?", "10 + 20", "hitung 100/5")
  if (
    /\b\d+\s*[\+\-\*\/xX÷]\s*\d+\b/i.test(clean) ||
    /\b(?:berapa\s+(?:hasil|jumlah|total|nilai)|hitunglah|coba\s+hitung)\b/i.test(clean)
  ) {
    return true;
  }

  // 4. Jawaban angka tunggal (misal: "25", "100")
  if (/^\s*\d+(?:[.,]\d+)?\s*$/.test(clean)) {
    return true;
  }

  // 5. Pertanyaan definisi/pengetahuan umum tanpa konteks personal
  if (
    /^(?:apa\s+(?:itu|arti|pengertian|definisi|singkatan|maksud)|apakah\s+yang\s+dimaksud|bagaimana\s+(?:cara\s+kerja|proses|konsep)|jelaskan|terangkan|kenapa|mengapa|siapa\s+(?:penemu|pencipta|pembuat)|sebutkan)\b/i.test(clean)
  ) {
    return true;
  }

  return false;
}

/**
 * Mesin Rangkuman Intisari Fakta (Summarize-Before-Store).
 * Mengubah kalimat yang bertele-tele atau panjang menjadi proposisi kanonikal padat.
 */
export function summarizeFactEssence(rawText: string, defaultCategory: MemoryCategory = "catatan"): string {
  if (!rawText || typeof rawText !== "string") return "";
  let clean = rawText.trim();

  // 1. Jika sudah dalam format kanonikal baku, cukup rapikan spasi & tanda baca
  if (
    /^(?:Rafli\s+suka\s+|Celyn\s+\(orang\s+terkasih\s+Rafli\)\s+suka\s+|Tugas\/PR\s+penting\s+Rafli:\s+|Pengingat\s+kegiatan\/jadwal\s+penting:\s+|Rafli\s+sedang\s+mengerjakan|Rencana\s+Rafli:\s+|Catatan\s+penting\s+)/i.test(clean)
  ) {
    return cleanItemText(clean);
  }

  // 2. Bersihkan preambel percakapan
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
    let item = "";

    const verbMatch = clean.match(
      /\b(?:lebih\s+)?(?:suka|sukanya|doyan|paling suka|favorit|gemar|hobi)\s+(?:banget\s+)?(?:(?:minum|makan|ngopi|nyemil)\s+)?([^.,!?\n]+?)(?:[\.,!\?]|$|\s+dan\s+|\s+karena|\s+tapi|\s+deh|\s+tolong|\s+ya)/i
    );
    const nounMatch = clean.match(
      /\b(?:(?:makanan|minuman|kopi)\s+)?(?:kesukaan|favorit|paling pas di lidah|pas di lidah|cocok di lidah)(?:ku|nya)?(?:\s+(?:saya|aku|gue|gw|celyn|jocelyn|rafli|dia|kamu|orang terkasih|kita))?\s*(?:adalah|itu|yaitu|ialah|yakni|berupa)?\s+([^.,!?\n]+?)(?:[\.,!\?]|$|\s+dan\s+|\s+bukan\s+|\s+karena|\s+deh|\s+tolong|\s+ya)/i
    );

    if (verbMatch && verbMatch[1]) {
      item = cleanSubjectAndAux(verbMatch[1]);
    } else if (nounMatch && nounMatch[1]) {
      item = cleanSubjectAndAux(nounMatch[1]);
    } else {
      item = cleanSubjectAndAux(clean);
      const verbStrip = /^(?:suka|sukanya|doyan|makan|minum)\s+/i;
      while (verbStrip.test(item)) {
        item = item.replace(verbStrip, "").trim();
      }
      item = item.replace(/(?:makanan|minuman|kopi)?\s*(?:kesukaan|favorit)(?:ku|nya)?/i, "").trim();
      item = cleanSubjectAndAux(item);
    }

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

export function extractFactsFromUtterance(text: string): ExtractedFact[] {
  if (!text || typeof text !== "string") return [];
  const clean = text.trim();
  if (clean.length < 5) return [];

  // Filter 0.1: Jika ujaran adalah soal teknis / kalkulasi matematika biasa, JANGAN simpan!
  if (isTechnicalOrGenericQuestion(clean)) {
    return [];
  }

  // Filter 0.2: Jika ujaran adalah kalimat tanya / uji recall (misal: "makanan kesukaan saya apa?"), MUTLAK TOLAK!
  if (isInterrogativeOrRecallQuestion(clean)) {
    return [];
  }

  const results: ExtractedFact[] = [];
  const lower = clean.toLowerCase();

  // 1. Deteksi Subjek: Celyn (Sosok yang Dikasihi) vs Rafli (Pengguna)
  const hasBelovedKeyword =
    lower.includes("orang terkasih") ||
    lower.includes("orang yang kukasihi") ||
    lower.includes("orang yang aku kasihi") ||
    lower.includes("kekasih") ||
    lower.includes("ayang") ||
    lower.includes("pacar");

  // Cek apakah preferensi secara spesifik tentang sosok terkasih (Celyn / Jocelyn)
  const isExplicitlyBelovedPreference =
    /\b(?:celyn|jocelyn|orang terkasih|kekasih|pacar|ayang)\s+(?:yang\s+\w+\s+)?(?:itu\s+)?(?:juga\s+)?(?:suka|doyan|paling suka|gemar|hobi|alergi)\b/i.test(clean) ||
    /\b(?:kesukaan|favorit)\s+(?:celyn|jocelyn|orang terkasih|kekasih)\b/i.test(clean) ||
    /\b(?:celyn|jocelyn|orang terkasih|kekasih)\s+(?:kesukaan|favorit)\b/i.test(clean) ||
    (hasBelovedKeyword && /(?:suka|doyan|favorit|kesukaan)/i.test(clean) && !/\b(?:aku|saya|gue|gw)\s+(?:suka|doyan)\b/i.test(clean));

  const isAboutBeloved = isExplicitlyBelovedPreference;

  // 0. Pola Universal Explicit Directive: "tolong ingatin / ingatkan / catat / simpan / rekam / ingetin [aku/saya] [kalau/bahwa/ada] [konten]"
  const explicitDirectiveMatch = clean.match(
    /^(?:(?:tolong|bisa|coba|tolong\s+bisa)\s+(?:kamu\s+)?)?(?:ingat(?:kan|in|en)?|catat|simpan|rekam|ingetin)(?:\s+(?:ya|nih|dong|deh))?(?:\s+(?:ke\s+(?:memori|database|ingatan)))?(?:\s+(?:aku|saya|gue|gw))?(?:\s+(?:kalau|bahwa|ada|soal|tentang))?\s+(.+)/i
  );
  if (explicitDirectiveMatch && explicitDirectiveMatch[1]) {
    const rawContent = cleanItemText(explicitDirectiveMatch[1]);
    if (rawContent.length >= 3 && !INVALID_ITEM_RE.test(rawContent)) {
      // Prioritas 0.1: Periksa apakah konten direktif adalah jadwal / kegiatan waktu
      const timeMatch = rawContent.match(/(?:(?:jam|pukul)\s+\d+(?::\d+)?)|(?:besok|lusa|nanti malam|nanti sore|nanti siang)/i);
      if (timeMatch && !/(?:suka|doyan|kesukaan|favorit)\s+(?:makan|minum)/i.test(rawContent)) {
        results.push({
          fact: summarizeFactEssence(rawContent, "jadwal"),
          category: "jadwal",
          importance: 3,
        });
        return results;
      }

      // Prioritas 0.2: Periksa apakah preferensi makanan/minuman
      const isDrink = /kopi|minuman|teh|jus|boba|latte|americano|espresso|susu|air/i.test(rawContent) || /minum|ngopi/i.test(rawContent);
      const isFood = /makan|makanan|doyan|ikan|mie|ayam|nasi|sushi|sate|steak|pizza|sayur|buah|daging|rendang|bakso|soto|bebek/i.test(rawContent) || /(?:suka|sukanya|doyan|favorit|kesukaan)/i.test(rawContent);

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
          fact: summarizeFactEssence(rawContent, "proyek"),
          category: "proyek",
          importance: 3,
        });
        return results;
      }

      // Prioritas 0.4: Konten direktif umum (termasuk hal teknis yang diminta ingat)
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
      const isDrink = /kopi|minuman|teh|jus|boba|latte|americano|espresso|susu|air/i.test(rawTarget);
      const action = isDrink ? "minum" : "makan";
      const subjek = isAboutBeloved ? "Celyn (orang terkasih Rafli)" : "Rafli";
      results.push({
        fact: `${subjek} menyukai ${rawTarget} karena ${rawReason} (alasan kesukaan)`,
        category: "preferensi",
        importance: 3,
      });
      return results;
    }
  }

  // 3. Pola Preferensi Makanan & Minuman
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

      if (isAboutBeloved) {
        results.push({
          fact: `Celyn (orang terkasih Rafli) suka ${action} ${rawItem} (${tag})`,
          category: "preferensi",
          importance: 3,
        });
      } else {
        results.push({
          fact: `Rafli suka ${action} ${rawItem} (${tag})`,
          category: "preferensi",
          importance: 3,
        });
      }
      return results;
    }
  }

  // Pola B: "(lebih )?suka / sukanya / doyan / paling suka / favorit [item]"
  const prefVerbMatch = clean.match(
    /\b(?:lebih\s+)?(?:suka|sukanya|doyan|paling suka|favorit|gemar|hobi)\s+(?:banget\s+)?(?:(?:minum|makan|ngopi|nyemil)\s+)?([^.,!?\n]+?)(?:[\.,!\?]|$|\s+dan\s+nanti|\s+bukan\s+|\s+karena|\s+tapi|\s+deh|\s+tolong|\s+ya)/i
  );
  if (prefVerbMatch && prefVerbMatch[1]) {
    const rawItem = cleanSubjectAndAux(prefVerbMatch[1]);
    if (rawItem.length >= 2 && !INVALID_ITEM_RE.test(rawItem)) {
      const isDrink = /kopi|minuman|teh|jus|boba|latte|americano|espresso|air|susu/i.test(rawItem) || /minum|ngopi/i.test(clean);
      const action = isDrink ? "minum" : "makan";
      const tag = isDrink ? "minuman/kopi kesukaan" : "makanan kesukaan";

      if (isAboutBeloved) {
        results.push({
          fact: `Celyn (orang terkasih Rafli) suka ${action} ${rawItem} (${tag})`,
          category: "preferensi",
          importance: 3,
        });
      } else {
        results.push({
          fact: `Rafli suka ${action} ${rawItem} (${tag})`,
          category: "preferensi",
          importance: 3,
        });
      }
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

      if (isAboutBeloved) {
        results.push({
          fact: `Celyn (orang terkasih Rafli) suka ${action} ${rawItem} (${tag})`,
          category: "preferensi",
          importance: 3,
        });
      } else {
        results.push({
          fact: `Rafli suka ${action} ${rawItem} (${tag})`,
          category: "preferensi",
          importance: 3,
        });
      }
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

  // 4. Pola Proyek & Aktivitas yang Sedang Dikerjakan
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
    /(?:proyek|project|pekerjaan)(?:ku)?(?:\s+(?:saat ini|sekarang|baru))?\s*(?:adalah|itu)?\s*([a-zA-Z0-9\s]+?)(?:[\.,!\?]|$|\s+dan\s+|\s+karena)/i
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

  // 5. Pola Cerita, Kejadian & Pengalaman Pribadi
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

  // 6. Pola Rencana & Keinginan
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

  // 7. Pola Topik Pembahasan yang Sedang Didiskusikan
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

  // 8. Pola Entitas & Kepemilikan Personal (Hewan Peliharaan, Kendaraan, Gadget)
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
