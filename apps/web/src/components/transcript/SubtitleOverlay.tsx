import React from "react";

interface SubtitleOverlayProps {
  transcripts: Array<{ speaker: "user" | "celyn"; text: string; time: string }>;
  statusMessage?: string;
  status?: "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";
}

export const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({
  transcripts,
}) => {
  const latestTranscript =
    transcripts.length > 0 ? transcripts[transcripts.length - 1] : null;

  return (
    <div className="pointer-events-auto max-w-xl w-[90%] md:w-auto text-center z-20">
      <div className="luxury-blur-panel px-6 py-3 rounded-2xl border border-white/10 shadow-2xl transition-all inline-block text-left sm:text-center max-h-28 overflow-y-auto no-scrollbar">
        {latestTranscript ? (
          <p className="text-xs sm:text-sm font-light text-slate-100 leading-relaxed drop-shadow-sm animate-in fade-in duration-200">
            {latestTranscript.speaker === "user" ? (
              <>
                <span className="text-rose-400 font-normal mr-1">Anda:</span>
                "{latestTranscript.text}"
              </>
            ) : (
              `"${latestTranscript.text}"`
            )}
          </p>
        ) : (
          <p className="text-xs sm:text-sm font-light text-slate-100 leading-relaxed drop-shadow-sm">
            "Halo! Saya siap menemani aktivitas Anda hari ini. Ada yang bisa saya bantu rencanakan?"
          </p>
        )}
      </div>
    </div>
  );
};
