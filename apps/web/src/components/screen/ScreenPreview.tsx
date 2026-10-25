import React, { useEffect, useRef, useState } from "react";
import { Monitor, X, Crosshair, Pause, Play, Sparkles, Minimize2, Maximize2 } from "lucide-react";
import { LookAtTarget } from "@celyn/shared";
import { ScreenCaptureStats } from "../../hooks/useScreenCapture";

interface ScreenPreviewProps {
  videoElement: HTMLVideoElement | null;
  lookAt: LookAtTarget | null;
  stats?: ScreenCaptureStats;
  isPaused?: boolean;
  onTogglePause?: () => void;
  onClose: () => void;
}

export const ScreenPreview: React.FC<ScreenPreviewProps> = ({
  videoElement,
  lookAt,
  stats,
  isPaused,
  onTogglePause,
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isMinimized, setIsMinimized] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !videoElement) return;

    videoElement.className =
      "w-full h-full object-cover rounded-xl pointer-events-none";
    container.appendChild(videoElement);

    return () => {
      if (videoElement.parentElement === container) {
        container.removeChild(videoElement);
      }
    };
  }, [videoElement, isMinimized]);

  return (
    <div
      className={`absolute top-14 right-2.5 sm:top-6 sm:right-6 z-30 transition-all duration-300 rounded-2xl glass-panel p-2 sm:p-2.5 shadow-2xl border border-cyan-500/40 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 ${
        isMinimized ? "w-44 sm:w-64 h-10 sm:h-12" : "w-48 h-32 sm:w-80 sm:h-52"
      }`}
    >
      {/* Header bar preview */}
      <div className="flex items-center justify-between px-1.5 pb-2 text-xs font-semibold text-slate-300">
        <div className="flex items-center gap-2 text-cyan-400">
          <Monitor className="w-4 h-4 animate-pulse" />
          <span className="font-bold tracking-wide">Screen Share</span>
          {stats && stats.savingsPercentage > 0 && (
            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              <Sparkles className="w-2.5 h-2.5" />
              <span>{stats.savingsPercentage}% Hemat Token</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {onTogglePause && (
            <button
              onClick={onTogglePause}
              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
              title={isPaused ? "Lanjutkan Stream Frame" : "Jeda Stream Frame"}
            >
              {isPaused ? <Play className="w-3.5 h-3.5 text-amber-400" /> : <Pause className="w-3.5 h-3.5" />}
            </button>
          )}

          <button
            onClick={() => setIsMinimized((prev) => !prev)}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            title={isMinimized ? "Perbesar Preview" : "Perkecil Preview"}
          >
            {isMinimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition-colors"
            title="Hentikan Share Layar"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Video screen container (hanya tampil jika tidak minimized) */}
      {!isMinimized && (
        <div
          ref={containerRef}
          className="relative flex-1 w-full bg-slate-950 rounded-xl overflow-hidden border border-white/10"
        >
          {isPaused && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm text-xs font-semibold text-amber-300">
              ⏸️ Stream Layar Dijeda
            </div>
          )}

          {/* Crosshair / Reticle jika Celyn menunjuk koordinat tertentu */}
          {lookAt && (
            <div
              className="absolute z-20 pointer-events-none transition-all duration-300 transform -translate-x-1/2 -translate-y-1/2"
              style={{
                left: `${lookAt.x * 100}%`,
                top: `${lookAt.y * 100}%`,
              }}
            >
              <div className="relative flex items-center justify-center">
                <Crosshair className="w-9 h-9 text-rose-500 animate-spin" />
                <div className="absolute w-14 h-14 rounded-full border-2 border-rose-500 animate-ping opacity-75" />
              </div>
              {lookAt.description && (
                <span className="absolute top-10 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-md bg-slate-900/95 text-[10px] font-medium text-rose-300 border border-rose-500/50 whitespace-nowrap shadow-xl">
                  {lookAt.description}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
