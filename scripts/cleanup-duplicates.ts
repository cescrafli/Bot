import dotenv from "dotenv";
dotenv.config();

import { createClient } from "@libsql/client";

async function main() {
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });

  console.log("=== 1. AUDITING CHAT_LOGS FOR DUPLICATES ===");
  const allLogs = await db.execute("SELECT id, session_id, role, content, created_at FROM chat_logs ORDER BY id ASC");
  console.log(`Total chat_logs: ${allLogs.rows.length}`);

  const seen = new Set<string>();
  const duplicateLogIds: number[] = [];

  for (const row of allLogs.rows) {
    const key = `${row.session_id}_${row.role}_${String(row.content).trim()}`;
    if (seen.has(key)) {
      duplicateLogIds.push(Number(row.id));
    } else {
      seen.add(key);
    }
  }

  console.log(`Found ${duplicateLogIds.length} duplicate rows in chat_logs:`, duplicateLogIds);
  if (duplicateLogIds.length > 0) {
    for (const id of duplicateLogIds) {
      await db.execute({ sql: "DELETE FROM chat_logs WHERE id = ?", args: [id] });
    }
    console.log("-> Cleaned duplicate rows from chat_logs!");
  }

  console.log("\n=== 2. AUDITING USER_PROFILE FOR DUPLICATES ===");
  // Normalisasi teks ID 3 & 5 ke canonical format
  await db.execute({
    sql: "UPDATE user_profile SET fact = 'Rafli suka minum americano dingin (ini minuman dan kopi kesukaan / favorit utamanya)' WHERE id = 3",
  });
  await db.execute({
    sql: "UPDATE user_profile SET fact = 'Celyn (orang terkasih Rafli) suka minum americano dingin (ini minuman dan kopi kesukaan / favorit utamanya)' WHERE id = 5",
  });

  const allProfile = await db.execute("SELECT id, category, fact, importance, updated_at FROM user_profile ORDER BY id ASC");
  console.table(allProfile.rows);

  const profileSeen = new Set<string>();
  const duplicateProfileIds: number[] = [];

  for (const row of allProfile.rows) {
    const key = String(row.fact).trim().toLowerCase();
    if (profileSeen.has(key)) {
      duplicateProfileIds.push(Number(row.id));
    } else {
      profileSeen.add(key);
    }
  }

  console.log(`Found ${duplicateProfileIds.length} duplicate rows in user_profile:`, duplicateProfileIds);
  if (duplicateProfileIds.length > 0) {
    for (const id of duplicateProfileIds) {
      await db.execute({ sql: "DELETE FROM user_profile WHERE id = ?", args: [id] });
    }
    console.log("-> Cleaned duplicate rows from user_profile!");
  }

  console.log("\n=== 3. FINAL STATE OF DATABASE ===");
  const remainingLogs = await db.execute("SELECT id, session_id, role, content, created_at FROM chat_logs ORDER BY id DESC LIMIT 15");
  console.table(remainingLogs.rows);

  const remainingProfile = await db.execute("SELECT id, category, fact, importance, updated_at FROM user_profile ORDER BY id DESC");
  console.table(remainingProfile.rows);
}

main().catch(console.error);
