import React, { useEffect, useRef } from "react";
import { Monitor, X, Crosshair } from "lucide-react";
import { LookAtTarget } from "@celyn/shared";

interface ScreenPreviewProps {
  videoElement: HTMLVideoElement | null;
  lookAt: LookAtTarget | null;
  onClose: () => void;
}

export const ScreenPreview: React.FC<ScreenPreviewProps> = ({
  videoElement,
  lookAt,
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

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
  }, [videoElement]);

  return (
    <div className="absolute top-6 right-6 z-30 w-72 h-44 rounded-2xl glass-panel p-2 shadow-2xl border border-cyan-500/30 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
      {/* Header bar preview */}
      <div className="flex items-center justify-between px-2 py-1 text-xs font-semibold text-slate-300">
        <div className="flex items-center gap-1.5 text-cyan-400">
          <Monitor className="w-3.5 h-3.5 animate-pulse" />
          <span>Screen Share Aktif</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          title="Tutup preview"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Video screen container */}
      <div
        ref={containerRef}
        className="relative flex-1 w-full bg-slate-950 rounded-xl overflow-hidden border border-white/5"
      >
        {/* Reticle / Crosshair jika Celyn sedang menunjuk ke koordinat layar */}
        {lookAt && (
          <div
            className="absolute z-20 pointer-events-none transition-all duration-300 transform -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${lookAt.x * 100}%`,
              top: `${lookAt.y * 100}%`,
            }}
          >
            <div className="relative flex items-center justify-center">
              <Crosshair className="w-8 h-8 text-rose-500 animate-spin" />
              <div className="absolute w-12 h-12 rounded-full border-2 border-rose-500 animate-ping opacity-75" />
            </div>
            {lookAt.description && (
              <span className="absolute top-9 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded bg-slate-900/90 text-[10px] text-rose-300 border border-rose-500/40 whitespace-nowrap shadow-lg">
                {lookAt.description}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
