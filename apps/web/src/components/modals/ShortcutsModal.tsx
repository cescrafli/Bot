import React from "react";
import { X, Command, ShieldCheck, Zap } from "lucide-react";

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-lg glass-panel rounded-2xl border border-white/10 shadow-2xl p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 mb-4">
          <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400">
            <Command className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">
              Pintasan Keyboard & Panduan Celyn
            </h3>
            <p className="text-xs text-slate-400">
              Tips praktis untuk interaksi maksimal
            </p>
          </div>
        </div>

        {/* Tabel Pintasan */}
        <div className="space-y-2 mb-6 text-xs">
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/50 border border-white/5">
            <span className="text-slate-300">Nyalakan / Matikan Mikrofon</span>
            <kbd className="px-2 py-1 rounded bg-slate-700 text-slate-200 font-mono text-[11px] border border-slate-600">
              M
            </kbd>
          </div>

          <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/50 border border-white/5">
            <span className="text-slate-300">Push to Talk (Tahan untuk bicara)</span>
            <kbd className="px-2 py-1 rounded bg-slate-700 text-slate-200 font-mono text-[11px] border border-slate-600">
              Spasi (Hold Space)
            </kbd>
          </div>

          <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/50 border border-white/5">
            <span className="text-slate-300">Mulai / Hentikan Share Layar</span>
            <kbd className="px-2 py-1 rounded bg-slate-700 text-slate-200 font-mono text-[11px] border border-slate-600">
              S
            </kbd>
          </div>

          <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/50 border border-white/5">
            <span className="text-slate-300">Ganti Tampilan Avatar (2D / 3D)</span>
            <kbd className="px-2 py-1 rounded bg-slate-700 text-slate-200 font-mono text-[11px] border border-slate-600">
              V
            </kbd>
          </div>
        </div>

        {/* Tips Keamanan & Privasi */}
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-200 space-y-1.5">
          <div className="flex items-center gap-1.5 font-semibold text-rose-300">
            <ShieldCheck className="w-4 h-4" />
            <span>Privasi & Keamanan Share Layar</span>
          </div>
          <p className="text-[11px] leading-relaxed opacity-90">
            Saat membagikan layar, pilih <strong>"Jendela Aplikasi"</strong> atau tab spesifik daripada seluruh desktop demi menjaga data rahasia/password. Frame hanya dikirim jika terjadi perubahan visual.
          </p>
        </div>
      </div>
    </div>
  );
};
