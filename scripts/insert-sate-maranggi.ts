import dotenv from "dotenv";
dotenv.config();

import { createClient } from "@libsql/client";

function getWibTimestamp() {
  try {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date()).replace("T", " ");
  } catch {
    const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
    return wib.toISOString().slice(0, 19).replace("T", " ");
  }
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url || !authToken) {
    throw new Error("TURSO_DATABASE_URL atau TURSO_AUTH_TOKEN belum diatur!");
  }

  const db = createClient({ url, authToken });
  const wibNow = getWibTimestamp();

  console.log("=== 1. CEK DATA EKSISTING DI USER_PROFILE ===");
  const before = await db.execute("SELECT id, category, fact, importance, updated_at FROM user_profile ORDER BY id ASC");
  console.table(before.rows);

  const targetFact = "Rafli suka makan sate maranggi (makanan kesukaan)";
  const category = "preferensi";
  const importance = 3;

  // Cek apakah preferensi makanan untuk Rafli sudah ada sebelumnya (misal nasi padang rendang / ikan dll)
  // Smart deduplication Level 2: domain preferensi makanan Rafli
  const foodCandidate = await db.execute(
    "SELECT id, fact FROM user_profile WHERE category = 'preferensi' AND fact NOT LIKE '%Celyn%' AND (fact LIKE '%makan%' OR fact LIKE '%makanan%') LIMIT 1"
  );

  if (foodCandidate.rows.length > 0) {
    const existingId = Number(foodCandidate.rows[0].id);
    console.log(`\nMenemukan preferensi makanan eksisting (ID ${existingId}: "${foodCandidate.rows[0].fact}").`);
    console.log(`Memperbarui baris tersebut ke fakta terbaru: "${targetFact}"`);
    await db.execute({
      sql: "UPDATE user_profile SET fact = ?, importance = ?, updated_at = ? WHERE id = ?",
      args: [targetFact, importance, wibNow, existingId],
    });
    console.log("✅ Berhasil di-UPDATE!");
  } else {
    console.log(`\nBelum ada preferensi makanan untuk Rafli. Melakukan INSERT: "${targetFact}"`);
    await db.execute({
      sql: "INSERT INTO user_profile (category, fact, importance, updated_at) VALUES (?, ?, ?, ?)",
      args: [category, targetFact, importance, wibNow],
    });
    console.log("✅ Berhasil di-INSERT!");
  }

  console.log("\n=== 2. HASIL AKHIR USER_PROFILE DI TURSO CLOUD ===");
  const after = await db.execute("SELECT id, category, fact, importance, updated_at FROM user_profile ORDER BY id ASC");
  console.table(after.rows);
}

main().catch(console.error);
