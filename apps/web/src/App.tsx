import React, { useState, useCallback, useEffect } from "react";
import { AvatarCanvas2D } from "./components/avatar/AvatarCanvas2D";
import { AvatarVRM3D } from "./components/avatar/AvatarVRM3D";
import { ControlBar } from "./components/controls/ControlBar";
import { ScreenPreview } from "./components/screen/ScreenPreview";
import { SubtitleOverlay } from "./components/transcript/SubtitleOverlay";
import { TranscriptDrawer } from "./components/chat/TranscriptDrawer";
import { ShortcutsModal } from "./components/modals/ShortcutsModal";
import { useAudioEngine } from "./hooks/useAudioEngine";
import { useGeminiLive } from "./hooks/useGeminiLive";
import { useScreenCapture } from "./hooks/useScreenCapture";
import { Bot, Activity, Wifi, Shield } from "lucide-react";

export function App() {
  const [avatarMode, setAvatarMode] = useState<"2d" | "3d">("2d");
  const [isPushToTalk, setIsPushToTalk] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  // Hook Gemini Live WebSocket
  const live = useGeminiLive({
    onAudioReceived: (b64Audio) => {
      audioEngine.playAudioChunk(b64Audio);
    },
    onInterrupted: () => {
      audioEngine.stopPlayback();
    },
  });

  // Hook Audio Capture & Playback
  const audioEngine = useAudioEngine({
    onAudioChunk: (b64PCM16k) => {
      if (live.isConnected) {
        live.sendAudio(b64PCM16k);
      }
    },
  });

  // Hook Screen Capture dengan Change Detection hemat token
  const screenCapture = useScreenCapture({
    onFrame: (b64JPEG) => {
      if (live.isConnected) {
        live.sendScreen(b64JPEG);
      }
    },
  });

  // Toggle Koneksi Sesi
  const handleToggleConnection = useCallback(async () => {
    if (live.isConnected) {
      screenCapture.stopScreenShare();
      audioEngine.stopMic();
      audioEngine.stopPlayback();
      live.disconnect();
    } else {
      live.connect();
      try {
        if (!isPushToTalk) {
          await audioEngine.startMic();
        }
      } catch (err) {
        console.warn("Gagal membuka mic otomatis saat connect:", err);
      }
    }
  }, [live, screenCapture, audioEngine, isPushToTalk]);

  // Toggle Mikrofon
  const handleToggleMic = useCallback(async () => {
    if (audioEngine.isMicActive) {
      audioEngine.stopMic();
    } else {
      try {
        await audioEngine.startMic();
      } catch (err) {
        console.error("Gagal menyalakan mic:", err);
      }
    }
  }, [audioEngine]);

  // Toggle Screen Share
  const handleToggleScreenShare = useCallback(() => {
    if (screenCapture.isSharing) {
      screenCapture.stopScreenShare();
    } else {
      screenCapture.startScreenShare();
    }
  }, [screenCapture]);

  // Keyboard Shortcuts (M: Mute/Unmute, S: Screen Share, V: Avatar 2D/3D, Spasi: Push-to-Talk)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Abaikan jika fokus pada input teks
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      if (e.code === "KeyM" && live.isConnected) {
        e.preventDefault();
        handleToggleMic();
      } else if (e.code === "KeyS" && live.isConnected) {
        e.preventDefault();
        handleToggleScreenShare();
      } else if (e.code === "KeyV") {
        e.preventDefault();
        setAvatarMode((prev) => (prev === "2d" ? "3d" : "2d"));
      } else if (e.code === "Space" && isPushToTalk && live.isConnected) {
        if (!audioEngine.isMicActive) {
          e.preventDefault();
          audioEngine.startMic();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && isPushToTalk && live.isConnected) {
        if (audioEngine.isMicActive) {
          e.preventDefault();
          audioEngine.stopMic();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [
    live.isConnected,
    isPushToTalk,
    audioEngine,
    handleToggleMic,
    handleToggleScreenShare,
  ]);

  return (
    <div className="relative w-screen h-screen flex flex-col justify-between bg-mesh overflow-hidden select-none">
      {/* Top Header Navbar */}
      <header className="relative z-20 flex items-center justify-between px-8 py-4 border-b border-white/5 bg-slate-950/40 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-rose-500 to-pink-500 shadow-lg shadow-rose-500/25">
            <Bot className="w-5 h-5 text-white" />
            <span
              className={`absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-slate-900 transition-colors ${
                live.isConnected ? "bg-emerald-400 animate-pulse" : "bg-slate-600"
              }`}
            />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
              <span>Celyn AI</span>
              <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                Live Vision & Voice
              </span>
            </h1>
            <p className="text-xs text-slate-400 flex items-center gap-1.5">
              <span>Model: Gemini 2.0 Flash</span>
              <span>•</span>
              <span className="flex items-center gap-1 text-slate-500">
                <Shield className="w-3 h-3" /> Privasi Terproteksi
              </span>
            </p>
          </div>
        </div>

        {/* Status Pills */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-pill text-xs text-slate-300 border border-white/10">
            <Activity
              className={`w-3.5 h-3.5 ${
                live.isConnected
                  ? "text-emerald-400 animate-pulse"
                  : "text-slate-500"
              }`}
            />
            <span className="capitalize font-medium">
              {live.isConnected ? live.status : "Offline"}
            </span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-pill text-xs text-slate-400 border border-white/10">
            <Wifi className={`w-3.5 h-3.5 ${live.isConnected ? "text-emerald-400" : "text-slate-600"}`} />
            <span>ws://localhost:3001</span>
          </div>
        </div>
      </header>

      {/* Main Center Stage: Avatar Rendering Area */}
      <main className="relative flex-1 w-full flex items-center justify-center overflow-hidden">
        {avatarMode === "2d" ? (
          <AvatarCanvas2D
            emotion={live.emotion}
            mouthOpen={audioEngine.volume}
            isSpeaking={audioEngine.isPlaying}
            lookAt={live.lookAt}
          />
        ) : (
          <AvatarVRM3D
            emotion={live.emotion}
            mouthOpen={audioEngine.volume}
            isSpeaking={audioEngine.isPlaying}
            lookAt={live.lookAt}
          />
        )}

        {/* Floating Screen Preview jika sedang sharing */}
        {screenCapture.isSharing && (
          <ScreenPreview
            videoElement={screenCapture.videoElement}
            lookAt={live.lookAt}
            stats={screenCapture.stats}
            isPaused={screenCapture.isPaused}
            onTogglePause={screenCapture.togglePause}
            onClose={screenCapture.stopScreenShare}
          />
        )}
      </main>

      {/* Bottom Floating Area: Subtitles & Control Bar */}
      <footer className="relative z-30 pb-7 pt-2 flex flex-col items-center gap-3.5 px-4">
        <SubtitleOverlay
          transcripts={live.transcripts}
          statusMessage={live.statusMessage}
        />

        <ControlBar
          isConnected={live.isConnected}
          isMicActive={audioEngine.isMicActive}
          isScreenSharing={screenCapture.isSharing}
          isPushToTalk={isPushToTalk}
          avatarMode={avatarMode}
          volume={audioEngine.volume}
          onToggleConnection={handleToggleConnection}
          onToggleMic={handleToggleMic}
          onToggleScreenShare={handleToggleScreenShare}
          onTogglePushToTalk={() => setIsPushToTalk((prev) => !prev)}
          onToggleAvatarMode={() =>
            setAvatarMode((prev) => (prev === "2d" ? "3d" : "2d"))
          }
          onToggleHistory={() => setIsHistoryOpen(true)}
          onToggleHelp={() => setIsHelpOpen(true)}
        />
      </footer>

      {/* Riwayat Percakapan Drawer */}
      <TranscriptDrawer
        isOpen={isHistoryOpen}
        transcripts={live.transcripts}
        onClose={() => setIsHistoryOpen(false)}
        onClear={() => {}}
      />

      {/* Modal Bantuan & Pintasan Keyboard */}
      <ShortcutsModal
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
      />
    </div>
  );
}
