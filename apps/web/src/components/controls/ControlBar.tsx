import React from "react";
import {
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  Power,
  Box,
  Layers,
  Volume2,
  Radio,
  History,
  HelpCircle,
  Sparkles,
} from "lucide-react";

interface ControlBarProps {
  isConnected: boolean;
  isMicActive: boolean;
  isScreenSharing: boolean;
  isPushToTalk: boolean;
  avatarMode: "2d" | "3d";
  volume: number; // 0..1
  onToggleConnection: () => void;
  onToggleMic: () => void;
  onToggleScreenShare: () => void;
  onTogglePushToTalk: () => void;
  onToggleAvatarMode: () => void;
  onToggleVoiceSelector?: () => void;
  onToggleHistory: () => void;
  onToggleHelp: () => void;
  onTriggerTestSpeech?: () => void;
  onPttHoldStart?: () => void;
  onPttHoldEnd?: () => void;
}

export const ControlBar: React.FC<ControlBarProps> = ({
  isConnected,
  isMicActive,
  isScreenSharing,
  isPushToTalk,
  avatarMode,
  volume,
  onToggleConnection,
  onToggleMic,
  onToggleScreenShare,
  onTogglePushToTalk,
  onToggleAvatarMode,
  onToggleVoiceSelector,
  onToggleHistory,
  onToggleHelp,
  onTriggerTestSpeech,
  onPttHoldStart,
  onPttHoldEnd,
}) => {
  return (
    <div className="flex items-center justify-center flex-wrap sm:flex-nowrap gap-1.5 sm:gap-2.5 px-2.5 py-2 sm:px-5 sm:py-3 rounded-2xl glass-panel shadow-2xl border border-white/10 w-auto max-w-[96vw] overflow-x-auto no-scrollbar">
      {/* Tombol Utama Koneksi */}
      <button
        onClick={onToggleConnection}
        title={isConnected ? "Hentikan Sesi" : "Mulai Percakapan"}
        className={`flex items-center gap-1.5 sm:gap-2 px-3.5 py-2 sm:px-5 sm:py-2.5 rounded-xl font-semibold text-xs sm:text-sm transition-all duration-200 shadow-lg shrink-0 ${
          isConnected
            ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30"
            : "bg-gradient-to-r from-rose-500 to-pink-600 text-white hover:from-rose-600 hover:to-pink-700 shadow-rose-500/30 hover:scale-[1.02]"
        }`}
      >
        <Power className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isConnected ? "text-rose-400" : ""}`} />
        <span className="sm:hidden">{isConnected ? "Akhiri" : "Mulai"}</span>
        <span className="hidden sm:inline">{isConnected ? "Akhiri Sesi" : "Mulai Celyn"}</span>
      </button>

      <div className="hidden sm:block h-6 w-px bg-white/10 mx-0.5 sm:mx-1 shrink-0" />

      {/* Tombol Mikrofon (Mendukung Touch-Hold saat mode PTT aktif di HP) */}
      <button
        onClick={isPushToTalk ? undefined : onToggleMic}
        onTouchStart={isPushToTalk ? (e) => { e.preventDefault(); onPttHoldStart?.(); } : undefined}
        onTouchEnd={isPushToTalk ? (e) => { e.preventDefault(); onPttHoldEnd?.(); } : undefined}
        onMouseDown={isPushToTalk ? () => onPttHoldStart?.() : undefined}
        onMouseUp={isPushToTalk ? () => onPttHoldEnd?.() : undefined}
        onMouseLeave={isPushToTalk ? () => onPttHoldEnd?.() : undefined}
        disabled={!isConnected}
        title={
          isPushToTalk
            ? "Tekan & Tahan untuk Bicara"
            : isMicActive
            ? "Matikan Mikrofon (M)"
            : "Nyalakan Mikrofon (M)"
        }
        className={`p-2 sm:p-2.5 rounded-xl transition-all duration-150 shrink-0 ${
          !isConnected
            ? "opacity-40 cursor-not-allowed bg-slate-800/40 text-slate-500"
            : isMicActive
            ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/50 hover:bg-emerald-500/35 ring-2 ring-emerald-500/30"
            : "bg-slate-800/80 text-slate-300 hover:bg-slate-700 border border-white/10"
        }`}
      >
        {isMicActive ? (
          <Mic className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-300 animate-pulse" />
        ) : (
          <MicOff className="w-4 h-4 sm:w-5 sm:h-5 text-rose-400" />
        )}
      </button>

      {/* Push to Talk Toggle */}
      <button
        onClick={onTogglePushToTalk}
        disabled={!isConnected}
        title="Mode Tekan untuk Bicara (Push to Talk)"
        className={`flex items-center gap-1 sm:gap-1.5 px-2.5 py-2 sm:px-3 sm:py-2.5 rounded-xl text-xs font-medium border transition-colors shrink-0 ${
          !isConnected
            ? "opacity-40 cursor-not-allowed bg-slate-800/40 text-slate-500 border-transparent"
            : isPushToTalk
            ? "bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30"
            : "bg-slate-800/80 text-slate-400 hover:bg-slate-700 border-white/10"
        }`}
      >
        <Radio className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        <span className="hidden md:inline">Push-to-Talk</span>
        <span className="md:hidden">PTT</span>
      </button>

      {/* Tombol Screen Share */}
      <button
        onClick={onToggleScreenShare}
        disabled={!isConnected}
        title={isScreenSharing ? "Hentikan Bagikan Layar" : "Bagikan Layar ke Celyn"}
        className={`flex items-center gap-1.5 px-2.5 py-2 sm:px-3.5 sm:py-2.5 rounded-xl font-medium text-xs transition-all duration-150 shrink-0 ${
          !isConnected
            ? "opacity-40 cursor-not-allowed bg-slate-800/40 text-slate-500"
            : isScreenSharing
            ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 animate-pulse"
            : "bg-slate-800/80 text-slate-300 hover:bg-slate-700 border border-white/10"
        }`}
      >
        {isScreenSharing ? (
          <>
            <Monitor className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-cyan-300" />
            <span className="hidden sm:inline">Berbagi</span>
          </>
        ) : (
          <>
            <MonitorOff className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Layar</span>
          </>
        )}
      </button>

      {/* Toggle Mode Avatar 2D / 3D */}
      <button
        onClick={onToggleAvatarMode}
        title="Ganti Mode Avatar (2D Celyn / 3D VRM)"
        className="flex items-center gap-1 sm:gap-1.5 px-2.5 py-2 sm:px-3 sm:py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-white/10 transition-colors shrink-0"
      >
        {avatarMode === "2d" ? (
          <>
            <Layers className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-pink-400" />
            <span>2D</span>
          </>
        ) : (
          <>
            <Box className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-cyan-400" />
            <span>3D</span>
          </>
        )}
      </button>

      {/* Tombol Pemilih Suara */}
      {onToggleVoiceSelector && (
        <button
          onClick={onToggleVoiceSelector}
          title="Pilih Suara Celyn (Multi-Voice)"
          className="flex items-center gap-1 sm:gap-1.5 px-2.5 py-2 sm:px-3 sm:py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-white/10 transition-colors shrink-0"
        >
          <Volume2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-rose-400" />
          <span className="hidden md:inline">Suara</span>
        </button>
      )}

      {/* Tombol Tes Suara & Mulut */}
      {onTriggerTestSpeech && (
        <button
          onClick={onTriggerTestSpeech}
          title="Uji coba gerak mulut dan suara Celyn sekarang"
          className="flex items-center gap-1 sm:gap-1.5 px-2.5 py-2 sm:px-3 sm:py-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-semibold border border-rose-500/30 transition-all shrink-0 hover:scale-[1.02]"
        >
          <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-rose-400 animate-pulse" />
          <span className="hidden md:inline">Tes Suara</span>
          <span className="md:hidden">Tes</span>
        </button>
      )}

      {/* Tombol Riwayat Transkrip */}
      <button
        onClick={onToggleHistory}
        title="Lihat Riwayat Percakapan Lengkap"
        className="p-2 sm:p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-white/10 transition-colors shrink-0"
      >
        <History className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
      </button>

      {/* Tombol Bantuan Pintasan */}
      <button
        onClick={onToggleHelp}
        title="Panduan & Pintasan Keyboard"
        className="p-2 sm:p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white border border-white/10 transition-colors shrink-0"
      >
        <HelpCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
      </button>

      {/* Meter Volume Output Celyn */}
      {isConnected && (
        <div className="flex items-center gap-1.5 pl-1 sm:pl-2 shrink-0">
          <Volume2 className="w-3.5 h-3.5 text-slate-400" />
          <div className="w-8 sm:w-14 h-2 rounded-full bg-slate-800 overflow-hidden border border-white/5">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 via-rose-500 to-pink-500 transition-all duration-75"
              style={{ width: `${Math.min(100, volume * 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
