import React from "react";
import { X, Command, ShieldCheck, Smartphone, MousePointer } from "lucide-react";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-[min(32rem,calc(100vw-1.5rem))] max-h-[90dvh] overflow-y-auto glass-panel rounded-2xl border border-white/10 shadow-2xl p-4 sm:p-6 relative no-scrollbar">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 sm:top-5 sm:right-5 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 mb-4">
          <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400 shrink-0">
            <Command className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-bold text-white">
              Pintasan & Panduan Kontrol Celyn
            </h3>
            <p className="text-[11px] sm:text-xs text-slate-400">
              Tips praktis untuk desktop & perangkat mobile
            </p>
          </div>
        </div>

        {/* Panduan Khusus Layar Sentuh / Mobile HP */}
        <div className="space-y-2 mb-4">
          <div className="text-[11px] font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-1.5">
            <Smartphone className="w-3.5 h-3.5" />
            <span>Gestur Layar Sentuh (HP & Tablet)</span>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-800/40 border border-white/5 space-y-1 text-xs text-slate-300">
            <p className="flex items-center justify-between">
              <span>Touch Gaze (Tatapan Mata):</span>
              <span className="text-cyan-300 font-medium">Sentuh / Geser Jari</span>
            </p>
            <p className="flex items-center justify-between">
              <span>Push-to-Talk di HP:</span>
              <span className="text-amber-300 font-medium">Tekan & Tahan Tombol Mic</span>
            </p>
            <p className="flex items-center justify-between">
              <span>Panel Kalibrasi:</span>
              <span className="text-pink-300 font-medium">Mode Bottom Sheet</span>
            </p>
          </div>
        </div>

        {/* Tabel Pintasan Keyboard Desktop */}
        <div className="space-y-2 mb-5 text-xs">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <MousePointer className="w-3.5 h-3.5" />
            <span>Pintasan Keyboard (Desktop)</span>
          </div>

          <div className="flex items-center justify-between p-2 sm:p-2.5 rounded-xl bg-slate-800/50 border border-white/5">
            <span className="text-slate-300">Nyalakan / Matikan Mikrofon</span>
            <kbd className="px-2 py-0.5 rounded bg-slate-700 text-slate-200 font-mono text-[11px] border border-slate-600">
              M
            </kbd>
          </div>

          <div className="flex items-center justify-between p-2 sm:p-2.5 rounded-xl bg-slate-800/50 border border-white/5">
            <span className="text-slate-300">Push to Talk (Tahan untuk bicara)</span>
            <kbd className="px-2 py-0.5 rounded bg-slate-700 text-slate-200 font-mono text-[11px] border border-slate-600">
              Spasi (Hold)
            </kbd>
          </div>

          <div className="flex items-center justify-between p-2 sm:p-2.5 rounded-xl bg-slate-800/50 border border-white/5">
            <span className="text-slate-300">Mulai / Hentikan Share Layar</span>
            <kbd className="px-2 py-0.5 rounded bg-slate-700 text-slate-200 font-mono text-[11px] border border-slate-600">
              S
            </kbd>
          </div>

          <div className="flex items-center justify-between p-2 sm:p-2.5 rounded-xl bg-slate-800/50 border border-white/5">
            <span className="text-slate-300">Ganti Tampilan Avatar (2D / 3D)</span>
            <kbd className="px-2 py-0.5 rounded bg-slate-700 text-slate-200 font-mono text-[11px] border border-slate-600">
              V
            </kbd>
          </div>

          <div className="flex items-center justify-between p-2 sm:p-2.5 rounded-xl bg-slate-800/50 border border-white/5">
            <span className="text-slate-300">Buka Panel Kalibrasi Rig</span>
            <kbd className="px-2 py-0.5 rounded bg-slate-700 text-slate-200 font-mono text-[11px] border border-slate-600">
              Alt + R
            </kbd>
          </div>
        </div>

        {/* Tips Keamanan & Privasi */}
        <div className="p-3 sm:p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-200 space-y-1">
          <div className="flex items-center gap-1.5 font-semibold text-rose-300 text-xs">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>Privasi & Keamanan Share Layar</span>
          </div>
          <p className="text-[10px] sm:text-[11px] leading-relaxed opacity-90">
            Saat membagikan layar, pilih <strong>"Jendela Aplikasi"</strong> daripada seluruh desktop demi menjaga kerahasiaan kata sandi/data pribadi.
          </p>
        </div>
      </div>
    </div>
  );
};
