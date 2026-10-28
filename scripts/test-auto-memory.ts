import dotenv from "dotenv";
dotenv.config();

import { memoryService } from "../apps/server/src/services/MemoryService";
import { createClient } from "@libsql/client";

async function main() {
  console.log("=============================================================");
  console.log("🧪 TESTING AUTONOMOUS MEMORY INGESTION (ZERO-MANUAL INPUT)");
  console.log("=============================================================\n");

  await memoryService.initSchema();

  const testSessionId = `test_auto_session_${Date.now()}`;

  // 1. Simulasi ucapan pengguna tentang preferensi makanan baru
  const userSpeech1 = "Eh Celyn, aku suka makan sate kambing muda bumbu kecap lho";
  console.log(`1. Mengirim ucapan pengguna: "${userSpeech1}"`);
  await memoryService.recordTurn(testSessionId, "user", userSpeech1);

  // Beri jeda kecil agar operasi async asinkron selesai
  await new Promise((r) => setTimeout(r, 1000));

  // 2. Verifikasi ke database Turso
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });

  const checkSate = await db.execute({
    sql: "SELECT * FROM user_profile WHERE category = 'preferensi' AND fact LIKE '%sate kambing%' LIMIT 1",
    args: [],
  });

  console.log("\nHasil kueri sate kambing di Turso:");
  console.table(checkSate.rows);
  if (checkSate.rows.length > 0) {
    console.log("✅ SUCCESS: Preferensi sate kambing berhasil diekstrak dan tersimpan otomatis tanpa input manual!");
    // Bersihkan baris uji agar tidak mengotori profil asli
    await db.execute({
      sql: "DELETE FROM user_profile WHERE id = ?",
      args: [checkSate.rows[0].id],
    });
    console.log("🧹 Baris uji berhasil dibersihkan kembali.");
  } else {
    console.error("❌ FAILED: Preferensi sate kambing tidak ditemukan di user_profile!");
    process.exit(1);
  }

  // 3. Verifikasi profil eksisting (Americano Dingin Rafli & Celyn)
  console.log("\n=== STATUS PREFERENSI KOPI RAFLI & CELYN DI TURSO ===");
  const coffeeRows = await db.execute({
    sql: "SELECT id, category, fact, importance, updated_at FROM user_profile WHERE category = 'preferensi' AND fact LIKE '%americano%'",
    args: [],
  });
  console.table(coffeeRows.rows);

  console.log("\n🎉 SELURUH PENGUJIAN OTOMATISASI MEMORI BERHASIL DENGAN SEMPURNA!");
}

main().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
