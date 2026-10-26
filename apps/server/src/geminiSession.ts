import { WebSocket } from "ws";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { config } from "./config.js";
import { synthesizeEdgeTTS } from "./edgeTts.js";
import {
  ClientMessage,
  ServerMessage,
  EmotionType,
  inferEmotionFromText,
  normalizeEmotion,
  buildContextualGreetingPrompt,
  CELYN_SYSTEM_PROMPT,
  CELYN_GREETING_PROMPT,
  DEFAULT_VOICE_NAME,
  extractIndonesianSentences,
} from "@celyn/shared";

export type SessionState = "DISCONNECTED" | "CONNECTING" | "ACTIVE" | "CLOSING" | "CLOSED";

export class GeminiSession {
  private session: any = null;
  private clientWs: WebSocket;
  private state: SessionState = "DISCONNECTED";
  private pendingQueue: ClientMessage[] = [];
  private maxDurationTimer: NodeJS.Timeout | null = null;
  private warningTimer: NodeJS.Timeout | null = null;

  // State untuk streaming sintesis suara Microsoft Edge Neural (id-ID-GadisNeural)
  private ttsBuffer = "";
  private ttsTurnId = 0;
  private ttsChain: Promise<void> = Promise.resolve();
  private useEdgeTts = true;
  private activeVoice: string;
  private isFirstChunkInTurn = true;
  private currentEmotion: EmotionType = "neutral";
  private explicitEmotionUsedInTurn = false;
  private relaxEmotionTimer: NodeJS.Timeout | null = null;
  private isBargeInMuted = false;
  private backupPcmChunks: string[] = [];

  public stats = {
    audioChunksIn: 0,
    audioChunksOut: 0,
    screenFramesIn: 0,
    toolCallsHandled: 0,
  };

  constructor(clientWs: WebSocket, customVoice?: string) {
    this.clientWs = clientWs;
    this.activeVoice = customVoice || config.geminiVoice;
    this.useEdgeTts =
      this.activeVoice.includes("Neural") ||
      this.activeVoice.startsWith("id-ID");
  }

  public async connect(): Promise<void> {
    if (this.state === "CONNECTING" || this.state === "ACTIVE") return;
    this.state = "CONNECTING";

    if (!config.geminiApiKey) {
      this.state = "CLOSED";
      this.sendToClient({
        type: "error",
        message: "GEMINI_API_KEY belum dikonfigurasi di backend (.env).",
      });
      return;
    }

    try {
      console.log(
        `🔌 [Gemini Live SDK] Menginisialisasi sesi (${config.geminiModel}) dengan suara: ${this.activeVoice}`
      );
      const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
      const internalGeminiVoice = this.useEdgeTts ? "Aoede" : this.activeVoice;

      this.session = await ai.live.connect({
        model: config.geminiModel,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            languageCode: "id-ID",
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: internalGeminiVoice,
              },
            },
          },
          // Aktifkan transkripsi dua arah real-time Bahasa Indonesia
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: {
            parts: [
              {
                text: CELYN_SYSTEM_PROMPT,
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
            this.state = "CLOSED";
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

      this.state = "ACTIVE";
      console.log("✅ [Gemini Live SDK] Sesi Celyn berhasil tersambung dan siap merespons!");

      // Kirim informasi model aktif ke klien
      this.sendToClient({
        type: "session_info",
        model: config.geminiModel,
        voice: this.activeVoice,
      });

      this.sendToClient({
        type: "status",
        status: "listening",
        message: "Celyn aktif dan siap mendengarkan ucapanmu!",
      });

      // Flush paket yang sempat masuk saat CONNECTING
      if (this.pendingQueue.length > 0) {
        console.log(`📦 [Gemini Live] Mem-flush ${this.pendingQueue.length} paket audio/pesan tertunda...`);
        const queueToProcess = [...this.pendingQueue];
        this.pendingQueue = [];
        for (const queuedMsg of queueToProcess) {
          await this.forwardMessageToGemini(queuedMsg);
        }
      }

      // Picu sapaan ramah pembuka Celyn secara otomatis saat pertama kali tersambung
      setTimeout(async () => {
        if (this.session && this.state === "ACTIVE") {
          try {
            console.log("👋 [Gemini Live] Mengirim trigger sapaan pembuka Celyn...");
            await this.session.sendClientContent({
              turns: [
                {
                  role: "user",
                  parts: [
                    {
                      text: buildContextualGreetingPrompt(),
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
      this.state = "CLOSED";
      console.error("Gagal menghubungkan ke Gemini Live API:", err);
      this.sendToClient({
        type: "error",
        message: `Gagal membuka sesi Gemini: ${err.message}`,
      });
    }
  }

  private setupSessionDurationLimit(): void {
    this.warningTimer = setTimeout(() => {
      this.sendToClient({
        type: "status",
        status: "listening",
        message: "Perhatian: Sesi telah berjalan 25 menit. Sesi akan otomatis direset pada menit ke-30.",
      });
    }, config.sessionWarningDurationMs);

    this.maxDurationTimer = setTimeout(() => {
      this.sendToClient({
        type: "status",
        status: "idle",
        message: "Batas durasi sesi 30 menit tercapai.",
      });
      this.close();
    }, config.sessionMaxDurationMs);
  }

  private clearTimers(): void {
    if (this.warningTimer) clearTimeout(this.warningTimer);
    if (this.maxDurationTimer) clearTimeout(this.maxDurationTimer);
    this.warningTimer = null;
    this.maxDurationTimer = null;
  }

  private cancelPendingTts(): void {
    this.ttsTurnId++;
    this.ttsBuffer = "";
    this.backupPcmChunks = [];
    this.isFirstChunkInTurn = true;
    this.explicitEmotionUsedInTurn = false;
    if (this.relaxEmotionTimer) {
      clearTimeout(this.relaxEmotionTimer);
      this.relaxEmotionTimer = null;
    }
  }

  private flushCompleteSentences(forceAll: boolean): void {
    if (!this.useEdgeTts) return;

    const { sentences, remaining } = extractIndonesianSentences(
      this.ttsBuffer,
      forceAll,
      this.isFirstChunkInTurn
    );
    this.ttsBuffer = remaining;

    for (const sentence of sentences) {
      this.isFirstChunkInTurn = false;

      // Auto-emotion inference dari teks jika LLM belum memanggil tool set_expression
      if (!this.explicitEmotionUsedInTurn) {
        const detected = inferEmotionFromText(sentence);
        if (detected !== "neutral" && detected !== this.currentEmotion) {
          this.currentEmotion = detected;
          this.sendToClient({
            type: "tool_call",
            id: "auto_expression",
            name: "set_expression",
            args: { emotion: detected },
          });
        }
      }

      this.enqueueEdgeTts(sentence, this.ttsTurnId, this.currentEmotion);
    }
  }

  private enqueueEdgeTts(
    sentence: string,
    turnId: number,
    emotion?: EmotionType
  ): void {
    const voice = this.activeVoice || config.geminiVoice || DEFAULT_VOICE_NAME;
    // Pipelined parallel prefetch: sintesis Edge TTS langsung dijalankan seketika di background
    const prefetchPromise = synthesizeEdgeTTS(sentence, { voice, emotion });

    this.ttsChain = this.ttsChain
      .then(async () => {
        if (turnId !== this.ttsTurnId || this.state !== "ACTIVE") return;
        try {
          const mp3Buf = await prefetchPromise;
          if (
            turnId !== this.ttsTurnId ||
            this.state !== "ACTIVE" ||
            mp3Buf.length === 0
          ) {
            return;
          }
          this.stats.audioChunksOut++;
          this.sendToClient({
            type: "audio",
            data: mp3Buf.toString("base64"),
            mimeType: "audio/mp3",
          });
        } catch (err: any) {
          console.error(
            `❌ [Edge Neural TTS] Gagal menyintesis kalimat:`,
            err?.message || err
          );
          if (
            this.backupPcmChunks.length > 0 &&
            turnId === this.ttsTurnId &&
            this.state === "ACTIVE"
          ) {
            const allFallbackPcm = this.backupPcmChunks.splice(0);
            console.warn(`⚠️ Mengirim ${allFallbackPcm.length} audio cadangan Gemini PCM (Server Fallback)`);
            for (const fallbackPcm of allFallbackPcm) {
              this.stats.audioChunksOut++;
              this.sendToClient({
                type: "audio",
                data: fallbackPcm,
                mimeType: "audio/pcm",
              });
            }
          }
        }
      })
      .catch(() => {});
  }

  private handleGeminiMessage(data: any): void {
    // 1. Interupsi (Barge-in)
    if (data.serverContent?.interrupted) {
      console.log("⚡ [Gemini Live] Interrupted: pengguna memotong bicara Celyn");
      this.isBargeInMuted = false;
      this.cancelPendingTts();
      this.sendToClient({ type: "interrupted" });
      return;
    }

    // 2. Transkripsi Suara Pengguna (Input Transcription)
    if (data.serverContent?.inputTranscription?.text) {
      this.isBargeInMuted = false;
      this.backupPcmChunks = [];
      const userText = data.serverContent.inputTranscription.text.trim();
      if (userText) {
        console.log(`🎙️ [User Speech]: ${userText}`);
        this.sendToClient({
          type: "transcript",
          speaker: "user",
          text: userText,
        });
        // ⚡ Berikan feedback visual seketika bahwa ucapan telah didengar dan sedang diproses
        this.sendToClient({
          type: "status",
          status: "thinking",
          message: "Celyn sedang menyimak & merangkai jawaban...",
        });
      }
    }

    // 2.1 Transkripsi Suara Celyn (Output Transcription Bahasa Indonesia)
    if (data.serverContent?.outputTranscription?.text) {
      if (!this.isBargeInMuted) {
        const celynText = data.serverContent.outputTranscription.text;
        if (celynText) {
          this.sendToClient({
            type: "transcript",
            speaker: "celyn",
            text: celynText,
          });

          // Auto-emotion inference di semua mode suara (Edge TTS maupun Native Gemini Live)
          if (!this.explicitEmotionUsedInTurn) {
            const detected = inferEmotionFromText(celynText);
            if (detected !== "neutral" && detected !== this.currentEmotion) {
              this.currentEmotion = detected;
              this.sendToClient({
                type: "tool_call",
                id: "auto_expression",
                name: "set_expression",
                args: { emotion: detected },
              });
            }
          }

          if (this.useEdgeTts) {
            this.ttsBuffer += celynText;
            this.flushCompleteSentences(false);
          }
        }
      }
    }

    // 2.2 Audio & Transkrip dari Model Turn
    const parts = data.serverContent?.modelTurn?.parts;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        // Abaikan token thought internal model agar tidak tampil atau dibacakan
        if (part.thought) continue;

        if (part.inlineData && part.inlineData.mimeType?.startsWith("audio/")) {
          if (!this.isBargeInMuted) {
            this.backupPcmChunks.push(part.inlineData.data);
          }
          // Hanya kirim audio bawaan Gemini jika tidak menggunakan Microsoft Edge Neural TTS
          if (!this.useEdgeTts && !this.isBargeInMuted) {
            this.stats.audioChunksOut++;
            this.sendToClient({
              type: "audio",
              data: part.inlineData.data,
              mimeType: "audio/pcm",
            });
          }
        }
        if (part.text && !data.serverContent?.outputTranscription?.text) {
          if (this.isBargeInMuted) continue;
          console.log(`💬 [Celyn AI]: ${part.text}`);
          this.sendToClient({
            type: "transcript",
            speaker: "celyn",
            text: part.text,
          });
          if (this.useEdgeTts) {
            this.ttsBuffer += part.text;
            this.flushCompleteSentences(false);
          }
        }
      }
    }

    // 2.5 Giliran Model Selesai
    if (data.serverContent?.turnComplete) {
      this.isBargeInMuted = false;
      console.log("🏁 [Gemini Live] Giliran bicara Celyn selesai.");
      this.isFirstChunkInTurn = true;
      this.explicitEmotionUsedInTurn = false;

      // Kembalikan ekspresi wajah secara rileks ke netral setelah beberapa detik selesai bicara
      if (this.relaxEmotionTimer) clearTimeout(this.relaxEmotionTimer);
      this.relaxEmotionTimer = setTimeout(() => {
        if (this.state === "ACTIVE" && this.currentEmotion !== "neutral") {
          this.currentEmotion = "neutral";
          this.sendToClient({
            type: "tool_call",
            id: "auto_relax",
            name: "set_expression",
            args: { emotion: "neutral" },
          });
        }
      }, 4500);

      if (this.useEdgeTts) {
        this.flushCompleteSentences(true);
        const turnAtComplete = this.ttsTurnId;
        this.ttsChain.then(() => {
          this.backupPcmChunks = [];
          if (this.ttsTurnId === turnAtComplete && this.state === "ACTIVE") {
            this.sendToClient({
              type: "status",
              status: "listening",
              message: "Celyn sedang mendengarkan ucapanmu...",
            });
          }
        });
      } else {
        this.backupPcmChunks = [];
        this.sendToClient({
          type: "status",
          status: "listening",
          message: "Celyn sedang mendengarkan ucapanmu...",
        });
      }
    }

    // 3. Tool Calls
    const toolCall = data.toolCall;
    if (toolCall?.functionCalls && Array.isArray(toolCall.functionCalls)) {
      for (const fc of toolCall.functionCalls) {
        this.stats.toolCallsHandled++;
        console.log(`🔧 [Tool Call] ${fc.name}:`, fc.args);

        let sanitizedArgs = fc.args || {};
        if (fc.name === "set_expression") {
          const normEmotion = normalizeEmotion(sanitizedArgs.emotion);
          sanitizedArgs = { ...sanitizedArgs, emotion: normEmotion };
          this.explicitEmotionUsedInTurn = true;
          this.currentEmotion = normEmotion;
        } else if (fc.name === "point_at_screen") {
          const clampedX = Math.max(0, Math.min(1, Number(sanitizedArgs.x) || 0.5));
          const clampedY = Math.max(0, Math.min(1, Number(sanitizedArgs.y) || 0.5));
          sanitizedArgs = { ...sanitizedArgs, x: clampedX, y: clampedY };
        }

        this.sendToClient({
          type: "tool_call",
          id: fc.id,
          name: fc.name,
          args: sanitizedArgs,
        });

        // Balas otomatis ke sesi Gemini Live
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
    if (this.state === "CLOSED" || this.state === "CLOSING") return;

    if (this.state === "CONNECTING") {
      // Simpan di Ring Buffer sementara (maksimal 30 paket audio/pesan)
      if (this.pendingQueue.length < 30) {
        this.pendingQueue.push(msg);
      } else {
        // Buang paket terlama jika penuh
        this.pendingQueue.shift();
        this.pendingQueue.push(msg);
      }
      return;
    }

    if (this.state === "ACTIVE") {
      await this.forwardMessageToGemini(msg);
    }
  }

  private async forwardMessageToGemini(msg: ClientMessage): Promise<void> {
    if (!this.session || this.state !== "ACTIVE") return;

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
        this.cancelPendingTts();
        await this.session.sendClientContent({
          turns: [{ role: "user", parts: [{ text: msg.text }] }],
          turnComplete: true,
        });
      } else if (msg.type === "barge_in") {
        console.log("⚡ [Client Barge-In] Membatalkan antrean TTS Celyn & mengaktifkan guard turn bleed...");
        this.isBargeInMuted = true;
        this.cancelPendingTts();
      } else if (msg.type === "audio_stream_end") {
        try {
          await this.session.sendRealtimeInput({
            audioStreamEnd: true,
          });
        } catch (e: any) {
          console.warn("sendRealtimeInput audioStreamEnd warning:", e?.message);
        }
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
    this.state = "CLOSING";
    this.cancelPendingTts();
    this.clearTimers();
    this.pendingQueue = [];
    if (this.session) {
      try {
        this.session.close();
      } catch {}
      this.session = null;
    }
    this.state = "CLOSED";
  }
}
