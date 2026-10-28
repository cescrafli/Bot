import dotenv from "dotenv";
dotenv.config();

import { createClient } from "@libsql/client";
import { memoryService } from "../apps/server/src/services/MemoryService";
import { buildCelynSystemPrompt } from "../packages/shared/src/avatar";

async function main() {
  console.log("=================================================");
  console.log("🔍 AI ENGINEER DEEP AUDIT: MEMORY SYSTEM PIPELINE");
  console.log("=================================================\n");

  const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });

  // 1. Audit Database Schema & Rows
  console.log("--- 1. DATABASE AUDIT (TURSO CLOUD) ---");
  const tables = ["user_profile", "session_summaries", "creator_private_story", "chat_logs"];
  for (const table of tables) {
    try {
      const countRes = await db.execute(`SELECT COUNT(*) as count FROM ${table}`);
      console.log(`Table '${table}': ${countRes.rows[0].count} rows`);
    } catch (e: any) {
      console.log(`Table '${table}': ERROR (${e.message})`);
    }
  }

  console.log("\n[user_profile records]:");
  const up = await db.execute("SELECT * FROM user_profile ORDER BY importance DESC, updated_at DESC");
  console.table(up.rows);

  console.log("\n[creator_private_story records]:");
  const cps = await db.execute("SELECT id, length(content) as char_len, updated_at FROM creator_private_story ORDER BY id ASC");
  console.table(cps.rows);

  // 2. Audit Server-Side Retrieval & Formatting
  console.log("\n--- 2. RETRIEVAL & FORMATTING AUDIT (MemoryService.ts) ---");
  const serverBlock = await memoryService.getMemoryPromptBlock();
  console.log("Memory Block length:", serverBlock.length, "characters");
  console.log("Contains 'americano dingin'?", serverBlock.includes("americano dingin"));
  console.log("Contains 'kopi'?", serverBlock.toLowerCase().includes("kopi"));
  console.log("Contains 'kesukaan' or 'favorit' for coffee?", 
    serverBlock.toLowerCase().includes("kopi kesukaan") || 
    serverBlock.toLowerCase().includes("kopi favorit")
  );

  // 3. Audit System Prompt Construction
  console.log("\n--- 3. SYSTEM PROMPT COMPOSITION AUDIT (avatar.ts) ---");
  const fullPromptAdmin = buildCelynSystemPrompt("jocelyn", serverBlock);
  const fullPromptDefault = buildCelynSystemPrompt("default", serverBlock);

  console.log("Admin Prompt total length:", fullPromptAdmin.length, "characters");
  console.log("Default Prompt total length:", fullPromptDefault.length, "characters");
  console.log("Is memoryContext present in Admin Prompt?", fullPromptAdmin.includes(serverBlock));
  console.log("Is memoryContext present in Default Prompt?", fullPromptDefault.includes("americano dingin"));

  // Check keyword distances and semantic anchors
  console.log("\n--- 4. LLM SEMANTIC ANCHORS & CONFLICT ANALYSIS ---");
  const hasCautionRule = fullPromptAdmin.includes("bilang saja dengan santai dan jangan mengarang");
  console.log("Has general caution rule ('jangan mengarang'):", hasCautionRule);
  const hasDirectPreferenceRule = 
    fullPromptAdmin.includes("WAJIB LANGSUNG MENJAWAB") &&
    fullPromptAdmin.includes("WAJIB MENJAWAB PREFERENSI");
  console.log("Has direct preference answering mandate:", hasDirectPreferenceRule);
  const hasKopiRecall = 
    fullPromptAdmin.includes("Kopi kesukaanmu kan americano dingin!") ||
    fullPromptAdmin.includes("Kamu kan suka minum americano dingin!");
  console.log("Has explicit coffee recall example in prompt:", hasKopiRecall);

  console.log("\nAudit script complete.");
}

main().catch(console.error);
