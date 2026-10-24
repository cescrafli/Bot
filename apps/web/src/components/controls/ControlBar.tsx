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
} from "lucide-react";

interface ControlBarProps {
  isConnected: boolean;
  isMicActive: boolean;
  isScreenSharing: boolean;
  avatarMode: "2d" | "3d";
  volume: number; // 0..1
  onToggleConnection: () => void;
  onToggleMic: () => void;
  onToggleScreenShare: () => void;
  onToggleAvatarMode: () => void;
}

export const ControlBar: React.FC<ControlBarProps> = ({
  isConnected,
  isMicActive,
  isScreenSharing,
  avatarMode,
  volume,
  onToggleConnection,
  onToggleMic,
  onToggleScreenShare,
  onToggleAvatarMode,
}) => {
  return (
    <div className="flex items-center gap-3 px-5 py-3 rounded-2xl glass-panel shadow-2xl border border-white/10">
      {/* Tombol Utama Koneksi / Mulai Sesi */}
      <button
        onClick={onToggleConnection}
        title={isConnected ? "Hentikan Sesi" : "Mulai Percakapan"}
        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200 shadow-lg ${
          isConnected
            ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30"
            : "bg-gradient-to-r from-rose-500 to-pink-600 text-white hover:from-rose-600 hover:to-pink-700 shadow-rose-500/30 hover:scale-[1.02]"
        }`}
      >
        <Power className={`w-4 h-4 ${isConnected ? "text-rose-400" : ""}`} />
        <span>{isConnected ? "Akhiri Sesi" : "Mulai Celyn"}</span>
      </button>

      <div className="h-6 w-px bg-white/10 mx-1" />

      {/* Tombol Mikrofon */}
      <button
        onClick={onToggleMic}
        disabled={!isConnected}
        title={isMicActive ? "Matikan Mikrofon" : "Nyalakan Mikrofon"}
        className={`p-2.5 rounded-xl transition-all duration-150 ${
          !isConnected
            ? "opacity-40 cursor-not-allowed bg-slate-800/40 text-slate-500"
            : isMicActive
            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30"
            : "bg-slate-800/80 text-slate-300 hover:bg-slate-700 border border-white/10"
        }`}
      >
        {isMicActive ? (
          <Mic className="w-5 h-5" />
        ) : (
          <MicOff className="w-5 h-5 text-rose-400" />
        )}
      </button>

      {/* Tombol Screen Share */}
      <button
        onClick={onToggleScreenShare}
        disabled={!isConnected}
        title={isScreenSharing ? "Hentikan Bagikan Layar" : "Bagikan Layar ke Celyn"}
        className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl font-medium text-xs transition-all duration-150 ${
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
        className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-white/10 transition-colors"
      >
        {avatarMode === "2d" ? (
          <>
            <Layers className="w-4 h-4 text-pink-400" />
            <span>Mode 2D</span>
          </>
        ) : (
          <>
            <Box className="w-4 h-4 text-cyan-400" />
            <span>Mode 3D</span>
          </>
        )}
      </button>

      {/* Meter Volume Mini */}
      {isConnected && (
        <div className="flex items-center gap-1.5 pl-2">
          <Volume2 className="w-4 h-4 text-slate-400" />
          <div className="w-12 h-2 rounded-full bg-slate-800 overflow-hidden border border-white/5">
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
