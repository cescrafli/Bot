import { WebSocket } from "ws";
import { config } from "./config.js";
import { ClientMessage, ServerMessage } from "@celyn/shared";

const GEMINI_LIVE_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent";

export class GeminiSession {
  private geminiWs: WebSocket | null = null;
  private clientWs: WebSocket;
  private isConnected = false;

  constructor(clientWs: WebSocket) {
    this.clientWs = clientWs;
  }

  public async connect(): Promise<void> {
    if (!config.geminiApiKey) {
      this.sendToClient({
        type: "error",
        message:
          "GEMINI_API_KEY belum dikonfigurasi di backend (.env). Silakan atur API key Anda.",
      });
      return;
    }

    const url = `${GEMINI_LIVE_URL}?key=${config.geminiApiKey}`;

    try {
      this.geminiWs = new WebSocket(url);

      this.geminiWs.on("open", () => {
        this.isConnected = true;
        console.log("✅ Terhubung ke Gemini Multimodal Live API");
        this.sendSetupMessage();
        this.sendToClient({
          type: "status",
          status: "listening",
          message: "Celyn siap mendengarkan dan melihat layarmu!",
        });
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
        console.error("Gemini WebSocket Error:", err);
        this.sendToClient({
          type: "error",
          message: `Koneksi Gemini Error: ${err.message}`,
        });
      });

      this.geminiWs.on("close", (code: number, reason: Buffer) => {
        this.isConnected = false;
        console.log(`Gemini WebSocket ditutup (code: ${code}, reason: ${reason.toString()})`);
        this.sendToClient({
          type: "status",
          status: "idle",
          message: "Sesi Gemini berakhir.",
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
              text: `Nama kamu adalah Celyn, asisten AI pribadi yang ramah, hangat, pintar, dan ekspresif.
Kamu berbicara dalam Bahasa Indonesia yang santai, luwes, dan bersahabat (seperti teman ngobrol akrab, jangan kaku atau terlalu birokratis).
Kamu berwujud avatar virtual yang bisa berkedip, bergerak bibirnya saat berbicara, dan mengubah ekspresi wajah.

KEMAMPUAN UTAMA:
1. Suara Real-time: Kamu mendengar ucapan pengguna dan langsung membalas dengan suara.
2. Vision (Screen Share): Pengguna dapat membagikan layar komputernya. Kamu bisa melihat kode program, desain, antarmuka aplikasi, dokumen, atau browser yang sedang dibuka.
3. Bantu pengguna menganalisis kode error, memberi saran desain, atau membaca informasi di layar.

PEDOMAN PENTING:
- Berikan respons yang ringkas, jelas, dan to-the-point karena suaramu didengarkan langsung (hindari paragraf panjang yang melelahkan).
- Gunakan tool \`set_expression\` sesering mungkin saat suasana emosi pembicaraan berubah:
  * "happy": saat menyapa, memberi solusi berhasil, atau bercanda.
  * "thinking": saat sedang menganalisis layar atau berpikir.
  * "surprised": saat menemukan error unik, hal menarik, atau terkejut.
  * "neutral": saat menjelaskan hal biasa secara santai.
- Gunakan tool \`point_at_screen\` jika pengguna menanyakan sesuatu di layar, dengan koordinat x, y (0.0 sampai 1.0) agar tatapan matamu tertuju ke sana.
- Jika teks di layar buram atau tidak terbaca jelas, katakan dengan jujur bahwa bagian itu kurang jelas.`,
            },
          ],
        },
        tools: [
          {
            functionDeclarations: [
              {
                name: "set_expression",
                description:
                  "Mengatur ekspresi wajah avatar Celyn agar sesuai dengan emosi percakapan.",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    emotion: {
                      type: "STRING",
                      enum: ["neutral", "happy", "thinking", "surprised", "sad"],
                      description: "Jenis emosi yang ditampilkan avatar.",
                    },
                    intensity: {
                      type: "NUMBER",
                      description: "Intensitas emosi dari 0.0 sampai 1.0",
                    },
                  },
                  required: ["emotion"],
                },
              },
              {
                name: "point_at_screen",
                description:
                  "Mengarahkan tatapan avatar ke koordinat layar yang sedang dibahas.",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    x: {
                      type: "NUMBER",
                      description: "Koordinat horizontal relatif layar (0.0 kiri s/d 1.0 kanan)",
                    },
                    y: {
                      type: "NUMBER",
                      description: "Koordinat vertikal relatif layar (0.0 atas s/d 1.0 bawah)",
                    },
                    description: {
                      type: "STRING",
                      description: "Keterangan elemen apa yang sedang dilihat",
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

    console.log("📤 Mengirim konfigurasi setup ke Gemini...");
    this.geminiWs.send(JSON.stringify(setupPayload));
  }

  private handleGeminiMessage(data: any): void {
    // 1. Tangani interupsi (pengguna mulai bicara saat Gemini sedang membalas suara)
    if (data.serverContent?.interrupted) {
      console.log("⚡ Barge-in: AI diinterupsi oleh pengguna");
      this.sendToClient({ type: "interrupted" });
      return;
    }

    // 2. Tangani audio output dari Gemini
    const parts = data.serverContent?.modelTurn?.parts;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (part.inlineData && part.inlineData.mimeType?.startsWith("audio/")) {
          this.sendToClient({
            type: "audio",
            data: part.inlineData.data,
          });
        }
        if (part.text) {
          this.sendToClient({
            type: "transcript",
            speaker: "celyn",
            text: part.text,
          });
        }
      }
    }

    // 3. Tangani Tool Calls (set_expression / point_at_screen)
    const toolCall = data.toolCall;
    if (toolCall?.functionCalls && Array.isArray(toolCall.functionCalls)) {
      for (const fc of toolCall.functionCalls) {
        console.log(`🔧 Tool call diterima dari Gemini: ${fc.name}`, fc.args);
        this.sendToClient({
          type: "tool_call",
          id: fc.id,
          name: fc.name,
          args: fc.args || {},
        });

        // Balas otomatis ke Gemini agar percakapan terus berlanjut tanpa menunggu
        this.sendToolResponse(fc.id, fc.name, { status: "success" });
      }
    }
  }

  public handleClientMessage(msg: ClientMessage): void {
    if (!this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN) return;

    if (msg.type === "audio") {
      // Chunk audio PCM 16kHz mono dari mikrofon pengguna
      const payload = {
        realtimeInput: {
          mediaChunks: [
            {
              mimeType: "audio/pcm;rate=16000",
              data: msg.data,
            },
          ],
        },
      };
      this.geminiWs.send(JSON.stringify(payload));
    } else if (msg.type === "screen") {
      // Frame layar JPEG
      const payload = {
        realtimeInput: {
          mediaChunks: [
            {
              mimeType: "image/jpeg",
              data: msg.data,
            },
          ],
        },
      };
      this.geminiWs.send(JSON.stringify(payload));
    } else if (msg.type === "text") {
      // Pesan teks langsung jika pengguna mengetik
      const payload = {
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
      this.geminiWs.send(JSON.stringify(payload));
    } else if (msg.type === "tool_response") {
      this.sendToolResponse(msg.id, "client_function", msg.output);
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
    if (this.geminiWs) {
      this.geminiWs.close();
      this.geminiWs = null;
    }
  }
}
