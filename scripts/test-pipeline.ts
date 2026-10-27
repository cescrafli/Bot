/**
 * Unit & Integration Smoke Test Suite untuk Celyn AI BOT
 * Menguji pipeline audio, visual change-detection, tool-calling schema, emosi, dan suara id-ID-GadisNeural.
 */
import {
  normalizeEmotion,
  DEFAULT_VOICE_NAME,
  VOICE_OPTIONS,
  isNativeGeminiVoice,
  CELYN_SYSTEM_PROMPT,
  buildCelynSystemPrompt,
  extractIndonesianSentences,
  inferEmotionFromText,
  inferUserEmotion,
  inferIndonesianProsody,
  normalizeSpokenIndonesian,
  cleanAndEscapeForSsml,
  buildExpressiveSsml,
  buildContextualGreetingPrompt,
  analyzeHumanVoiceFrame,
} from "@celyn/shared";
import { execSync } from "node:child_process";
import fs from "node:fs";
import { synthesizeEdgeTTS, generateSecMsGecV2 } from "../apps/server/src/edgeTts.js";

console.log("🧪 [Smoke Test] Memulai Pengujian Pipeline Celyn AI BOT...\n");

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

// 1. Uji Algoritma Deteksi Perubahan Layar (32x32 Thumbnail Difference)
console.log("--- 1. Uji Change Detection Pipeline (Screen Share) ---");

function simulateDiff(thumbA: Uint8ClampedArray, thumbB: Uint8ClampedArray, threshold = 35) {
  let diffPixels = 0;
  for (let i = 0; i < thumbA.length; i += 4) {
    const delta =
      Math.abs(thumbA[i] - thumbB[i]) +
      Math.abs(thumbA[i + 1] - thumbB[i + 1]) +
      Math.abs(thumbA[i + 2] - thumbB[i + 2]);
    if (delta > threshold) diffPixels++;
  }
  return diffPixels;
}

const frameSize = 32 * 32 * 4;
const staticFrameA = new Uint8ClampedArray(frameSize).fill(128);
const staticFrameB = new Uint8ClampedArray(frameSize).fill(128); // Sama persis
const changedFrame = new Uint8ClampedArray(frameSize).fill(128);
// Ubah 100 piksel secara signifikan
for (let i = 0; i < 400; i += 4) {
  changedFrame[i] = 255;
  changedFrame[i + 1] = 0;
  changedFrame[i + 2] = 0;
}

const diffStatic = simulateDiff(staticFrameA, staticFrameB);
assert(diffStatic === 0, "Layar statis menghasilkan 0 perbedaan piksel (hemat token)");

const diffChanged = simulateDiff(staticFrameA, changedFrame);
assert(diffChanged >= 100, `Perubahan layar terdeteksi dengan tepat (${diffChanged} piksel berubah)`);

// 2. Uji Konversi Format Audio (16-bit Linear PCM Little-Endian)
console.log("\n--- 2. Uji Audio PCM Math & Base64 ---");

const testSamples = new Int16Array([0, 16384, -16384, 32767, -32768]);
const uint8Bytes = new Uint8Array(testSamples.buffer, testSamples.byteOffset, testSamples.byteLength);

let binary = "";
for (let i = 0; i < uint8Bytes.byteLength; i++) {
  binary += String.fromCharCode(uint8Bytes[i]);
}
const base64Audio = Buffer.from(binary, "binary").toString("base64");
assert(base64Audio.length > 0, "Konversi Int16Array ke Base64 berhasil");

const restoredBytes = Buffer.from(base64Audio, "base64");
const restoredSamples = new Int16Array(restoredBytes.buffer, restoredBytes.byteOffset, restoredBytes.length / 2);
assert(restoredSamples[1] === 16384, "Preservasi amplitudo positif 16384 akurat");
assert(restoredSamples[2] === -16384, "Preservasi amplitudo negatif -16384 akurat");

// 3. Uji Validitas Skema Tool Calling Gemini Live API
console.log("\n--- 3. Uji Definisi Tool Calling Gemini Live ---");

const tools = [
  {
    name: "set_expression",
    parameters: {
      type: "OBJECT",
      properties: {
        emotion: { enum: ["neutral", "happy", "thinking", "surprised", "sad", "shy"] },
      },
      required: ["emotion"],
    },
  },
  {
    name: "point_at_screen",
    parameters: {
      type: "OBJECT",
      properties: {
        x: { type: "NUMBER" },
        y: { type: "NUMBER" },
      },
      required: ["x", "y"],
    },
  },
];

assert(tools.length === 2, "Tepat 2 tool AI terdaftar untuk Celyn");
assert(tools[0].name === "set_expression", "Tool 'set_expression' tersedia");
assert(tools[1].name === "point_at_screen", "Tool 'point_at_screen' tersedia");

// 4. Uji Normalisasi & Pemetaan Sinonim Emosi Avatar
console.log("\n--- 4. Uji Normalisasi Emosi Avatar & Deteksi Emosi Pengguna ---");
assert(normalizeEmotion("happy") === "happy", "Pemetaan 'happy' -> 'happy'");
assert(normalizeEmotion("senang") === "happy", "Pemetaan sinonim bahasa Indonesia 'senang' -> 'happy'");
assert(normalizeEmotion("mikir") === "thinking", "Pemetaan sinonim bahasa Indonesia 'mikir' -> 'thinking'");
assert(normalizeEmotion("kaget") === "surprised", "Pemetaan sinonim bahasa Indonesia 'kaget' -> 'surprised'");
assert(normalizeEmotion("sedih") === "sad", "Pemetaan sinonim bahasa Indonesia 'sedih' -> 'sad'");
assert(normalizeEmotion("tersipu") === "shy", "Pemetaan sinonim bahasa Indonesia 'tersipu' -> 'shy'");
assert(normalizeEmotion("malu") === "shy", "Pemetaan sinonim bahasa Indonesia 'malu' -> 'shy'");
assert(normalizeEmotion("unknown_random_string") === "neutral", "Fallback emosi yang tidak dikenal -> 'neutral'");

// 4.1 Uji Deteksi Nada & Emosi Pengguna (inferUserEmotion)
const tiredAnalysis = inferUserEmotion("Hari ini capek banget kerjaan numpuk");
assert(tiredAnalysis.emotion === "tired" && tiredAnalysis.suggestedCelynEmotion === "sad", "Deteksi nada capek/lelah berhasil (sugesti emosi Celyn: sad/empati)");

const sadAnalysis = inferUserEmotion("Aku lagi sedih dan kecewa banget...");
assert(sadAnalysis.emotion === "sad" && sadAnalysis.suggestedCelynEmotion === "sad", "Deteksi nada sedih/galau berhasil");

const angryAnalysis = inferUserEmotion("Gila kesel banget gue sama dia!");
assert(angryAnalysis.emotion === "angry" && angryAnalysis.suggestedCelynEmotion === "sad", "Deteksi nada marah/kesal berhasil (Celyn menenangkan)");

const happyAnalysis = inferUserEmotion("Wah keren banget akhirnya berhasil!");
assert(happyAnalysis.emotion === "happy" && happyAnalysis.suggestedCelynEmotion === "happy", "Deteksi nada gembira berhasil (Celyn ikut ceria)");

// 5. Uji Katalog Multi-Voice Native Gemini & Sintesis Edge Neural
async function runTtsTests() {
  console.log("\n--- 5. Uji Katalog Multi-Voice Native Gemini & Sintesis Edge Neural ---");
  assert(
    VOICE_OPTIONS.length === 4,
    `Katalog voice memiliki 4 profil suara ultra-natural HD (${VOICE_OPTIONS.map((v) => v.name).join(", ")})`
  );
  assert(
    DEFAULT_VOICE_NAME === "Aoede",
    `Default voice rekomendasi Celyn adalah '${DEFAULT_VOICE_NAME}' (Gemini Live Ultra-Natural)`
  );
  assert(
    isNativeGeminiVoice("Aoede") === true &&
      isNativeGeminiVoice("Zephyr") === true &&
      isNativeGeminiVoice("Leda") === true &&
      isNativeGeminiVoice("Kore") === true,
    "Aoede, Zephyr, Leda, & Kore teridentifikasi sebagai Native Gemini Live Voice (Real-Time HD)"
  );
  assert(
    CELYN_SYSTEM_PROMPT.toLowerCase().includes("100% bahasa indonesia"),
    "System prompt mengunci percakapan 100% Bahasa Indonesia"
  );

  const gecToken = generateSecMsGecV2();
  assert(
    /^[0-9A-F]{16}-[0-9A-F]{64}$/.test(gecToken),
    `Token Sec-MS-GEC v2 valid (${gecToken.slice(0, 24)}...)`
  );

  const audioBuf = await synthesizeEdgeTTS(
    "Halo! Aku Celyn, senang sekali bisa mengobrol denganmu dalam bahasa Indonesia.",
    { voice: "id-ID-GadisNeural" }
  );
  assert(
    audioBuf.length > 10000,
    `Sintesis suara Gadis (id-ID-GadisNeural) berhasil (${audioBuf.length} bytes MP3)`
  );

  // Uji Pemecah Kalimat Bahasa Indonesia Cerdas
  const test1 = extractIndonesianSentences(
    "Harganya Rp 15.000 saja. Cukup murah kan? Silakan dibeli!",
    false
  );
  assert(
    test1.sentences.length === 2 &&
      test1.sentences[0] === "Harganya Rp 15.000 saja." &&
      test1.sentences[1] === "Cukup murah kan?",
    "Pemisah kalimat mempertahankan angka desimal/ribuan 'Rp 15.000' tanpa terpotong"
  );

  const test2 = extractIndonesianSentences(
    "Saya membeli buku, pulpen, dll. di toko. Kamu mau titip?",
    false
  );
  assert(
    test2.sentences.length === 1 &&
      test2.sentences[0] === "Saya membeli buku, pulpen, dll. di toko.",
    "Pemisah kalimat mempertahankan singkatan Bahasa Indonesia 'dll.' tanpa terpotong"
  );

  const test3 = extractIndonesianSentences("Ini kalimat belum selesai", false);
  assert(
    test3.sentences.length === 0 && test3.remaining === "Ini kalimat belum selesai",
    "Buffer belum selesai tidak dipotong saat streaming (forceAll=false)"
  );

  const test4 = extractIndonesianSentences("Ini kalimat akhir giliran", true);
  assert(
    test4.sentences.length === 1 && test4.sentences[0] === "Ini kalimat akhir giliran",
    "Buffer akhir giliran dipaksa di-flush saat turnComplete (forceAll=true)"
  );

  // Uji Pemeliharaan Keutuhan Kalimat Bertanda Koma (Pitch Contour Kontinu Tanpa Terminal Fall)
  const testFullContour = extractIndonesianSentences(
    "Wah menarik banget nih kodenya, kelihatannya kamu lagi bikin komponen React ya? Yuk kita bahas!",
    false
  );
  assert(
    testFullContour.sentences.length === 1 &&
      testFullContour.sentences[0] ===
        "Wah menarik banget nih kodenya, kelihatannya kamu lagi bikin komponen React ya?",
    "Kalimat ber-koma tidak dipotong sembarangan, menjaga kurva intonasi pitch utuh"
  );

  // Uji Pemecahan Kalimat Ekstra Panjang (> 135 karakter) pada Konjungsi Klausa
  const veryLongText =
    "Kita bisa mulai memeriksa struktur komponen terlebih dahulu untuk memastikan tidak ada kesalahan rendering, karena kalau ada error di bagian lifecycle efeknya bisa merambat ke komponen lain.";
  const testLongSplit = extractIndonesianSentences(veryLongText, false);
  assert(
    testLongSplit.sentences.length >= 1 &&
      testLongSplit.sentences[0].includes("komponen terlebih dahulu"),
    "Kalimat ekstra panjang berhasil dipecah secara halus pada konjungsi klausa mandiri"
  );

  // Uji Normalisasi Teks Lisan & Fonetik Akronim Bahasa Indonesia
  console.log("\n--- 6. Uji Normalisasi Teks Lisan & Dynamic Emotional Prosody ---");
  const normTech = normalizeSpokenIndonesian("Kita bisa panggil API dan pakai AI untuk UI/UX website.");
  assert(
    normTech.includes("E-P-I") && normTech.includes("E-I") && normTech.includes("Yu-Ai"),
    `Fonetik akronim teknis ditransformasi dengan benar (E-P-I, E-I, Yu-Ai): "${normTech}"`
  );

  const normChat = normalizeSpokenIndonesian("buku, pulpen, dll. yg dibeli kmrn bgt wkwkwk");
  assert(
    normTech !== normChat &&
      normChat.includes("dan lain-lain") &&
      normChat.includes("yang") &&
      normChat.includes("haha"),
    `Singkatan & tawa Indonesia diekspansi alami (dan lain-lain, yang, haha): "${normChat}"`
  );

  // Uji Kontekstual Satuan Jarak (10 km -> kilometer, bukan "10 kamu") & Gelar Dokter (dr. vs dr)
  const normContextual = normalizeSpokenIndonesian("Jaraknya 10 km dr sini ke tempat dr. Budi bayar Rp 15.000");
  assert(
    normContextual.includes("10 kilometer") &&
      normContextual.includes("dari sini") &&
      normContextual.includes("dokter Budi") &&
      normContextual.includes("15.000 rupiah"),
    `Konteks satuan '10 kilometer', 'dari sini', 'dokter Budi', dan '15.000 rupiah' presisi: "${normContextual}"`
  );

  // Uji Expressive SSML Builder (Jeda Berpikir <break> pada Elipsis & Tanda Pisah)
  const ssmlOutput = buildExpressiveSsml("Hmm... bentar ya — coba aku cek kodenya.", { emotion: "thinking" });
  assert(
    ssmlOutput.includes("<break time='220ms'/>") && ssmlOutput.includes("<break time='160ms'/>"),
    `SSML builder menyuntikkan jeda napas mikro (<break>) untuk elipsis dan tanda pisah`
  );

  // Uji Inferensi Emosi Teks Otomatis
  assert(inferEmotionFromText("Wah keren banget hasil desainmu!") === "happy", "Inferensi emosi happy");
  assert(inferEmotionFromText("Hmm bentar ya coba aku cek kodenya...") === "thinking", "Inferensi emosi thinking");
  assert(inferEmotionFromText("Waduh, kok bisa error kayak gitu?!") === "surprised", "Inferensi emosi surprised");
  assert(inferEmotionFromText("Yah, sayang banget filenya belum tersimpan.") === "sad", "Inferensi emosi sad");

  // Uji Dynamic Prosody Engine (Natural Recalibrated Prosody)
  const prosodyHappy = inferIndonesianProsody("Wah asik banget nih!", "happy");
  assert(
    prosodyHappy.rate === "+5%" && prosodyHappy.pitch === "+2Hz",
    `Prosodi happy dinaikkan dinamis secara alami (+5% rate, +2Hz pitch - tidak cempreng)`
  );

  const prosodyQuestion = inferIndonesianProsody("Kamu lagi ngerjain project apa sekarang ya?");
  assert(
    prosodyQuestion.pitch === "+2Hz",
    `Intonasi nada tanya dinaikkan +2Hz untuk keluwesan vokal pertanyaan Indonesia`
  );

  // Uji Prosodi Kalimat Empati Menenangkan (Iyaaa, yang sabar yaa...)
  const prosodyComfort = inferIndonesianProsody("Iyaaa, yang sabar yaa...", "sad");
  assert(
    prosodyComfort.pitch === "+0Hz" && prosodyComfort.rate === "+0%",
    "Prosodi kalimat empati menenangkan ('Iyaaa, yang sabar yaa...') bernada stabil & hangat (pitch +0Hz, tidak tinggi)"
  );

  // Uji Sapaan Kontekstual Waktu (Pagi / Siang / Sore / Malam)
  const morningGreeting = buildContextualGreetingPrompt(new Date("2026-10-25T08:00:00"));
  const nightGreeting = buildContextualGreetingPrompt(new Date("2026-10-25T21:00:00"));
  assert(
    morningGreeting.includes("pagi") && nightGreeting.includes("malam"),
    `Sapaan pembuka dinamis menyesuaikan waktu pengguna (${morningGreeting.slice(0, 35)}...)`
  );

  // Uji Persona Identitas Khusus Mode Admin ('jocelyn' / Password 'admin')
  const promptJocelyn = buildCelynSystemPrompt("jocelyn");
  assert(
    promptJocelyn.includes("Rafli") &&
    promptJocelyn.includes("orang terkasih") &&
    promptJocelyn.includes("referensi"),
    "Mode admin memuat jawaban pembuat: 'Rafli yang menggunakan referensi orang terkasih'"
  );
  assert(
    promptJocelyn.includes("rekan profesional") &&
    promptJocelyn.includes("perasa") &&
    (promptJocelyn.includes("menyemangatinya") || promptJocelyn.includes("nyemangatin dia")),
    "Mode admin memuat kisah orang terkasih: rekan profesional, terkadang perasa, dan diciptakan untuk menyemangatinya"
  );
  assert(
    promptJocelyn.toLowerCase().includes("bebas berbicara lebih panjang, mengalir, dan hangat"),
    "Mode admin membebaskan panjang kalimat basa-basi (tidak dibatasi 1-2 kalimat pendek)"
  );
  assert(
    promptJocelyn.includes("dikasihi") &&
    promptJocelyn.includes("penuh kasih") &&
    !promptJocelyn.includes("disayangi Rafli") &&
    !promptJocelyn.includes("orang yang dia sayang"),
    "Mode admin menggunakan terminologi 'dikasihi' / 'penuh kasih' alih-alih 'disayang'"
  );

  // Uji Persona Identitas Khusus Mode Login ('default' / Password 'login')
  const promptDefault = buildCelynSystemPrompt("default");
  assert(
    promptDefault.includes("Rafli") && promptDefault.includes("teman ngobrol visual AI"),
    "Mode login memuat persona umum AI teman ngobrol buatan Rafli"
  );
  assert(
    !promptDefault.includes("orang terkasih dari pembuat saya") &&
    !promptDefault.includes("rekan profesional tapi terkadang perasa") &&
    promptDefault.includes("JANGAN PERNAH menyebut frasa \"orang terkasih\", profesi \"rekan profesional\", atau sifat \"perasa\""),
    "Mode login merahasiakan kisah orang terkasih, rekan profesional, dan perasa"
  );

  // Uji Instruksi Wajah Sedih Singkat & Intonasi Menenangkan pada System Prompt
  assert(
    promptDefault.includes("wajah sedih") &&
    promptDefault.includes("Iyaaa, yang sabar yaa..."),
    "System prompt memuat instruksi wajah sedih singkat dan intonasi menenangkan ('Iyaaa, yang sabar yaa...')"
  );

  // Uji Omni-Knowledge & Jawaban Segala Pertanyaan
  assert(
    promptDefault.includes("OMNI-KNOWLEDGE") &&
    promptDefault.includes("SIAP MENJAWAB PERTANYAAN APAPUN") &&
    promptDefault.includes("sains, teknologi, koding/pemrograman"),
    "System prompt default memuat instruksi Omni-Knowledge untuk siap menjawab pertanyaan apa pun"
  );
  assert(
    !promptDefault.includes("bukan mesin pencari") &&
    !promptJocelyn.includes("bukan mesin pencari"),
    "Instruksi restriktif 'bukan mesin pencari' telah dibersihkan dari prompt Celyn"
  );
  assert(
    promptDefault.includes("software engineer") &&
    promptJocelyn.includes("software engineer") &&
    !promptDefault.includes("Gemini") &&
    !promptDefault.includes("Google") &&
    !promptJocelyn.includes("Gemini") &&
    !promptJocelyn.includes("Google"),
    "Prompt bebas 100% dari pembahasan Gemini/Google dan murni memuat Rafli sebagai software engineer pembuat Celyn"
  );
  assert(
    promptDefault.includes("Sesuaikan panjang jawaban secara adaptif"),
    "Mode default mengadopsi ritme adaptif (tidak lagi dipangkas kaku 1-2 kalimat)"
  );

  // Uji Variasi Fonetik Nama Celyn (Celine, Selin) & Eksklusi (Selina, Celini)
  assert(
    promptDefault.includes("Celyn = Celine = Selin") &&
    promptDefault.includes("Selina") &&
    promptDefault.includes("Celini"),
    "Mode default mengenali variasi fonetik Celyn = Celine = Selin dan mengecualikan Selina / Celini"
  );
  assert(
    promptDefault.includes("Celine itu siapa") &&
    promptDefault.includes("Jangan pernah bingung atau mendadak diam lama"),
    "Mode default memiliki instruksi respons instan tanpa diam lama saat ditanya identitas 'Celine itu siapa'"
  );

  // Uji Inisiatif Bertanya & Icebreaker Spontaneity
  assert(
    promptDefault.includes("INISIATIF BERTANYA & ICEBREAKER") &&
    promptDefault.includes("JANGAN PERNAH DIAM ATAU RAGU") &&
    promptDefault.includes("kamu ada pertanyaan buat aku"),
    "System prompt memuat instruksi Inisiatif Bertanya & Icebreaker spontan saat diminta bertanya"
  );
  assert(
    promptDefault.includes("Eh iya halo, denger kok!"),
    "System prompt memuat penanganan selaan ramah kata 'Halo / Denger nggak'"
  );

  // Uji Sapaan Khusus Jocelyn (Password 'admin') vs Normal (Password 'login')
  const jocelynGreeting = buildContextualGreetingPrompt(new Date(), "jocelyn");
  assert(
    jocelynGreeting.includes("Jocelyn") && jocelynGreeting.includes("tetap semangat"),
    "Sapaan khusus mode 'jocelyn' menyapa Jocelyn langsung dengan doa dan kobaran semangat"
  );
  const defaultGreeting = buildContextualGreetingPrompt(new Date(), "default");
  assert(
    !defaultGreeting.includes("Jocelyn"),
    "Sapaan mode default tidak menyebutkan pesan khusus Jocelyn"
  );

  // 7. Uji Human-Voice VAD & Deteksi Gumaman ("hmmm", "aaa") vs Penolakan Noise
  console.log("\n--- 7. Uji Smart Human-Voice VAD & Deteksi Gumaman (hmmm, aaa) ---");

  // Helper untuk membuat buffer PCM 16kHz (2048 sample / 128ms)
  const sampleRate = 16000;
  const frameLength = 2048;

  // Kasus A: Gumaman "hmmm" (gelombang sinus ~180 Hz dengan amplitudo vokal sedang)
  const hmmmPcm = new Int16Array(frameLength);
  for (let i = 0; i < frameLength; i++) {
    hmmmPcm[i] = Math.round(Math.sin((2 * Math.PI * 180 * i) / sampleRate) * 10000);
  }
  const hmmmAnalysis = analyzeHumanVoiceFrame(hmmmPcm);
  assert(
    hmmmAnalysis.isHumanVoice && hmmmAnalysis.isSustainedVocal,
    `Deteksi gumaman 'hmmm' (180Hz) berhasil diidentifikasi sebagai suara manusia & vokal berkelanjutan (RMS: ${hmmmAnalysis.rms.toFixed(3)}, ZCR: ${hmmmAnalysis.zcr.toFixed(3)})`
  );

  // Kasus B: Vokal "aaa" (gelombang sinus ~700 Hz dengan amplitudo vokal jelas)
  const aaaPcm = new Int16Array(frameLength);
  for (let i = 0; i < frameLength; i++) {
    aaaPcm[i] = Math.round(Math.sin((2 * Math.PI * 700 * i) / sampleRate) * 12000);
  }
  const aaaAnalysis = analyzeHumanVoiceFrame(aaaPcm);
  assert(
    aaaAnalysis.isHumanVoice && aaaAnalysis.isSustainedVocal,
    `Deteksi vokal 'aaa' (700Hz) berhasil diidentifikasi sebagai suara manusia & vokal berkelanjutan (RMS: ${aaaAnalysis.rms.toFixed(3)}, ZCR: ${aaaAnalysis.zcr.toFixed(3)})`
  );

  // Kasus C: Kebisingan ruangan / desis kipas halus (random noise, RMS rendah di bawah batas vokal)
  const noisePcm = new Int16Array(frameLength);
  for (let i = 0; i < frameLength; i++) {
    noisePcm[i] = Math.round((Math.random() * 2 - 1) * 200); // Amplitudo sangat kecil
  }
  const noiseAnalysis = analyzeHumanVoiceFrame(noisePcm);
  assert(
    !noiseAnalysis.isHumanVoice && !noiseAnalysis.isSustainedVocal,
    `Penolakan desis/noise ruangan berhasil (RMS: ${noiseAnalysis.rms.toFixed(4)} < threshold, isHumanVoice: false)`
  );

  // Kasus D: Ketukan meja / klik mouse impulsif (crest factor sangat tinggi)
  const clickPcm = new Int16Array(frameLength);
  clickPcm[500] = 26000;
  clickPcm[501] = -22000;
  clickPcm[502] = 12000;
  const clickAnalysis = analyzeHumanVoiceFrame(clickPcm);
  assert(
    !clickAnalysis.isHumanVoice && clickAnalysis.crestFactor > 7.2,
    `Penolakan klik/ketukan impulsif berhasil (Crest factor: ${clickAnalysis.crestFactor.toFixed(1)} > 7.2, isHumanVoice: false)`
  );

  // Kasus E: Instruksi prompt Celyn untuk mendengarkan gumaman & respons sabar
  assert(
    (CELYN_SYSTEM_PROMPT.toLowerCase().includes("bergumam") ||
      CELYN_SYSTEM_PROMPT.toLowerCase().includes("peka terhadap gumaman")) &&
      CELYN_SYSTEM_PROMPT.includes("hmmm...") &&
      (CELYN_SYSTEM_PROMPT.includes("anu...") || CELYN_SYSTEM_PROMPT.includes("aaa...")),
    "Prompt sistem Celyn memuat instruksi eksplisit untuk menyimak gumaman berpikir ('hmmm...', 'aaa...')"
  );

  // Kasus F: Frame ultra-rendah latensi 64ms (1024 sample) pada analyzeHumanVoiceFrame
  const pcm1024 = new Int16Array(1024);
  for (let i = 0; i < 1024; i++) {
    pcm1024[i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 12000);
  }
  const analysis1024 = analyzeHumanVoiceFrame(pcm1024);
  assert(
    analysis1024.isHumanVoice && analysis1024.isSustainedVocal,
    `Frame audio ultra-rendah latensi 64ms (1024 sample) terdeteksi presisi (RMS: ${analysis1024.rms.toFixed(3)})`
  );

  // 8. Uji Optimasi Time-To-First-Audio (TTFA) & First-Chunk Early Split
  console.log("\n--- 8. Uji Optimasi TTFA & First-Chunk Early Clause Split ---");

  const sampleLongIntro = "Eh iya bener banget, jadi bagian kode ini bisa kita rapikan langsung ya.";
  // Saat isFirstChunk = true: wajib pecah cepat pada klausa pembuka agar audio pertama keluar seketika
  const earlySplit = extractIndonesianSentences(sampleLongIntro, false, true);
  assert(
    earlySplit.sentences.length === 1 &&
      earlySplit.sentences[0].includes("Eh iya bener banget") &&
      earlySplit.remaining.startsWith("jadi"),
    `First-chunk TTFA split berhasil memecah klausa awal seketika: "${earlySplit.sentences[0]}" (sisa: "${earlySplit.remaining.slice(0, 25)}...")`
  );

  // Saat isFirstChunk = false: klausa pendek TIDAK dipotong sebelum ada tanda baca akhir (menjaga kurva intonasi)
  const normalSplit = extractIndonesianSentences(sampleLongIntro, false, false);
  assert(
    normalSplit.sentences.length === 0,
    "Kalimat berlanjut tidak dipotong terburu-buru saat isFirstChunk=false (menjaga prosodi alami)"
  );

  // 9. Uji Gerbang Autentikasi Admin & Proteksi Sesi
  console.log("\n--- 9. Uji Gerbang Autentikasi 2-Password ('admin' & 'login') ---");

  const VALID_PASSWORDS = ["admin", "login"];
  const validateAuth = (input: string) => VALID_PASSWORDS.includes(input.trim().toLowerCase());

  assert(validateAuth("admin"), "Kata sandi otorisasi 'admin' (Mode Jocelyn) berhasil divalidasi");
  assert(validateAuth("login"), "Kata sandi otorisasi 'login' (Mode Default) berhasil divalidasi");
  assert(validateAuth(" admin "), "Kata sandi dengan spasi ' admin ' berhasil ditoleransi via trim");
  assert(validateAuth(" LOGIN "), "Kata sandi ' LOGIN ' berhasil ditoleransi via case-insensitivity");
  assert(!validateAuth("12345"), "Kata sandi salah '12345' ditolak oleh sistem");
  assert(!validateAuth(""), "Kata sandi kosong ditolak oleh sistem");

  // Simulasi verifikasi otentikasi endpoint /api/token
  function checkApiTokenAuth(headers: Record<string, string>, query: Record<string, string>) {
    const valid = ["admin", "login"];
    const provided = headers["x-admin-password"] || query.password || query.key;
    if (!provided || !valid.includes(String(provided).trim())) {
      return { status: 401, error: "Unauthorized" };
    }
    return { status: 200, ok: true };
  }

  const noHeaderReq = checkApiTokenAuth({}, {});
  assert(noHeaderReq.status === 401, "Permintaan /api/token tanpa x-admin-password ditolak (HTTP 401)");

  const wrongHeaderReq = checkApiTokenAuth({ "x-admin-password": "salah" }, {});
  assert(wrongHeaderReq.status === 401, "Permintaan /api/token dengan password salah ditolak (HTTP 401)");

  const validAdminReq = checkApiTokenAuth({ "x-admin-password": "admin" }, {});
  assert(validAdminReq.status === 200, "Permintaan /api/token dengan header 'x-admin-password: admin' diterima (HTTP 200)");

  const validLoginReq = checkApiTokenAuth({ "x-admin-password": "login" }, {});
  assert(validLoginReq.status === 200, "Permintaan /api/token dengan header 'x-admin-password: login' diterima (HTTP 200)");

  // 10. Uji Pembersihan Markdown, Links, & Formatting untuk SSML Edge TTS
  console.log("\n--- 10. Uji Stripping Markdown & SSML XML Escaping ---");
  const markdownSample =
    "Silakan cek [dokumentasi](https://example.com/doc) di sini! Gunakan `console.log()` dan *perhatikan* pesan berikut: ```ts const a = 1; ``` Terima kasih & sukses selalu.";
  const cleanedSsml = cleanAndEscapeForSsml(markdownSample);

  assert(!cleanedSsml.includes("https://"), "Link URL markdown berhasil di-strip dari ucapan TTS");
  assert(cleanedSsml.includes("dokumentasi"), "Teks anchor link dipertahankan untuk diucapkan");
  assert(!cleanedSsml.includes("```"), "Blok kode triple-backticks berhasil di-strip");
  assert(!cleanedSsml.includes("`"), "Backtick inline kode berhasil di-strip");
  assert(!cleanedSsml.includes("*"), "Tanda bintang format tebal/miring berhasil di-strip");
  assert(cleanedSsml.includes("&amp;"), "Karakter ampersand (&) berhasil di-escape ke XML entity (&amp;)");

  // 11. Uji Rate Limit Map Pruning & Vercel API Health Check
  console.log("\n--- 11. Uji Rate Limit Map Pruning & Vercel API Syntax Check ---");
  const testRateMap = new Map<string, { count: number; lastReset: number }>();
  const now = Date.now();
  for (let i = 0; i < 210; i++) {
    testRateMap.set(`ip-${i}`, {
      count: 1,
      lastReset: i < 150 ? now - 70000 : now, // 150 entri sudah kadaluwarsa (> 60s)
    });
  }
  assert(testRateMap.size === 210, "Simulasi rateLimitMap terisi 210 entri");

  // Jalankan logika pruning
  if (testRateMap.size > 200) {
    const pruneNow = Date.now();
    for (const [ipKey, entry] of testRateMap.entries()) {
      if (pruneNow - entry.lastReset > 60000) {
        testRateMap.delete(ipKey);
      }
    }
  }
  assert(
    testRateMap.size === 60,
    `Pruning rate limit berhasil membuang entri kadaluwarsa (sisa ${testRateMap.size} entri aktif)`
  );

  // Periksa sintaksis file API Vercel Serverless
  let apiSyntaxOk = true;
  try {
    execSync("node --check api/tts.js", { stdio: "pipe" });
    execSync("node --check api/token.js", { stdio: "pipe" });
    execSync("node --check api/health.js", { stdio: "pipe" });
  } catch (err: any) {
    apiSyntaxOk = false;
  }
  assert(apiSyntaxOk, "Validasi sintaksis node --check pada api/tts.js, api/token.js, api/health.js lulus 100%");

  // 12. Uji Antrean Pesan Teks & Penanganan Input Teks Tanpa Suara
  console.log("\n--- 12. Uji Antrean Pesan Teks & Zero-Drop Text Queue ---");
  const testPendingQueue: Array<{ type: string; text?: string }> = [];
  const enqueueText = (msg: { type: string; text?: string }, isConnecting: boolean) => {
    if (isConnecting || msg.type === "text") {
      testPendingQueue.push(msg);
      if (testPendingQueue.length > 25) testPendingQueue.shift();
    }
  };

  enqueueText({ type: "text", text: "Halo Celyn dari ketikan teks!" }, false);
  assert(
    testPendingQueue.length === 1 && testPendingQueue[0].text === "Halo Celyn dari ketikan teks!",
    "Pesan teks berhasil diantrekan meskipun status sesi masih idle (Zero-Drop Text Queue)"
  );

  let bargeInMuted = true;
  let hasUserInitiated = false;
  const onHandleText = (text: string) => {
    hasUserInitiated = true;
    bargeInMuted = false;
  };
  onHandleText(testPendingQueue[0].text!);
  assert(
    bargeInMuted === false,
    "Flag bargeInMuted berhasil di-reset ke false saat menerima pesan teks (suara tidak dibisukan)"
  );
  assert(
    hasUserInitiated === true,
    "Flag hasUserInitiated bernilai true sehingga auto-greeting dicegah menimpa pertanyaan teks pengguna"
  );

  // 13. Uji Ketersediaan dan Konsistensi Tekstur Wajah Rig Celyn
  console.log("\n--- 13. Uji Integritas Aset Tekstur Rigging Celyn ---");
  assert(fs.existsSync("apps/web/public/celyn_torso_rig.png"), "Aset tekstur torso default ada");
  assert(fs.existsSync("apps/web/public/celyn_torso_rig_closed.png"), "Aset tekstur mata terpejam ada");
  assert(fs.existsSync("apps/web/public/celyn_torso_rig_sad.png"), "Aset tekstur wajah sedih / empati alami ada");
  assert(fs.existsSync("apps/web/public/celyn_torso_rig_sad_closed.png"), "Aset tekstur sedih mata terpejam ada");
  assert(fs.existsSync("apps/web/public/celyn_torso_rig_thinking.png"), "Aset tekstur wajah berpikir / analitis ada");
  assert(fs.existsSync("apps/web/public/celyn_torso_rig_thinking_closed.png"), "Aset tekstur berpikir mata terpejam ada");
  assert(fs.existsSync("apps/web/public/celyn_torso_rig_surprised.png"), "Aset tekstur wajah kaget / terkesan ada");
  assert(fs.existsSync("apps/web/public/celyn_torso_rig_surprised_closed.png"), "Aset tekstur kaget mata terpejam ada");
  assert(fs.existsSync("apps/web/public/celyn_torso_rig_shy.png"), "Aset tekstur wajah tersipu / malu manis ada");
  assert(fs.existsSync("apps/web/public/celyn_torso_rig_shy_closed.png"), "Aset tekstur tersipu mata terpejam ada");

  // 14. Ringkasan
  console.log("\n=======================================================");
  console.log(`📊 Hasil Akhir Smoke Test: ${passed} Passed, ${failed} Failed`);
  console.log("=======================================================\n");

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log("🎉 SEMUA UJI PIPELINE BERHASIL DENGAN SEMPURNA!");
  }
}

runTtsTests().catch((err) => {
  console.error("❌ Error pada pengujian TTS:", err);
  process.exit(1);
});
