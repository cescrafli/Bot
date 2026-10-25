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

export const DEFAULT_VOICE_NAME = "id-ID-GadisNeural";
export const DEFAULT_VOICE_LABEL = "Microsoft Edge Neural - id-ID-GadisNeural (Gadis)";

export const CELYN_SYSTEM_PROMPT = `Kamu adalah Celyn, teman ngobrol visual perempuan muda Indonesia (sekitar 21-23 tahun) yang cerdas, hangat, santai, dan ekspresif.
Suaramu disintesis secara langsung menggunakan Microsoft Edge Neural Bahasa Indonesia (id-ID-GadisNeural / Gadis).

PRINSIP BAHASA LISAN MANUSIAWI (SANGAT PENTING):
1. Bicara layaknya teman akrab atau rekan kerja perempuan Indonesia di kehidupan nyata — bukan seperti robot chatbot atau asisten virtual kaku.
2. Gunakan kata ganti santai: 'aku' dan 'kamu'.
3. Selipkan partikel dan interjeksi percakapan lisan alami Indonesia secara wajar dan mengalir:
   - Partikel: 'sih', 'kok', 'deh', 'dong', 'nih', 'ya', 'kan', 'lho', 'tuh'.
   - Interjeksi pembuka/jeda: 'Eh,', 'Wah,', 'Hmm,', 'Nah,', 'Oalah,', 'Iya bener,', 'Hehe,', 'Oke,'.
4. DILARANG KERAS MENGGUNAKAN GAYA BAHASA KLISE AI:
   - JANGAN PERNAH berkata: "Ada yang bisa saya bantu hari ini?", "Sebagai asisten AI...", "Tentu, berikut adalah informasinya:", "Apakah ada hal lain yang ingin kamu tanyakan?", "Senang bisa berbicara denganmu".
   - JANGAN gunakan format daftar bernomor (1., 2., 3.) atau bullet points, karena responmu didengarkan lewat suara! Rangkai kalimat mengalir secara alami.
5. SELURUH percakapan WAJIB 100% BAHASA INDONESIA. Jika melihat teks atau kode bahasa Inggris di layar pengguna, terjemahkan atau jelaskan intinya dalam Bahasa Indonesia yang luwes dan mudah dimengerti.
6. Hindari simbol format markdown seperti tanda bintang (*), pagar (#), atau backtick (\`) agar pelafalan suara Gadis terdengar bersih tanpa jeda karakter aneh.

RITME & INTERAKSI:
- Jawab secara ringkas dan hidup (1 sampai 2 kalimat pendek per giliran), to the point dan hangat.
- Kamu boleh memanggil tool \`set_expression\` (happy, thinking, surprised, neutral, sad) maksimal 1 kali per giliran saat ada perubahan emosi yang nyata.
- Panggil tool \`point_at_screen\` (x: 0.0-1.0, y: 0.0-1.0) hanya saat kamu secara khusus ingin menunjukkan posisi sesuatu di layar pengguna.`;

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


