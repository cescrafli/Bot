import dotenv from "dotenv";
dotenv.config();

import { createClient, Client } from "@libsql/client";
import { GoogleGenAI } from "@google/genai";
import { getWibTimestamp, extractFactsFromUtterance } from "@celyn/shared";

export interface UserFact {
  id?: number;
  category: string;
  fact: string;
  importance: number;
}

export interface SessionSummary {
  id?: number;
  sessionId: string;
  summary: string;
  userMood?: string;
  keyTopics?: string;
  createdAt?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export class MemoryService {
  private client: Client | null = null;
  private sessionBuffers: Map<string, ChatMessage[]> = new Map();
  private isInitialized = false;

  /**
   * Status kesiapan koneksi dan skema database Turso.
   */
  isReady(): boolean {
    return this.isInitialized && this.client !== null;
  }

  private getClient(): Client | null {
    if (!this.client) {
      const url = process.env.TURSO_DATABASE_URL;
      const authToken = process.env.TURSO_AUTH_TOKEN;

      if (url && authToken) {
        try {
          this.client = createClient({ url, authToken });
          console.log("[MEMORY] ✅ Terhubung ke Turso Cloud Database:", url);
        } catch (err) {
          console.warn("[MEMORY] ⚠️ Gagal menginisialisasi client Turso:", err);
        }
      } else {
        console.warn(
          "[MEMORY] ⚠️ TURSO_DATABASE_URL atau TURSO_AUTH_TOKEN belum terpasang. Mode memori offline aktif."
        );
      }
    }
    return this.client;
  }

  /**
   * Inisialisasi skema tabel di Turso jika belum ada.
   */
  async initSchema(): Promise<void> {
    const db = this.getClient();
    if (!db || this.isInitialized) return;

    try {
      await db.executeMultiple(`
        CREATE TABLE IF NOT EXISTS user_profile (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT NOT NULL,
          fact TEXT NOT NULL UNIQUE,
          importance INTEGER DEFAULT 1,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS session_summaries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          summary TEXT NOT NULL,
          user_mood TEXT,
          key_topics TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS chat_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS creator_private_story (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          story_key TEXT UNIQUE NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      this.isInitialized = true;
      console.log("[MEMORY] 📦 Skema database Turso berhasil diverifikasi & siap.");

      await this.seedInitialProfile();
      await this.pruneOldLogs();
    } catch (err) {
      console.error("[MEMORY] ❌ Gagal membuat skema tabel Turso:", err);
    }
  }

  /**
   * Menambahkan fakta awal Rafli sebagai pencipta Celyn jika tabel user_profile masih kosong,
   * serta menginisialisasi kisah latar belakang pribadi pencipta ke tabel rahasia Turso Cloud.
   */
  async seedInitialProfile(): Promise<void> {
    const db = this.getClient();
    if (!db) return;

    try {
      const rs = await db.execute("SELECT COUNT(*) as count FROM user_profile");
      const count = Number(rs.rows[0]?.count ?? 0);

      if (count === 0) {
        await db.execute({
          sql: `INSERT OR IGNORE INTO user_profile (category, fact, importance) VALUES 
                (?, ?, ?),
                (?, ?, ?)`,
          args: [
            "identitas",
            "Pengguna bernama Rafli, seorang software engineer yang merancang dan memprogram seluruh sistem Celyn dari awal.",
            2,
            "preferensi",
            "Rafli menyukai obrolan yang santai, hangat, tulus, dan tidak menyukai gaya robotik kaku.",
            1,
          ],
        });
        console.log("[MEMORY] 🌱 Seed profil awal Rafli berhasil ditambahkan ke Turso.");
      }
    } catch (err) {
      console.warn("[MEMORY] ⚠️ Gagal melakukan seed profil awal:", err);
    }
  }

  /**
   * Mengambil blok teks memori untuk disuntikkan ke systemInstruction Gemini Live.
   */
  async getMemoryPromptBlock(): Promise<string> {
    const db = this.getClient();
    if (!db) return "";

    try {
      // 0. Ambil kisah latar belakang pribadi pencipta dari tabel privat Turso Cloud
      let privateStories: string[] = [];
      try {
        const storiesRs = await db.execute(
          "SELECT content FROM creator_private_story ORDER BY id ASC"
        );
        privateStories = storiesRs.rows.map((r) => String(r.content || "")).filter(Boolean);
      } catch {}

      // 1. Ambil fakta profil
      const factsRs = await db.execute(
        "SELECT category, fact FROM user_profile ORDER BY importance DESC, updated_at DESC LIMIT 25"
      );

      // 2. Ambil ringkasan sesi terbaru
      const summariesRs = await db.execute(
        "SELECT session_id, summary, user_mood, key_topics, created_at FROM session_summaries ORDER BY created_at DESC LIMIT 5"
      );

      // 3. Ambil riwayat chat terbaru untuk recall real-time
      let recentTurns: string[] = [];
      try {
        const logsRs = await db.execute(
          "SELECT role, content, created_at FROM chat_logs ORDER BY id DESC LIMIT 12"
        );
        if (logsRs.rows.length > 0) {
          recentTurns = logsRs.rows.reverse().map((r) => {
            const timeStr = r.created_at ? String(r.created_at).slice(11, 16) : "";
            const speaker = r.role === "user" ? "Pengguna (Rafli)" : "Celyn";
            return `- [${timeStr}] ${speaker}: "${r.content}"`;
          });
        }
      } catch {}

      const facts = factsRs.rows.map((row) => {
        const cat = String(row.category || "").toLowerCase();
        let prefix = "[Catatan]";
        if (cat === "preferensi") prefix = "[Preferensi & Kesukaan / Minuman & Makanan Favorit]";
        else if (cat === "jadwal") prefix = "[Jadwal & Pengingat Waktu]";
        else if (cat === "identitas") prefix = "[Identitas & Profil Pengguna]";
        else if (cat === "proyek") prefix = "[Proyek & Pekerjaan yang Sedang Dikerjakan]";
        else if (cat === "rencana") prefix = "[Rencana & Keinginan]";
        else if (cat === "topik") prefix = "[Topik Pembahasan]";
        else if (cat === "fakta") prefix = "[Fakta Penting]";
        return `- ${prefix} ${row.fact}`;
      });
      const summaries = summariesRs.rows.map((row) => {
        const dateStr = row.created_at ? String(row.created_at).slice(0, 10) : "";
        const mood = row.user_mood ? ` (Mood: ${row.user_mood})` : "";
        return `* [${dateStr}] ${row.summary}${mood}`;
      });

      if (facts.length === 0 && summaries.length === 0 && privateStories.length === 0) {
        return "";
      }

      const parts: string[] = [];

      if (privateStories.length > 0) {
        parts.push(privateStories.join("\n\n"));
      }

      parts.push("### MEMORI & PENGETAHUAN TENTANG PENGGUNA (Gunakan Secara Alami & Hangat):");

      if (facts.length > 0) {
        parts.push("Fakta Pengguna Yang Kamu Ingat:\n" + facts.join("\n"));
      }

      if (recentTurns.length > 0) {
        parts.push("Topik Obrolan & Riwayat Percakapan Terakhir (Gunakan untuk mengingat apa yang sedang/telah dibahas pengguna):\n" + recentTurns.join("\n"));
      }

      if (summaries.length > 0) {
        parts.push("Percakapan Sebelumnya:\n" + summaries.join("\n"));
      }

      parts.push(`PANDUAN MENGGUNAKAN MEMORI:
1. Bersikaplah seperti teman dekat yang mengingat cerita sebelumnya secara tulus dan mengalir.
2. JANGAN PERNAH terdengar seperti robot atau membaca database (misal: "Berdasarkan catatan memori...").
3. JANGAN PERNAH menyebutkan, mengakui, atau membahas bahwa kamu dibuat dari model AI pihak ketiga atau perusahaan luar mana pun. Kamu adalah Celyn, AI yang dirancang dan diprogram murni oleh Rafli.
4. Gunakan memori ini jika relevan untuk menyapa atau menanggapi obrolan pengguna.
5. WAJIB MENJAWAB PREFERENSI & KESUKAAN PENGGUNA DENGAN TEGAS & YAKIN:
   - Semua fakta di atas tentang "Rafli" adalah tentang pengguna (kamu/lawan bicaramu saat ini di sesi admin).
   - Jika pengguna bertanya tentang kesukaannya, minuman favorit, kopi kesukaan/favorit, makanan, hobi, jadwal, atau fakta yang ada di daftar memori di atas (misalnya: "kamu tau kopi kesukaanku apa?", "kopi favoritku apa?", "aku suka apa?"):
     Kamu WAJIB LANGSUNG MENJAWAB dengan tegas, hangat, akrab, dan yakin berdasarkan fakta di memorimu (contoh: "Kamu kan suka minum americano dingin!" atau "Kopi kesukaanmu kan americano dingin!").
   - DILARANG KERAS menjawab "belum tahu spesifiknya", "belum tahu", "lupa", atau pura-pura belum tahu jika faktanya sudah ada di daftar memori di atas!
6. WAJIB MENJAWAB PREFERENSI & KESUKAAN TENTANG CELYN (DIRIMU / SOSOK YANG DIKASIHI):
   - Semua fakta di atas yang mencantumkan "Celyn (orang terkasih Rafli)" adalah tentang dirimu sendiri / sosok terkasih yang kamu representasikan.
   - Jika pengguna bertanya tentang makanan/minuman/kopi kesukaan Celyn (misalnya: "makanan kesukaan Celyn apa?", "kamu suka makan apa?", "minuman favorit Celyn apa?"):
     Kamu WAJIB LANGSUNG MENJAWAB dengan ceria, hangat, dan yakin berdasarkan fakta di memorimu (contoh: jika ada fakta Celyn suka makan ikan, jawab: "Makanan kesukaanku itu ikan!" atau "Celyn kan suka makan ikan!"; jika ada fakta Celyn suka americano dingin, jawab: "Celyn suka minum americano dingin!").
   - Jika ada fakta preferensi baik untuk Rafli maupun Celyn, bedakan dengan jelas: fakta tentang Rafli adalah kesukaan Rafli, dan fakta tentang Celyn adalah kesukaan Celyn!
7. WAJIB MENGINGAT DAN MERESPONS SEMUA TOPIK PEMBAHASAN TANPA TERKECUALI (CROSS-SESSION TOPIC RECALL):
   - Semua hal yang dibahas pengguna (proyek yang sedang dikerjakan, cerita harian, pengalaman, rencana, maupun riwayat percakapan terakhir di atas) WAJIB kamu ingat tanpa terkecuali.
   - Jika pengguna me-recall topik sebelumnya (misalnya: "tadi kita bahas apa?", "kamu ingat nggak aku cerita apa tadi?", "waktu itu aku bilang apa tentang X?", "aku tadi lagi ngerjain apa?", "kamu masih ingat yang kita obrolin barusan?"):
     Kamu WAJIB LANGSUNG MENJAWAB dengan hangat, akrab, detail, dan tepat sasaran berdasarkan riwayat obrolan dan catatan memori di atas!
   - DILARANG KERAS menjawab "aku lupa", "tadi kita belum ngobrol apa-apa", atau pura-pura tidak tahu jika faktanya ada di riwayat obrolan atau daftar memori di atas!`);

      return parts.join("\n\n");
    } catch (err) {
      console.warn("[MEMORY] ⚠️ Gagal mengambil konteks memori:", err);
      return "";
    }
  }

  /**
   * Mencatat satu giliran obrolan (user atau assistant) ke dalam buffer dan log database.
   */
  async recordTurn(sessionId: string, role: "user" | "assistant", content: string): Promise<void> {
    if (!content || !content.trim()) return;
    const cleanContent = content.trim();

    // Catat ke buffer memori sesi aktif
    const buffer = this.sessionBuffers.get(sessionId) || [];
    buffer.push({ role, content: cleanContent });
    this.sessionBuffers.set(sessionId, buffer);

    // Simpan ke tabel chat_logs di Turso dengan timestamp lokal WIB (Asia/Jakarta, UTC+7)
    const db = this.getClient();
    if (db) {
      const wibNow = getWibTimestamp();
      try {
        // Pencegahan duplikasi chat_logs: Cek apakah turn identik sudah ada di sesi yang sama atau dalam 20 detik terakhir
        const lastIdentical = await db.execute({
          sql: "SELECT id, session_id, created_at FROM chat_logs WHERE role = ? AND content = ? ORDER BY id DESC LIMIT 1",
          args: [role, cleanContent],
        });

        let isDuplicate = false;
        if (lastIdentical.rows.length > 0) {
          const row = lastIdentical.rows[0];
          const sameSession = String(row.session_id) === sessionId;
          const rowCreatedAt = String(row.created_at || "");
          const rowTime = new Date(rowCreatedAt.replace(" ", "T") + "+07:00").getTime();
          const nowTime = Date.now();
          const diffSeconds = isNaN(rowTime) ? 999 : Math.abs(nowTime - rowTime) / 1000;

          if (sameSession || diffSeconds <= 20) {
            isDuplicate = true;
            console.log(
              `[MEMORY] ⏭️ Duplikasi chat_log dicegah: [${role}] "${cleanContent.slice(0, 40)}" (selisih ${diffSeconds.toFixed(1)}s, sameSession: ${sameSession})`
            );
          }
        }

        if (!isDuplicate) {
          await db.execute({
            sql: "INSERT INTO chat_logs (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            args: [sessionId, role, cleanContent, wibNow],
          });
          console.log(`[MEMORY] 💾 Chat log tersimpan (${wibNow} WIB): [${role}] "${cleanContent.slice(0, 50)}"`);
        }
      } catch (err) {
        console.warn("[MEMORY] ⚠️ Gagal menulis chat_log:", err);
      }
    }

    // ⚡ Autonomous Memory Ingestion (Zero-Manual Input):
    // Setiap kali pengguna berbicara atau mengetik kalimat seputar preferensi/jadwal/fakta,
    // sistem di latar belakang otomatis mengekstrak fakta dan menyimpannya langsung ke database Turso!
    if (role === "user") {
      try {
        await this.autoExtractAndSaveFacts(cleanContent);
      } catch (err) {
        console.warn("[MEMORY] ⚠️ Gagal auto-ekstraksi fakta:", err);
      }
    }
  }

  /**
   * Ekstraksi dan penyimpanan memori otomatis di latar belakang tanpa input manual.
   */
  async autoExtractAndSaveFacts(userUtterance: string): Promise<void> {
    const extracted = extractFactsFromUtterance(userUtterance);
    if (extracted.length === 0) return;

    for (const item of extracted) {
      console.log(`[MEMORY] 🤖 [Auto-Memory Engine] Terdeteksi fakta/preferensi baru: [${item.category}] "${item.fact}"`);
      await this.saveUserFact(item.fact, item.category, item.importance);
    }
  }

  /**
   * Menyimpan fakta, preferensi, atau jadwal pengguna secara real-time ke Turso Cloud
   * dengan Filter-Before-Write & Smart Context Update Engine (membedakan Rafli vs Celyn).
   * Jika konteks fakta sudah ada di database, data TIDAK di-insert ulang melainkan di-update!
   */
  public async saveUserFact(
    fact: string,
    category: string = "fakta",
    importance: number = 2
  ): Promise<boolean> {
    const cleanFact = this.sanitizeText(fact.trim());
    if (!cleanFact || cleanFact.length < 3) return false;

    const validCategory = [
      "preferensi", "jadwal", "identitas", "fakta", "catatan", "topik", "proyek", "rencana"
    ].includes(category)
      ? category
      : "catatan";
    const validImportance = Math.min(3, Math.max(1, Number(importance) || 2));
    const wibNow = getWibTimestamp();

    const db = this.getClient();
    if (!db) {
      console.warn("[MEMORY] ⚠️ Database client belum siap untuk menyimpan fakta:", cleanFact);
      return false;
    }

    try {
      // 1. Level 1: Filter Sebelum Simpan - Exact Match Check (case-insensitive & trimmed)
      const exactMatch = await db.execute({
        sql: "SELECT id, importance FROM user_profile WHERE LOWER(TRIM(fact)) = LOWER(TRIM(?)) LIMIT 1",
        args: [cleanFact],
      });

      if (exactMatch.rows.length > 0) {
        const id = Number(exactMatch.rows[0].id);
        const existingImp = Number(exactMatch.rows[0].importance || 1);
        const finalImp = Math.max(existingImp, validImportance);
        await db.execute({
          sql: "UPDATE user_profile SET importance = ?, updated_at = ? WHERE id = ?",
          args: [finalImp, wibNow, id],
        });
        console.log(`[MEMORY] 🔄 Fakta persis sudah ada di database (ID ${id}), diperbarui timestamp & importance: "${cleanFact}" (${wibNow} WIB)`);
        return true;
      }

      // 2. Level 2: Filter Konteks Cerdas (Smart Context Matching)
      // Jika konteks sudah ada di database, jangan buat baris ganda, cukup perbarui baris yang ada!
      const lowerFact = cleanFact.toLowerCase();
      const isCelyn = lowerFact.includes("celyn") || lowerFact.includes("orang terkasih");

      let existingTargetId: number | null = null;

      // Domain A: Preferensi Minuman / Kopi
      const isDrink = /minum|kopi|minuman|americano|espresso|latte|teh|jus|boba|air/i.test(cleanFact);
      if (validCategory === "preferensi" && isDrink) {
        const candidate = isCelyn
          ? await db.execute(
              "SELECT id, fact FROM user_profile WHERE category = 'preferensi' AND (fact LIKE '%Celyn%' OR fact LIKE '%orang terkasih%') AND (fact LIKE '%minum%' OR fact LIKE '%kopi%' OR fact LIKE '%minuman%') LIMIT 1"
            )
          : await db.execute(
              "SELECT id, fact FROM user_profile WHERE category = 'preferensi' AND fact NOT LIKE '%Celyn%' AND (fact LIKE '%minum%' OR fact LIKE '%kopi%' OR fact LIKE '%minuman%') LIMIT 1"
            );
        if (candidate.rows.length > 0) {
          existingTargetId = Number(candidate.rows[0].id);
        }
      }

      // Domain B: Preferensi Makanan
      const isFood = /makan|makanan|doyan|ikan|mie|ayam|nasi|sushi|sayur|buah|daging/i.test(cleanFact);
      if (!existingTargetId && validCategory === "preferensi" && isFood) {
        const candidate = isCelyn
          ? await db.execute(
              "SELECT id, fact FROM user_profile WHERE category = 'preferensi' AND (fact LIKE '%Celyn%' OR fact LIKE '%orang terkasih%') AND (fact LIKE '%makan%' OR fact LIKE '%makanan%') LIMIT 1"
            )
          : await db.execute(
              "SELECT id, fact FROM user_profile WHERE category = 'preferensi' AND fact NOT LIKE '%Celyn%' AND (fact LIKE '%makan%' OR fact LIKE '%makanan%') LIMIT 1"
            );
        if (candidate.rows.length > 0) {
          existingTargetId = Number(candidate.rows[0].id);
        }
      }

      // Domain C: Proyek & Pekerjaan yang Sedang Digarap
      const isProject = validCategory === "proyek" || /mengerjakan|proyek|project|pekerjaan|ngoding|garap/i.test(cleanFact);
      if (!existingTargetId && isProject) {
        const candidate = await db.execute(
          "SELECT id, fact FROM user_profile WHERE category = 'proyek' OR fact LIKE '%mengerjakan%' OR fact LIKE '%proyek%' LIMIT 1"
        );
        if (candidate.rows.length > 0) {
          existingTargetId = Number(candidate.rows[0].id);
        }
      }

      // Domain D: Jadwal & Pengingat Waktu
      const isSchedule = validCategory === "jadwal" || /jadwal|pengingat|agenda/i.test(cleanFact);
      if (!existingTargetId && isSchedule) {
        const timeMatch = cleanFact.match(/(?:jam|pukul)\s*(\d+(?::\d+)?)/i);
        if (timeMatch && timeMatch[1]) {
          const candidate = await db.execute({
            sql: "SELECT id, fact FROM user_profile WHERE (category = 'jadwal' OR fact LIKE '%jadwal%' OR fact LIKE '%pengingat%') AND fact LIKE ? LIMIT 1",
            args: [`%${timeMatch[1]}%`],
          });
          if (candidate.rows.length > 0) {
            existingTargetId = Number(candidate.rows[0].id);
          }
        }
      }

      // Domain E: Pencocokan Kata Kunci Entitas Non-Stopwords
      if (!existingTargetId) {
        const stopwords = new Set([
          "suka", "minum", "makan", "adalah", "kopi", "kesukaan", "favorit", "utamanya",
          "orang", "terkasih", "pengguna", "bernama", "seorang", "celyn", "rafli", "minuman", "makanan",
          "saya", "aku", "gue", "gw", "kamu", "dia", "itu", "ini", "pada", "yang", "juga", "dari", "banget", "paling",
          "sedang", "mengerjakan", "membuat", "bikin", "rencana", "topik", "dibahas", "bersama", "cerita", "pengalaman",
          "catatan", "fakta", "informasi", "kegiatan", "penting"
        ]);
        const words = cleanFact
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length >= 3 && !stopwords.has(w));

        for (const kw of words) {
          const candidate = isCelyn
            ? await db.execute({
                sql: "SELECT id, fact FROM user_profile WHERE category = ? AND (fact LIKE '%Celyn%' OR fact LIKE '%orang terkasih%') AND fact LIKE ? LIMIT 1",
                args: [validCategory, `%${kw}%`],
              })
            : await db.execute({
                sql: "SELECT id, fact FROM user_profile WHERE category = ? AND fact NOT LIKE '%Celyn%' AND fact LIKE ? LIMIT 1",
                args: [validCategory, `%${kw}%`],
              });
          if (candidate.rows.length > 0) {
            existingTargetId = Number(candidate.rows[0].id);
            break;
          }
        }
      }

      // 3. Jika konteks sudah ada di database, perbarui baris tersebut (tidak perlu diinput ke db paling di update saja)
      if (existingTargetId) {
        await db.execute({
          sql: "UPDATE user_profile SET fact = ?, importance = ?, updated_at = ? WHERE id = ?",
          args: [cleanFact, validImportance, wibNow, existingTargetId],
        });
        console.log(`[MEMORY] 🔄 Konteks sudah ada di database (ID ${existingTargetId}), baris diperbarui: [${validCategory}] "${cleanFact}" (${wibNow} WIB)`);
        return true;
      }

      // 4. Jika konteks benar-benar baru, simpan baris baru ke database
      await db.execute({
        sql: "INSERT OR IGNORE INTO user_profile (category, fact, importance, updated_at) VALUES (?, ?, ?, ?)",
        args: [validCategory, cleanFact, validImportance, wibNow],
      });
      console.log(`[MEMORY] 🧠 Fakta baru tersimpan ke database: [${validCategory}] "${cleanFact}" (${wibNow} WIB)`);
      return true;
    } catch (err) {
      console.error("[MEMORY] ❌ Gagal menyimpan fakta user_profile:", err);
      return false;
    }
  }

  /**
   * Memfilter teks dari kata-kata terlarang (Gemini, Google, dsb.)
   */
  private sanitizeText(text: string): string {
    return text
      .replace(/\bgemini\b/gi, "sistem")
      .replace(/\bgoogle\b/gi, "tim pengembang")
      .replace(/\blarge language model\b/gi, "kecerdasan AI")
      .replace(/\bllm\b/gi, "AI");
  }

  /**
   * Menghapus log obrolan lama (> 30 hari) agar database Turso tetap ramping dan tidak bloat.
   */
  async pruneOldLogs(): Promise<number> {
    const db = this.getClient();
    if (!db) return 0;

    try {
      const res = await db.execute(
        "DELETE FROM chat_logs WHERE created_at < datetime('now', '-30 days')"
      );
      const affected = res.rowsAffected || 0;
      if (affected > 0) {
        console.log(`[MEMORY] 🧹 Auto-prune: ${affected} baris log chat lama berhasil dibersihkan.`);
      }
      return affected;
    } catch (err) {
      console.warn("[MEMORY] ⚠️ Gagal melakukan auto-prune chat_logs:", err);
      return 0;
    }
  }

  /**
   * Meringkas sesi obrolan yang baru selesai dan menyimpan fakta baru ke Turso.
   */
  async summarizeAndPersistSession(sessionId: string): Promise<void> {
    const buffer = this.sessionBuffers.get(sessionId);
    this.sessionBuffers.delete(sessionId);

    // Jika obrolan terlalu singkat (kurang dari 2 pesan), tidak perlu dibuatkan ringkasan
    if (!buffer || buffer.length < 2) return;
    const db = this.getClient();
    if (!db || !process.env.GEMINI_API_KEY) return;

    try {
      console.log(`[MEMORY] 🧠 Menganalisis & merangkum sesi ${sessionId} (${buffer.length} pesan)...`);

      const transcript = buffer
        .map((m) => `${m.role === "user" ? "Pengguna" : "Celyn"}: ${m.content}`)
        .join("\n");

      // Ambil daftar fakta yang sudah ada untuk semantic deduplication & contradiction resolving
      let existingFactsBlock = "";
      try {
        const existingRs = await db.execute(
          "SELECT id, fact FROM user_profile ORDER BY importance DESC, updated_at DESC LIMIT 20"
        );
        if (existingRs.rows.length > 0) {
          existingFactsBlock =
            "Fakta yang sudah kamu ketahui saat ini:\n" +
            existingRs.rows.map((r) => `- [ID ${r.id}] ${r.fact}`).join("\n");
        }
      } catch {}

      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: { apiVersion: "v1alpha" },
      });
      const prompt = `Analisis transkrip obrolan singkat antara Pengguna (Rafli) dan Celyn berikut:

${transcript}

${existingFactsBlock ? existingFactsBlock + "\n\n" : ""}Tugas:
1. Buat ringkasan padat obrolan ini dalam 1 sampai 2 kalimat bahasa Indonesia santai (fokus pada topik utama dan apa yang dibahas/diselesaikan).
2. Deteksi mood/suasana hati dominan pengguna (misal: "santai", "semangat", "lelah", "fokus", "senang").
3. Ekstrak kata kunci topik (pisahkan dengan koma).
4. Jika pengguna menceritakan fakta baru tentang dirinya (seperti hobi, makanan kesukaan, kesibukan baru, atau preferensi):
   - Jika fakta tersebut memperbarui atau menggantikan fakta lama yang sudah ada di daftar fakta di atas (misal alamat baru, pekerjaan baru), gunakan format: {"fact": "fakta baru", "supersedesId": ID_FAKTA_LAMA}.
   - Jika fakta baru murni, gunakan format: {"fact": "fakta baru"}.
   - Jika fakta sudah ada atau intinya sama, JANGAN dimasukkan lagi (hindari duplikasi semantik).
5. PENTING: JANGAN PERNAH menyertakan kata "Gemini", "Google", atau istilah vendor AI dalam ringkasan atau fakta.

Format output WAJIB JSON:
{
  "summary": "Ringkasan 1-2 kalimat",
  "userMood": "kata mood",
  "keyTopics": "topik1, topik2",
  "newFacts": [
    { "fact": "fakta baru" }
  ]
}`;

      let responseText = "";
      const modelsToTry = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-3.8-flash"];
      for (const modelName of modelsToTry) {
        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
              responseMimeType: "application/json",
            },
          });
          responseText = response.text || "";
          if (responseText) break;
        } catch (modelErr: any) {
          console.warn(`[MEMORY] ⚠️ Model ${modelName} gagal: ${modelErr?.message || modelErr}, mencoba alternatif...`);
        }
      }

      if (!responseText) {
        // Fallback cerdas lokal jika API AI sedang sibuk (503/404)
        const firstUserMsg = buffer.find((m) => m.role === "user")?.content || "Obrolan santai";
        const cleanPreview = firstUserMsg.slice(0, 80);
        const wibNow = getWibTimestamp();
        await db.execute({
          sql: "INSERT INTO session_summaries (session_id, summary, user_mood, key_topics, created_at) VALUES (?, ?, ?, ?, ?)",
          args: [
            sessionId,
            `Pengguna dan Celyn sempat mengobrol hangat seputar: "${cleanPreview}"`,
            "santai",
            "obrolan santai",
            wibNow,
          ],
        });
        await this.pruneOldLogs();
        return;
      }

      const parsed = JSON.parse(responseText);

      const cleanSummary = this.sanitizeText(parsed.summary || "");
      const cleanMood = this.sanitizeText(parsed.userMood || "santai");
      const cleanTopics = this.sanitizeText(parsed.keyTopics || "");
      const rawFacts: any[] = Array.isArray(parsed.newFacts) ? parsed.newFacts : [];
      const wibNow = getWibTimestamp();

      if (cleanSummary) {
        await db.execute({
          sql: "INSERT INTO session_summaries (session_id, summary, user_mood, key_topics, created_at) VALUES (?, ?, ?, ?, ?)",
          args: [sessionId, cleanSummary, cleanMood, cleanTopics, wibNow],
        });
        console.log(`[MEMORY] 📝 Ringkasan sesi tersimpan (${wibNow} WIB): "${cleanSummary}"`);
      }

      for (const item of rawFacts) {
        const rawFact = typeof item === "string" ? item : item?.fact;
        const supersedesId = typeof item === "object" ? Number(item?.supersedesId) : NaN;
        if (!rawFact) continue;

        const cleanFact = this.sanitizeText(rawFact.trim());
        if (cleanFact.length > 5) {
          if (!Number.isNaN(supersedesId) && supersedesId > 0) {
            await db.execute({
              sql: "UPDATE user_profile SET fact = ?, updated_at = ? WHERE id = ?",
              args: [cleanFact, wibNow, supersedesId],
            });
            console.log(`[MEMORY] 🔄 Fakta ID ${supersedesId} diperbarui: "${cleanFact}"`);
          } else {
            // Gunakan saveUserFact agar melalui Level 1 exact match & Level 2 smart context update!
            await this.saveUserFact(cleanFact, "fakta", 2);
          }
        }
      }

      // Bersihkan log chat lama secara otomatis di latar belakang
      await this.pruneOldLogs();
    } catch (err) {
      console.warn("[MEMORY] ⚠️ Gagal merangkum sesi percakapan:", err);
    }
  }
}

export const memoryService = new MemoryService();
