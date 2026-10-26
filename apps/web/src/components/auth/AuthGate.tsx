import React, { useState, useRef, useEffect } from "react";
import { Lock, Eye, EyeOff, ShieldCheck, Sparkles, AlertCircle, Clock } from "lucide-react";

interface AuthGateProps {
  error: string | null;
  isLocked: boolean;
  lockoutSeconds: number;
  onLogin: (password: string, rememberMe: boolean) => boolean;
  onClearError: () => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({
  error,
  isLocked,
  lockoutSeconds,
  onLogin,
  onClearError,
}) => {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input saat mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Animasi getar saat terjadi error password salah
  useEffect(() => {
    if (error) {
      setIsShaking(true);
      const timer = setTimeout(() => setIsShaking(false), 500);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim() || isLocked) return;

    const success = onLogin(password, rememberMe);
    if (!success) {
      setPassword("");
      inputRef.current?.focus();
    }
  };

  return (
    <div className="relative flex items-center justify-center min-h-[100dvh] w-full bg-slate-950 px-4 select-none overflow-hidden font-sans">
      {/* Background Ambient Aura Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px] sm:w-[500px] h-[340px] sm:h-[500px] bg-rose-600/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-[260px] sm:w-[400px] h-[260px] sm:h-[400px] bg-cyan-600/15 rounded-full blur-[100px] pointer-events-none" />

      {/* Main Glassmorphic Card */}
      <div
        className={`relative z-10 w-full max-w-md glass-panel border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-2xl transition-transform duration-200 ${
          isShaking ? "animate-shake" : ""
        }`}
      >
        {/* Header Icon & Badges */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="relative mb-4">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-tr from-rose-500/20 via-pink-500/20 to-cyan-500/20 border border-white/15 flex items-center justify-center shadow-lg shadow-rose-500/10 backdrop-blur-md">
              <Lock className="w-8 h-8 sm:w-9 sm:h-9 text-rose-400 animate-pulse" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
            </div>
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full glass-pill border border-rose-500/30 text-rose-300 text-[11px] sm:text-xs font-medium mb-2.5">
            <Sparkles className="w-3.5 h-3.5 text-rose-400" />
            <span>Akses Terbatas — Otorisasi Admin</span>
          </div>

          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            Celyn AI BOT
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1.5 max-w-xs leading-relaxed">
            Masukkan kata sandi otorisasi untuk memulai percakapan interaktif dengan Celyn.
          </p>
        </div>

        {/* Form Login */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="celyn-password-input"
              className="block text-xs font-medium text-slate-300 ml-1"
            >
              Kata Sandi Otorisasi
            </label>
            <div className="relative flex items-center">
              <input
                ref={inputRef}
                id="celyn-password-input"
                type={showPassword ? "text" : "password"}
                value={password}
                disabled={isLocked}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) onClearError();
                }}
                placeholder={isLocked ? "Terkunci sementara..." : "Masukkan kata sandi (admin)..."}
                className="w-full bg-slate-900/80 border border-white/15 focus:border-rose-500/60 rounded-xl px-3.5 py-2.5 sm:py-3 pr-11 text-base sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20 transition-all shadow-inner disabled:opacity-50 disabled:cursor-not-allowed"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                tabIndex={-1}
                disabled={isLocked}
                className="absolute right-3 p-1 rounded-lg text-slate-400 hover:text-white transition-colors disabled:opacity-40"
                title={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Opsi Ingat Sesi */}
          <div className="flex items-center justify-between text-xs px-1">
            <label className="flex items-center gap-2 cursor-pointer text-slate-400 hover:text-slate-300 transition-colors">
              <input
                type="checkbox"
                checked={rememberMe}
                disabled={isLocked}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-white/20 bg-slate-900/60 text-rose-500 focus:ring-rose-500/30 cursor-pointer"
              />
              <span>Ingat sesi di perangkat ini</span>
            </label>
            <span className="text-[11px] text-slate-500">
              Default: <code className="text-rose-300 font-mono">admin</code>
            </span>
          </div>

          {/* Error / Lockout Alert */}
          {error && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs animate-in fade-in">
              {isLocked ? (
                <Clock className="w-4 h-4 shrink-0 text-rose-400 mt-0.5 animate-spin" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
              )}
              <div className="flex-1 leading-relaxed">
                <span>{error}</span>
                {isLocked && (
                  <span className="block font-semibold mt-0.5 text-rose-200">
                    Sisa waktu: {lockoutSeconds} detik
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Tombol Submit */}
          <button
            type="submit"
            disabled={!password.trim() || isLocked}
            className="w-full mt-2 py-3 px-4 rounded-xl bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 active:scale-[0.98] text-white text-sm font-semibold shadow-lg shadow-rose-500/25 transition-all duration-150 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            <span>Masuk ke Celyn AI</span>
            <Sparkles className="w-4 h-4 text-rose-200" />
          </button>
        </form>

        {/* Footer Info */}
        <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400/70" />
          <span>Koneksi aman terenkripsi ke Gemini Live & Edge Neural TTS</span>
        </div>
      </div>
    </div>
  );
};
