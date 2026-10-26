import { useState, useRef, useCallback, useEffect } from "react";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { getStoredAuthPassword } from "./useAuth";
import {
  ClientMessage,
  ServerMessage,
  EmotionType,
  LookAtTarget,
  normalizeEmotion,
  inferEmotionFromText,
  buildContextualGreetingPrompt,
  CELYN_SYSTEM_PROMPT,
  CELYN_GREETING_PROMPT,
  DEFAULT_VOICE_NAME,
  extractIndonesianSentences,
} from "@celyn/shared";

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
    "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error"
  >("idle");
  const [statusMessage, setStatusMessage] = useState<string>("Siap terhubung");
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
        }
      } else if (msg.type === "status") {
        setStatus(msg.status);
        if (msg.message) setStatusMessage(msg.message);
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
      const queryParams = new URLSearchParams();
      if (voicePreference) queryParams.set("voice", voicePreference);
      const queryStr = queryParams.toString() ? `?${queryParams.toString()}` : "";

      const res = await fetch(`/api/token${queryStr}`, {
        headers: {
          "x-admin-password": authPass,
        },
      });
      const data = await res.json();

      if (!res.ok || !data.token) {
        throw new Error(
          data.error ||
            "Gagal mendapatkan Ephemeral Token dari /api/token. Pastikan GEMINI_API_KEY sudah diatur di Environment Variables Vercel."
        );
      }

      const activeModel = data.model || "gemini-3.8-live";
      const activeVoice = voicePreference || data.voice || DEFAULT_VOICE_NAME;
      const useEdgeTts =
        activeVoice.includes("Neural") || activeVoice.startsWith("id-ID");
      const internalGeminiVoice = useEdgeTts ? "Aoede" : activeVoice;

      setModelInfo({ model: activeModel, voice: activeVoice });
      setConnectionLabel("Vercel Live Direct");
      setStatusMessage("Menghubungkan ke Gemini Live API (Bahasa Indonesia)...");

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
            parts: [{ text: CELYN_SYSTEM_PROMPT }],
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
          onmessage: (msg: any) => {
            if (msg.serverContent?.interrupted) {
              bargeInMutedRef.current = false;
              handleServerMessage({ type: "interrupted" });
              return;
            }

            if (msg.serverContent?.inputTranscription?.text) {
              bargeInMutedRef.current = false;
              backupPcmChunksRef.current = [];
              const userText = msg.serverContent.inputTranscription.text.trim();
              if (userText) {
                handleServerMessage({
                  type: "transcript",
                  speaker: "user",
                  text: userText,
                });
                handleServerMessage({
                  type: "status",
                  status: "thinking",
                  message: "Celyn sedang menyimak & merangkai jawaban...",
                });
              }
            }

            if (msg.serverContent?.outputTranscription?.text) {
              if (!bargeInMutedRef.current) {
                const celynText = msg.serverContent.outputTranscription.text;
                if (celynText) {
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

              if (directRelaxTimerRef.current) clearTimeout(directRelaxTimerRef.current);
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
              }, 4500);

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

                if (directSessionRef.current) {
                  try {
                    directSessionRef.current.sendToolResponse({
                      functionResponses: [
                        {
                          id: fc.id,
                          name: fc.name,
                          response: {
                            output: {
                              status: "applied",
                              instruction: "Ekspresi visual berhasil diterapkan. Sekarang kamu WAJIB langsung memberikan respon lisanmu dengan suara (audio) dalam Bahasa Indonesia.",
                            },
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
            console.error("Gemini Live Direct Error:", err);
            setStatus("error");
            setStatusMessage(
              `Koneksi Gemini Error: ${err?.message || "Terjadi kesalahan"}`
            );
          },
          onclose: () => {
            clearSessionTimers();
            directSessionRef.current = null;
            setIsConnected(false);
            setStatus("idle");
            setStatusMessage("Sesi Gemini telah berakhir.");
          },
        },
      });

      directSessionRef.current = session;
      setIsConnected(true);
      setStatus("listening");
      setStatusMessage("Celyn aktif dan siap mendengarkan ucapanmu!");

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
            "⚠️ Sesi Gemini Live mendekati batas 30 menit (tersisa 5 menit). Sesi akan dihentikan otomatis saat batas tercapai.",
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
                  parts: [{ text: buildContextualGreetingPrompt() }],
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
      console.error("Gagal membuka sesi Serverless Gemini:", err);
      setStatus("error");
      setStatusMessage(
        err?.message || "Gagal terhubung ke server maupun Gemini Live API."
      );
    }
  }, [handleServerMessage]);

  const connect = useCallback((selectedVoice?: string) => {
    if (
      (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) ||
      directSessionRef.current
    ) {
      return;
    }

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
    const voiceQuery = selectedVoice ? `&voice=${encodeURIComponent(selectedVoice)}` : "";
    const wsUrl =
      envWs ||
      `${wsProtocol}//${window.location.hostname}:3001?password=${encodeURIComponent(authPass)}${voiceQuery}`;

    let opened = false;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    // Timeout cepat 2.5 detik untuk fallback ke Serverless jika server lokal tidak merespons
    const wsTimeout = window.setTimeout(() => {
      if (!opened && wsRef.current === ws) {
        console.warn("⏱️ WebSocket local timeout (2.5s), beralih otomatis ke Serverless Ephemeral Token...");
        try {
          ws.close();
        } catch {}
        wsRef.current = null;
        connectViaServerlessToken(selectedVoice);
      }
    }, 2500);

    ws.onopen = () => {
      clearTimeout(wsTimeout);
      opened = true;
      setConnectionLabel(wsUrl);
      setIsConnected(true);
      setStatus("listening");
      setStatusMessage("Terhubung! Celyn sedang mendengarkan...");
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
      try {
        if (msg.type === "audio") {
          await session.sendRealtimeInput({
            audio: {
              mimeType: "audio/pcm;rate=16000",
              data: msg.data,
            },
          });
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
        } else if (msg.type === "text") {
          hasUserInitiatedTurnRef.current = true;
          bargeInMutedRef.current = false;
          directHasPendingToolCallRef.current = false;
          directTtsTurnIdRef.current++;
          directTtsBufferRef.current = "";
          backupPcmChunksRef.current = [];
          handleServerMessage({
            type: "status",
            status: "thinking",
            message: "Celyn sedang menyimak & merangkai jawaban...",
          });
          const textPrompt = `[Pesan teks dari pengguna]: "${msg.text}"\nJawablah sekarang juga dengan SUARA lisan (audio) dalam Bahasa Indonesia!`;
          await session.sendClientContent({
            turns: [{ role: "user", parts: [{ text: textPrompt }] }],
            turnComplete: true,
          });
        }
      } catch (err) {
        console.error("Gagal mengirim pesan ke sesi Gemini:", err);
      }
      return;
    }

    // 3. Jika koneksi belum terbuka, antrekan paket pesan (khususnya pesan teks WAJIB diantrekan agar tidak hilang)
    if (statusRef.current === "connecting" || msg.type === "text") {
      pendingQueueRef.current.push(msg);
      if (pendingQueueRef.current.length > 25) {
        pendingQueueRef.current.shift();
      }
    }
  }, [handleServerMessage]);

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
    lookAt,
    transcripts,
    connect,
    disconnect,
    sendAudio,
    sendAudioStreamEnd,
    sendScreen,
    sendText,
    clearTranscripts,
    onBargeIn,
  };
}
