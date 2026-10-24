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
  onToggleHistory: () => void;
  onToggleHelp: () => void;
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
  onToggleHistory,
  onToggleHelp,
}) => {
  return (
    <div className="flex items-center gap-2.5 px-5 py-3 rounded-2xl glass-panel shadow-2xl border border-white/10 max-w-full overflow-x-auto">
      {/* Tombol Utama Koneksi */}
      <button
        onClick={onToggleConnection}
        title={isConnected ? "Hentikan Sesi" : "Mulai Percakapan"}
        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200 shadow-lg shrink-0 ${
          isConnected
            ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30"
            : "bg-gradient-to-r from-rose-500 to-pink-600 text-white hover:from-rose-600 hover:to-pink-700 shadow-rose-500/30 hover:scale-[1.02]"
        }`}
      >
        <Power className={`w-4 h-4 ${isConnected ? "text-rose-400" : ""}`} />
        <span>{isConnected ? "Akhiri Sesi" : "Mulai Celyn"}</span>
      </button>

      <div className="h-6 w-px bg-white/10 mx-1 shrink-0" />

      {/* Tombol Mikrofon */}
      <button
        onClick={onToggleMic}
        disabled={!isConnected}
        title={isMicActive ? "Matikan Mikrofon (M)" : "Nyalakan Mikrofon (M)"}
        className={`p-2.5 rounded-xl transition-all duration-150 shrink-0 ${
          !isConnected
            ? "opacity-40 cursor-not-allowed bg-slate-800/40 text-slate-500"
            : isMicActive
            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30"
            : "bg-slate-800/80 text-slate-300 hover:bg-slate-700 border border-white/10"
        }`}
      >
        {isMicActive ? (
          <Mic className="w-5 h-5 text-emerald-300" />
        ) : (
          <MicOff className="w-5 h-5 text-rose-400" />
        )}
      </button>

      {/* Push to Talk Toggle */}
      <button
        onClick={onTogglePushToTalk}
        disabled={!isConnected}
        title="Mode Tekan Spasi untuk Bicara (Push to Talk)"
        className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium border transition-colors shrink-0 ${
          !isConnected
            ? "opacity-40 cursor-not-allowed bg-slate-800/40 text-slate-500 border-transparent"
            : isPushToTalk
            ? "bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30"
            : "bg-slate-800/80 text-slate-400 hover:bg-slate-700 border-white/10"
        }`}
      >
        <Radio className="w-4 h-4" />
        <span>Push-to-Talk</span>
      </button>

      {/* Tombol Screen Share */}
      <button
        onClick={onToggleScreenShare}
        disabled={!isConnected}
        title={isScreenSharing ? "Hentikan Bagikan Layar" : "Bagikan Layar ke Celyn"}
        className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl font-medium text-xs transition-all duration-150 shrink-0 ${
          !isConnected
            ? "opacity-40 cursor-not-allowed bg-slate-800/40 text-slate-500"
            : isScreenSharing
            ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 animate-pulse"
            : "bg-slate-800/80 text-slate-300 hover:bg-slate-700 border border-white/10"
        }`}
      >
        {isScreenSharing ? (
          <>
            <Monitor className="w-4 h-4 text-cyan-300" />
            <span>Berbagi Layar</span>
          </>
        ) : (
          <>
            <MonitorOff className="w-4 h-4" />
            <span>Share Layar</span>
          </>
        )}
      </button>

      {/* Toggle Mode Avatar 2D / 3D */}
      <button
        onClick={onToggleAvatarMode}
        title="Ganti Mode Avatar (2D Celyn / 3D VRM)"
        className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-white/10 transition-colors shrink-0"
      >
        {avatarMode === "2d" ? (
          <>
            <Layers className="w-4 h-4 text-pink-400" />
            <span>2D Celyn</span>
          </>
        ) : (
          <>
            <Box className="w-4 h-4 text-cyan-400" />
            <span>3D VRM</span>
          </>
        )}
      </button>

      {/* Tombol Riwayat Transkrip */}
      <button
        onClick={onToggleHistory}
        title="Lihat Riwayat Percakapan Lengkap"
        className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-white/10 transition-colors shrink-0"
      >
        <History className="w-4 h-4" />
      </button>

      {/* Tombol Bantuan Pintasan */}
      <button
        onClick={onToggleHelp}
        title="Panduan & Pintasan Keyboard"
        className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white border border-white/10 transition-colors shrink-0"
      >
        <HelpCircle className="w-4 h-4" />
      </button>

      {/* Meter Volume Output Celyn */}
      {isConnected && (
        <div className="flex items-center gap-2 pl-2 shrink-0">
          <Volume2 className="w-4 h-4 text-slate-400" />
          <div className="w-14 h-2 rounded-full bg-slate-800 overflow-hidden border border-white/5">
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
