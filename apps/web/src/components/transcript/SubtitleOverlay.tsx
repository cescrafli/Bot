import React from "react";
import { stripVoiceMetadataTags } from "@celyn/shared";

interface SubtitleOverlayProps {
  transcripts: Array<{ speaker: "user" | "celyn"; text: string; time: string }>;
  statusMessage?: string;
  status?: "idle" | "connecting" | "listening" | "thinking" | "speaking" | "researching" | "working" | "error";
}

function cleanSubtitleText(raw: string): string {
  let cleaned = stripVoiceMetadataTags(raw);
  // Ubah tautan markdown [Judul](url) menjadi hanya Judul agar teks subtitle lisan nyaman dibaca
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // Bersihkan format markdown tebal / miring / kode
  cleaned = cleaned.replace(/[*_~`]/g, "");
  return cleaned.trim();
}

export const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({
  transcripts,
}) => {
  const latestTranscript =
    transcripts.length > 0 ? transcripts[transcripts.length - 1] : null;

  const displaySubtitle = latestTranscript
    ? cleanSubtitleText(latestTranscript.text)
    : "";

  return (
    <div className="pointer-events-auto max-w-[min(36rem,calc(100vw-1.5rem))] w-full text-center z-20 mx-auto">
      <div className="luxury-blur-panel px-4 sm:px-6 py-2.5 sm:py-3 rounded-2xl border border-white/10 shadow-2xl transition-all inline-block text-left sm:text-center max-h-28 overflow-y-auto no-scrollbar">
        {latestTranscript && displaySubtitle ? (
          <p className="text-xs sm:text-sm font-light text-slate-100 leading-relaxed drop-shadow-sm animate-in fade-in duration-200">
            {latestTranscript.speaker === "user" ? (
              <>
                <span className="text-rose-400 font-normal mr-1">Anda:</span>
                "{displaySubtitle}"
              </>
            ) : (
              `"${displaySubtitle}"`
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
