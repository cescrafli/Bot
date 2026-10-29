import React from "react";
import { X, Sparkles, Check, Volume2 } from "lucide-react";
import { VOICE_OPTIONS, VoiceOption } from "@celyn/shared";

interface VoiceSelectorModalProps {
  isOpen: boolean;
  selectedVoice: string;
  onSelectVoice: (voiceId: string) => void;
  onClose: () => void;
  onTestVoice?: (voiceId: string) => void;
}

export const VoiceSelectorModal: React.FC<VoiceSelectorModalProps> = ({
  isOpen,
  selectedVoice,
  onSelectVoice,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-[min(32rem,calc(100vw-1.5rem))] max-h-[90dvh] overflow-y-auto glass-panel rounded-2xl border border-white/10 shadow-2xl p-4 sm:p-6 relative no-scrollbar">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 sm:top-5 sm:right-5 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 mb-4">
          <div className="p-2 rounded-xl bg-gradient-to-tr from-rose-500 to-pink-500 text-white shadow-lg shadow-rose-500/20 shrink-0">
            <Volume2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
              <span>Pilih Karakter Suara Celyn</span>
              <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                HD Native
              </span>
            </h3>
            <p className="text-[11px] sm:text-xs text-slate-400">
              Pilih karakter vokal sesuai preferensi Anda (100% vokal perempuan muda natural Celyn)
            </p>
          </div>
        </div>

        {/* Daftar Pilihan Suara */}
        <div className="space-y-2.5 mb-5">
          {VOICE_OPTIONS.map((voice: VoiceOption) => {
            const isSelected = voice.id.toLowerCase() === selectedVoice.toLowerCase();

            return (
              <div
                key={voice.id}
                onClick={() => onSelectVoice(voice.id)}
                className={`flex items-start justify-between gap-3 p-3 sm:p-3.5 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? "bg-rose-500/15 border-rose-500/50 shadow-lg shadow-rose-500/10 ring-1 ring-rose-500/30"
                    : "bg-slate-800/40 hover:bg-slate-800/80 border-white/5 hover:border-white/15"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-xs sm:text-sm font-bold text-white">
                      {voice.name}
                    </span>
                    <span
                      className="text-[9px] sm:text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-rose-500/20 text-rose-300 border-rose-500/30"
                    >
                      {voice.badge}
                    </span>
                    {voice.id === "Aoede" && (
                      <span className="flex items-center gap-0.5 text-[9px] text-amber-300 font-medium bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded-full">
                        <Sparkles className="w-2.5 h-2.5" />
                        <span>Rekomendasi</span>
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] sm:text-xs text-slate-300 leading-relaxed">
                    {voice.description}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-1 font-mono">
                    Engine: Celyn HD Realtime Audio (24kHz)
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0 pt-0.5">
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center border transition-all ${
                      isSelected
                        ? "bg-rose-500 border-rose-400 text-white"
                        : "border-slate-600 bg-slate-900"
                    }`}
                  >
                    {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Info Box Kenaturalan Suara */}
        <div className="p-3 sm:p-3.5 rounded-xl bg-slate-800/60 border border-white/5 text-xs text-slate-300 space-y-1">
          <div className="flex items-center gap-1.5 font-semibold text-rose-300 text-xs">
            <Sparkles className="w-4 h-4 shrink-0 text-rose-400" />
            <span>Katalog Karakter Suara Natural Celyn</span>
          </div>
          <p className="text-[10px] sm:text-[11px] leading-relaxed text-slate-400">
            Semua suara dihasilkan secara langsung dengan karakter vokal natural Celyn. Pilih <strong>Aoede</strong> untuk karakter paling natural & tawa spontan, <strong>Zephyr</strong> untuk artikulasi ceria & bersemangat, <strong>Leda</strong> untuk kelembutan suara yang ramah, atau <strong>Kore</strong> untuk nada yang tenang dan hangat.
          </p>
        </div>
      </div>
    </div>
  );
};
