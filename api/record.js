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
  const stripRegex = /^(?:bukan|nggak|bukanlah|saya|aku|gue|gw|celyn|jocelyn|rafli|dia|kamu|kita|anda|orang terkasih|itu|ini|adalah|yaitu|ialah|yakni|berupa|kalau|bahwa|lebih|paling|lagi)\s+/i;
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

        if (item.length >= 2) {
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
      results.push({
        fact: `Catatan penting ${subjek}: ${rawContent}`,
        category: "catatan",
        importance: 3,
      });
      return results;
    }
  }

  // Pola A: "(makanan/minuman/kopi)? (kesukaan/favorit) ... adalah/itu/yaitu [item]"
  const prefNounMatch = clean.match(
    /\b(?:(?:makanan|minuman|kopi)\s+)?(?:kesukaan|favorit)(?:ku|nya)?(?:\s+(?:saya|aku|gue|gw|celyn|jocelyn|rafli|dia|kamu|orang terkasih|kita))?\s*(?:adalah|itu|yaitu|ialah|yakni|berupa)?\s+([^.,!?\n]+?)(?:[\.,!\?]|$|\s+dan\s+|\s+bukan\s+|\s+karena)/i
  );
  if (prefNounMatch && prefNounMatch[1]) {
    let rawItem = cleanSubjectAndAux(prefNounMatch[1]);
    if (rawItem.length >= 2 && !/^(itu|ini|dia|kamu|aku|saya|bukan|ku|nya)$/i.test(rawItem)) {
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
    if (rawItem.length >= 2 && !/^(itu|ini|dia|kamu|aku|saya|ngobrol|bicara|bukan)$/i.test(rawItem)) {
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
    if (rawItem.length >= 2 && !/^(itu|ini|dia|kamu|aku|saya|bukan|apa|ku|nya)$/i.test(rawItem)) {
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
    return { action: "updated", id: existingId, fact: cleanFact };
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
  const isFood = /makan|makanan|doyan|ikan|mie|ayam|nasi|sushi|sayur|buah|daging/i.test(cleanFact);
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
