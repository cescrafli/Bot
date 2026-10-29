import React, { useState, useCallback, useEffect, useRef, Suspense, lazy } from "react";
import { AvatarCanvas2D } from "./components/avatar/AvatarCanvas2D";
import { ControlBar } from "./components/controls/ControlBar";
import { JobTray } from "./components/controls/JobTray";
import { ScreenPreview } from "./components/screen/ScreenPreview";
import { SubtitleOverlay } from "./components/transcript/SubtitleOverlay";
import { TranscriptDrawer } from "./components/chat/TranscriptDrawer";
import { ShortcutsModal } from "./components/modals/ShortcutsModal";
import { VoiceSelectorModal } from "./components/modals/VoiceSelectorModal";
import { SettingsModal } from "./components/modals/SettingsModal";
import { DocumentModal } from "./components/modals/DocumentModal";
import { useAudioEngine } from "./hooks/useAudioEngine";
import { useGeminiLive } from "./hooks/useGeminiLive";
import { useScreenCapture } from "./hooks/useScreenCapture";
import { useAuth } from "./hooks/useAuth";
import { AuthGate } from "./components/auth/AuthGate";
import {
  Bot,
  Activity,
  Wifi,
  Shield,
  Send,
  Box,
  Lock,
  AlertCircle,
  Volume2,
  Settings,
  AudioLines,
} from "lucide-react";
import { getVoiceOption } from "@celyn/shared";

// Lazy-load Avatar 3D VRM agar initial bundle load ringan di Vercel
const AvatarVRM3D = lazy(() =>
  import("./components/avatar/AvatarVRM3D").then((m) => ({
    default: m.AvatarVRM3D,
  }))
);

export function App() {
  const auth = useAuth();
  const [avatarMode, setAvatarMode] = useState<"2d" | "3d">("2d");
  const [isPushToTalk, setIsPushToTalk] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isRigPanelOpen, setIsRigPanelOpen] = useState(false);
  const [isTextInputOpen, setIsTextInputOpen] = useState(false);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [inputText, setInputText] = useState("");
  const [selectedVoice, setSelectedVoice] = useState<string>(() => {
    return localStorage.getItem("celyn_selected_voice") || "Aoede";
  });

  const liveRef = useRef<any>(null);

  // Hook Audio Capture & Playback
  const audioEngine = useAudioEngine({
    onAudioChunk: (b64PCM16k) => {
      if (liveRef.current?.isConnected) {
        liveRef.current.sendAudio(b64PCM16k);
      }
    },
    onBargeIn: () => {
      liveRef.current?.onBargeIn();
    },
    onAudioStreamEnd: () => {
      liveRef.current?.sendAudioStreamEnd();
    },
  });

  // Hook Gemini Live WebSocket
  const live = useGeminiLive({
    onAudioReceived: (b64Audio, mimeType) => {
      audioEngine.playAudioChunk(b64Audio, mimeType);
    },
    onInterrupted: () => {
      audioEngine.stopPlayback();
    },
  });

  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  // ⚡ Otomatis matikan mikrofon jika sesi terputus atau berakhir
  useEffect(() => {
    if (!live.isConnected && audioEngine.isMicActive) {
      audioEngine.stopMic();
    }
  }, [live.isConnected, audioEngine]);

  // Hook Screen Capture dengan Change Detection hemat token
  const screenCapture = useScreenCapture({
    onFrame: (b64JPEG) => {
      live.sendScreen(b64JPEG);
    },
  });

  const handleSelectVoice = useCallback(
    (newVoice: string) => {
      setSelectedVoice(newVoice);
      localStorage.setItem("celyn_selected_voice", newVoice);
      setIsVoiceModalOpen(false);
      audioEngine.stopPlayback();
      if (live.isConnected) {
        live.disconnect();
        setTimeout(() => {
          live.connect(newVoice);
        }, 200);
      }
    },
    [live, audioEngine]
  );

  // Uji coba suara: Jika live aktif, minta Celyn bicara langsung; jika belum, putar sampel audio
  const handleTestSpeech = useCallback(() => {
    if (live.isConnected) {
      live.sendText("Celyn, halo! Coba sapa aku dengan satu kalimat ramah dan ceria.");
    } else {
      audioEngine.triggerTestSpeech();
    }
  }, [live, audioEngine]);

  // Kirim Pesan Teks (dengan auto-connect jika belum tersambung, tanpa menyalakan mic)
  const handleSendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // ⚡ Buka kunci AudioContext secara sinkron saat user gesture submit (wajib untuk pemutaran audio browser)
      audioEngine.unlockAudio();

      // Hentikan pemutaran audio sebelumnya HANYA jika Celyn sedang aktif berbicara
      if (audioEngine.isPlaying) {
        audioEngine.stopPlayback();
      }

      // Jika belum terhubung, hubungkan otomatis ke Celyn TANPA menyalakan mikrofon
      if (!live.isConnected) {
        live.connect(selectedVoice);
      }

      live.sendText(trimmed);
      setInputText("");
    },
    [audioEngine, live, selectedVoice]
  );

  // Toggle Koneksi Sesi
  const handleToggleConnection = useCallback(async () => {
    // ⚡ Buka kunci AudioContext secara sinkron saat user gesture (wajib untuk iOS Safari & Android Chrome)
    audioEngine.unlockAudio();

    if (live.isConnected) {
      screenCapture.stopScreenShare();
      audioEngine.stopMic();
      audioEngine.stopPlayback();
      live.disconnect();
    } else {
      live.connect(selectedVoice);
      try {
        if (!isPushToTalk) {
          await audioEngine.startMic();
        }
      } catch (err) {
        console.warn("Gagal membuka mic otomatis saat connect:", err);
      }
    }
  }, [live, screenCapture, audioEngine, isPushToTalk, selectedVoice]);

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
      if (!auth.isAuthenticated) return;

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
      if (!auth.isAuthenticated) return;

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
    auth.isAuthenticated,
    live.isConnected,
    isPushToTalk,
    audioEngine,
    handleToggleMic,
    handleToggleScreenShare,
  ]);

  // Status sinkron dengan pemutaran audio riil dan mikrofon di browser
  const effectiveStatus = !live.isConnected
    ? "idle"
    : live.status === "error"
    ? "error"
    : audioEngine.isPlaying
    ? "speaking"
    : live.status === "researching"
    ? "researching"
    : live.status === "working"
    ? "working"
    : live.status === "thinking"
    ? "thinking"
    : !audioEngine.isMicActive
    ? "idle"
    : live.status;

  const effectiveStatusMessage = !live.isConnected
    ? "Siaga • Siap Berbicara"
    : live.status === "error"
    ? live.statusMessage || "Koneksi Celyn bermasalah"
    : audioEngine.isPlaying
    ? "Berbicara • Merespons Anda"
    : effectiveStatus === "researching"
    ? "Tunggu sebentar ya, saya sedang research..."
    : effectiveStatus === "working"
    ? "Sedang memproses dokumen di latar belakang..."
    : effectiveStatus === "thinking"
    ? "Menyimak • Merangkai Jawaban"
    : !audioEngine.isMicActive
    ? "Siaga • Siap Berbicara"
    : "Mendengarkan • Silakan Bicara";

  // Handler Logout / Kunci Sesi
  const handleLogout = useCallback(() => {
    if (live.isConnected) {
      live.disconnect();
    }
    audioEngine.stopMic();
    audioEngine.stopPlayback();
    if (screenCapture.isSharing) {
      screenCapture.stopScreenShare();
    }
    auth.logout();
  }, [live, audioEngine, screenCapture, auth]);

  // Handler Login dengan Auto-Unlock AudioContext (User Gesture Sah Browser)
  const handleLogin = useCallback(
    (password: string, rememberMe = true) => {
      // ⚡ Buka kunci AudioContext seketika saat klik Login agar browser mengizinkan audio out tanpa open mic
      audioEngine.unlockAudio();
      return auth.login(password, rememberMe);
    },
    [audioEngine, auth]
  );

  // Gerbang Autentikasi: Tahan seluruh tampilan AI jika belum memasukkan password 'admin'
  if (!auth.isAuthenticated) {
    return (
      <AuthGate
        error={auth.error}
        isLocked={auth.isLocked}
        lockoutSeconds={auth.lockoutSeconds}
        onLogin={handleLogin}
        onClearError={auth.clearError}
      />
    );
  }

  return (
    <div className="relative w-full h-[100dvh] flex flex-col justify-between bg-[#08080d] text-slate-200 overflow-hidden select-none safe-top safe-bottom safe-left safe-right">
      {/* Subtle Luxury Ambient Background */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[850px] h-[850px] ambient-halo blur-[110px] animate-soft-aura z-0"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[600px] h-[350px] ambient-halo-back blur-[90px] z-0"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(#ffffff05_1px,transparent_1px)] [background-size:32px_32px] opacity-40 z-0"
      />

      {/* Main Viewport Shell */}
      <div className="relative z-10 flex flex-col justify-between h-full p-3 sm:p-5 md:p-6 lg:p-8 max-w-7xl mx-auto w-full">
        {/* Minimalist Header Bar (h-12) */}
        <header className="flex items-center justify-between w-full h-12 shrink-0">
          {/* Left: Refined Minimal Logo */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-rose-500/80 to-violet-500/80 p-[1px] shadow-sm shadow-rose-500/20">
              <div className="w-full h-full rounded-full bg-[#08080d]/90 flex items-center justify-center">
                <span className="w-2 h-2 rounded-full bg-rose-400" />
              </div>
            </div>
            <span className="font-medium tracking-tight text-white text-sm md:text-base">
              Celyn AI
            </span>
          </div>

          {/* Center: Clean Status & Audio Presence */}
          <div className="luxury-blur-panel px-3 sm:px-4 py-1.5 rounded-full flex items-center gap-2 sm:gap-2.5 transition-all">
            <span className="relative flex h-2 w-2 shrink-0">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${
                  audioEngine.isPlaying || (live.isConnected && audioEngine.isMicActive)
                    ? "bg-rose-400"
                    : "hidden"
                }`}
              />
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  audioEngine.isPlaying || (live.isConnected && audioEngine.isMicActive)
                    ? "bg-rose-500"
                    : live.isConnected
                    ? "bg-rose-400/80"
                    : "bg-slate-400"
                }`}
              />
            </span>
            <span className="text-[11px] sm:text-xs font-normal text-slate-300 tracking-wide truncate max-w-[130px] sm:max-w-none">
              {effectiveStatusMessage}
            </span>
            {/* Delicate Waveform Bars */}
            <div className="flex items-center gap-0.5 h-3 pl-1.5 border-l border-white/10 shrink-0">
              <span
                className={`w-[2px] rounded-full transition-all ${
                  audioEngine.isPlaying || effectiveStatus === "speaking"
                    ? "h-3 bg-rose-400 animate-bar-wave"
                    : "h-1.5 bg-rose-400/80"
                }`}
              />
              <span
                className={`w-[2px] rounded-full transition-all ${
                  audioEngine.isPlaying || effectiveStatus === "speaking"
                    ? "h-4 bg-violet-400 animate-bar-wave"
                    : "h-3 bg-violet-400/80"
                }`}
                style={{ animationDelay: "0.2s" }}
              />
              <span
                className={`w-[2px] rounded-full transition-all ${
                  audioEngine.isPlaying || effectiveStatus === "speaking"
                    ? "h-2.5 bg-slate-300 animate-bar-wave"
                    : "h-2 bg-slate-300/80"
                }`}
                style={{ animationDelay: "0.4s" }}
              />
            </div>
          </div>

          {/* Right: Concise Essential Controls */}
          <div className="flex items-center gap-2 sm:gap-2.5">
            {/* Voice Changer Selector Button */}
            <button
              onClick={() => setIsVoiceModalOpen(true)}
              className="h-8 px-2.5 rounded-full luxury-blur-panel flex items-center gap-1.5 text-slate-300 hover:text-white hover:border-white/20 transition-all cursor-pointer group"
              title={`Karakter Suara: ${getVoiceOption(live.modelInfo.voice || selectedVoice).name} (Klik untuk ganti)`}
            >
              <AudioLines className="w-3.5 h-3.5 text-rose-400 group-hover:scale-110 transition-transform" />
              <span className="text-[11px] font-medium tracking-wide">
                {getVoiceOption(live.modelInfo.voice || selectedVoice).name}
              </span>
            </button>

            {/* Settings Icon Button */}
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="w-8 h-8 rounded-full luxury-blur-panel flex items-center justify-center text-slate-400 hover:text-white hover:border-white/20 transition-colors cursor-pointer"
              title="Pengaturan"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Center Character Stage (Uncluttered, Breathing Room) */}
        <main
          className="relative flex-1 flex flex-col items-center justify-center my-auto min-h-0 w-full"
          data-purpose="central-avatar-stage"
        >
          {/* Banner Error Screen/Camera Capture */}
          {screenCapture.error && (
            <div className="absolute top-2 z-40 max-w-sm px-4 py-2 rounded-xl bg-rose-600/95 text-white text-xs backdrop-blur-md shadow-2xl flex items-center gap-2 border border-rose-400/40 animate-in fade-in slide-in-from-top-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-white" />
              <span className="flex-1">{screenCapture.error}</span>
            </div>
          )}

          {avatarMode === "2d" ? (
            <AvatarCanvas2D
              emotion={live.emotion}
              mouthOpen={audioEngine.volume}
              intonation={audioEngine.intonation}
              isSpeaking={audioEngine.isPlaying || effectiveStatus === "speaking"}
              lookAt={live.lookAt}
              status={effectiveStatus}
              isRigPanelOpen={isRigPanelOpen}
              onToggleRigPanel={() => setIsRigPanelOpen((prev) => !prev)}
            />
          ) : (
            <Suspense
              fallback={
                <div className="flex flex-col items-center justify-center gap-2.5 text-cyan-300 text-xs animate-pulse p-8 rounded-2xl luxury-blur-panel border border-cyan-500/20">
                  <Box className="w-8 h-8 animate-spin" />
                  <span>Memuat Engine 3D VRM...</span>
                </div>
              }
            >
              <AvatarVRM3D
                emotion={live.emotion}
                mouthOpen={audioEngine.volume}
                isSpeaking={audioEngine.isPlaying || effectiveStatus === "speaking"}
                lookAt={live.lookAt}
              />
            </Suspense>
          )}

          {/* Floating Screen Preview jika sedang sharing */}
          {screenCapture.isSharing && (
            <ScreenPreview
              videoElement={screenCapture.videoElement}
              captureMode={screenCapture.captureMode}
              lookAt={live.lookAt}
              stats={screenCapture.stats}
              isPaused={screenCapture.isPaused}
              onTogglePause={screenCapture.togglePause}
              onClose={screenCapture.stopScreenShare}
            />
          )}
        </main>

        {/* Floating Subtitle & Ultra-Clean Control Dock */}
        <footer className="w-full flex flex-col items-center pb-2 shrink-0 gap-3">
          {/* Floating Elegant Speech Subtitle */}
          <SubtitleOverlay
            transcripts={live.transcripts}
            statusMessage={effectiveStatusMessage}
            status={effectiveStatus}
          />

          {/* Toggleable Luxury Text Input Form */}
          {isTextInputOpen && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendText(inputText);
              }}
              className="w-full max-w-md flex items-center gap-2 px-3 py-1.5 rounded-2xl luxury-blur-panel border border-white/10 shadow-2xl animate-in fade-in slide-in-from-bottom-2"
            >
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Ketik pesan untuk Celyn..."
                className="flex-1 bg-transparent text-xs sm:text-sm text-white placeholder-slate-400 focus:outline-none px-2 py-1 min-w-0"
                autoFocus
              />
              <button
                type="submit"
                disabled={!inputText.trim()}
                className="p-1.5 rounded-xl bg-rose-500 hover:bg-rose-600 disabled:opacity-30 text-white transition-colors cursor-pointer shrink-0"
                title="Kirim pesan"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          )}

          {/* Ultra-Clean 5-Button Dock */}
          <ControlBar
            isConnected={live.isConnected}
            isMicActive={audioEngine.isMicActive}
            isScreenSharing={screenCapture.isSharing}
            isPushToTalk={isPushToTalk}
            isTextInputOpen={isTextInputOpen}
            volume={audioEngine.volume}
            onToggleConnection={handleToggleConnection}
            onToggleMic={handleToggleMic}
            onToggleScreenShare={handleToggleScreenShare}
            onToggleVoiceSelector={() => setIsVoiceModalOpen(true)}
            onToggleTextInput={() => setIsTextInputOpen((prev) => !prev)}
            onToggleHistory={() => setIsHistoryOpen(true)}
            activeDocumentsCount={live.activeDocuments.length}
            onToggleDocumentModal={() => setIsDocumentModalOpen(true)}
            onPttHoldStart={() => {
              if (!audioEngine.isMicActive) audioEngine.startMic();
            }}
            onPttHoldEnd={() => {
              if (audioEngine.isMicActive) audioEngine.stopMic();
            }}
          />
        </footer>
      </div>

      {/* Riwayat Percakapan Drawer */}
      <TranscriptDrawer
        isOpen={isHistoryOpen}
        transcripts={live.transcripts}
        onClose={() => setIsHistoryOpen(false)}
        onClear={live.clearTranscripts}
      />

      {/* Tray Notifikasi Pekerjaan Latar Belakang */}
      <JobTray jobs={live.jobs} onDismissJob={live.dismissJob} />

      {/* Modal Bantuan & Pintasan Keyboard */}
      <ShortcutsModal
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
      />

      {/* Modal Manajemen Dokumen (PDF, Word, Excel) */}
      <DocumentModal
        isOpen={isDocumentModalOpen}
        onClose={() => setIsDocumentModalOpen(false)}
        activeDocuments={live.activeDocuments}
        onUploadDocument={live.uploadDocument}
        onRemoveDocument={live.removeDocument}
        onGenerateDocument={live.generateDocument}
        isUploading={live.isUploadingDoc}
        isGenerating={live.isGeneratingDoc}
        statusMessage={live.docStatusMessage}
      />

      {/* Modal Pemilih Suara Multi-Voice */}
      <VoiceSelectorModal
        isOpen={isVoiceModalOpen}
        selectedVoice={live.modelInfo.voice || selectedVoice}
        onSelectVoice={handleSelectVoice}
        onClose={() => setIsVoiceModalOpen(false)}
        onTestVoice={handleTestSpeech}
      />

      {/* Modal Pengaturan */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        avatarMode={avatarMode}
        onToggleAvatarMode={() =>
          setAvatarMode((prev) => (prev === "2d" ? "3d" : "2d"))
        }
        isPushToTalk={isPushToTalk}
        onTogglePushToTalk={() => setIsPushToTalk((prev) => !prev)}
        isConnected={live.isConnected}
        onToggleConnection={handleToggleConnection}
        onOpenShortcuts={() => setIsHelpOpen(true)}
        onOpenCalibration={() => setIsRigPanelOpen(true)}
        onTriggerTestSpeech={handleTestSpeech}
        onLogout={handleLogout}
        currentEmotion={live.emotion}
        onSelectEmotion={live.setEmotion}
      />
    </div>
  );
}
