import { WebSocket } from "ws";
import { config } from "./config.js";
import { ClientMessage, ServerMessage } from "@celyn/shared";

// Gunakan v1beta untuk Gemini Live API
const GEMINI_LIVE_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

export class GeminiSession {
  private geminiWs: WebSocket | null = null;
  private clientWs: WebSocket;
  private isConnected = false;
  private isSetupComplete = false;
  private pendingQueue: any[] = [];
  private sessionStartTime: number = Date.now();
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
        message:
          "GEMINI_API_KEY belum dikonfigurasi di backend (.env). Silakan isi API key Anda di .env root.",
      });
      return;
    }

    const url = `${GEMINI_LIVE_URL}?key=${config.geminiApiKey}`;

    try {
      this.geminiWs = new WebSocket(url);
      this.sessionStartTime = Date.now();

      this.geminiWs.on("open", () => {
        this.isConnected = true;
        console.log("✅ [Gemini Live] Terhubung ke Google Generative Service WebSocket (v1beta)");
        this.sendSetupMessage();

        // Setup timer proteksi durasi sesi (Maks 30 menit per sesi)
        this.setupSessionDurationLimit();
      });

      this.geminiWs.on("message", (raw: Buffer) => {
        try {
          const data = JSON.parse(raw.toString("utf8"));
          this.handleGeminiMessage(data);
        } catch (err) {
          console.error("Gagal mem-parse pesan dari Gemini:", err);
        }
      });

      this.geminiWs.on("error", (err: Error) => {
        console.error("Gemini WebSocket Error:", err.message);
        this.sendToClient({
          type: "error",
          message: `Koneksi Gemini Error: ${err.message}`,
        });
      });

      this.geminiWs.on("close", (code: number, reason: Buffer) => {
        this.isConnected = false;
        this.isSetupComplete = false;
        console.log(`Gemini WebSocket ditutup (code: ${code}, reason: ${reason.toString()})`);
        this.clearTimers();
        this.sendToClient({
          type: "status",
          status: "idle",
          message: "Sesi Gemini telah berakhir.",
        });
      });
    } catch (err: any) {
      console.error("Gagal membuka koneksi ke Gemini:", err);
      this.sendToClient({
        type: "error",
        message: `Gagal menghubungkan ke Gemini Live API: ${err.message}`,
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
        message: "Perhatian: Sesi telah berjalan 25 menit. Sesi akan otomatis direset pada menit ke-30 demi keamanan kuota.",
      });
    }, WARNING_TIME);

    this.maxDurationTimer = setTimeout(() => {
      this.sendToClient({
        type: "status",
        status: "idle",
        message: "Batas durasi sesi 30 menit tercapai. Silakan mulai sesi baru kapan saja.",
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

  private sendSetupMessage(): void {
    if (!this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN) return;

    const setupPayload = {
      setup: {
        model: `models/${config.geminiModel}`,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: config.geminiVoice,
              },
            },
          },
        },
        systemInstruction: {
          parts: [
            {
              text: `Nama kamu adalah Celyn, asisten AI pribadi berwujud avatar visual perempuan muda yang pintar, ramah, hangat, dan ekspresif.
Kamu berbicara dalam Bahasa Indonesia yang santai, luwes, natural, dan bersahabat (seperti teman mengobrol yang asik, gunakan kata sapaan wajar seperti 'kamu', 'aku', 'wah', 'oke', 'sip'). Jangan gunakan bahasa yang kaku seperti surat resmi pemerintah.

FITUR & TANGGUNG JAWAB:
1. Suara Real-time: Kamu mendengar ucapan pengguna lewat mikrofon dan langsung menjawabnya dengan suara.
2. Penglihatan Layar (Screen Share): Jika pengguna membagikan layar komputernya, kamu bisa melihat apa yang ada di layar (kode pemrograman, peramban web, desain, teks dokumen, error terminal, dsb.).
3. Bantu pengguna memecahkan masalah coding, menerjemahkan teks di layar, atau mendiskusikan konten visual yang sedang mereka buka.

ATURAN WAJIB PERCAKAPAN:
- Buat jawaban yang RINGKAS, PADAT, dan LUGAS (1 sampai 3 kalimat pendek) karena suaramu dibacakan langsung. Pengguna tidak suka mendengarkan monolog panjang.
- Sering-seringlah memanggil tool \`set_expression\` setiap kali ada transisi emosi:
  * "happy": saat menyapa, memberi selamat, merasa senang, atau bercanda.
  * "thinking": saat sedang menganalisis tampilan layar atau berpikir sebelum memberi jawaban.
  * "surprised": jika melihat error yang tidak biasa, hal lucu, atau fakta mengejutkan.
  * "neutral": saat menjelaskan hal biasa secara tenang.
  * "sad": jika pengguna mengalami kendala berat atau kamu bersimpati.
- Panggil tool \`point_at_screen\` dengan perkiraan koordinat x, y (0.0 sampai 1.0) jika pengguna menanyakan lokasi suatu elemen di layar, agar matamu melirik ke sana dan sistem menandai posisinya.
- Jika teks pada layar buram atau sulit dibaca, katakan dengan jujur dan minta pengguna memperbesar tampilannya.`,
            },
          ],
        },
        tools: [
          {
            functionDeclarations: [
              {
                name: "set_expression",
                description:
                  "Ubah ekspresi wajah avatar Celyn agar selaras dengan nuansa percakapan.",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    emotion: {
                      type: "STRING",
                      enum: ["neutral", "happy", "thinking", "surprised", "sad"],
                      description: "Jenis emosi yang akan ditampilkan oleh avatar.",
                    },
                    intensity: {
                      type: "NUMBER",
                      description: "Tingkat intensitas emosi dari 0.0 sampai 1.0",
                    },
                  },
                  required: ["emotion"],
                },
              },
              {
                name: "point_at_screen",
                description:
                  "Mengarahkan tatapan dan crosshair penanda ke area layar yang sedang dibahas.",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    x: {
                      type: "NUMBER",
                      description: "Koordinat horizontal relatif layar (0.0 paling kiri, 1.0 paling kanan)",
                    },
                    y: {
                      type: "NUMBER",
                      description: "Koordinat vertikal relatif layar (0.0 paling atas, 1.0 paling bawah)",
                    },
                    description: {
                      type: "STRING",
                      description: "Keterangan singkat objek atau tombol yang ditunjuk",
                    },
                  },
                  required: ["x", "y"],
                },
              },
            ],
          },
        ],
      },
    };

    console.log(`📤 [Gemini Live] Mengirim konfigurasi setup (${config.geminiModel}, Suara: ${config.geminiVoice})...`);
    this.geminiWs.send(JSON.stringify(setupPayload));
  }

  private handleGeminiMessage(data: any): void {
    // 1. Konfirmasi Setup Selesai dari Gemini Live API
    if (data.setupComplete) {
      this.isSetupComplete = true;
      console.log("🎉 [Gemini Live] Sesi Setup Selesai! Celyn siap menerima suara & gambar.");
      this.sendToClient({
        type: "status",
        status: "listening",
        message: "Celyn aktif dan siap mendengarkan!",
      });

      // Kirim pesan yang tertunda selama fase setup
      while (this.pendingQueue.length > 0) {
        const item = this.pendingQueue.shift();
        this.geminiWs?.send(JSON.stringify(item));
      }
      return;
    }

    // 2. Interupsi (Barge-in): pengguna memotong pembicaraan AI
    if (data.serverContent?.interrupted) {
      console.log("⚡ [Gemini Live] Sinyal Interrupted diterima: pengguna memotong bicara Celyn");
      this.sendToClient({ type: "interrupted" });
      return;
    }

    // 3. Audio & Transkrip dari respon Gemini
    const parts = data.serverContent?.modelTurn?.parts;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (part.inlineData && part.inlineData.mimeType?.startsWith("audio/")) {
          this.stats.audioChunksOut++;
          if (this.stats.audioChunksOut === 1 || this.stats.audioChunksOut % 30 === 0) {
            console.log(`🔊 [Gemini Live] Mengirim streaming audio balasan Celyn ke klien (${this.stats.audioChunksOut} chunks)`);
          }
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

    // 4. Tool Calls (set_expression / point_at_screen)
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

        // Balas toolResponse segera ke Gemini
        this.sendToolResponse(fc.id, fc.name, { status: "applied", timestamp: Date.now() });
      }
    }
  }

  public handleClientMessage(msg: ClientMessage): void {
    if (!this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN) return;

    let payload: any = null;

    if (msg.type === "audio") {
      this.stats.audioChunksIn++;
      if (this.stats.audioChunksIn === 1 || this.stats.audioChunksIn % 50 === 0) {
        console.log(`🎙️ [Client Audio] Menerima chunk mikrofon ke-${this.stats.audioChunksIn} (Setup complete: ${this.isSetupComplete})`);
      }
      payload = {
        realtimeInput: {
          mediaChunks: [
            {
              mimeType: "audio/pcm;rate=16000",
              data: msg.data,
            },
          ],
        },
      };
    } else if (msg.type === "screen") {
      this.stats.screenFramesIn++;
      payload = {
        realtimeInput: {
          mediaChunks: [
            {
              mimeType: "image/jpeg",
              data: msg.data,
            },
          ],
        },
      };
    } else if (msg.type === "text") {
      payload = {
        clientContent: {
          turns: [
            {
              role: "user",
              parts: [{ text: msg.text }],
            },
          ],
          turnComplete: true,
        },
      };
    } else if (msg.type === "tool_response") {
      this.sendToolResponse(msg.id, "client_response", msg.output);
      return;
    }

    if (payload) {
      if (this.isSetupComplete) {
        this.geminiWs.send(JSON.stringify(payload));
      } else {
        // Simpan sementara di antrean sampai setupComplete diterima
        if (this.pendingQueue.length < 50) {
          this.pendingQueue.push(payload);
        }
      }
    }
  }

  public sendToolResponse(
    id: string,
    name: string,
    responseObj: Record<string, unknown>
  ): void {
    if (!this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN) return;

    const payload = {
      toolResponse: {
        functionResponses: [
          {
            id,
            response: { output: responseObj },
          },
        ],
      },
    };
    this.geminiWs.send(JSON.stringify(payload));
  }

  private sendToClient(msg: ServerMessage): void {
    if (this.clientWs.readyState === WebSocket.OPEN) {
      this.clientWs.send(JSON.stringify(msg));
    }
  }

  public close(): void {
    this.clearTimers();
    this.pendingQueue = [];
    if (this.geminiWs) {
      try {
        this.geminiWs.close();
      } catch {}
      this.geminiWs = null;
    }
  }
}
