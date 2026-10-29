import React from "react";
import {
  Volume2,
  Keyboard,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  History,
  FileText,
} from "lucide-react";

interface ControlBarProps {
  isConnected: boolean;
  isMicActive: boolean;
  isScreenSharing: boolean;
  isPushToTalk: boolean;
  isTextInputOpen: boolean;
  volume?: number; // 0..1
  activeDocumentsCount?: number;
  onToggleConnection: () => void;
  onToggleMic: () => void;
  onToggleScreenShare: () => void;
  onToggleVoiceSelector: () => void;
  onToggleTextInput: () => void;
  onToggleHistory: () => void;
  onToggleDocumentModal?: () => void;
  onPttHoldStart?: () => void;
  onPttHoldEnd?: () => void;
}

export const ControlBar: React.FC<ControlBarProps> = ({
  isConnected,
  isMicActive,
  isScreenSharing,
  isPushToTalk,
  isTextInputOpen,
  activeDocumentsCount,
  onToggleConnection,
  onToggleMic,
  onToggleScreenShare,
  onToggleVoiceSelector,
  onToggleTextInput,
  onToggleHistory,
  onToggleDocumentModal,
  onPttHoldStart,
  onPttHoldEnd,
}) => {
  // Center glowing mic handler
  const handleCenterClick = () => {
    if (!isConnected) {
      onToggleConnection();
    } else if (!isPushToTalk) {
      onToggleMic();
    }
  };

  return (
    <nav
      aria-label="Kontrol Percakapan"
      className="luxury-dock px-3 py-2 rounded-full flex items-center gap-2 sm:gap-3 transition-all"
    >
      {/* 1. Mode Suara (Voice Selector Modal) */}
      <button
        onClick={onToggleVoiceSelector}
        className="w-10 h-10 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 active:scale-95 transition-all cursor-pointer"
        title="Mode Suara (Aoede / Kore)"
      >
        <Volume2 className="w-4 h-4 text-slate-300" />
      </button>

      {/* 2. Input Teks / Keyboard Toggle */}
      <button
        onClick={onToggleTextInput}
        className={`w-10 h-10 rounded-full flex items-center justify-center transition-all cursor-pointer ${
          isTextInputOpen
            ? "text-rose-400 bg-rose-500/15 border border-rose-500/30"
            : "text-slate-400 hover:text-white hover:bg-white/5 active:scale-95"
        }`}
        title="Ketik Pesan Teks"
      >
        <Keyboard className="w-4 h-4" />
      </button>

      {/* 3. Center Glowing Rose Microphone Button */}
      <button
        onClick={handleCenterClick}
        onTouchStart={
          isConnected && isPushToTalk
            ? (e) => {
                e.preventDefault();
                onPttHoldStart?.();
              }
            : undefined
        }
        onTouchEnd={
          isConnected && isPushToTalk
            ? (e) => {
                e.preventDefault();
                onPttHoldEnd?.();
              }
            : undefined
        }
        onMouseDown={isConnected && isPushToTalk ? () => onPttHoldStart?.() : undefined}
        onMouseUp={isConnected && isPushToTalk ? () => onPttHoldEnd?.() : undefined}
        onMouseLeave={isConnected && isPushToTalk ? () => onPttHoldEnd?.() : undefined}
        title={
          isPushToTalk
            ? "Tahan untuk Bicara (PTT)"
            : isMicActive
            ? "Matikan Mikrofon (M)"
            : "Nyalakan Mikrofon (M)"
        }
        className={`relative group p-3.5 rounded-full transition-all cursor-pointer ${
          isMicActive
            ? "bg-gradient-to-tr from-rose-500 to-rose-600 text-white shadow-lg shadow-rose-500/40 hover:shadow-rose-500/60 hover:scale-105 active:scale-95"
            : "bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-white border border-white/10 hover:border-rose-500/40 hover:scale-105 active:scale-95 shadow-md"
        }`}
      >
        {/* Glow / Ping Ring saat mic aktif */}
        {isConnected && isMicActive && (
          <span className="absolute inset-0 rounded-full bg-rose-400 opacity-60 animate-ping pointer-events-none" />
        )}
        <div className="relative z-10 flex items-center justify-center">
          {isMicActive ? (
            <Mic className="w-5 h-5 text-white animate-pulse" />
          ) : (
            <MicOff className="w-5 h-5 text-rose-300" />
          )}
        </div>
      </button>

      {/* 4. Bagi Layar / Visual Context */}
      <button
        onClick={onToggleScreenShare}
        disabled={!isConnected}
        className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
          !isConnected
            ? "opacity-30 cursor-not-allowed text-slate-500"
            : isScreenSharing
            ? "text-cyan-400 bg-cyan-500/15 border border-cyan-500/30 animate-pulse cursor-pointer"
            : "text-slate-400 hover:text-white hover:bg-white/5 active:scale-95 cursor-pointer"
        }`}
        title={isScreenSharing ? "Hentikan Bagikan Layar (S)" : "Bagikan Layar ke Celyn (S)"}
      >
        {isScreenSharing ? (
          <Monitor className="w-4 h-4 text-cyan-400" />
        ) : (
          <MonitorOff className="w-4 h-4" />
        )}
      </button>

      {/* 5. Dokumen PDF / Word / Excel */}
      <button
        onClick={onToggleDocumentModal}
        className="w-10 h-10 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 active:scale-95 transition-all cursor-pointer relative"
        title="Dokumen (PDF, Word, Excel)"
      >
        <FileText className="w-4 h-4 text-slate-300" />
        {activeDocumentsCount !== undefined && activeDocumentsCount > 0 && (
          <span className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-rose-500 text-[9px] font-bold text-white flex items-center justify-center shadow">
            {activeDocumentsCount}
          </span>
        )}
      </button>

      {/* 6. Riwayat Percakapan / Transkrip Drawer */}
      <button
        onClick={onToggleHistory}
        className="w-10 h-10 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 active:scale-95 transition-all cursor-pointer"
        title="Riwayat Percakapan"
      >
        <History className="w-4 h-4 text-slate-300" />
      </button>
    </nav>
  );
};
