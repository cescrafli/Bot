import dotenv from "dotenv";
dotenv.config();

import { createClient } from "@libsql/client";

async function main() {
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });

  console.log("=== CHECK USER PROFILE FOR 'IKAN' ===");
  const up = await db.execute("SELECT * FROM user_profile ORDER BY id DESC");
  console.table(up.rows);

  console.log("\n=== CHECK CHAT LOGS FOR 'IKAN' OR RECENT ACTIVITY ===");
  const cl = await db.execute("SELECT * FROM chat_logs ORDER BY id DESC LIMIT 15");
  console.table(cl.rows);
}

main().catch(console.error);
