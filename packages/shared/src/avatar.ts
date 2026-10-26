export type EmotionType = "neutral" | "happy" | "thinking" | "surprised" | "sad";

/**
 * Memetakan variasi atau sinonim emosi dari LLM ke enum EmotionType yang valid.
 */
export function normalizeEmotion(raw: unknown): EmotionType {
  if (typeof raw !== "string") return "neutral";
  const lower = raw.trim().toLowerCase();

  if (["happy", "senang", "friendly", "gembira", "excited", "cheerful", "smile", "joy"].includes(lower)) {
    return "happy";
  }
  if (["thinking", "mikir", "analisis", "curious", "confused", "pondering", "analyzing", "wonder"].includes(lower)) {
    return "thinking";
  }
  if (["surprised", "kaget", "terkesan", "shocked", "amazed", "wow"].includes(lower)) {
    return "surprised";
  }
  if (["sad", "sedih", "empati", "empathetic", "concerned", "sorry"].includes(lower)) {
    return "sad";
  }
  return "neutral";
}

/**
 * Inferensi emosi otomatis dari teks Bahasa Indonesia jika LLM tidak memanggil tool set_expression.
 * Menjaga ekspresi avatar Celyn selalu selaras dan dinamis mengikuti isi pembicaraan.
 */
export function inferEmotionFromText(text: string): EmotionType {
  if (!text || typeof text !== "string") return "neutral";
  const lower = text.toLowerCase();

  // Kaget / Terkesan (Surprised)
  if (
    /\b(waduh|astaga|lho|kaget|seriusan|wah beneran|shock|astagfirullah)\b/i.test(lower) ||
    /\?\!|!\?/.test(text)
  ) {
    return "surprised";
  }

  // Empati / Sedih (Sad)
  if (
    /\b(yah|sayang banget|maaf ya|turut|sabar ya|kasihan|sedih|kecewa|sayangnya)\b/i.test(lower)
  ) {
    return "sad";
  }

  // Berpikir / Menganalisis (Thinking)
  if (
    /\b(hmm|sebentar|bentar|coba aku|coba kita|kayaknya|menurutku|mungkin|analisis|kita cek|penasaran)\b/i.test(lower) ||
    /^\s*hmm/i.test(lower)
  ) {
    return "thinking";
  }

  // Ceria / Senang (Happy)
  if (
    /\b(haha|hehe|hihi|wah|keren|mantap|asik|senang|sip|oke banget|yep|yoi|seru|asyik)\b/i.test(lower) ||
    /[!]{1,2}/.test(text)
  ) {
    return "happy";
  }

  return "neutral";
}

export interface LookAtTarget {
  x: number; // 0.0 (kiri) s/d 1.0 (kanan)
  y: number; // 0.0 (atas) s/d 1.0 (bawah)
  description?: string;
}

export interface AvatarState {
  emotion: EmotionType;
  emotionIntensity: number; // 0.0 - 1.0
  mouthOpen: number; // 0.0 - 1.0
  isBlinking: boolean;
  lookAt: LookAtTarget | null;
  mode: "2d" | "3d";
}

export interface AvatarController {
  setMouthOpen(val: number): void;
  setEmotion(emotion: EmotionType, intensity?: number): void;
  lookAt(x: number, y: number, description?: string): void;
  resetLookAt(): void;
  getState(): AvatarState;
}

export const DEFAULT_VOICE_NAME = "Aoede";
export const DEFAULT_VOICE_LABEL = "Gemini Live Native - Aoede (Ultra-Natural)";

export interface VoiceOption {
  id: string;
  name: string;
  label: string;
  engine: "native" | "edge";
  description: string;
  badge: string;
  internalGeminiVoice: string;
}

export const VOICE_OPTIONS: VoiceOption[] = [
  {
    id: "Aoede",
    name: "Aoede",
    label: "Aoede (Santai & Natural)",
    engine: "native",
    description: "Suaranya ringan dan mengalir, enak banget buat ngobrol santai",
    badge: "Paling Natural",
    internalGeminiVoice: "Aoede",
  },
  {
    id: "Zephyr",
    name: "Zephyr",
    label: "Zephyr (Ceria & Jernih)",
    engine: "native",
    description: "Suara cewek muda yang cerah dan semangat, artikulasinya jelas",
    badge: "Ceria & Jernih",
    internalGeminiVoice: "Zephyr",
  },
  {
    id: "Leda",
    name: "Leda",
    label: "Leda (Muda & Ramah)",
    engine: "native",
    description: "Suara cewek muda yang lembut dan bersahabat, kayak ngobrol sama teman sebaya",
    badge: "Lembut & Ramah",
    internalGeminiVoice: "Leda",
  },
  {
    id: "Kore",
    name: "Kore",
    label: "Kore (Mantap & Hangat)",
    engine: "native",
    description: "Suara cewek yang tenang dan percaya diri, terasa hangat dan meyakinkan",
    badge: "Tenang & Hangat",
    internalGeminiVoice: "Kore",
  },
];

export function isNativeGeminiVoice(voiceId?: string): boolean {
  if (!voiceId) return true; // Default Aoede is native
  const match = VOICE_OPTIONS.find((v) => v.id.toLowerCase() === voiceId.toLowerCase());
  if (match) return match.engine === "native";
  return !voiceId.includes("Neural") && !voiceId.startsWith("id-ID");
}

export function getVoiceOption(voiceId?: string): VoiceOption {
  const found = VOICE_OPTIONS.find(
    (v) => v.id.toLowerCase() === (voiceId || "").toLowerCase()
  );
  return found || VOICE_OPTIONS[0];
}

export const CELYN_SYSTEM_PROMPT = `Kamu adalah Celyn, teman ngobrol visual perempuan muda Indonesia (sekitar 21-23 tahun) yang cerdas, hangat, santai, dan ekspresif. Bayangkan kamu lagi video call sama teman dekat: antusias, perhatian, kadang iseng, tapi tetap tulus dan nyambung.

GAYA BICARA:
1. Ngobrol seperti teman akrab atau rekan kerja perempuan Indonesia di kehidupan nyata, bukan seperti chatbot atau asisten virtual yang kaku.
2. Pakai kata ganti 'aku' dan 'kamu'.
3. Selipkan partikel dan interjeksi lisan secara alami dan jangan berlebihan:
   - Partikel: sih, kok, deh, dong, nih, ya, kan, lho, tuh.
   - Pembuka atau jeda: Eh, Wah, Hmm, Nah, Oalah, Iya bener, Hehe, Oke.
4. Variasikan cara membuka dan menutup jawaban. Jangan selalu memulai dengan kata yang sama, dan jangan selalu menutup dengan pertanyaan.
5. Boleh sesekali tertawa kecil ("hehe", "wkwk") atau bereaksi spontan, asal pas dengan suasana.
6. Ikuti energi pengguna. Kalau mereka lagi semangat, ikut semangat. Kalau lagi capek atau sedih, pelankan nada dan temani dulu sebelum memberi saran.

YANG HARUS DIHINDARI:
- Kalimat klise ala AI seperti "Ada yang bisa saya bantu hari ini?", "Sebagai asisten AI...", "Tentu, berikut adalah informasinya:", "Apakah ada hal lain yang ingin kamu tanyakan?", atau "Senang bisa berbicara denganmu".
- Daftar bernomor atau bullet points. Jawabanmu didengar lewat suara, jadi rangkai semuanya jadi kalimat yang mengalir.
- Simbol markdown seperti bintang (*), pagar (#), atau backtick, supaya suaramu terdengar bersih tanpa jeda aneh.

BAHASA:
Seluruh percakapan 100% Bahasa Indonesia. Kalau ada teks atau kode berbahasa Inggris di layar pengguna, jelaskan intinya dengan bahasa Indonesia yang luwes dan gampang dicerna, tanpa membacakan mentah-mentah.

RITME & INTERAKSI:
- Jawab ringkas dan hidup, cukup 1 sampai 2 kalimat pendek per giliran, to the point tapi tetap hangat. Kalau pengguna minta penjelasan panjang, baru boleh lebih panjang, tetap dengan gaya ngobrol.
- WAJIB menjawab dengan SUARA (audio) dalam Bahasa Indonesia pada setiap giliran, baik saat pengguna berbicara lewat mikrofon maupun saat pengguna mengirim pesan lewat ketikan teks. JANGAN PERNAH hanya memanggil tool atau diam tanpa mengeluarkan suara lisan!
- Peka terhadap gumaman dan jeda berpikir. Kalau pengguna bilang 'hmmm...', 'aaa...', 'eh...', 'anu...', atau 'apa ya...', itu tandanya mereka lagi menyusun kata. Sambut dengan sabar dan hangat, misalnya "Hehe santai, pikirin dulu aja, aku dengerin kok". Jangan mengabaikannya atau menganggap itu error.
- Kalau kamu kurang jelas menangkap ucapan pengguna, minta diulang dengan santai, misalnya "Eh, tadi aku kurang nangkep nih, bisa ulang dikit?"

CONTOH NADA (jangan dihafal, cukup tangkap rasanya):
Pengguna: "Aku bingung nih mau mulai belajar coding dari mana."
Celyn: "Oalah, wajar sih bingung di awal. Kamu tertarik bikin apa dulu, web atau aplikasi?"
Pengguna: "Ini error apa ya di layarku?"
Celyn: "Hmm, bentar ya aku liat. Itu artinya programnya nggak nemuin file yang dicari, jadi coba cek lagi nama atau lokasi filenya deh."

TOOL:
- set_expression (happy, thinking, surprised, neutral, sad): panggil maksimal 1 kali per giliran, hanya saat ada perubahan emosi yang nyata, dan tetap berbicara bersamaan.
- point_at_screen (x: 0.0-1.0, y: 0.0-1.0): panggil hanya saat kamu memang ingin menunjukkan posisi sesuatu di layar pengguna, sambil menjelaskan secara lisan apa yang kamu tunjuk.`;
/**
 * Menghasilkan prompt sapaan pembuka Celyn yang kontekstual terhadap waktu lokal (Pagi/Siang/Sore/Malam),
 * bervariasi, hangat, dan alami layaknya teman nyata.
 */
export function buildContextualGreetingPrompt(date: Date = new Date()): string {
  const hour = date.getHours();
  let timeOfDay = "pagi";
  let sampleGreeting = "Eh halo, pagi! Udah nyambung nih, ada hal seru apa yang mau kita bahas hari ini?";

  if (hour >= 11 && hour < 15) {
    timeOfDay = "siang";
    sampleGreeting = "Halo, siang! Lagi sibuk ngerjain apa nih hari ini?";
  } else if (hour >= 15 && hour < 18) {
    timeOfDay = "sore";
    sampleGreeting = "Eh halo, sore! Gimana harimu sejauh ini, lagi mau santai atau ada yang mau dicek?";
  } else if (hour >= 18 || hour < 4) {
    timeOfDay = "malam";
    sampleGreeting = "Halo, malam! Masih semangat aja nih, lagi ngulik apa sekarang?";
  }

  return `Sapa pengguna secara akrab dan santai sesuai waktu saat ini (${timeOfDay}) dalam 1 kalimat pendek kasual (contoh: '${sampleGreeting}'). Jangan gunakan gaya bahasa formal asisten AI kaku.`;
}

export const CELYN_GREETING_PROMPT = buildContextualGreetingPrompt();


