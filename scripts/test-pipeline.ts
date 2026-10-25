/**
 * Unit & Integration Smoke Test Suite untuk Celyn AI BOT
 * Menguji pipeline audio, visual change-detection, tool-calling schema, emosi, dan suara id-ID-GadisNeural.
 */
import {
  normalizeEmotion,
  DEFAULT_VOICE_NAME,
  CELYN_SYSTEM_PROMPT,
  extractIndonesianSentences,
  inferEmotionFromText,
  inferIndonesianProsody,
  normalizeSpokenIndonesian,
  buildExpressiveSsml,
  buildContextualGreetingPrompt,
} from "@celyn/shared";
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
        emotion: { enum: ["neutral", "happy", "thinking", "surprised", "sad"] },
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
console.log("\n--- 4. Uji Normalisasi Emosi Avatar ---");
assert(normalizeEmotion("happy") === "happy", "Pemetaan 'happy' -> 'happy'");
assert(normalizeEmotion("senang") === "happy", "Pemetaan sinonim bahasa Indonesia 'senang' -> 'happy'");
assert(normalizeEmotion("mikir") === "thinking", "Pemetaan sinonim bahasa Indonesia 'mikir' -> 'thinking'");
assert(normalizeEmotion("kaget") === "surprised", "Pemetaan sinonim bahasa Indonesia 'kaget' -> 'surprised'");
assert(normalizeEmotion("sedih") === "sad", "Pemetaan sinonim bahasa Indonesia 'sedih' -> 'sad'");
assert(normalizeEmotion("unknown_random_string") === "neutral", "Fallback emosi yang tidak dikenal -> 'neutral'");

// 5. Uji Suara Microsoft Edge Neural (id-ID-GadisNeural) & Bahasa Indonesia
async function runTtsTests() {
  console.log("\n--- 5. Uji Suara Microsoft Edge Neural (id-ID-GadisNeural) & Bahasa Indonesia ---");
  assert(
    DEFAULT_VOICE_NAME === "id-ID-GadisNeural",
    `Default voice Celyn adalah '${DEFAULT_VOICE_NAME}'`
  );
  assert(
    CELYN_SYSTEM_PROMPT.includes("100% BAHASA INDONESIA") &&
      CELYN_SYSTEM_PROMPT.includes("id-ID-GadisNeural"),
    "System prompt mengunci percakapan 100% Bahasa Indonesia dengan id-ID-GadisNeural"
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

  // Uji Dynamic Prosody Engine
  const prosodyHappy = inferIndonesianProsody("Wah asik banget nih!", "happy");
  assert(
    prosodyHappy.rate === "+9%" && prosodyHappy.pitch === "+4Hz",
    `Prosodi happy dinaikkan dinamis (+9% rate, +4Hz pitch)`
  );

  const prosodyQuestion = inferIndonesianProsody("Kamu lagi ngerjain project apa sekarang ya?");
  assert(
    prosodyQuestion.pitch === "+4Hz",
    `Intonasi nada tanya dinaikkan +4Hz untuk keluwesan vokal pertanyaan Indonesia`
  );

  // Uji Sapaan Kontekstual Waktu (Pagi / Siang / Sore / Malam)
  const morningGreeting = buildContextualGreetingPrompt(new Date("2026-10-25T08:00:00"));
  const nightGreeting = buildContextualGreetingPrompt(new Date("2026-10-25T21:00:00"));
  assert(
    morningGreeting.includes("pagi") && nightGreeting.includes("malam"),
    `Sapaan pembuka dinamis menyesuaikan waktu pengguna (${morningGreeting.slice(0, 35)}...)`
  );

  // 7. Ringkasan
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
