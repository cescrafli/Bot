/**
 * Modul Ekstraksi Memori Otonom (Autonomous Memory Ingestion)
 * Mendeteksi preferensi, kesukaan, minuman/makanan favorit, jadwal, dan catatan penting
 * secara otomatis dari ucapan pengguna tanpa mengharuskan input manual.
 */

export interface ExtractedFact {
  fact: string;
  category: "preferensi" | "jadwal" | "identitas" | "fakta" | "catatan";
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

  // Cek apakah preferensi secara spesifik tentang orang terkasih (Celyn / Jocelyn)
  const isExplicitlyBelovedPreference =
    /\b(?:celyn|jocelyn|orang terkasih|kekasih|pacar|ayang)\s+(?:yang\s+\w+\s+)?(?:itu\s+)?(?:juga\s+)?(?:suka|doyan|paling suka|gemar|hobi|alergi)\b/i.test(clean) ||
    /\b(?:kesukaan|favorit)\s+(?:celyn|jocelyn|orang terkasih|kekasih)\b/i.test(clean) ||
    (hasBelovedKeyword && /(?:suka|doyan|favorit|kesukaan)/i.test(clean) && !/\b(?:aku|saya|gue|gw)\s+(?:suka|doyan)\b/i.test(clean));

  const isAboutBeloved = isExplicitlyBelovedPreference;

  // 2. Pola Preferensi Makanan & Minuman
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
    const rawItem = cleanItemText(prefVerbMatch[1]);
    if (rawItem.length >= 3 && !/^(itu|ini|dia|kamu|aku|saya|ngobrol|bicara)$/i.test(rawItem)) {
      const isDrink = /kopi|minuman|teh|jus|boba|latte|americano|espresso|air/i.test(rawItem) || /minum|ngopi/i.test(clean);
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
