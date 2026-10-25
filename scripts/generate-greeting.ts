import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { synthesizeEdgeTTS } from "../apps/server/src/edgeTts.js";
dotenv.config();

async function generateGreetingAudio() {
  console.log("🗣️ Menghasilkan audio sapaan Celyn dengan Microsoft Edge Neural (id-ID-GadisNeural)...");

  const greetingText =
    "Eh halo! Aku Celyn. Suaraku udah aktif nih, senang banget bisa ngobrol langsung sama kamu hari ini. Mau kita mulai dari mana?";

  const mp3Buffer = await synthesizeEdgeTTS(greetingText, {
    voice: "id-ID-GadisNeural",
  });

  const outMp3 = path.resolve(process.cwd(), "apps/web/public/celyn_test_greeting.mp3");
  const outWav = path.resolve(process.cwd(), "apps/web/public/celyn_test_greeting.wav");

  fs.writeFileSync(outMp3, mp3Buffer);
  // Simpan juga sebagai fallback wav (browser audio context dapat men-decode mp3 data apapun ekstensinya)
  fs.writeFileSync(outWav, mp3Buffer);

  console.log("✅ Berhasil menyimpan audio tes GadisNeural ke:");
  console.log("   -", outMp3, `(${mp3Buffer.length} bytes)`);
  console.log("   -", outWav, `(${mp3Buffer.length} bytes)`);
}

generateGreetingAudio().catch((err) => {
  console.error("❌ Gagal membuat audio sapaan:", err);
  process.exit(1);
});
