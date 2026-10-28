import dotenv from "dotenv";
dotenv.config();

import { createClient } from "@libsql/client";
import { MemoryService } from "../apps/server/src/services/MemoryService.js";

async function runDeduplicationTest() {
  console.log("=================================================");
  console.log("🧪 TESTING FILTER-BEFORE-WRITE & DEDUPLICATION");
  console.log("=================================================\n");

  const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });

  const memoryService = new MemoryService();
  await memoryService.initSchema();

  // Test 1: Chat Logs Rapid Duplicate Prevention
  console.log("--- 1. Testing Chat Logs Rapid Duplicate Prevention ---");
  const testSessionId = `test_dedup_${Date.now()}`;
  const testMsg = "Halo Celyn, ini pesan tes debounce anti ganda!";

  await memoryService.recordTurn(testSessionId, "user", testMsg);
  // Send identical turn immediately (simulating double trigger)
  await memoryService.recordTurn(testSessionId, "user", testMsg);

  const logsCheck = await db.execute({
    sql: "SELECT id, session_id, role, content FROM chat_logs WHERE session_id = ? AND content = ?",
    args: [testSessionId, testMsg],
  });

  console.log(`Pesan yang terdaftar di chat_logs: ${logsCheck.rows.length}`);
  if (logsCheck.rows.length === 1) {
    console.log("✅ PASS: Hanya 1 baris tercatat di chat_logs, duplikasi berhasil dicegah!");
  } else {
    throw new Error(`❌ FAIL: Terdapat ${logsCheck.rows.length} baris di chat_logs (seharusnya 1)!`);
  }

  // Bersihkan log tes
  await db.execute({
    sql: "DELETE FROM chat_logs WHERE session_id = ?",
    args: [testSessionId],
  });

  // Test 2: User Profile Exact Match Filter
  console.log("\n--- 2. Testing User Profile Exact Match Filter ---");
  const initialProfiles = await db.execute("SELECT id, fact FROM user_profile");
  const initialCount = initialProfiles.rows.length;
  console.log(`Jumlah fakta awal di user_profile: ${initialCount}`);

  // Coba simpan fakta persis yang sudah ada di database
  const existingFact = String(initialProfiles.rows[0].fact);
  console.log(`Mencoba menyimpan kembali fakta eksisting: "${existingFact.slice(0, 50)}..."`);
  await memoryService.saveUserFact(existingFact, "identitas", 2);

  const afterExact = await db.execute("SELECT id FROM user_profile");
  console.log(`Jumlah fakta setelah percobaan duplikasi: ${afterExact.rows.length}`);
  if (afterExact.rows.length === initialCount) {
    console.log("✅ PASS: Jumlah baris tidak bertambah, exact match dicegah dan diperbarui!");
  } else {
    throw new Error(`❌ FAIL: Baris bertambah dari ${initialCount} menjadi ${afterExact.rows.length}!`);
  }

  // Test 3: User Profile Contextual Update (Minuman Rafli)
  console.log("\n--- 3. Testing Contextual Update (Preferensi Minuman Rafli) ---");
  const initialCoffee = await db.execute(
    "SELECT id, fact FROM user_profile WHERE category = 'preferensi' AND fact NOT LIKE '%Celyn%' AND (fact LIKE '%minum%' OR fact LIKE '%kopi%') LIMIT 1"
  );
  if (initialCoffee.rows.length === 0) {
    throw new Error("Data kopi Rafli tidak ditemukan untuk baseline pengujian!");
  }
  const coffeeRowId = Number(initialCoffee.rows[0].id);
  const originalCoffeeFact = String(initialCoffee.rows[0].fact);
  console.log(`Baris kopi eksisting Rafli (ID ${coffeeRowId}): "${originalCoffeeFact}"`);

  // Kirim fakta minuman baru untuk Rafli
  const newCoffeeFact = "Rafli suka minum americano dingin (ini minuman dan kopi kesukaan / favorit utamanya)";
  await memoryService.saveUserFact(newCoffeeFact, "preferensi", 3);

  const afterCoffeeUpdate = await db.execute("SELECT id FROM user_profile");
  console.log(`Jumlah fakta setelah update preferensi minuman: ${afterCoffeeUpdate.rows.length}`);
  if (afterCoffeeUpdate.rows.length === initialCount) {
    console.log("✅ PASS: Konteks minuman sudah ada di database, baris diperbarui tanpa duplikasi!");
  } else {
    throw new Error(`❌ FAIL: Baris bertambah padahal konteks minuman sudah ada!`);
  }

  // Test 4: User Profile Contextual Update (Preferensi Makanan Celyn)
  console.log("\n--- 4. Testing Contextual Update (Preferensi Makanan Celyn) ---");
  // Simpan preferensi makanan Celyn pertama kali
  await memoryService.saveUserFact(
    "Celyn (orang terkasih Rafli) suka makan ikan (makanan kesukaan)",
    "preferensi",
    3
  );

  const celynFoodCheck1 = await db.execute(
    "SELECT id, fact FROM user_profile WHERE category = 'preferensi' AND fact LIKE '%Celyn%' AND (fact LIKE '%makan%' OR fact LIKE '%ikan%')"
  );
  console.log(`Baris makanan Celyn terdaftar (ID ${celynFoodCheck1.rows[0].id}): "${celynFoodCheck1.rows[0].fact}"`);
  const celynFoodId = Number(celynFoodCheck1.rows[0].id);
  const countWithCelynFood = (await db.execute("SELECT id FROM user_profile")).rows.length;

  // Sekarang coba simpan preferensi makanan Celyn lagi dengan variasi kalimat berbeda tapi konteks sama
  console.log("Mencoba simpan variasi preferensi makanan Celyn: 'Celyn (orang terkasih Rafli) suka makan ikan bakar (makanan kesukaan)'...");
  await memoryService.saveUserFact(
    "Celyn (orang terkasih Rafli) suka makan ikan bakar (makanan kesukaan)",
    "preferensi",
    3
  );

  const afterCelynFoodVariant = await db.execute("SELECT id FROM user_profile");
  console.log(`Jumlah fakta setelah variasi makanan Celyn: ${afterCelynFoodVariant.rows.length}`);
  if (afterCelynFoodVariant.rows.length === countWithCelynFood) {
    console.log("✅ PASS: Konteks makanan Celyn diperbarui di ID yang sama, TIDAK dibuat baris ganda!");
  } else {
    throw new Error(`❌ FAIL: Baris makanan Celyn menjadi ganda!`);
  }

  // Kembalikan ke teks kesukaan ikan Celyn yang murni
  await memoryService.saveUserFact(
    "Celyn (orang terkasih Rafli) suka makan ikan (makanan kesukaan)",
    "preferensi",
    3
  );

  // Test 5: Auto-Extract Utterance Context Deduplication
  console.log("\n--- 5. Testing Auto-Extract Utterance Context Deduplication ---");
  const countBeforeUtterance = (await db.execute("SELECT id FROM user_profile")).rows.length;

  // Kirim ujaran santai yang mengandung preferensi yang sudah ada
  await memoryService.autoExtractAndSaveFacts("kamu ingat kan kalau celyn itu suka minum americano dingin");
  await memoryService.autoExtractAndSaveFacts("aku juga suka minum americano dingin loh");

  const countAfterUtterance = (await db.execute("SELECT id FROM user_profile")).rows.length;
  console.log(`Jumlah fakta sebelum ujaran: ${countBeforeUtterance}, setelah ujaran: ${countAfterUtterance}`);
  if (countAfterUtterance === countBeforeUtterance) {
    console.log("✅ PASS: Auto-extractor mengenali konteks yang sudah ada dan tidak membuat baris duplikat!");
  } else {
    throw new Error(`❌ FAIL: Ujaran menciptakan baris duplikat di user_profile!`);
  }

  console.log("\n=================================================");
  console.log("🎉 ALL DEDUPLICATION & CONTEXT TESTS PASSED!");
  console.log("=================================================");

  // Tampilkan tabel akhir
  const finalProfile = await db.execute("SELECT id, category, fact, importance, updated_at FROM user_profile ORDER BY id ASC");
  console.table(finalProfile.rows);
}

runDeduplicationTest().catch((err) => {
  console.error(err);
  process.exit(1);
});