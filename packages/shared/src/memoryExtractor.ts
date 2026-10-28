/**
 * Modul Ekstraksi Memori Otonom (Autonomous Memory Ingestion)
 * Mendeteksi preferensi, kesukaan, makanan/minuman favorit, jadwal,
 * proyek yang sedang dikerjakan, topik obrolan, kejadian harian, dan rencana
 * secara otomatis dari ucapan pengguna tanpa mengharuskan input manual.
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

const CLEANUP_FILLERS = /\s+(?:ya|nih|dong|lho|banget|sih|deh|kan|tuh|kok|hehe|haha|tau|tahu|itu|ini)\s*$/i;

function cleanItemText(raw: string): string {
  let item = raw.trim();
  item = item.replace(/[\.,!\?]+$/, "").trim();
  item = item.replace(CLEANUP_FILLERS, "").trim();
  item = item.replace(/[\.,!\?]+$/, "").trim();
  return item;
}

function cleanSubjectAndAux(raw: string): string {
  let s = cleanItemText(raw);
  const stripRegex = /^(?:saya|aku|gue|gw|celyn|jocelyn|rafli|dia|kamu|kita|anda|orang terkasih|itu|ini|adalah|yaitu|ialah|yakni|berupa|kalau|bahwa)\s+/i;
  while (stripRegex.test(s)) {
    s = s.replace(stripRegex, "").trim();
  }
  return s;
}

export function extractFactsFromUtterance(text: string): ExtractedFact[] {
  if (!text || typeof text !== "string") return [];
  const clean = text.trim();
  if (clean.length < 5) return [];

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

  // 2. Pola Preferensi Makanan & Minuman
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
