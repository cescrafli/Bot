import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

// Load .env
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("❌ GEMINI_API_KEY belum diisi di file .env!");
  console.log("👉 Silakan isi GEMINI_API_KEY Anda di file .env lalu jalankan lagi:");
  console.log("   npx tsx scripts/test-poc-vision.ts");
  process.exit(1);
}

async function testGeminiVisionPoC() {
  console.log("🔍 [Fase 1 PoC] Menguji Vision Gemini dengan screenshot...");

  // Gunakan gambar avatar Celyn atau screenshot yang tersedia
  const imagePath = path.resolve(process.cwd(), "apps/web/public/celyn_avatar.png");
  if (!fs.existsSync(imagePath)) {
    console.error(`❌ Gambar tidak ditemukan di: ${imagePath}`);
    process.exit(1);
  }

  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString("base64");

  const prompt = "Deskripsikan secara detail karakter apa yang ada dalam gambar ini, ciri-ciri fisiknya, pakaian, dan ekspresinya dalam Bahasa Indonesia yang ramah.";

  const rawModel = process.env.TEXT_MODEL || process.env.GEMINI_MODEL || "gemini-3-flash-preview";
  // Model live hanya untuk sesi bidirectional WebSocket; untuk endpoint REST generateContent gunakan model teks vision
  const model = rawModel.includes("live") ? "gemini-3-flash-preview" : rawModel;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  console.log(`📡 Mengirim permintaan ke Gemini API (${model})...`);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: "image/png",
                  data: base64Image,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API Error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const answer = data.candidates?.[0]?.content?.parts?.[0]?.text;

    console.log("\n=======================================================");
    console.log("✅ Jawaban Sukses dari Gemini Vision (Bahasa Indonesia):");
    console.log("=======================================================\n");
    console.log(answer);
    console.log("\n=======================================================");
    console.log("🎯 PoC Fase 1 BERHASIL! Model mampu membaca visual & merespons dalam Bahasa Indonesia.");
  } catch (err: any) {
    console.error("❌ Gagal menguji Gemini Vision:", err.message);
  }
}

testGeminiVisionPoC();
