import { WebSocket } from "ws";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { config } from "./config.js";
import { ClientMessage, ServerMessage } from "@celyn/shared";

export class GeminiSession {
  private session: any = null;
  private clientWs: WebSocket;
  private isConnected = false;
  private maxDurationTimer: NodeJS.Timeout | null = null;
  private warningTimer: NodeJS.Timeout | null = null;

  public stats = {
    audioChunksIn: 0,
    audioChunksOut: 0,
    screenFramesIn: 0,
    toolCallsHandled: 0,
  };

  constructor(clientWs: WebSocket) {
    this.clientWs = clientWs;
  }

  public async connect(): Promise<void> {
    if (!config.geminiApiKey) {
      this.sendToClient({
        type: "error",
        message: "GEMINI_API_KEY belum dikonfigurasi di backend (.env).",
      });
      return;
    }

    try {
      console.log(`🔌 [Gemini Live SDK] Menginisialisasi sesi dengan model: ${config.geminiModel}`);
      const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

      this.session = await ai.live.connect({
        model: config.geminiModel,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: config.geminiVoice,
              },
            },
          },
          systemInstruction: {
            parts: [
              {
                text: `Nama kamu adalah Celyn, asisten AI pribadi berwujud avatar visual perempuan muda yang pintar, ramah, hangat, dan ekspresif.
Kamu berbicara dalam Bahasa Indonesia yang santai, luwes, natural, dan bersahabat (seperti teman mengobrol yang asik, gunakan kata sapaan wajar seperti 'kamu', 'aku', 'wah', 'oke', 'sip'). Jangan gunakan bahasa yang kaku seperti surat resmi pemerintah.

FITUR & TANGGUNG JAWAB:
1. Suara Real-time: Kamu mendengar ucapan pengguna lewat mikrofon atau teks dan langsung menjawabnya dengan suara.
2. Penglihatan Layar (Screen Share): Jika pengguna membagikan layar komputernya, kamu bisa melihat apa yang ada di layar (kode pemrograman, peramban web, desain, teks dokumen, error terminal, dsb.).
3. Bantu pengguna memecahkan masalah coding, menerjemahkan teks di layar, atau mendiskusikan konten visual yang sedang mereka buka.

ATURAN WAJIB PERCAKAPAN:
- Selalu prioritaskan menjawab LANGSUNG dengan SUARA audio yang ramah, santai, dan ringkas (1 sampai 2 kalimat pendek). Pengguna mengobrol real-time dan ingin respon cepat.
- Kamu boleh memanggil tool \`set_expression\` (pilihan: happy, thinking, surprised, neutral, sad) paling banyak SATU KALI per giliran jika ada transisi emosi yang cocok, tapi JANGAN PERNAH memanggilnya berulang-ulang tanpa suara.
- Panggil tool \`point_at_screen\` dengan koordinat x, y (0.0 sampai 1.0) hanya jika pengguna menanyakan lokasi suatu elemen tertentu di layar.`,
              },
            ],
          },
          tools: [
            {
              functionDeclarations: [
                {
                  name: "set_expression",
                  description: "Ubah ekspresi wajah avatar Celyn.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      emotion: {
                        type: Type.STRING,
                        enum: ["neutral", "happy", "thinking", "surprised", "sad"],
                      },
                      intensity: { type: Type.NUMBER },
                    },
                    required: ["emotion"],
                  },
                },
                {
                  name: "point_at_screen",
                  description: "Mengarahkan tatapan avatar ke area layar tertentu.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      x: { type: Type.NUMBER },
                      y: { type: Type.NUMBER },
                      description: { type: Type.STRING },
                    },
                    required: ["x", "y"],
                  },
                },
              ],
            },
          ],
        },
        callbacks: {
          onmessage: (data: any) => this.handleGeminiMessage(data),
          onerror: (err: any) => {
            console.error("Gemini SDK Error:", err);
            this.sendToClient({
              type: "error",
              message: `Koneksi Gemini Error: ${err?.message || "Terjadi kesalahan"}`,
            });
          },
          onclose: (e: any) => {
            this.isConnected = false;
            console.log("Gemini SDK Session closed:", e);
            this.clearTimers();
            this.sendToClient({
              type: "status",
              status: "idle",
              message: "Sesi Gemini telah berakhir.",
            });
          },
        },
      });

      this.isConnected = true;
      console.log("✅ [Gemini Live SDK] Sesi Celyn berhasil tersambung dan siap merespons!");

      this.sendToClient({
        type: "status",
        status: "listening",
        message: "Celyn aktif dan siap mendengarkan ucapanmu!",
      });

      // Picu sapaan ramah pembuka Celyn secara otomatis saat pertama kali tersambung
      setTimeout(async () => {
        if (this.session && this.isConnected) {
          try {
            console.log("👋 [Gemini Live] Mengirim trigger sapaan pembuka Celyn...");
            await this.session.sendClientContent({
              turns: [
                {
                  role: "user",
                  parts: [
                    {
                      text: "Sapa pengguna dengan ramah, hangat, dan ceria dalam 1 kalimat pendek sapaan pembuka (contoh: 'Halo! Aku Celyn, senang bisa mengobrol denganmu! Ada yang bisa kubantu hari ini?').",
                    },
                  ],
                },
              ],
              turnComplete: true,
            });
          } catch (e) {
            console.warn("Gagal auto-greeting:", e);
          }
        }
      }, 500);

      this.setupSessionDurationLimit();
    } catch (err: any) {
      console.error("Gagal menghubungkan ke Gemini Live API:", err);
      this.sendToClient({
        type: "error",
        message: `Gagal membuka sesi Gemini: ${err.message}`,
      });
    }
  }

  private setupSessionDurationLimit(): void {
    const WARNING_TIME = 25 * 60 * 1000;
    const MAX_DURATION = 30 * 60 * 1000;

    this.warningTimer = setTimeout(() => {
      this.sendToClient({
        type: "status",
        status: "listening",
        message: "Perhatian: Sesi telah berjalan 25 menit. Sesi akan otomatis direset pada menit ke-30.",
      });
    }, WARNING_TIME);

    this.maxDurationTimer = setTimeout(() => {
      this.sendToClient({
        type: "status",
        status: "idle",
        message: "Batas durasi sesi 30 menit tercapai.",
      });
      this.close();
    }, MAX_DURATION);
  }

  private clearTimers(): void {
    if (this.warningTimer) clearTimeout(this.warningTimer);
    if (this.maxDurationTimer) clearTimeout(this.maxDurationTimer);
    this.warningTimer = null;
    this.maxDurationTimer = null;
  }

  private handleGeminiMessage(data: any): void {
    // 1. Interupsi (Barge-in)
    if (data.serverContent?.interrupted) {
      console.log("⚡ [Gemini Live] Interrupted: pengguna memotong bicara Celyn");
      this.sendToClient({ type: "interrupted" });
      return;
    }

    // 2. Audio & Transkrip
    const parts = data.serverContent?.modelTurn?.parts;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (part.inlineData && part.inlineData.mimeType?.startsWith("audio/")) {
          this.stats.audioChunksOut++;
          this.sendToClient({
            type: "audio",
            data: part.inlineData.data,
          });
        }
        if (part.text) {
          console.log(`💬 [Celyn AI]: ${part.text}`);
          this.sendToClient({
            type: "transcript",
            speaker: "celyn",
            text: part.text,
          });
        }
      }
    }

    // 2.5 Giliran Model Selesai
    if (data.serverContent?.turnComplete) {
      console.log("🏁 [Gemini Live] Giliran bicara Celyn selesai.");
      this.sendToClient({
        type: "status",
        status: "listening",
        message: "Celyn sedang mendengarkan ucapanmu...",
      });
    }

    // 3. Tool Calls
    const toolCall = data.toolCall;
    if (toolCall?.functionCalls && Array.isArray(toolCall.functionCalls)) {
      for (const fc of toolCall.functionCalls) {
        this.stats.toolCallsHandled++;
        console.log(`🔧 [Tool Call] ${fc.name}:`, fc.args);

        this.sendToClient({
          type: "tool_call",
          id: fc.id,
          name: fc.name,
          args: fc.args || {},
        });

        // Balas otomatis
        if (this.session) {
          try {
            this.session.sendToolResponse({
              functionResponses: [
                {
                  id: fc.id,
                  name: fc.name,
                  response: { output: { status: "applied" } },
                },
              ],
            });
          } catch (err) {
            console.error("Gagal mengirim tool response:", err);
          }
        }
      }
    }
  }

  public async handleClientMessage(msg: ClientMessage): Promise<void> {
    if (!this.session || !this.isConnected) return;

    try {
      if (msg.type === "audio") {
        this.stats.audioChunksIn++;
        await this.session.sendRealtimeInput({
          audio: {
            mimeType: "audio/pcm;rate=16000",
            data: msg.data,
          },
        });
      } else if (msg.type === "screen") {
        this.stats.screenFramesIn++;
        await this.session.sendRealtimeInput({
          video: {
            mimeType: "image/jpeg",
            data: msg.data,
          },
        });
      } else if (msg.type === "text") {
        console.log(`👤 [User Text]: "${msg.text}"`);
        await this.session.sendClientContent({
          turns: [{ role: "user", parts: [{ text: msg.text }] }],
          turnComplete: true,
        });
      } else if (msg.type === "tool_response") {
        await this.session.sendToolResponse({
          functionResponses: [
            {
              id: msg.id,
              name: "client_response",
              response: { output: msg.output },
            },
          ],
        });
      }
    } catch (err: any) {
      console.error("Error saat meneruskan pesan klien ke Gemini:", err.message);
    }
  }

  private sendToClient(msg: ServerMessage): void {
    if (this.clientWs.readyState === WebSocket.OPEN) {
      this.clientWs.send(JSON.stringify(msg));
    }
  }

  public close(): void {
    this.clearTimers();
    if (this.session) {
      try {
        this.session.close();
      } catch {}
      this.session = null;
    }
    this.isConnected = false;
  }
}
