import React from "react";
import { MessageSquare } from "lucide-react";

interface SubtitleOverlayProps {
  transcripts: Array<{ speaker: "user" | "celyn"; text: string; time: string }>;
  statusMessage: string;
  status?: "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";
}

export const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({
  transcripts,
  statusMessage,
  status = "idle",
}) => {
  const latestTranscript =
    transcripts.length > 0 ? transcripts[transcripts.length - 1] : null;

  const dotColorClass =
    status === "listening" || status === "speaking"
      ? "bg-emerald-400 animate-pulse"
      : status === "connecting" || status === "thinking"
      ? "bg-amber-400 animate-ping"
      : status === "error"
      ? "bg-rose-500"
      : "bg-slate-500";

  return (
    <div className="w-full max-w-xl mx-auto flex flex-col items-center gap-1.5 sm:gap-2 pointer-events-none px-2">
      {/* Subtitle Terakhir */}
      {latestTranscript && (
        <div className="pointer-events-auto flex items-start gap-2 sm:gap-2.5 px-3 sm:px-4 py-2 sm:py-2.5 rounded-2xl glass-panel border border-white/10 shadow-2xl text-[11px] sm:text-xs max-w-[94vw] sm:max-w-lg max-h-24 overflow-y-auto transition-all animate-in fade-in slide-in-from-bottom-2">
          <MessageSquare
            className={`w-3.5 h-3.5 sm:w-4 sm:h-4 mt-0.5 shrink-0 ${
              latestTranscript.speaker === "celyn"
                ? "text-rose-400"
                : "text-sky-400"
            }`}
          />
          <div className="flex-1 leading-relaxed">
            <span className="font-semibold mr-1.5 text-slate-300">
              {latestTranscript.speaker === "celyn" ? "Celyn:" : "Anda:"}
            </span>
            <span className="text-slate-100">{latestTranscript.text}</span>
          </div>
        </div>
      )}

      {/* Status Bar Kecil */}
      <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-full bg-slate-900/60 border border-white/5 text-[10px] sm:text-[11px] text-slate-400">
        <span className={`w-1.5 h-1.5 rounded-full ${dotColorClass}`} />
        <span className="truncate max-w-[80vw] sm:max-w-none">{statusMessage}</span>
      </div>
    </div>
  );
};
