import React, { useState } from "react";
import { EmotionType } from "@celyn/shared";
import {
  X,
  Layers,
  Box,
  Sparkles,
  Radio,
  Sliders,
  Keyboard,
  PowerOff,
  Lock,
  Smile,
  Key,
  Eye,
  EyeOff,
  Check,
} from "lucide-react";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  avatarMode: "2d" | "3d";
  onToggleAvatarMode: () => void;
  isPushToTalk: boolean;
  onTogglePushToTalk: () => void;
  isConnected: boolean;
  onToggleConnection: () => void;
  onOpenShortcuts: () => void;
  onOpenCalibration: () => void;
  onTriggerTestSpeech?: () => void;
  onLogout: () => void;
  currentEmotion?: EmotionType;
  onSelectEmotion?: (emotion: EmotionType) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  avatarMode,
  onToggleAvatarMode,
  isPushToTalk,
  onTogglePushToTalk,
  isConnected,
  onToggleConnection,
  onOpenShortcuts,
  onOpenCalibration,
  onTriggerTestSpeech,
  onLogout,
  currentEmotion,
  onSelectEmotion,
}) => {
  const [customKey, setCustomKey] = useState<string>(() => {
    return localStorage.getItem("celyn_custom_gemini_key") || "";
  });
  const [showKey, setShowKey] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  const handleSaveCustomKey = () => {
    const trimmed = customKey.trim();
    if (trimmed) {
      localStorage.setItem("celyn_custom_gemini_key", trimmed);
    } else {
      localStorage.removeItem("celyn_custom_gemini_key");
    }
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  const handleClearCustomKey = () => {
    localStorage.removeItem("celyn_custom_gemini_key");
    setCustomKey("");
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="w-full max-w-md luxury-blur-panel rounded-2xl sm:rounded-3xl p-4 sm:p-6 border border-white/10 shadow-2xl space-y-4 sm:space-y-5 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Modal */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-rose-500/80 to-violet-500/80 p-[1px] shadow-sm shadow-rose-500/20">
              <div className="w-full h-full rounded-full bg-[#08080d]/90 flex items-center justify-center">
                <span className="w-2 h-2 rounded-full bg-rose-400" />
              </div>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-wide">
                Pengaturan
              </h2>
              <p className="text-[11px] text-slate-400">
                Preferensi avatar & audio interaktif
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full luxury-blur-panel flex items-center justify-center text-slate-400 hover:text-white hover:border-white/20 transition-colors cursor-pointer"
            title="Tutup"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Daftar Opsi Pengaturan */}
        <div className="space-y-3 max-h-[75dvh] overflow-y-auto no-scrollbar pr-1">
          {/* Mode Avatar 2D / 3D */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.03] border border-white/5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400">
                {avatarMode === "2d" ? (
                  <Layers className="w-4 h-4" />
                ) : (
                  <Box className="w-4 h-4" />
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-slate-200">Mode Avatar</p>
                <p className="text-[10px] text-slate-400">
                  {avatarMode === "2d" ? "2D Rigging Bernapas" : "3D VRM Engine"}
                </p>
              </div>
            </div>
            <button
              onClick={onToggleAvatarMode}
              className="px-3 py-1.5 rounded-full text-xs font-semibold bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 border border-violet-500/30 transition-all cursor-pointer"
            >
              Ganti ke {avatarMode === "2d" ? "3D" : "2D"}
            </button>
          </div>

          {/* Uji Coba Mimik Wajah & Emosi */}
          <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/5 space-y-2.5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400">
                <Smile className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-200">Uji Coba Mimik & Emosi</p>
                <p className="text-[10px] text-slate-400">
                  Uji perubahan mimik wajah & gerak tubuh 2.5D
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5 pt-1">
              {[
                { id: "sad", label: "😢 Sedih / Empati" },
                { id: "happy", label: "😊 Ceria / Senang" },
                { id: "thinking", label: "🤔 Berpikir" },
                { id: "surprised", label: "😲 Kaget" },
                { id: "shy", label: "🥰 Tersipu" },
                { id: "neutral", label: "✨ Netral / Siaga" },
              ].map((emo) => (
                <button
                  key={emo.id}
                  onClick={() => onSelectEmotion?.(emo.id as EmotionType)}
                  className={`px-2 py-1.5 rounded-xl text-[11px] font-medium border transition-all cursor-pointer text-center ${
                    currentEmotion === emo.id
                      ? "bg-rose-500/20 text-rose-300 border-rose-500/50 shadow-sm shadow-rose-500/20 font-semibold"
                      : "bg-white/[0.02] text-slate-300 border-white/5 hover:border-white/20 hover:text-white"
                  }`}
                >
                  {emo.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tes Suara & Mulut */}
          {onTriggerTestSpeech && (
            <div className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.03] border border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                  <Sparkles className="w-4 h-4 animate-pulse" />
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-200">Tes Suara Celyn</p>
                  <p className="text-[10px] text-slate-400">
                    Uji coba gerak bibir & suara audio
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  onTriggerTestSpeech();
                }}
                className="px-3 py-1.5 rounded-full text-xs font-semibold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 transition-all cursor-pointer"
              >
                Uji Coba
              </button>
            </div>
          )}

          {/* Mode Push-to-Talk (PTT) */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.03] border border-white/5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                <Radio className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-200">Push-to-Talk</p>
                <p className="text-[10px] text-slate-400">
                  {isPushToTalk ? "Bicara saat tombol ditahan" : "Deteksi suara otomatis"}
                </p>
              </div>
            </div>
            <button
              onClick={onTogglePushToTalk}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                isPushToTalk
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : "bg-slate-800 text-slate-400 border-white/10 hover:text-white"
              }`}
            >
              {isPushToTalk ? "Aktif" : "Nonaktif"}
            </button>
          </div>

          {/* Kalibrasi Rig 2D */}
          {avatarMode === "2d" && (
            <div className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.03] border border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                  <Sliders className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-200">Kalibrasi Rig 2D</p>
                  <p className="text-[10px] text-slate-400">
                    Atur sendi bahu, napas & bibir (Alt+R)
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  onClose();
                  onOpenCalibration();
                }}
                className="px-3 py-1.5 rounded-full text-xs font-semibold bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30 transition-all cursor-pointer"
              >
                Buka Rig
              </button>
            </div>
          )}

          {/* Pintasan Keyboard */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.03] border border-white/5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
                <Keyboard className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-200">Pintasan Keyboard</p>
                <p className="text-[10px] text-slate-400">
                  Daftar tombol cepat M, S, V, Spasi
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                onClose();
                onOpenShortcuts();
              }}
              className="px-3 py-1.5 rounded-full text-xs font-semibold bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/30 transition-all cursor-pointer"
            >
              Lihat
            </button>
          </div>

          {/* Kunci API Gemini Cadangan (Bebas Quota) */}
          <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/5 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                  <Key className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-200">Kunci API Cadangan</p>
                  <p className="text-[10px] text-slate-400">
                    Bypass batas kuota jika server bersama penuh
                  </p>
                </div>
              </div>
              {customKey && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Tersimpan
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type={showKey ? "text" : "password"}
                  value={customKey}
                  onChange={(e) => setCustomKey(e.target.value)}
                  placeholder="Tempel kunci API (AIzaSy... atau AQ...)"
                  className="w-full px-3 py-1.5 pr-8 rounded-xl bg-black/40 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400/50"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  title={showKey ? "Sembunyikan" : "Tampilkan"}
                >
                  {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>

              <button
                type="button"
                onClick={handleSaveCustomKey}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 transition-all cursor-pointer flex items-center gap-1 shrink-0"
              >
                {saveSuccess ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span>Tersimpan</span>
                  </>
                ) : (
                  <span>Simpan</span>
                )}
              </button>

              {customKey && (
                <button
                  type="button"
                  onClick={handleClearCustomKey}
                  className="px-2 py-1.5 rounded-xl text-xs font-medium bg-white/5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-white/10 hover:border-rose-500/30 transition-all cursor-pointer shrink-0"
                  title="Hapus Kunci Cadangan"
                >
                  Hapus
                </button>
              )}
            </div>
          </div>

          {/* Putuskan Sesi Percakapan */}
          {isConnected && (
            <div className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.03] border border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                  <PowerOff className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-200">Sesi AI Aktif</p>
                  <p className="text-[10px] text-slate-400">
                    Hentikan sambungan WebSocket
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  onToggleConnection();
                  onClose();
                }}
                className="px-3 py-1.5 rounded-full text-xs font-semibold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 transition-all cursor-pointer"
              >
                Putuskan
              </button>
            </div>
          )}

          {/* Kunci Sesi (Logout) */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-rose-500/[0.04] border border-rose-500/15">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400">
                <Lock className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-medium text-rose-200">Kunci Sesi</p>
                <p className="text-[10px] text-slate-400">
                  Kembali ke layar kata sandi
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                onClose();
                onLogout();
              }}
              className="px-3 py-1.5 rounded-full text-xs font-semibold bg-rose-500/20 hover:bg-rose-500/40 text-rose-300 border border-rose-500/40 transition-all cursor-pointer"
            >
              Kunci
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
