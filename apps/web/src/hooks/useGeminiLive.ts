import { useState, useRef, useCallback, useEffect } from "react";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import {
  ClientMessage,
  ServerMessage,
  EmotionType,
  LookAtTarget,
  normalizeEmotion,
  CELYN_SYSTEM_PROMPT,
  CELYN_GREETING_PROMPT,
  DEFAULT_VOICE_NAME,
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
        directTtsTurnIdRef.current++;
        directTtsBufferRef.current = "";
        setStatus("listening");
        onInterrupted();
      } else if (msg.type === "transcript") {
        const time = new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        setTranscripts((prev) => {
          const last = prev[prev.length - 1];
          if (
            last &&
            last.speaker === msg.speaker &&
            !msg.text.startsWith("\n")
          ) {
            const sep =
              last.text.endsWith(" ") ||
              msg.text.startsWith(" ") ||
              /^[.,!?;:)]/.test(msg.text) ||
              msg.speaker === "celyn"
                ? ""
                : " ";
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...last,
              text: `${last.text}${sep}${msg.text}`.replace(/\s+/g, " ").trim(),
            };
            return updated;
          }
          return [
            ...prev.slice(-99),
            { speaker: msg.speaker, text: msg.text.trim(), time },
          ];
        });
      } else if (msg.type === "tool_call") {
        if (msg.name === "set_expression") {
          const newEmotion = normalizeEmotion(msg.args.emotion);
          console.log("🎭 Mengubah emosi avatar ke:", newEmotion);
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
  const connectViaServerlessToken = useCallback(async () => {
    try {
      setStatus("connecting");
      setStatusMessage("Meminta token sesi aman dari Vercel Serverless...");

      const res = await fetch("/api/token");
      const data = await res.json();

      if (!res.ok || !data.token) {
        throw new Error(
          data.error ||
            "Gagal mendapatkan Ephemeral Token dari /api/token. Pastikan GEMINI_API_KEY sudah diatur di Environment Variables Vercel."
        );
      }

      const activeModel = data.model || "gemini-3.8-live";
      const activeVoice = data.voice || DEFAULT_VOICE_NAME;
      const useEdgeTts =
        activeVoice.includes("Neural") || activeVoice.startsWith("id-ID");
      const internalGeminiVoice = useEdgeTts ? "Aoede" : activeVoice;

      setModelInfo({ model: activeModel, voice: activeVoice });
      setConnectionLabel("Vercel Live Direct");
      setStatusMessage("Menghubungkan ke Gemini Live API (Bahasa Indonesia)...");

      const enqueueDirectEdgeTts = (sentence: string, turnId: number) => {
        directTtsChainRef.current = directTtsChainRef.current
          .then(async () => {
            if (turnId !== directTtsTurnIdRef.current || !directSessionRef.current) {
              return;
            }
            try {
              const ttsRes = await fetch("/api/tts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: sentence, voice: activeVoice }),
              });
              if (!ttsRes.ok) return;
              const ttsData = await ttsRes.json();
              if (
                turnId === directTtsTurnIdRef.current &&
                directSessionRef.current &&
                ttsData.audio
              ) {
                handleServerMessage({
                  type: "audio",
                  data: ttsData.audio,
                  mimeType: ttsData.mimeType || "audio/mp3",
                });
              }
            } catch (e) {
              console.warn("Gagal menyintesis kalimat via /api/tts:", e);
            }
          })
          .catch(() => {});
      };

      const flushDirectSentences = (forceAll: boolean) => {
        if (!useEdgeTts) return;
        while (true) {
          const match = directTtsBufferRef.current.match(
            /^([\s\S]*?[.!?\n]+)(?:\s+|$)([\s\S]*)$/
          );
          if (match && match[1].trim().length >= 8) {
            const sentence = match[1].trim();
            directTtsBufferRef.current = match[2] || "";
            enqueueDirectEdgeTts(sentence, directTtsTurnIdRef.current);
          } else {
            break;
          }
        }
        if (forceAll) {
          const remaining = directTtsBufferRef.current.trim();
          directTtsBufferRef.current = "";
          if (remaining.length > 0) {
            enqueueDirectEdgeTts(remaining, directTtsTurnIdRef.current);
          }
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
              handleServerMessage({ type: "interrupted" });
              return;
            }

            if (msg.serverContent?.inputTranscription?.text) {
              const userText = msg.serverContent.inputTranscription.text.trim();
              if (userText) {
                handleServerMessage({
                  type: "transcript",
                  speaker: "user",
                  text: userText,
                });
              }
            }

            if (msg.serverContent?.outputTranscription?.text) {
              const celynText = msg.serverContent.outputTranscription.text;
              if (celynText) {
                handleServerMessage({
                  type: "transcript",
                  speaker: "celyn",
                  text: celynText,
                });
                if (useEdgeTts) {
                  directTtsBufferRef.current += celynText;
                  flushDirectSentences(false);
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
                  if (!useEdgeTts) {
                    handleServerMessage({
                      type: "audio",
                      data: part.inlineData.data,
                      mimeType: "audio/pcm",
                    });
                  }
                }
                if (part.text && !msg.serverContent?.outputTranscription?.text) {
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
              if (useEdgeTts) {
                flushDirectSentences(true);
                const turnAtComplete = directTtsTurnIdRef.current;
                directTtsChainRef.current.then(() => {
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
                          response: { output: { status: "applied" } },
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
      flushPendingQueue();

      // Kirim sapaan otomatis Celyn saat pertama kali terhubung
      setTimeout(async () => {
        if (directSessionRef.current) {
          try {
            await directSessionRef.current.sendClientContent({
              turns: [
                {
                  role: "user",
                  parts: [{ text: CELYN_GREETING_PROMPT }],
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

  const connect = useCallback(() => {
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
      connectViaServerlessToken();
      return;
    }

    setStatus("connecting");
    setStatusMessage("Menghubungkan ke server backend...");

    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = envWs || `${wsProtocol}//${window.location.hostname}:3001`;

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
        connectViaServerlessToken();
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
        connectViaServerlessToken();
      } else {
        setStatus("error");
        setStatusMessage("Koneksi ke backend terputus.");
      }
    };

    ws.onclose = () => {
      clearTimeout(wsTimeout);
      if (opened) {
        setIsConnected(false);
        setStatus("idle");
        setStatusMessage("Koneksi terputus.");
      }
    };
  }, [handleServerMessage, connectViaServerlessToken, flushPendingQueue]);

  const disconnect = useCallback(() => {
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
  }, []);

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
        } else if (msg.type === "screen") {
          await session.sendRealtimeInput({
            video: {
              mimeType: "image/jpeg",
              data: msg.data,
            },
          });
        } else if (msg.type === "text") {
          directTtsTurnIdRef.current++;
          directTtsBufferRef.current = "";
          await session.sendClientContent({
            turns: [{ role: "user", parts: [{ text: msg.text }] }],
            turnComplete: true,
          });
        }
      } catch (err) {
        console.error("Gagal mengirim pesan ke sesi Gemini:", err);
      }
      return;
    }

    // 3. Jika status masih connecting, simpan ke antrean sementara (ring buffer maks 25 pesan)
    if (statusRef.current === "connecting") {
      pendingQueueRef.current.push(msg);
      if (pendingQueueRef.current.length > 25) {
        pendingQueueRef.current.shift();
      }
    }
  }, []);

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  const onBargeIn = useCallback(() => {
    directTtsTurnIdRef.current++;
    directTtsBufferRef.current = "";
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "barge_in" }));
    }
    setStatus("listening");
    setStatusMessage("Celyn sedang mendengarkan ucapanmu...");
  }, []);

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
    sendScreen,
    sendText,
    clearTranscripts,
    onBargeIn,
  };
}
