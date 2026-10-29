import { WebSocket } from "ws";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { config } from "./config.js";
import { synthesizeEdgeTTS } from "./edgeTts.js";
import { memoryService } from "./services/MemoryService.js";
import { researchService } from "./services/ResearchService.js";
import { jobService } from "./services/JobService.js";
import { documentService } from "./services/DocumentService.js";
import {
  ClientMessage,
  ServerMessage,
  EmotionType,
  AuthMode,
  inferEmotionFromText,
  inferUserEmotion,
  normalizeEmotion,
  buildContextualGreetingPrompt,
  buildCelynSystemPrompt,
  CELYN_SYSTEM_PROMPT,
  CELYN_GREETING_PROMPT,
  DEFAULT_VOICE_NAME,
  resolveVoiceId,
  extractIndonesianSentences,
  RESEARCH_STATUS_TEXT,
  stripVoiceMetadataTags,
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
  private authMode: AuthMode = "default";
  private isFirstChunkInTurn = true;
  private currentEmotion: EmotionType = "neutral";
  private explicitEmotionUsedInTurn = false;
  private relaxEmotionTimer: NodeJS.Timeout | null = null;
  private isBargeInMuted = false;
  private backupPcmChunks: string[] = [];
  private hasPendingToolCall = false;
  private hasUserInitiatedTurn = false;
  public sessionId: string;
  private memoryContext?: string;
  private currentTurnCelynText = "";
  private currentTurnUserSpeech = "";
  private activeDocs: Map<string, { fileName: string; content: string }> = new Map();

  public stats = {
    audioChunksIn: 0,
    audioChunksOut: 0,
    screenFramesIn: 0,
    toolCallsHandled: 0,
  };

  constructor(
    clientWs: WebSocket,
    customVoice?: string,
    authMode: AuthMode = "default",
    sessionId?: string,
    memoryContext?: string
  ) {
    this.clientWs = clientWs;
    this.activeVoice = resolveVoiceId(customVoice || config.geminiVoice);
    this.authMode = authMode;
    this.sessionId =
      sessionId || `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.memoryContext = memoryContext;
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
                text: buildCelynSystemPrompt(this.authMode, this.memoryContext),
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
                        enum: ["neutral", "happy", "thinking", "surprised", "sad", "shy"],
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
                {
                  name: "remember_fact",
                  description: "Simpan fakta, preferensi pribadi (seperti makanan/minuman favorit), jadwal, janji, atau informasi penting yang diminta pengguna untuk diingat ke memori jangka panjang.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      fact: {
                        type: Type.STRING,
                        description: "Isi fakta atau preferensi yang harus diingat secara jelas dan ringkas (contoh: 'Rafli suka minum americano dingin (kopi/minuman kesukaan)', 'Rafli ada jadwal meeting jam 8 malam')",
                      },
                      category: {
                        type: Type.STRING,
                        enum: ["preferensi", "jadwal", "identitas", "fakta", "catatan", "topik", "proyek", "rencana"],
                        description: "Kategori memori: 'preferensi' (makanan, minuman, kebiasaan), 'jadwal' (waktu/jam kegiatan), 'identitas' (tentang diri pengguna), atau 'catatan'",
                      },
                      importance: {
                        type: Type.NUMBER,
                        description: "Tingkat kepentingan skala 1 sampai 3 (3 = sangat penting/jadwal krusial, 2 = preferensi utama, 1 = fakta umum)",
                      },
                    },
                    required: ["fact"],
                  },
                },
                {
                  name: "create_document",
                  description: "Buat atau ekspor dokumen laporan, ringkasan, atau lembar kerja ke format PDF (.pdf), Word (.docx), atau Excel (.xlsx) saat diminta pengguna.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      kind: {
                        type: Type.STRING,
                        enum: ["pdf", "docx", "xlsx"],
                        description: "Format dokumen: 'pdf', 'docx', atau 'xlsx'",
                      },
                      title: {
                        type: Type.STRING,
                        description: "Judul dokumen yang relevan",
                      },
                      instruction: {
                        type: Type.STRING,
                        description: "Instruksi rincian isi, topik, atau data yang harus dimuat dalam dokumen",
                      },
                    },
                    required: ["kind", "title"],
                  },
                },
                {
                  name: "process_document",
                  description:
                    "Proses dokumen yang sudah diunggah: summarize (meringkas), translate (menerjemahkan), paraphrase (parafrase), edit (mengubah isi dengan menjaga format), atau custom (analisis bebas).",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      docId: { type: Type.STRING, description: "Nama file atau ID dokumen" },
                      operation: {
                        type: Type.STRING,
                        enum: ["summarize", "translate", "paraphrase", "edit", "custom"],
                        description: "Operasi dokumen",
                      },
                      targetLanguage: {
                        type: Type.STRING,
                        description: "Bahasa tujuan khusus untuk translate. TANYAKAN dulu jika belum diketahui.",
                      },
                      instruction: {
                        type: Type.STRING,
                        description: "Instruksi spesifik pengeditan atau analisis",
                      },
                    },
                    required: ["docId", "operation"],
                  },
                },
                {
                  name: "research",
                  description:
                    "Lakukan riset mendalam atau pencarian fakta dan informasi terkini di web. Kembalikan temuan beserta link/tautan sumber rujukan.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      query: { type: Type.STRING, description: "Topik atau kueri pencarian riset" },
                    },
                    required: ["query"],
                  },
                },
              ],
            },
          ],
        },
        callbacks: {
          onmessage: (data: any) => this.handleGeminiMessage(data),
          onerror: (err: any) => {
            console.error("Celyn Live Error:", err);
            this.sendToClient({
              type: "error",
              message: `Koneksi Celyn mengalami kendala: ${err?.message || "Terjadi kesalahan koneksi"}`,
            });
          },
          onclose: (e: any) => {
            this.state = "CLOSED";
            console.log("Gemini SDK Session closed: code", e?.code, "reason:", e?.reason || "clean");
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

      // ⚡ Priming Audio Pipeline: Kirim 1 frame silence PCM 16kHz (64ms = 2048 bytes)
      // agar subsistem audio decoder Gemini Live selalu aktif meskipun pengguna belum menyalakan mic
      try {
        const primingSilence = Buffer.alloc(2048).toString("base64");
        await this.session.sendRealtimeInput({
          audio: {
            mimeType: "audio/pcm;rate=16000",
            data: primingSilence,
          },
        });
      } catch (e: any) {
        console.warn("Priming audio warning:", e?.message);
      }

      // Kirim informasi model aktif ke klien
      this.sendToClient({
        type: "session_info",
        model: config.geminiModel,
        voice: this.activeVoice,
      });

      this.sendToClient({
        type: "status",
        status: "listening",
        message: "Siaga • Siap Berbicara",
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

      // Picu sapaan ramah pembuka Celyn secara otomatis HANYA jika pengguna belum mengirim pesan/suara
      setTimeout(async () => {
        if (!this.hasUserInitiatedTurn && this.session && this.state === "ACTIVE") {
          try {
            console.log("👋 [Gemini Live] Mengirim trigger sapaan pembuka Celyn...");
            await this.session.sendClientContent({
              turns: [
                {
                  role: "user",
                  parts: [
                    {
                      text: buildContextualGreetingPrompt(new Date(), this.authMode),
                    },
                  ],
                },
              ],
              turnComplete: true,
            });
          } catch (e) {
            console.warn("Gagal auto-greeting:", e);
          }
        } else if (this.hasUserInitiatedTurn) {
          console.log("ℹ️ [Gemini Live] Auto-greeting dilewati karena pengguna telah mengirim pesan pertama.");
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
        // Jika sebelumnya 'sad' dan kalimat berikutnya netral/penyemangat, pulihkan segera ke neutral
        if (this.currentEmotion === "sad" && detected === "neutral") {
          this.currentEmotion = "neutral";
          this.sendToClient({
            type: "tool_call",
            id: "auto_relax_sad",
            name: "set_expression",
            args: { emotion: "neutral" },
          });
        } else if (detected !== "neutral" && detected !== this.currentEmotion) {
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

  private async handleGeminiMessage(data: any): Promise<void> {
    // 1. Interupsi (Barge-in)
    if (data.serverContent?.interrupted) {
      console.log("⚡ [Gemini Live] Interrupted: pengguna memotong bicara Celyn");
      this.isBargeInMuted = false;
      this.cancelPendingTts();
      if (this.currentTurnUserSpeech.trim()) {
        const fullUserText = this.currentTurnUserSpeech.trim();
        this.currentTurnUserSpeech = "";
        if (this.authMode === "jocelyn") {
          memoryService.recordTurn(this.sessionId, "user", fullUserText);
        }
      }
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
        this.currentTurnUserSpeech += (this.currentTurnUserSpeech ? " " : "") + userText;

        this.sendToClient({
          type: "transcript",
          speaker: "user",
          text: userText,
        });

        // ⚡ Deteksi nada & emosi suara pengguna secara real-time
        const userEmotion = inferUserEmotion(userText);
        if (userEmotion.emotion !== "neutral") {
          this.currentEmotion = userEmotion.suggestedCelynEmotion;
          this.sendToClient({
            type: "tool_call",
            id: `user_tone_${Date.now()}`,
            name: "set_expression",
            args: { emotion: userEmotion.suggestedCelynEmotion },
          });
        }

        // ⚡ Berikan feedback visual seketika bahwa ucapan telah didengar dan direspons
        this.sendToClient({
          type: "status",
          status: "thinking",
          message: userEmotion.statusMessage,
        });
      }
    }

    // 2.1 Transkripsi Suara Celyn (Output Transcription Bahasa Indonesia)
    if (data.serverContent?.outputTranscription?.text) {
      if (!this.isBargeInMuted) {
        // Jika sebelumnya ada akumulasi ucapan pengguna, catat turn utuh pengguna ke memori
        if (this.currentTurnUserSpeech.trim()) {
          const fullUserText = this.currentTurnUserSpeech.trim();
          this.currentTurnUserSpeech = "";
          if (this.authMode === "jocelyn") {
            memoryService.recordTurn(this.sessionId, "user", fullUserText);
          }
        }

        const rawCelynText = data.serverContent.outputTranscription.text;
        const emotionMatch = rawCelynText.match(/[\{\[\(]\s*(?:emotion|expression)\s*:\s*([a-zA-Z_-]+)\s*[\}\]\)]/i);
        if (emotionMatch) {
          const detected = normalizeEmotion(emotionMatch[1]);
          if (detected && detected !== "neutral") {
            this.explicitEmotionUsedInTurn = true;
            this.currentEmotion = detected;
            this.sendToClient({
              type: "tool_call",
              id: `inline_emotion_${Date.now()}`,
              name: "set_expression",
              args: { emotion: detected },
            });
          }
        }
        const celynText = stripVoiceMetadataTags(rawCelynText);
        if (celynText) {
          this.currentTurnCelynText += celynText;
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
          const emotionMatch = part.text.match(/[\{\[\(]\s*(?:emotion|expression)\s*:\s*([a-zA-Z_-]+)\s*[\}\]\)]/i);
          if (emotionMatch) {
            const detected = normalizeEmotion(emotionMatch[1]);
            if (detected && detected !== "neutral") {
              this.explicitEmotionUsedInTurn = true;
              this.currentEmotion = detected;
              this.sendToClient({
                type: "tool_call",
                id: `inline_emotion_${Date.now()}`,
                name: "set_expression",
                args: { emotion: detected },
              });
            }
          }
          const cleanPart = stripVoiceMetadataTags(part.text);
          if (!cleanPart) continue;
          this.currentTurnCelynText += cleanPart;
          console.log(`💬 [Celyn AI]: ${cleanPart}`);
          this.sendToClient({
            type: "transcript",
            speaker: "celyn",
            text: cleanPart,
          });
          if (this.useEdgeTts) {
            this.ttsBuffer += cleanPart;
            this.flushCompleteSentences(false);
          }
        }
      }
    }

    // 2.5 Giliran Model Selesai
    if (data.serverContent?.turnComplete) {
      this.isBargeInMuted = false;

      // Pastikan sisa ucapan pengguna tercatat jika belum ter-flush
      if (this.currentTurnUserSpeech.trim()) {
        const fullUserText = this.currentTurnUserSpeech.trim();
        this.currentTurnUserSpeech = "";
        if (this.authMode === "jocelyn") {
          memoryService.recordTurn(this.sessionId, "user", fullUserText);
        }
      }

      if (this.currentTurnCelynText.trim()) {
        if (this.authMode === "jocelyn") {
          memoryService.recordTurn(this.sessionId, "assistant", this.currentTurnCelynText.trim());
        }
        this.currentTurnCelynText = "";
      }

      // Jika baru saja mengeksekusi sub-turn pemanggilan tool, tahan status listening
      // agar tidak mendahului sub-turn jawaban suara yang akan segera dimulai model
      if (this.hasPendingToolCall) {
        this.hasPendingToolCall = false;
        console.log("⚙️ [Gemini Live] Sub-turn tool call selesai, melanjutkan ke respon suara Celyn...");
        return;
      }

      console.log("🏁 [Gemini Live] Giliran bicara Celyn selesai.");
      this.isFirstChunkInTurn = true;
      this.explicitEmotionUsedInTurn = false;

      // Kembalikan ekspresi wajah secara rileks ke netral setelah selesai bicara
      // Untuk ekspresi 'sad', pulihkan lebih cepat (~2200ms) agar wajah tidak murung terlalu lama
      if (this.relaxEmotionTimer) clearTimeout(this.relaxEmotionTimer);
      const relaxDelay = this.currentEmotion === "sad" ? 2200 : 4500;
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
      }, relaxDelay);

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
        this.hasPendingToolCall = true;
        console.log(`🔧 [Tool Call] ${fc.name}:`, fc.args);

        let sanitizedArgs = fc.args || {};
        let toolResponseOutput: any = {
          status: "applied",
          instruction: "Ekspresi visual berhasil diterapkan. Sekarang kamu WAJIB langsung menjawab pertanyaan pengguna secara lisan dengan suara (audio) dalam Bahasa Indonesia secara jelas, tuntas, dan tanpa ragu.",
        };

        if (fc.name === "set_expression") {
          const normEmotion = normalizeEmotion(sanitizedArgs.emotion);
          sanitizedArgs = { ...sanitizedArgs, emotion: normEmotion };
          this.explicitEmotionUsedInTurn = true;
          this.currentEmotion = normEmotion;
        } else if (fc.name === "point_at_screen") {
          const clampedX = Math.max(0, Math.min(1, Number(sanitizedArgs.x) || 0.5));
          const clampedY = Math.max(0, Math.min(1, Number(sanitizedArgs.y) || 0.5));
          sanitizedArgs = { ...sanitizedArgs, x: clampedX, y: clampedY };
        } else if (fc.name === "remember_fact") {
          const fact = String(sanitizedArgs.fact || "").trim();
          const category = String(sanitizedArgs.category || "fakta").trim();
          const importance = Number(sanitizedArgs.importance) || 2;
          console.log(`🧠 [Tool remember_fact] Menyimpan: [${category}] "${fact}"`);
          let saved = false;
          if (fact) {
            saved = await memoryService.saveUserFact(fact, category, importance);
          }
          if (saved) {
            toolResponseOutput = {
              status: "saved",
              fact,
              category,
              instruction: "Fakta atau preferensi pengguna ini telah berhasil disimpan ke memori jangka panjang Turso. Sekarang berikan konfirmasi lisanmu secara hangat, santai, akrab, dan tulus kepada pengguna bahwa kamu sudah mengingatnya.",
            };
          } else {
            toolResponseOutput = {
              status: "error",
              instruction: "Penyimpanan memori ke database sedang mengalami kendala. Sampaikan dengan santai dan jujur bahwa kamu sedang mencatatnya di ingatan sesi ini dulu.",
            };
          }
        } else if (fc.name === "create_document") {
          const kind = String(sanitizedArgs.kind || "pdf").toLowerCase();
          const title = String(sanitizedArgs.title || "Dokumen Celyn").trim();
          const instruction = String(sanitizedArgs.instruction || "").trim();
          console.log(`📄 [Tool create_document] Menghasilkan dokumen ${kind.toUpperCase()}: "${title}"`);
          const job = jobService.createJob("create", `${title}.${kind}`, `Membuat dokumen ${kind.toUpperCase()}...`);

          this.sendToClient({
            type: "job",
            jobId: job.id,
            kind: "create",
            stage: "running",
            progress: 0.25,
            message: `Menyusun dokumen ${kind.toUpperCase()} '${title}'...`,
            fileName: `${title}.${kind}`,
          });

          toolResponseOutput = {
            status: "started",
            jobId: job.id,
            kind,
            title,
            instruction: `Dokumen ${kind.toUpperCase()} berjudul '${title}' sedang dibuatkan di latar belakang. Sampaikan secara lisan dengan ceria, singkat, dan hangat bahwa kamu sedang menyiapkannya dan pengguna tetap bisa lanjut ngobrol!`,
          };

          (async () => {
            try {
              const res = await documentService.generateDocument({
                kind: kind as any,
                title,
                instruction,
              });
              jobService.updateJob(job.id, {
                stage: "done",
                progress: 1.0,
                message: "Dokumen berhasil dibuat!",
                resultBuffer: res.buffer,
                downloadUrl: `/api/documents/download?id=${job.id}`,
              });
              this.sendToClient({
                type: "job",
                jobId: job.id,
                kind: "create",
                stage: "done",
                progress: 1.0,
                message: "Dokumen berhasil dibuat dan siap diunduh!",
                fileName: res.fileName,
                downloadUrl: `/api/documents/download?id=${job.id}`,
              });
            } catch (err: any) {
              jobService.updateJob(job.id, {
                stage: "error",
                message: err?.message || "Gagal membuat dokumen",
              });
              this.sendToClient({
                type: "job",
                jobId: job.id,
                kind: "create",
                stage: "error",
                progress: 1.0,
                message: err?.message || "Gagal membuat dokumen",
              });
            }
          })();
        } else if (fc.name === "research") {
          const query = String(sanitizedArgs.query || "").trim();
          console.log(`🔍 [Tool research] Melakukan riset topik: "${query}"`);

          // Sinyal aktivitas riset ke avatar (animasi buka laptop & status text)
          this.sendToClient({
            type: "status",
            status: "researching",
            message: RESEARCH_STATUS_TEXT,
          });

          const researchResult = await researchService.conductResearch(query);

          toolResponseOutput = {
            status: "done",
            query,
            summary: researchResult.summary,
            sources: researchResult.sources,
            instruction: `Hasil riset untuk '${query}' berhasil didapatkan. Sekarang sampaikan penjelasannya secara lisan dengan cerdas, hangat, santai, dan sebutkan tingkat keyakinanmu secara jujur. Jangan lupa berikan tautan / sumber rujukan dalam format markdown [Judul](URL) agar pengguna dapat memeriksa langsung!`,
          };
        } else if (fc.name === "process_document") {
          const { docId, operation, targetLanguage, instruction } = sanitizedArgs;
          if (operation === "translate" && !targetLanguage) {
            toolResponseOutput = {
              status: "needs_input",
              operation: "translate",
              ask: "Mau diterjemahkan ke bahasa apa? (Misalnya: Bahasa Inggris, Bahasa Jepang, Bahasa Mandarin, dll.)",
              instruction:
                "Tanyakan terlebih dahulu ke pengguna secara langsung dan santai bahasa tujuan yang diinginkan untuk terjemahan dokumen ini.",
            };
          } else {
            const opKind = (operation || "edit") as any;
            const targetDocName = String(docId || "dokumen");
            const job = jobService.createJob(opKind, targetDocName, `Sedang memproses ${operation} pada ${targetDocName} secara in-place...`);
            toolResponseOutput = {
              status: "started",
              jobId: job.id,
              operation,
              instruction: `Dokumen '${targetDocName}' sedang diproses langsung (${operation}) di latar belakang dan hasilnya akan tetap berformat asli (in-place). Beritahu pengguna dengan santai bahwa proses sedang berjalan dan kalian tetap bisa lanjut ngobrol!`,
            };

            // Jalankan background worker untuk proses dokumen in-place
            (async () => {
              try {
                let matchedContent = "";
                let matchedFileName = targetDocName;
                for (const [key, val] of this.activeDocs.entries()) {
                  if (key.includes(targetDocName.toLowerCase()) || targetDocName.toLowerCase().includes(key)) {
                    matchedContent = val.content;
                    matchedFileName = val.fileName;
                    break;
                  }
                }

                if (!matchedContent && this.activeDocs.size > 0) {
                  const first = this.activeDocs.values().next().value;
                  if (first) {
                    matchedContent = first.content;
                    matchedFileName = first.fileName;
                  }
                }

                const res = await documentService.processDocumentInPlace({
                  fileName: matchedFileName,
                  operation: opKind,
                  originalContent: matchedContent || `Dokumen: ${targetDocName}`,
                  instruction: instruction || `Lakukan ${operation} pada dokumen ini`,
                  targetLanguage,
                });

                jobService.updateJob(job.id, {
                  stage: "done",
                  progress: 1.0,
                  message: `Dokumen ${res.fileName} berhasil diproses langsung!`,
                  resultBuffer: res.buffer,
                  fileName: res.fileName,
                  downloadUrl: `/api/documents/download?id=${job.id}`,
                });

                this.sendToClient({
                  type: "job",
                  jobId: job.id,
                  kind: opKind,
                  stage: "done",
                  progress: 1.0,
                  message: `Dokumen ${res.fileName} selesai diproses dan siap diunduh!`,
                  fileName: res.fileName,
                  downloadUrl: `/api/documents/download?id=${job.id}`,
                });
              } catch (err: any) {
                console.error("[process_document in-place error]:", err);
                jobService.updateJob(job.id, {
                  stage: "error",
                  message: err?.message || "Gagal memproses dokumen in-place",
                });
                this.sendToClient({
                  type: "job",
                  jobId: job.id,
                  kind: opKind,
                  stage: "error",
                  progress: 1.0,
                  message: err?.message || "Gagal memproses dokumen in-place",
                });
              }
            })();
          }
        }

        this.sendToClient({
          type: "tool_call",
          id: fc.id,
          name: fc.name,
          args: sanitizedArgs,
        });

        // Balas otomatis ke sesi Gemini Live dengan instruksi tegas untuk langsung menjawab lisan
        if (this.session) {
          try {
            this.session.sendToolResponse({
              functionResponses: [
                {
                  id: fc.id,
                  name: fc.name,
                  response: {
                    output: toolResponseOutput,
                  },
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
        this.hasUserInitiatedTurn = true;
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
      } else if (msg.type === "doc_context") {
        console.log(`📄 [Doc Context] Menyuntikkan konteks dokumen '${msg.fileName || "dokumen"}'`);
        const docName = msg.fileName || "dokumen";
        this.activeDocs.set(docName.toLowerCase(), { fileName: docName, content: msg.text });
        const safeText = msg.text.replace(/<\/document_context>/gi, "&lt;/document_context&gt;");
        let livePayload = safeText;
        if (safeText.length > 25000) {
          const head = safeText.slice(0, 15000);
          const tail = safeText.slice(-5000);
          livePayload = `${head}\n\n... [Bagian tengah dokumen tersimpan lengkap di memori Celyn (${safeText.length} karakter)] ...\n\n${tail}`;
        }
        await this.session.sendClientContent({
          turns: [
            {
              role: "user",
              parts: [{ text: livePayload }],
            },
          ],
          turnComplete: true,
        });
      } else if (msg.type === "text") {
        const preview = msg.text.length > 50 ? `${msg.text.slice(0, 50)}...` : msg.text;
        console.log(`👤 [User Text]: "${preview}"`);
        if (this.authMode === "jocelyn") {
          memoryService.recordTurn(this.sessionId, "user", msg.text);
        }
        this.hasUserInitiatedTurn = true;
        this.isBargeInMuted = false;
        this.hasPendingToolCall = false;
        this.cancelPendingTts();

        // ⚡ Deteksi nada & emosi teks pengguna secara instan (zero-latency empathy)
        const userEmotion = inferUserEmotion(msg.text);
        if (userEmotion.emotion !== "neutral") {
          this.currentEmotion = userEmotion.suggestedCelynEmotion;
          this.sendToClient({
            type: "tool_call",
            id: `user_text_tone_${Date.now()}`,
            name: "set_expression",
            args: { emotion: userEmotion.suggestedCelynEmotion },
          });
        }

        this.sendToClient({
          type: "status",
          status: "thinking",
          message: userEmotion.statusMessage,
        });
        // Sertakan direktif verbal eksplisit agar model native audio selalu menghasilkan jawaban suara lisan
        const textPrompt = `[Pesan teks dari pengguna]: "${msg.text}"\nJawablah sekarang juga dengan SUARA lisan (audio) dalam Bahasa Indonesia secara jelas dan tuntas!`;
        await this.session.sendClientContent({
          turns: [{ role: "user", parts: [{ text: textPrompt }] }],
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

    // Trigger ringkasan otomatis saat sesi ditutup (HANYA untuk admin / mode jocelyn)
    if (this.authMode === "jocelyn") {
      memoryService.summarizeAndPersistSession(this.sessionId).catch((err) => {
        console.warn("[MEMORY] ⚠️ Gagal merangkum sesi percakapan:", err?.message || err);
      });
    }
  }
}
