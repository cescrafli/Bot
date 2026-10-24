import { useState, useRef, useCallback, useEffect } from "react";
import {
  ClientMessage,
  ServerMessage,
  EmotionType,
  LookAtTarget,
} from "@celyn/shared";

interface UseGeminiLiveOptions {
  onAudioReceived: (b64PCM24k: string) => void;
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
  const [emotion, setEmotion] = useState<EmotionType>("neutral");
  const [lookAt, setLookAt] = useState<LookAtTarget | null>(null);
  const [transcripts, setTranscripts] = useState<
    Array<{ speaker: "user" | "celyn"; text: string; time: string }>
  >([]);

  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    setStatus("connecting");
    setStatusMessage("Menghubungkan ke server backend...");

    // Tentukan URL WebSocket (ke server localhost:3001)
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl =
      process.env.NODE_ENV === "production"
        ? `${wsProtocol}//${window.location.host}/ws`
        : "ws://localhost:3001";

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      setStatus("listening");
      setStatusMessage("Terhubung! Celyn sedang mendengarkan...");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;

        if (msg.type === "audio") {
          setStatus("speaking");
          onAudioReceived(msg.data);
        } else if (msg.type === "interrupted") {
          console.log("⚡ Interrupted diterima dari server");
          setStatus("listening");
          onInterrupted();
        } else if (msg.type === "transcript") {
          const time = new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });
          setTranscripts((prev) => [
            ...prev.slice(-10), // Simpan 10 percakapan terakhir
            { speaker: msg.speaker, text: msg.text, time },
          ]);
        } else if (msg.type === "tool_call") {
          if (msg.name === "set_expression") {
            const newEmotion = (msg.args.emotion as EmotionType) || "neutral";
            console.log("🎭 Mengubah emosi avatar ke:", newEmotion);
            setEmotion(newEmotion);
          } else if (msg.name === "point_at_screen") {
            const x = Number(msg.args.x) || 0.5;
            const y = Number(msg.args.y) || 0.5;
            const description = (msg.args.description as string) || undefined;
            console.log("👁️ Avatar melirik ke layar:", { x, y, description });
            setLookAt({ x, y, description });

            // Reset lookAt setelah 6 detik
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
      } catch (err) {
        console.error("Gagal membaca pesan WebSocket:", err);
      }
    };

    ws.onerror = (err) => {
      console.error("WebSocket client error:", err);
      setStatus("error");
      setStatusMessage("Koneksi ke backend gagal. Pastikan server aktif.");
    };

    ws.onclose = () => {
      setIsConnected(false);
      setStatus("idle");
      setStatusMessage("Koneksi terputus.");
    };
  }, [onAudioReceived, onInterrupted]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    setStatus("idle");
    setStatusMessage("Sesi dihentikan.");
  }, []);

  const sendMessage = useCallback((msg: ClientMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
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
      sendMessage({ type: "text", text });
    },
    [sendMessage]
  );

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    status,
    statusMessage,
    emotion,
    lookAt,
    transcripts,
    connect,
    disconnect,
    sendAudio,
    sendScreen,
    sendText,
  };
}
