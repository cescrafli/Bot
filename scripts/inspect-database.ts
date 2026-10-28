import dotenv from "dotenv";
dotenv.config();

import { createClient } from "@libsql/client";

async function inspectDatabase() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url || !authToken) {
    console.error("❌ TURSO_DATABASE_URL atau TURSO_AUTH_TOKEN belum terpasang di .env");
    process.exit(1);
  }

  console.log("=================================================================");
  console.log("🔍 INSPEKSI DATABASE TURSO CLOUD - CELYN AI BOT");
  console.log(`🌐 Database: ${url}`);
  console.log("=================================================================\n");

  const db = createClient({ url, authToken });

  try {
    // 1. Profil Fakta Pengguna (user_profile)
    const profiles = await db.execute("SELECT id, category, fact, importance, updated_at FROM user_profile ORDER BY importance DESC, updated_at DESC");
    console.log(`📌 1. TABEL 'user_profile' (${profiles.rows.length} fakta tersimpan):`);
    if (profiles.rows.length === 0) {
      console.log("   (Belum ada fakta tersimpan)\n");
    } else {
      for (const row of profiles.rows) {
        console.log(`   • [ID: ${row.id}] [${row.category}] (Bintang: ${row.importance})`);
        console.log(`     "${row.fact}" (Update: ${row.updated_at})`);
      }
      console.log("");
    }

    // 2. Ringkasan Sesi Lampau (session_summaries)
    const summaries = await db.execute("SELECT id, session_id, summary, user_mood, key_topics, created_at FROM session_summaries ORDER BY id DESC LIMIT 5");
    console.log(`📝 2. TABEL 'session_summaries' (5 sesi terbaru):`);
    if (summaries.rows.length === 0) {
      console.log("   (Belum ada ringkasan sesi yang tersimpan)\n");
    } else {
      for (const row of summaries.rows) {
        console.log(`   • [Sesi: ${row.session_id}] [Mood: ${row.user_mood || "-"}] [Topik: ${row.key_topics || "-"}]`);
        console.log(`     Ringkasan: "${row.summary}"`);
        console.log(`     Waktu: ${row.created_at}`);
      }
      console.log("");
    }

    // 3. Log Pesan Giliran (chat_logs)
    const logs = await db.execute("SELECT id, session_id, role, content, created_at FROM chat_logs ORDER BY id DESC LIMIT 8");
    console.log(`💬 3. TABEL 'chat_logs' (8 pesan obrolan admin terakhir):`);
    if (logs.rows.length === 0) {
      console.log("   (Belum ada riwayat pesan)\n");
    } else {
      for (const row of logs.rows) {
        const roleIcon = row.role === "user" ? "👤 [Pengguna]" : "🤖 [Celyn]";
        console.log(`   • [${row.created_at}] ${roleIcon}: "${row.content}"`);
      }
      console.log("");
    }

    // 4. Kisah Privat Terisolasi (creator_private_story)
    try {
      const stories = await db.execute("SELECT id, story_key, title, length(content) as content_len, updated_at FROM creator_private_story ORDER BY id ASC");
      console.log(`🔒 4. TABEL 'creator_private_story' (${stories.rows.length} entri privat terenkripsi/terisolasi di Cloud):`);
      if (stories.rows.length === 0) {
        console.log("   (Belum ada entri kisah privat)\n");
      } else {
        for (const row of stories.rows) {
          console.log(`   • [ID: ${row.id}] [Key: ${row.story_key}] "${row.title}" (${row.content_len} chars) - Update: ${row.updated_at}`);
        }
        console.log("");
      }
    } catch (e: any) {
      console.log("   (Tabel creator_private_story belum diinisialisasi)");
    }

    console.log("=================================================================");
    console.log("✅ Inspeksi selesai! Data Turso Cloud berhasil dibaca.");
    console.log("=================================================================");
  } catch (err: any) {
    console.error("❌ Gagal membaca Turso Cloud Database:", err?.message || err);
  }
}

inspectDatabase();
