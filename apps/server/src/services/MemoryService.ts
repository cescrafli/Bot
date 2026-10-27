import dotenv from "dotenv";
dotenv.config();

import { createClient, Client } from "@libsql/client";
import { GoogleGenAI } from "@google/genai";

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
   * Menambahkan fakta awal Rafli sebagai pencipta Celyn jika tabel user_profile masih kosong.
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
      // 1. Ambil fakta profil
      const factsRs = await db.execute(
        "SELECT category, fact FROM user_profile ORDER BY importance DESC, updated_at DESC LIMIT 8"
      );

      // 2. Ambil ringkasan sesi terbaru
      const summariesRs = await db.execute(
        "SELECT session_id, summary, user_mood, key_topics, created_at FROM session_summaries ORDER BY created_at DESC LIMIT 2"
      );

      const facts = factsRs.rows.map((row) => `- ${row.fact}`);
      const summaries = summariesRs.rows.map((row) => {
        const dateStr = row.created_at ? String(row.created_at).slice(0, 10) : "";
        const mood = row.user_mood ? ` (Mood: ${row.user_mood})` : "";
        return `* [${dateStr}] ${row.summary}${mood}`;
      });

      if (facts.length === 0 && summaries.length === 0) {
        return "";
      }

      const parts: string[] = [
        "### MEMORI & PENGETAHUAN TENTANG PENGGUNA (Gunakan Secara Alami & Hangat):",
      ];

      if (facts.length > 0) {
        parts.push("Fakta Pengguna Yang Kamu Ingat:\n" + facts.join("\n"));
      }

      if (summaries.length > 0) {
        parts.push("Percakapan Sebelumnya:\n" + summaries.join("\n"));
      }

      parts.push(`PANDUAN MENGGUNAKAN MEMORI:
1. Bersikaplah seperti teman dekat yang mengingat cerita sebelumnya secara tulus dan mengalir.
2. JANGAN PERNAH terdengar seperti robot atau membaca database (misal: "Berdasarkan catatan memori...").
3. JANGAN PERNAH menyebutkan, mengakui, atau membahas bahwa kamu dibuat dari model AI pihak ketiga atau perusahaan luar mana pun. Kamu adalah Celyn, AI yang dirancang dan diprogram murni oleh Rafli.
4. Gunakan memori ini jika relevan untuk menyapa atau menanggapi obrolan pengguna.`);

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

    // Simpan ke tabel chat_logs di Turso
    const db = this.getClient();
    if (db) {
      db.execute({
        sql: "INSERT INTO chat_logs (session_id, role, content) VALUES (?, ?, ?)",
        args: [sessionId, role, cleanContent],
      }).catch((err) => {
        console.warn("[MEMORY] ⚠️ Gagal menulis chat_log:", err);
      });
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
        await db.execute({
          sql: "INSERT INTO session_summaries (session_id, summary, user_mood, key_topics) VALUES (?, ?, ?, ?)",
          args: [
            sessionId,
            `Pengguna dan Celyn sempat mengobrol hangat seputar: "${cleanPreview}"`,
            "santai",
            "obrolan santai",
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

      if (cleanSummary) {
        await db.execute({
          sql: "INSERT INTO session_summaries (session_id, summary, user_mood, key_topics) VALUES (?, ?, ?, ?)",
          args: [sessionId, cleanSummary, cleanMood, cleanTopics],
        });
        console.log(`[MEMORY] 📝 Ringkasan sesi tersimpan: "${cleanSummary}"`);
      }

      for (const item of rawFacts) {
        const rawFact = typeof item === "string" ? item : item?.fact;
        const supersedesId = typeof item === "object" ? Number(item?.supersedesId) : NaN;
        if (!rawFact) continue;

        const cleanFact = this.sanitizeText(rawFact.trim());
        if (cleanFact.length > 5) {
          if (!Number.isNaN(supersedesId) && supersedesId > 0) {
            await db.execute({
              sql: "UPDATE user_profile SET fact = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
              args: [cleanFact, supersedesId],
            });
            console.log(`[MEMORY] 🔄 Fakta ID ${supersedesId} diperbarui: "${cleanFact}"`);
          } else {
            await db.execute({
              sql: "INSERT OR IGNORE INTO user_profile (category, fact, importance) VALUES (?, ?, ?)",
              args: ["fakta", cleanFact, 1],
            });
            console.log(`[MEMORY] 💡 Fakta baru pengguna tercatat: "${cleanFact}"`);
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
