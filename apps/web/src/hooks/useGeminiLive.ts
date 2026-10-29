import { useState, useRef, useCallback, useEffect } from "react";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { getStoredAuthPassword, getStoredAuthMode, getStoredAuthToken } from "./useAuth";
import {
  ClientMessage,
  ServerMessage,
  EmotionType,
  LookAtTarget,
  normalizeEmotion,
  inferEmotionFromText,
  inferUserEmotion,
  buildContextualGreetingPrompt,
  buildCelynSystemPrompt,
  CELYN_SYSTEM_PROMPT,
  CELYN_GREETING_PROMPT,
  DEFAULT_VOICE_NAME,
  resolveVoiceId,
  extractIndonesianSentences,
  ParsedDocument,
  DocumentKind,
  RESEARCH_STATUS_TEXT,
} from "@celyn/shared";
import { extractPdfClientSide } from "../services/ClientDocumentReader.js";

interface UseGeminiLiveOptions {
  onAudioReceived: (b64Audio: string, mimeType?: string) => void;
  onInterrupted: () => void;
}

export function useGeminiLive({
  onAudioReceived,
  onInterrupted,
}: UseGeminiLiveOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<
    "idle" | "connecting" | "listening" | "thinking" | "researching" | "working" | "speaking" | "error"
  >("idle");
  const [statusMessage, setStatusMessage] = useState<string>("Siaga • Siap Berbicara");
  const [modelInfo, setModelInfo] = useState<{ model: string; voice: string }>({
    model: "gemini-3.8-live",
    voice: DEFAULT_VOICE_NAME,
  });
  const [connectionLabel, setConnectionLabel] = useState<string>("ws://localhost:3001");
  const [emotion, setEmotion] = useState<EmotionType>("neutral");
  const [lookAt, setLookAt] = useState<LookAtTarget | null>(null);
  const [transcripts, setTranscripts] = useState<
    Array<{ speaker: "user" | "celyn"; text: string; time: string }>
  >([]);
  const [activeDocuments, setActiveDocuments] = useState<ParsedDocument[]>([]);
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const [isGeneratingDoc, setIsGeneratingDoc] = useState(false);
  const [docStatusMessage, setDocStatusMessage] = useState<string | null>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const dismissJob = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const wsRef = useRef<WebSocket | null>(null);
  const directSessionRef = useRef<any>(null);
  const pendingQueueRef = useRef<ClientMessage[]>([]);
  const statusRef = useRef(status);
  const sendMessageRef = useRef<(msg: ClientMessage) => Promise<void> | void>(() => {});

  // State antrean TTS Microsoft Edge Neural (id-ID-GadisNeural) untuk mode Serverless Direct
  const directTtsBufferRef = useRef<string>("");
  const directTtsTurnIdRef = useRef<number>(0);
  const directTtsChainRef = useRef<Promise<void>>(Promise.resolve());
  const directIsFirstChunkRef = useRef<boolean>(true);
  const directExplicitEmotionRef = useRef<boolean>(false);
  const directCurrentEmotionRef = useRef<EmotionType>("neutral");
  const directRelaxTimerRef = useRef<number | null>(null);
  const activeTurnSpeakerRef = useRef<"user" | "celyn" | null>(null);
  const backupPcmChunksRef = useRef<string[]>([]);
  const bargeInMutedRef = useRef<boolean>(false);
  const directHasPendingToolCallRef = useRef<boolean>(false);
  const hasUserInitiatedTurnRef = useRef<boolean>(false);
  const sessionWarningTimerRef = useRef<number | null>(null);
  const sessionMaxDurationTimerRef = useRef<number | null>(null);
  const disconnectRef = useRef<() => void>(() => {});

  // State dan ref untuk pendinginan kuota (quota cooldown) & rotasi kunci
  const [quotaCooldownSeconds, setQuotaCooldownSeconds] = useState<number>(0);
  const quotaTimerRef = useRef<number | null>(null);
  const shouldRotateKeyRef = useRef<boolean>(false);

  const startQuotaCooldown = useCallback((seconds: number = 30) => {
    if (quotaTimerRef.current) {
      clearInterval(quotaTimerRef.current);
      quotaTimerRef.current = null;
    }
    setQuotaCooldownSeconds(seconds);
    quotaTimerRef.current = window.setInterval(() => {
      setQuotaCooldownSeconds((prev) => {
        if (prev <= 1) {
          if (quotaTimerRef.current) {
            clearInterval(quotaTimerRef.current);
            quotaTimerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    return () => {
      if (quotaTimerRef.current) {
        clearInterval(quotaTimerRef.current);
      }
    };
  }, []);

  const sessionIdRef = useRef<string>(
    `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
  );
  const directTurnCelynTextRef = useRef<string>("");
  const directUserTurnBufferRef = useRef<string>("");
  const lastRecordedTurnRef = useRef<{ role: string; content: string; time: number } | null>(null);

  const recordTurnToServer = useCallback((role: "user" | "assistant", content: string) => {
    const authMode = getStoredAuthMode();
    const authPass = getStoredAuthPassword();
    const isJocelynOrAdmin = authMode === "jocelyn" || authPass === "admin";
    if (!isJocelynOrAdmin) return;
    const clean = content.trim();
    if (!clean) return;

    // Client-side debounce to prevent dual transcription/turnComplete duplicate flushes
    const now = Date.now();
    if (
      lastRecordedTurnRef.current &&
      lastRecordedTurnRef.current.role === role &&
      lastRecordedTurnRef.current.content === clean &&
      now - lastRecordedTurnRef.current.time < 15000
    ) {
      return;
    }
    lastRecordedTurnRef.current = { role, content: clean, time: now };

    const token = getStoredAuthToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-admin-password": getStoredAuthPassword() || "admin",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    fetch("/api/record", {
      method: "POST",
      headers,
      body: JSON.stringify({
        sessionId: sessionIdRef.current,
        role,
        content: clean,
        password: getStoredAuthPassword() || "admin",
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          console.error(`❌ [/api/record HTTP ${res.status}]:`, errData);
        }
      })
      .catch((e) => {
        console.warn("[RECORD] Gagal mencatat turn ke server:", e);
      });
  }, []);

  const clearSessionTimers = useCallback(() => {
    if (sessionWarningTimerRef.current) {
      clearTimeout(sessionWarningTimerRef.current);
      sessionWarningTimerRef.current = null;
    }
    if (sessionMaxDurationTimerRef.current) {
      clearTimeout(sessionMaxDurationTimerRef.current);
      sessionMaxDurationTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const flushPendingQueue = useCallback(() => {
    if (pendingQueueRef.current.length === 0) return;
    const queue = [...pendingQueueRef.current];
    pendingQueueRef.current = [];
    console.log(`📦 Mengirim ${queue.length} antrean paket pre-connect...`);
    for (const msg of queue) {
      sendMessageRef.current(msg);
    }
  }, []);

  const handleServerMessage = useCallback(
    (msg: ServerMessage) => {
      if (msg.type === "session_info") {
        setModelInfo({ model: msg.model, voice: msg.voice });
      } else if (msg.type === "audio") {
        setStatus("speaking");
        onAudioReceived(msg.data, msg.mimeType);
      } else if (msg.type === "interrupted") {
        console.log("⚡ Interrupted diterima");
        bargeInMutedRef.current = false;
        directTtsTurnIdRef.current++;
        directTtsBufferRef.current = "";
        backupPcmChunksRef.current = [];
        directIsFirstChunkRef.current = true;
        directExplicitEmotionRef.current = false;
        activeTurnSpeakerRef.current = null;
        if (directRelaxTimerRef.current) {
          clearTimeout(directRelaxTimerRef.current);
          directRelaxTimerRef.current = null;
        }
        setStatus("listening");
        onInterrupted();
      } else if (msg.type === "transcript") {
        const time = new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        setTranscripts((prev) => {
          const isSameOngoingTurn =
            activeTurnSpeakerRef.current === msg.speaker && prev.length > 0;
          activeTurnSpeakerRef.current = msg.speaker;

          if (isSameOngoingTurn) {
            const last = prev[prev.length - 1];
            // Smart word boundary spacing untuk Bahasa Indonesia (cegah "Halokamu")
            const needsSpace =
              !last.text.endsWith(" ") &&
              !msg.text.startsWith(" ") &&
              !/^[.,!?;:)%]/.test(msg.text) &&
              /[a-zA-Z0-9]$/.test(last.text);
            const sep = needsSpace ? " " : "";
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...last,
              text: `${last.text}${sep}${msg.text}`,
            };
            return updated;
          }

          return [
            ...prev.slice(-99),
            { speaker: msg.speaker, text: msg.text.replace(/^\s+/, ""), time },
          ];
        });
      } else if (msg.type === "tool_call") {
        if (msg.name === "set_expression") {
          const newEmotion = normalizeEmotion(msg.args.emotion);
          console.log("🎭 Mengubah emosi avatar ke:", newEmotion);
          directExplicitEmotionRef.current = true;
          directCurrentEmotionRef.current = newEmotion;
          setEmotion(newEmotion);
        } else if (msg.name === "point_at_screen") {
          const x = Math.max(0, Math.min(1, Number(msg.args.x) || 0.5));
          const y = Math.max(0, Math.min(1, Number(msg.args.y) || 0.5));
          const description = (msg.args.description as string) || undefined;
          console.log("👁️ Avatar melirik ke layar:", { x, y, description });
          setLookAt({ x, y, description });

          setTimeout(() => {
            setLookAt(null);
          }, 6000);
        } else if (msg.name === "create_document") {
          const kind = ((msg.args.kind as string) || "pdf").toLowerCase() as DocumentKind;
          const title = String(msg.args.title || "Dokumen Celyn");
          const instruction = String(msg.args.instruction || "");
          console.log("📄 [Proxy WS Tool] create_document dipanggil:", { kind, title });
          generateDocumentRef.current(kind, title, instruction);
        }
      } else if (msg.type === "status") {
        setStatus(msg.status);
        if (msg.message) setStatusMessage(msg.message);
      } else if (msg.type === "job") {
        setJobs((prev) => {
          const updatedJob = {
            id: msg.jobId,
            kind: msg.kind,
            stage: msg.stage,
            progress: msg.progress,
            message: msg.message,
            fileName: msg.fileName,
            downloadUrl: msg.downloadUrl,
            error: msg.error?.userMessage,
          };
          const existing = prev.find((j) => j.id === msg.jobId);
          if (existing) {
            return prev.map((j) => (j.id === msg.jobId ? updatedJob : j));
          }
          return [...prev, updatedJob];
        });
      } else if (msg.type === "error") {
        setStatus("error");
        setStatusMessage(msg.message);
      }
    },
    [onAudioReceived, onInterrupted]
  );

  /**
   * Mode Vercel Serverless / Ephemeral Token:
   * Mengambil token sekali pakai dari /api/token lalu membuka sesi Gemini Live
   * langsung dari browser tanpa perlu server WebSocket persisten port 3001.
   */
  const connectViaServerlessToken = useCallback(async (voicePreference?: string) => {
    try {
      setStatus("connecting");
      setStatusMessage("Meminta token sesi aman dari Vercel Serverless...");

      const authPass = getStoredAuthPassword() || "admin";
      const token = getStoredAuthToken();
      const customKey = (localStorage.getItem("celyn_custom_gemini_key") || "").trim();

      const queryParams = new URLSearchParams();
      if (voicePreference) queryParams.set("voice", voicePreference);
      if (shouldRotateKeyRef.current) {
        queryParams.set("rotate", "1");
        shouldRotateKeyRef.current = false;
      }
      const queryStr = queryParams.toString() ? `?${queryParams.toString()}` : "";

      const headers: Record<string, string> = {
        "x-admin-password": authPass,
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      if (customKey) {
        headers["x-gemini-key"] = customKey;
      }

      const res = await fetch(`/api/token${queryStr}`, { headers });
      const data = await res.json();

      if (!res.ok || !data.token) {
        const isQuota =
          res.status === 429 ||
          /quota|rate\s*limit|penuh|resource_exhausted/i.test(String(data.error || ""));
        if (isQuota) {
          startQuotaCooldown(30);
          shouldRotateKeyRef.current = true;
          throw new Error(
            "Batas kuota layanan suara AI saat ini sedang penuh. Sistem sedang mendinginkan koneksi (reset otomatis dalam 30–60 detik). Anda juga dapat memasukkan API Key cadangan di Pengaturan."
          );
        }
        throw new Error(
          data.error ||
            "Gagal mendapatkan token sesi dari server. Pastikan layanan Celyn sudah dikonfigurasi di Environment Variables."
        );
      }

      const activeModel = data.model || "gemini-3.8-live";
      const activeVoice = resolveVoiceId(voicePreference || data.voice || DEFAULT_VOICE_NAME);
      const useEdgeTts =
        activeVoice.includes("Neural") || activeVoice.startsWith("id-ID");
      const internalGeminiVoice = useEdgeTts ? "Aoede" : activeVoice;

      setModelInfo({ model: activeModel, voice: activeVoice });
      setConnectionLabel("Celyn Live Direct");
      setStatusMessage("Menghubungkan Celyn...");

      const enqueueDirectEdgeTts = (
        sentence: string,
        turnId: number,
        emotion?: EmotionType
      ) => {
        // Pipelined parallel prefetch synthesis via /api/tts
        const fetchPromise = fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: sentence,
            voice: activeVoice,
            emotion: emotion || "neutral",
          }),
        })
          .then(async (ttsRes) => {
            if (!ttsRes.ok) return null;
            return await ttsRes.json();
          })
          .catch((e) => {
            console.warn("Gagal menyintesis kalimat via /api/tts:", e);
            return null;
          });

        directTtsChainRef.current = directTtsChainRef.current
          .then(async () => {
            if (
              turnId !== directTtsTurnIdRef.current ||
              !directSessionRef.current
            ) {
              return;
            }
            const ttsData = await fetchPromise;
            if (
              turnId === directTtsTurnIdRef.current &&
              directSessionRef.current
            ) {
              if (ttsData?.audio) {
                handleServerMessage({
                  type: "audio",
                  data: ttsData.audio,
                  mimeType: ttsData.mimeType || "audio/mp3",
                });
              } else if (backupPcmChunksRef.current.length > 0) {
                // Fallback otomatis jika Edge TTS error / timeout: putar seluruh audio cadangan Gemini PCM
                const allPcm = backupPcmChunksRef.current.splice(0);
                console.warn(`⚠️ Menggunakan ${allPcm.length} audio cadangan native Gemini (Edge TTS fallback)`);
                for (const pcm of allPcm) {
                  handleServerMessage({
                    type: "audio",
                    data: pcm,
                    mimeType: "audio/pcm",
                  });
                }
              }
            }
          })
          .catch(() => {});
      };

      const flushDirectSentences = (forceAll: boolean) => {
        if (!useEdgeTts) return;
        const { sentences, remaining } = extractIndonesianSentences(
          directTtsBufferRef.current,
          forceAll,
          directIsFirstChunkRef.current
        );
        directTtsBufferRef.current = remaining;

        for (const sentence of sentences) {
          directIsFirstChunkRef.current = false;

          // Auto-emotion inference jika LLM belum memanggil tool set_expression
          if (!directExplicitEmotionRef.current) {
            const detected = inferEmotionFromText(sentence);
            // Jika sebelumnya 'sad' dan kalimat berikutnya netral/penyemangat, pulihkan segera ke neutral
            if (directCurrentEmotionRef.current === "sad" && detected === "neutral") {
              directCurrentEmotionRef.current = "neutral";
              handleServerMessage({
                type: "tool_call",
                id: "auto_relax_sad",
                name: "set_expression",
                args: { emotion: "neutral" },
              });
            } else if (
              detected !== "neutral" &&
              detected !== directCurrentEmotionRef.current
            ) {
              directCurrentEmotionRef.current = detected;
              handleServerMessage({
                type: "tool_call",
                id: "auto_expression",
                name: "set_expression",
                args: { emotion: detected },
              });
            }
          }

          enqueueDirectEdgeTts(
            sentence,
            directTtsTurnIdRef.current,
            directCurrentEmotionRef.current
          );
        }
      };

      const ai = new GoogleGenAI({
        apiKey: data.token,
        httpOptions: { apiVersion: "v1alpha" },
      });

      const session = await ai.live.connect({
        model: activeModel,
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
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: {
            parts: [
              {
                text: buildCelynSystemPrompt(
                  getStoredAuthMode(),
                  data.memoryContext || undefined
                ),
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
                        enum: [
                          "neutral",
                          "happy",
                          "thinking",
                          "surprised",
                          "sad",
                          "shy",
                        ],
                      },
                      intensity: { type: Type.NUMBER },
                    },
                    required: ["emotion"],
                  },
                },
                {
                  name: "point_at_screen",
                  description:
                    "Mengarahkan tatapan avatar ke area layar tertentu.",
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
                  description:
                    "Simpan fakta, preferensi pribadi (seperti makanan/minuman favorit), jadwal, janji, atau informasi penting yang diminta pengguna untuk diingat ke memori jangka panjang.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      fact: {
                        type: Type.STRING,
                        description:
                          "Isi fakta atau preferensi yang harus diingat secara jelas dan ringkas (contoh: 'Rafli suka minum americano dingin (kopi/minuman kesukaan)', 'Rafli ada jadwal meeting jam 8 malam')",
                      },
                      category: {
                        type: Type.STRING,
                        enum: ["preferensi", "jadwal", "identitas", "fakta", "catatan", "topik", "proyek", "rencana"],
                        description:
                          "Kategori memori: 'preferensi' (makanan, minuman, kebiasaan), 'jadwal' (waktu/jam kegiatan), 'identitas' (tentang diri pengguna), atau 'catatan'",
                      },
                      importance: {
                        type: Type.NUMBER,
                        description:
                          "Tingkat kepentingan skala 1 sampai 3 (3 = sangat penting/jadwal krusial, 2 = preferensi utama, 1 = fakta umum)",
                      },
                    },
                    required: ["fact"],
                  },
                },
                {
                  name: "create_document",
                  description:
                    "Buat atau ekspor dokumen laporan, ringkasan, atau lembar kerja ke format PDF (.pdf), Word (.docx), atau Excel (.xlsx) saat diminta pengguna.",
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
                        description:
                          "Instruksi rincian isi, topik, atau data yang harus dimuat dalam dokumen",
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
          onopen: () => {
            setIsConnected(true);
            setStatus("listening");
            setStatusMessage("Celyn aktif dan siap mendengarkan ucapanmu!");
          },
          onmessage: async (msg: any) => {
            if (msg.serverContent?.interrupted) {
              bargeInMutedRef.current = false;
              directTurnCelynTextRef.current = "";
              if (directUserTurnBufferRef.current.trim()) {
                recordTurnToServer("user", directUserTurnBufferRef.current.trim());
                directUserTurnBufferRef.current = "";
              }
              handleServerMessage({ type: "interrupted" });
              return;
            }

            if (msg.serverContent?.inputTranscription?.text) {
              bargeInMutedRef.current = false;
              backupPcmChunksRef.current = [];
              const userText = msg.serverContent.inputTranscription.text.trim();
              if (userText) {
                directUserTurnBufferRef.current += (directUserTurnBufferRef.current ? " " : "") + userText;
                handleServerMessage({
                  type: "transcript",
                  speaker: "user",
                  text: userText,
                });

                // ⚡ Analisis nada emosi ucapan pengguna seketika
                const userEmotion = inferUserEmotion(userText);
                if (userEmotion.emotion !== "neutral") {
                  directCurrentEmotionRef.current = userEmotion.suggestedCelynEmotion;
                  handleServerMessage({
                    type: "tool_call",
                    id: `user_tone_${Date.now()}`,
                    name: "set_expression",
                    args: { emotion: userEmotion.suggestedCelynEmotion },
                  });
                }

                handleServerMessage({
                  type: "status",
                  status: "thinking",
                  message: userEmotion.statusMessage,
                });
              }
            }

            if (msg.serverContent?.outputTranscription?.text) {
              if (directUserTurnBufferRef.current.trim()) {
                recordTurnToServer("user", directUserTurnBufferRef.current.trim());
                directUserTurnBufferRef.current = "";
              }

              if (!bargeInMutedRef.current) {
                const celynText = msg.serverContent.outputTranscription.text;
                if (celynText) {
                  directTurnCelynTextRef.current += celynText;
                  handleServerMessage({
                    type: "transcript",
                    speaker: "celyn",
                    text: celynText,
                  });

                  // Auto-emotion inference di semua mode suara (Edge TTS maupun Native Gemini Live)
                  if (!directExplicitEmotionRef.current) {
                    const detected = inferEmotionFromText(celynText);
                    if (
                      detected !== "neutral" &&
                      detected !== directCurrentEmotionRef.current
                    ) {
                      directCurrentEmotionRef.current = detected;
                      handleServerMessage({
                        type: "tool_call",
                        id: "auto_expression",
                        name: "set_expression",
                        args: { emotion: detected },
                      });
                    }
                  }

                  if (useEdgeTts) {
                    directTtsBufferRef.current += celynText;
                    flushDirectSentences(false);
                  }
                }
              }
            }

            const parts = msg.serverContent?.modelTurn?.parts;
            if (Array.isArray(parts)) {
              for (const part of parts) {
                if (part.thought) continue;
                if (
                  part.inlineData &&
                  part.inlineData.mimeType?.startsWith("audio/")
                ) {
                  if (!bargeInMutedRef.current) {
                    backupPcmChunksRef.current.push(part.inlineData.data);
                  }
                  if (!useEdgeTts && !bargeInMutedRef.current) {
                    handleServerMessage({
                      type: "audio",
                      data: part.inlineData.data,
                      mimeType: "audio/pcm",
                    });
                  }
                }
                if (part.text && !msg.serverContent?.outputTranscription?.text) {
                  if (bargeInMutedRef.current) continue;
                  directTurnCelynTextRef.current += part.text;
                  handleServerMessage({
                    type: "transcript",
                    speaker: "celyn",
                    text: part.text,
                  });
                  if (useEdgeTts) {
                    directTtsBufferRef.current += part.text;
                    flushDirectSentences(false);
                  }
                }
              }
            }

            if (msg.serverContent?.turnComplete) {
              bargeInMutedRef.current = false;

              if (directUserTurnBufferRef.current.trim()) {
                recordTurnToServer("user", directUserTurnBufferRef.current.trim());
                directUserTurnBufferRef.current = "";
              }

              if (directTurnCelynTextRef.current.trim()) {
                recordTurnToServer("assistant", directTurnCelynTextRef.current.trim());
                directTurnCelynTextRef.current = "";
              }

              // Jika baru saja mengeksekusi sub-turn pemanggilan tool, tahan status listening
              // agar tidak mendahului sub-turn jawaban suara yang akan segera dimulai model
              if (directHasPendingToolCallRef.current) {
                directHasPendingToolCallRef.current = false;
                console.log("⚙️ [Direct Live] Sub-turn tool call selesai, melanjutkan ke respon suara Celyn...");
                return;
              }

              directIsFirstChunkRef.current = true;
              directExplicitEmotionRef.current = false;
              activeTurnSpeakerRef.current = null;

              // Rapikan spasi akhir bubble chat yang baru saja selesai
              setTranscripts((prev) => {
                if (prev.length === 0) return prev;
                const last = prev[prev.length - 1];
                const trimmed = last.text.trim();
                if (trimmed === last.text) return prev;
                const updated = [...prev];
                updated[updated.length - 1] = { ...last, text: trimmed };
                return updated;
              });

              // Kembalikan ekspresi wajah secara rileks ke netral setelah selesai bicara
              // Untuk ekspresi 'sad', pulihkan lebih cepat (~2200ms) agar wajah tidak murung terlalu lama
              if (directRelaxTimerRef.current) clearTimeout(directRelaxTimerRef.current);
              const relaxDelay = directCurrentEmotionRef.current === "sad" ? 2200 : 4500;
              directRelaxTimerRef.current = window.setTimeout(() => {
                if (
                  directSessionRef.current &&
                  directCurrentEmotionRef.current !== "neutral"
                ) {
                  directCurrentEmotionRef.current = "neutral";
                  handleServerMessage({
                    type: "tool_call",
                    id: "auto_relax",
                    name: "set_expression",
                    args: { emotion: "neutral" },
                  });
                }
              }, relaxDelay);

              if (useEdgeTts) {
                flushDirectSentences(true);
                const turnAtComplete = directTtsTurnIdRef.current;
                directTtsChainRef.current.then(() => {
                  backupPcmChunksRef.current = [];
                  if (
                    directTtsTurnIdRef.current === turnAtComplete &&
                    directSessionRef.current
                  ) {
                    handleServerMessage({
                      type: "status",
                      status: "listening",
                      message: "Celyn sedang mendengarkan ucapanmu...",
                    });
                  }
                });
              } else {
                backupPcmChunksRef.current = [];
                handleServerMessage({
                  type: "status",
                  status: "listening",
                  message: "Celyn sedang mendengarkan ucapanmu...",
                });
              }
            }

            const toolCall = msg.toolCall;
            if (
              toolCall?.functionCalls &&
              Array.isArray(toolCall.functionCalls)
            ) {
              for (const fc of toolCall.functionCalls) {
                directHasPendingToolCallRef.current = true;
                handleServerMessage({
                  type: "tool_call",
                  id: fc.id,
                  name: fc.name,
                  args: fc.args || {},
                });

                let toolOutput: any = {
                  status: "applied",
                  instruction:
                    "Ekspresi visual berhasil diterapkan. Sekarang kamu WAJIB langsung memberikan respon lisanmu dengan suara (audio) dalam Bahasa Indonesia.",
                };

                if (fc.name === "remember_fact") {
                  const fact = String(fc.args?.fact || "").trim();
                  const category = String(fc.args?.category || "fakta").trim();
                  const importance = Number(fc.args?.importance) || 2;
                  console.log("🧠 [Direct Live Tool] Menyimpan memori:", { fact, category });

                  let saved = false;
                  if (fact) {
                    try {
                      const res = await fetch("/api/remember", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          "x-admin-password": getStoredAuthPassword() || "admin",
                        },
                        body: JSON.stringify({
                          fact,
                          category,
                          importance,
                          password: getStoredAuthPassword() || "admin",
                        }),
                      });
                      if (res.ok) {
                        const data = await res.json().catch(() => null);
                        if (data && data.ok) {
                          saved = true;
                        }
                      } else {
                        const errData = await res.json().catch(() => ({}));
                        console.error(`❌ [/api/remember HTTP ${res.status}]:`, errData);
                      }
                    } catch (e) {
                      console.warn("Gagal simpan remember_fact via /api/remember:", e);
                    }
                  }

                  if (saved) {
                    toolOutput = {
                      status: "saved",
                      fact,
                      category,
                      instruction:
                        "Fakta atau preferensi pengguna ini telah berhasil disimpan ke memori jangka panjang Turso. Sekarang berikan konfirmasi lisanmu secara hangat, santai, akrab, dan tulus kepada pengguna bahwa kamu sudah mengingatnya.",
                    };
                  } else {
                    toolOutput = {
                      status: "error",
                      instruction:
                        "Penyimpanan memori ke database sedang mengalami kendala. Sampaikan dengan santai dan jujur bahwa kamu sedang mencatatnya di ingatan sesi ini dulu.",
                    };
                  }
                } else if (fc.name === "create_document") {
                  const kind = (((fc.args as any)?.kind as string) || "pdf").toLowerCase() as DocumentKind;
                  const title = String((fc.args as any)?.title || "Dokumen Celyn").trim();
                  const instruction = String((fc.args as any)?.instruction || "").trim();
                  console.log("📄 [Direct Live Tool] Menghasilkan dokumen:", { kind, title });

                  generateDocumentRef.current(kind, title, instruction);

                  toolOutput = {
                    status: "ready",
                    kind,
                    title,
                    instruction: `Dokumen ${kind.toUpperCase()} berjudul '${title}' telah siap diproses dan tombol unduh otomatis dimunculkan di layar pengguna. Sekarang sampaikan secara lisan dengan ceria, singkat, dan hangat bahwa dokumennya sudah dibuatkan dan bisa langsung diunduh!`,
                  };
                } else if (fc.name === "process_document") {
                  const docId = String((fc.args as any)?.docId || "").trim();
                  const operation = String((fc.args as any)?.operation || "summarize").trim();
                  toolOutput = {
                    status: "applied",
                    docId,
                    operation,
                    instruction: `Operasi '${operation}' pada dokumen '${docId}' telah dicatat. Berikan penjelasan dan tanggapan lisanmu secara langsung dalam Bahasa Indonesia!`,
                  };
                } else if (fc.name === "research") {
                  const query = String((fc.args as any)?.query || "").trim();
                  toolOutput = {
                    status: "applied",
                    query,
                    instruction: `Riset tentang '${query}' telah diselesaikan. Sampaikan intisari temuanmu secara lisan dalam Bahasa Indonesia secara padat dan ramah!`,
                  };
                }

                if (directSessionRef.current) {
                  try {
                    directSessionRef.current.sendToolResponse({
                      functionResponses: [
                        {
                          id: fc.id,
                          name: fc.name,
                          response: {
                            output: toolOutput,
                          },
                        },
                      ],
                    });
                  } catch (e) {
                    console.warn("Gagal mengirim tool response:", e);
                  }
                }
              }
            }
          },
          onerror: (err: any) => {
            console.error("❌ [Celyn Live Direct] Error:", err);
            directSessionRef.current = null;
            setIsConnected(false);
            setStatus("error");
            const rawMsg = String(err?.message || "Terjadi kendala koneksi");
            const isQuota = /quota|rate\s*limit|resource_exhausted|429/i.test(rawMsg);
            if (isQuota) {
              shouldRotateKeyRef.current = true;
              startQuotaCooldown(30);
              setStatusMessage(
                "Batas kuota layanan suara AI saat ini sedang penuh. Sistem sedang mendinginkan koneksi (reset otomatis dalam 30–60 detik). Anda juga dapat memasukkan API Key cadangan di Pengaturan."
              );
            } else {
              const sanitizedErr = rawMsg
                .replace(/https?:\/\/[^\s]+/gi, "")
                .replace(/google|gemini/gi, "layanan AI")
                .trim();
              setStatusMessage(`Koneksi Celyn bermasalah: ${sanitizedErr}`);
            }
          },
          onclose: (event: any) => {
            console.warn("🔌 [Celyn Live Direct] Sesi WebSocket ditutup:", {
              code: event?.code,
              reason: event?.reason,
              wasClean: event?.wasClean,
            });
            clearSessionTimers();
            directSessionRef.current = null;
            setIsConnected(false);
            setStatus("idle");

            const isQuotaExceeded =
              event?.code === 1011 ||
              /quota|rate\s*limit|resource_exhausted/i.test(String(event?.reason || ""));

            if (isQuotaExceeded) {
              shouldRotateKeyRef.current = true;
              startQuotaCooldown(30);
              setStatusMessage(
                "Batas kuota percakapan suara AI saat ini sedang penuh. Sistem sedang mendinginkan koneksi (reset otomatis dalam 30–60 detik). Anda juga dapat memasukkan API Key cadangan di Pengaturan."
              );
            } else if (event?.code === 1000) {
              setStatusMessage("Sesi Celyn telah selesai.");
            } else {
              const sanitizedReason = String(event?.reason || "")
                .replace(/https?:\/\/[^\s]+/gi, "")
                .replace(/google|gemini/gi, "layanan AI")
                .trim();
              setStatusMessage(
                `Koneksi Celyn ditutup (Kode: ${event?.code || "1006"}${sanitizedReason ? `, ${sanitizedReason}` : ""}). Klik tombol telepon untuk terhubung kembali.`
              );
            }
          },
        },
      });

      directSessionRef.current = session;
      setIsConnected(true);
      setStatus("listening");
      setStatusMessage("Siaga • Siap Berbicara");

      // ⚡ Priming Audio Pipeline: Kirim 1 frame silence PCM 16kHz (64ms = 2048 bytes)
      try {
        const primingSilence = btoa(String.fromCharCode(...new Uint8Array(2048)));
        session.sendRealtimeInput({
          audio: {
            mimeType: "audio/pcm;rate=16000",
            data: primingSilence,
          },
        });
      } catch {}

      flushPendingQueue();

      // Atur timer masa aktif sesi Gemini Live (serverless max ~30 menit)
      clearSessionTimers();
      sessionWarningTimerRef.current = window.setTimeout(() => {
        handleServerMessage({
          type: "status",
          status: "listening",
          message:
            "⚠️ Sesi Celyn mendekati batas 30 menit (tersisa 5 menit). Sesi akan dihentikan otomatis saat batas tercapai.",
        });
      }, 25 * 60 * 1000);

      sessionMaxDurationTimerRef.current = window.setTimeout(() => {
        console.warn(
          "⏱️ Batas waktu sesi Serverless 30 menit tercapai. Menutup sesi secara bersih..."
        );
        handleServerMessage({
          type: "status",
          status: "idle",
          message:
            "Sesi telah mencapai batas maksimal 30 menit. Silakan sambungkan kembali jika ingin melanjutkan.",
        });
        disconnectRef.current();
      }, 30 * 60 * 1000);

      // Kirim sapaan otomatis Celyn saat pertama kali terhubung HANYA jika pengguna belum mengirim pesan
      setTimeout(async () => {
        if (!hasUserInitiatedTurnRef.current && directSessionRef.current) {
          try {
            await directSessionRef.current.sendClientContent({
              turns: [
                {
                  role: "user",
                  parts: [
                    {
                      text: buildContextualGreetingPrompt(new Date(), getStoredAuthMode()),
                    },
                  ],
                },
              ],
              turnComplete: true,
            });
          } catch (e) {
            console.warn("Gagal mengirim auto-greeting:", e);
          }
        }
      }, 450);
    } catch (err: any) {
      console.error("Gagal membuka sesi Celyn:", err);
      setStatus("error");
      setStatusMessage(
        err?.message || "Gagal terhubung ke layanan percakapan Celyn."
      );
    }
  }, [handleServerMessage, recordTurnToServer]);

  const connect = useCallback((selectedVoice?: string) => {
    if (
      (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) ||
      directSessionRef.current
    ) {
      return;
    }

    sessionIdRef.current = `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    directTurnCelynTextRef.current = "";

    const envWs = import.meta.env.VITE_WS_URL;
    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";

    // Jika berjalan di Vercel / domain produksi tanpa VITE_WS_URL, langsung gunakan mode Serverless Ephemeral Token
    if (!envWs && !isLocalhost) {
      connectViaServerlessToken(selectedVoice);
      return;
    }

    setStatus("connecting");
    setStatusMessage("Menghubungkan ke server backend...");

    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const authPass = getStoredAuthPassword() || "admin";
    const authMode = getStoredAuthMode();
    const token = getStoredAuthToken();
    const tokenQuery = token ? `&token=${encodeURIComponent(token)}` : "";
    const voiceQuery = selectedVoice ? `&voice=${encodeURIComponent(selectedVoice)}` : "";
    const wsUrl =
      envWs ||
      `${wsProtocol}//${window.location.hostname}:3001?password=${encodeURIComponent(authPass)}&authMode=${authMode}&sessionId=${encodeURIComponent(sessionIdRef.current)}${voiceQuery}${tokenQuery}`;

    let opened = false;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    // Timeout 6.5 detik untuk fallback ke Serverless jika server lokal lambat merespons
    const wsTimeout = window.setTimeout(() => {
      if (!opened && wsRef.current === ws) {
        console.warn("⏱️ WebSocket local timeout (6.5s), beralih otomatis ke Serverless Ephemeral Token...");
        try {
          ws.close();
        } catch {}
        wsRef.current = null;
        connectViaServerlessToken(selectedVoice);
      }
    }, 6500);

    ws.onopen = () => {
      clearTimeout(wsTimeout);
      opened = true;
      setConnectionLabel(wsUrl);
      setIsConnected(true);
      setStatus("listening");
      setStatusMessage("Siaga • Siap Berbicara");
      flushPendingQueue();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        handleServerMessage(msg);
      } catch (err) {
        console.error("Gagal membaca pesan WebSocket:", err);
      }
    };

    ws.onerror = (err) => {
      clearTimeout(wsTimeout);
      console.warn("WebSocket error, memeriksa fallback Serverless...", err);
      if (!opened) {
        wsRef.current = null;
        connectViaServerlessToken(selectedVoice);
      } else {
        setStatus("error");
        setStatusMessage("Koneksi ke backend terputus.");
      }
    };

    ws.onclose = () => {
      clearTimeout(wsTimeout);
      clearSessionTimers();
      if (opened) {
        setIsConnected(false);
        setStatus("idle");
        setStatusMessage("Koneksi terputus.");
      }
    };
  }, [handleServerMessage, connectViaServerlessToken, flushPendingQueue, clearSessionTimers]);

  const disconnect = useCallback(() => {
    clearSessionTimers();
    hasUserInitiatedTurnRef.current = false;
    bargeInMutedRef.current = false;
    pendingQueueRef.current = [];
    directTtsTurnIdRef.current++;
    directTtsBufferRef.current = "";
    const wasDirect = !!directSessionRef.current;
    const endingSessionId = sessionIdRef.current;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (directSessionRef.current) {
      try {
        directSessionRef.current.close();
      } catch {}
      directSessionRef.current = null;
    }
    setIsConnected(false);
    setStatus("idle");
    setStatusMessage("Sesi dihentikan.");

    if (wasDirect && getStoredAuthMode() === "jocelyn") {
      fetch("/api/summarize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": getStoredAuthPassword() || "admin",
        },
        body: JSON.stringify({ sessionId: endingSessionId }),
      }).catch((e) => {
        console.warn("[SUMMARIZE] Gagal merangkum sesi serverless:", e);
      });
    }
  }, [clearSessionTimers]);

  useEffect(() => {
    disconnectRef.current = disconnect;
  }, [disconnect]);

  const sendMessage = useCallback(async (msg: ClientMessage) => {
    // 1. Jika terhubung via WebSocket Server lokal
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
      return;
    }

    // 2. Jika terhubung via Direct Gemini Live Session (Vercel Serverless Mode)
    const session = directSessionRef.current;
    if (session) {
      // ⚡ Validasi apakah socket underlying SDK masih benar-benar OPEN
      const rawWs = (session as any)?.conn?.ws;
      if (rawWs && rawWs.readyState !== WebSocket.OPEN) {
        if (rawWs.readyState === WebSocket.CLOSING || rawWs.readyState === WebSocket.CLOSED) {
          directSessionRef.current = null;
          setIsConnected(false);
          setStatus("idle");
        }
        return;
      }

      try {
        if (msg.type === "audio") {
          try {
            await session.sendRealtimeInput({
              audio: {
                mimeType: "audio/pcm;rate=16000",
                data: msg.data,
              },
            });
          } catch (audioErr: any) {
            if (audioErr?.message?.includes("CLOSING or CLOSED")) {
              directSessionRef.current = null;
              setIsConnected(false);
              setStatus("idle");
            }
          }
        } else if (msg.type === "audio_stream_end") {
          try {
            await session.sendRealtimeInput({
              audioStreamEnd: true,
            });
          } catch (e: any) {
            console.warn("directSession sendRealtimeInput audioStreamEnd:", e?.message);
          }
        } else if (msg.type === "screen") {
          await session.sendRealtimeInput({
            video: {
              mimeType: "image/jpeg",
              data: msg.data,
            },
          });
        } else if (msg.type === "doc_context") {
          const safeText = msg.text.replace(/<\/document_context>/gi, "&lt;/document_context&gt;");
          await session.sendClientContent({
            turns: [
              {
                role: "user",
                parts: [{ text: safeText }],
              },
            ],
            turnComplete: false,
          });
        } else if (msg.type === "text") {
          hasUserInitiatedTurnRef.current = true;
          bargeInMutedRef.current = false;
          directHasPendingToolCallRef.current = false;
          directTtsTurnIdRef.current++;
          directTtsBufferRef.current = "";
          backupPcmChunksRef.current = [];
          directUserTurnBufferRef.current = "";
          recordTurnToServer("user", msg.text);
          const userEmotion = inferUserEmotion(msg.text);
          if (userEmotion.emotion !== "neutral") {
            directCurrentEmotionRef.current = userEmotion.suggestedCelynEmotion;
            handleServerMessage({
              type: "tool_call",
              id: `user_text_tone_${Date.now()}`,
              name: "set_expression",
              args: { emotion: userEmotion.suggestedCelynEmotion },
            });
          }

          handleServerMessage({
            type: "status",
            status: "thinking",
            message: userEmotion.statusMessage,
          });
          const textPrompt = `[Pesan teks dari pengguna]: "${msg.text}"\nJawablah sekarang juga dengan SUARA lisan (audio) dalam Bahasa Indonesia!`;
          await session.sendClientContent({
            turns: [{ role: "user", parts: [{ text: textPrompt }] }],
            turnComplete: true,
          });
        }
      } catch (err) {
        console.error("Gagal mengirim pesan ke sesi Celyn:", err);
      }
      return;
    }

    // 3. Jika koneksi belum terbuka, antrekan HANYA pesan teks atau dokumen (JANGAN antrekan audio mentah!)
    if (msg.type === "text" || msg.type === "doc_context") {
      pendingQueueRef.current.push(msg);
      if (pendingQueueRef.current.length > 25) {
        pendingQueueRef.current.shift();
      }
    }
  }, [handleServerMessage, recordTurnToServer]);

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  const onBargeIn = useCallback(() => {
    bargeInMutedRef.current = true;
    directTtsTurnIdRef.current++;
    directTtsBufferRef.current = "";
    backupPcmChunksRef.current = [];
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "barge_in" }));
    }
    setStatus("listening");
    setStatusMessage("Celyn sedang mendengarkan ucapanmu...");
  }, []);

  const sendAudioStreamEnd = useCallback(() => {
    sendMessage({ type: "audio_stream_end" });
  }, [sendMessage]);

  const sendAudio = useCallback(
    (b64PCM16k: string) => {
      // Tandai aktivitas suara pengguna agar auto-greeting tidak menabrak pembicaraan
      hasUserInitiatedTurnRef.current = true;
      sendMessage({ type: "audio", data: b64PCM16k });
    },
    [sendMessage]
  );

  const sendScreen = useCallback(
    (b64JPEG: string) => {
      sendMessage({ type: "screen", data: b64JPEG });
    },
    [sendMessage]
  );

  const sendText = useCallback(
    (text: string) => {
      hasUserInitiatedTurnRef.current = true;
      bargeInMutedRef.current = false;
      directHasPendingToolCallRef.current = false;
      activeTurnSpeakerRef.current = "user";

      // Berikan visual feedback seketika bahwa pesan sedang disimak
      setStatus("thinking");
      setStatusMessage("Celyn sedang menyimak & merangkai jawaban...");

      const time = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      setTranscripts((prev) => [
        ...prev.slice(-99),
        { speaker: "user", text, time },
      ]);
      sendMessage({ type: "text", text });
    },
    [sendMessage]
  );

  const clearTranscripts = useCallback(() => {
    setTranscripts([]);
  }, []);

  const generateDocument = useCallback(
    async (kind: DocumentKind, title: string, instruction: string, context?: string) => {
      setIsGeneratingDoc(true);
      setDocStatusMessage(`Celyn sedang membuat dokumen ${kind.toUpperCase()}...`);
      try {
        const password = getStoredAuthPassword() || "admin";
        const token = getStoredAuthToken();
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "x-admin-password": password,
        };
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        const res = await fetch("/api/documents/generate", {
          method: "POST",
          headers,
          body: JSON.stringify({
            kind,
            title,
            instruction,
            context,
            password,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData?.error || `Gagal membuat dokumen (HTTP ${res.status})`);
        }

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const ext = kind === "pdf" ? "pdf" : kind === "docx" ? "docx" : "xlsx";
        a.download = `${title || "Dokumen_Celyn"}.${ext}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();

        setDocStatusMessage(`Dokumen ${kind.toUpperCase()} berhasil dibuat & diunduh!`);
        setTimeout(() => setDocStatusMessage(null), 5000);
      } catch (err: any) {
        console.error("Gagal generate dokumen:", err);
        setDocStatusMessage(`Gagal membuat dokumen: ${err?.message || "Error"}`);
        throw err;
      } finally {
        setIsGeneratingDoc(false);
      }
    },
    []
  );

  const generateDocumentRef = useRef(generateDocument);
  useEffect(() => {
    generateDocumentRef.current = generateDocument;
  }, [generateDocument]);

  const uploadDocument = useCallback(
    async (file: File): Promise<ParsedDocument> => {
      const maxAllowedBytes = 500 * 1024 * 1024; // 500 MB
      if (file.size > maxAllowedBytes) {
        throw new Error(
          `Ukuran file '${file.name}' (${(file.size / (1024 * 1024)).toFixed(1)} MB) melebihi batas maksimum 500 MB.`
        );
      }

      setIsUploadingDoc(true);
      const isLargeFile = file.size > 4.5 * 1024 * 1024;
      const fileSizeMb = (file.size / (1024 * 1024)).toFixed(1);

      try {
        const password = getStoredAuthPassword() || "admin";
        const token = getStoredAuthToken();
        const headers: Record<string, string> = {
          "x-admin-password": password,
          "Content-Type": "application/json",
        };
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        let doc: ParsedDocument | null = null;

        if (isLargeFile) {
          // --- JALUR EKSTRAKSI SISI KLIEN INSTAN (UNTUK FILE BESAR S.D 500 MB) ---
          const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

          if (isPdf) {
            setDocStatusMessage(`Mengekstrak teks dokumen PDF besar (${fileSizeMb} MB) langsung di peramban...`);
            doc = await extractPdfClientSide(file);

            if (!doc.characterCount || doc.characterCount < 10) {
              throw new Error(
                `Dokumen PDF '${file.name}' (${fileSizeMb} MB) adalah dokumen hasil scan murni tanpa teks digital. Untuk dokumen scan gambar, silakan perkecil atau kompres di bawah 4.5 MB agar dapat diproses oleh AI Vision OCR.`
              );
            }
          } else {
            throw new Error(
              `File '${file.name}' berukuran ${fileSizeMb} MB (melebihi 4.5 MB). File di atas 4.5 MB didukung penuh hingga 500 MB untuk format PDF. Harap simpan ulang sebagai PDF atau kompres file Word/Excel di bawah 4.5 MB.`
            );
          }
        } else {
          // --- JALUR STANDAR VERCEL SERVERLESS (UNTUK FILE <= 4.5 MB) ---
          setDocStatusMessage(`Membaca dokumen '${file.name}' (Hybrid OCR)...`);
          const formData = new FormData();
          formData.append("file", file);

          const uploadHeaders: Record<string, string> = {
            "x-admin-password": password,
          };
          if (token) {
            uploadHeaders["Authorization"] = `Bearer ${token}`;
          }

          let res: Response | null = null;
          try {
            res = await fetch("/api/documents/read", {
              method: "POST",
              headers: uploadHeaders,
              body: formData,
            });
          } catch (netErr: any) {
            // Fallback instan ke peramban jika PDF
            if (file.name.toLowerCase().endsWith(".pdf")) {
              setDocStatusMessage(`Membaca dokumen '${file.name}' langsung di peramban...`);
              doc = await extractPdfClientSide(file);
            } else {
              throw netErr;
            }
          }

          if (res && !res.ok) {
            if (res.status === 413 && file.name.toLowerCase().endsWith(".pdf")) {
              setDocStatusMessage(`Membaca dokumen '${file.name}' langsung di peramban...`);
              doc = await extractPdfClientSide(file);
            } else {
              const errData = await res.json().catch(() => ({}));
              throw new Error(errData?.error || `Gagal membaca dokumen (HTTP ${res.status})`);
            }
          } else if (res && !doc) {
            const data = await res.json();
            doc = data.document;
          }
        }

        if (!doc) {
          throw new Error("Gagal mengekstrak isi dokumen.");
        }

        setActiveDocuments((prev) => [
          ...prev.filter((d) => d.fileName !== doc.fileName),
          doc,
        ]);

        // Injeksi konteks dokumen ke sesi percakapan aktif secara terstruktur dengan instruksi respon proaktif
        const systemContent = `[PENGGUNA MENGUNGGAH DOKUMEN: ${doc.fileName}]\nBerikut adalah isi dokumen yang baru saja dibaca:\n\n<document_context fileName="${doc.fileName}" usedOcr="${doc.usedOcr}">\n${doc.markdownContent}\n</document_context>\n\nINSTRUKSI RESPON WAJIB: Dokumen '${doc.fileName}' baru saja diunggah oleh pengguna. Segera respon secara lisan dengan hangat, ramah, dan natural bahwa kamu sudah membaca isi file '${doc.fileName}' tersebut, lalu tanyakan kepada pengguna dokumen ini mau diapakan (contohnya: mau dirangkum/disummarize, diedit isinya, diterjemahkan, dianalisis datanya, atau ada bagian tertentu yang mau ditanyakan). JANGAN bacakan seluruh isi dokumen, cukup sapa dan tanyakan rencana pengguna terhadap dokumen ini.`;

        let isLiveActive = false;
        if (directSessionRef.current) {
          try {
            directSessionRef.current.sendClientContent({
              turns: [
                {
                  role: "user",
                  parts: [{ text: systemContent }],
                },
              ],
              turnComplete: true,
            });
            isLiveActive = true;
          } catch (e) {
            console.warn("Gagal inject context dokumen ke direct session:", e);
          }
        } else if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          sendMessageRef.current({
            type: "doc_context",
            text: systemContent,
            fileName: doc.fileName,
          });
          isLiveActive = true;
        }

        // Jika belum tersambung ke audio Live, tampilkan pesan sapaan proaktif Celyn ke transcripts chat
        if (!isLiveActive) {
          setTranscripts((prev) => [
            ...prev,
            {
              speaker: "celyn",
              text: `Aku sudah selesai baca isi file '${doc.fileName}' ini lho! Kira-kira mau kamu apain nih dokumennya? Mau aku bantu rangkum intisarinya, edit isinya, terjemahin, atau ada bagian tertentu yang mau kamu tanyakan?`,
              time: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
            },
          ]);
        }

        setDocStatusMessage(`Dokumen '${doc.fileName}' siap dibahas bersama Celyn!`);
        setTimeout(() => setDocStatusMessage(null), 4000);
        return doc;
      } catch (err: any) {
        setDocStatusMessage(`Gagal membaca dokumen: ${err?.message || "Error"}`);
        throw err;
      } finally {
        setIsUploadingDoc(false);
      }
    },
    []
  );

  const removeDocument = useCallback((fileName: string) => {
    setActiveDocuments((prev) => prev.filter((d) => d.fileName !== fileName));
  }, []);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    status,
    statusMessage,
    modelInfo,
    connectionLabel,
    emotion,
    setEmotion,
    lookAt,
    transcripts,
    activeDocuments,
    jobs,
    dismissJob,
    isUploadingDoc,
    isGeneratingDoc,
    docStatusMessage,
    uploadDocument,
    removeDocument,
    generateDocument,
    connect,
    disconnect,
    sendAudio,
    sendAudioStreamEnd,
    sendScreen,
    sendText,
    clearTranscripts,
    onBargeIn,
    quotaCooldownSeconds,
    startQuotaCooldown,
  };
}
