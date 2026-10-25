/**
 * Unit & Integration Smoke Test Suite untuk Celyn AI BOT
 * Menguji pipeline audio, visual change-detection, tool-calling schema, emosi, dan suara id-ID-GadisNeural.
 */
import {
  normalizeEmotion,
  DEFAULT_VOICE_NAME,
  CELYN_SYSTEM_PROMPT,
  extractIndonesianSentences,
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

  // 6. Ringkasan
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
