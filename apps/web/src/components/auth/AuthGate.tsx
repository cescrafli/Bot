import React, { useState, useRef, useEffect } from "react";
import { Eye, EyeOff } from "lucide-react";

interface AuthGateProps {
  error: string | null;
  isLocked: boolean;
  lockoutSeconds: number;
  onLogin: (password: string, rememberMe: boolean) => boolean | Promise<boolean>;
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
  const [isShaking, setIsShaking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input saat halaman dibuka
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim() || isLocked) return;

    const success = await onLogin(password, true);
    if (!success) {
      setPassword("");
      inputRef.current?.focus();
    }
  };

  return (
    <div className="relative flex items-center justify-center min-h-[100dvh] w-full bg-[#08080d] bg-mesh px-4 py-8 select-none font-sans overflow-hidden">
      {/* Ambient Rose & Violet Halo */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 ambient-halo opacity-60"
      />

      {/* Kartu Utama Glassmorphism Selaras Identitas Celyn */}
      <div
        className={`relative z-10 w-full max-w-md luxury-blur-panel border border-white/10 rounded-3xl shadow-2xl flex flex-col items-center justify-center px-6 py-10 sm:px-10 sm:py-12 transition-all duration-200 ${
          isShaking ? "animate-shake" : ""
        }`}
      >
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-rose-500 to-violet-600 p-[1px] shadow-lg shadow-rose-500/20 mb-4">
          <div className="w-full h-full rounded-2xl bg-[#08080d]/90 flex items-center justify-center">
            <span className="w-3 h-3 rounded-full bg-rose-400 animate-subtle-pulse" />
          </div>
        </div>

        {/* Judul Halaman */}
        <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight text-center mb-1.5">
          Akses Ruang Celyn
        </h1>
        <p className="text-xs sm:text-sm text-slate-300/80 text-center mb-6">
          Masukkan kata sandi sesi Anda untuk melanjutkan
        </p>

        {/* Form Input & Submit */}
        <form
          onSubmit={handleSubmit}
          className="w-full flex flex-col items-center"
        >
          <label
            htmlFor="protected-password-input"
            className="w-full text-xs font-medium text-slate-300 mb-2 block"
          >
            Kata Sandi Sesi
          </label>
          <div className="relative w-full mb-4">
            <input
              ref={inputRef}
              id="protected-password-input"
              type={showPassword ? "text" : "password"}
              value={password}
              disabled={isLocked}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) onClearError();
              }}
              placeholder={isLocked ? "Terkunci sementara..." : "Masukkan kata sandi Anda"}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-950/75 border border-white/10 focus:border-rose-500/70 focus:ring-2 focus:ring-rose-500/20 text-white placeholder-slate-400 text-sm outline-none transition-all pr-11 disabled:opacity-50 disabled:cursor-not-allowed shadow-inner"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              disabled={isLocked}
              aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white transition-colors disabled:opacity-40 cursor-pointer"
              title={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
            >
              {showPassword ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>

          <button
            type="submit"
            disabled={!password.trim() || isLocked}
            className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-gradient-to-r from-rose-600 to-violet-600 hover:from-rose-500 hover:to-violet-500 active:scale-[0.98] text-white text-sm font-semibold transition-all shadow-lg shadow-rose-500/20 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            Masuk
          </button>

          {/* Notifikasi Error / Cooldown */}
          {error && (
            <div
              role="alert"
              className="mt-4 text-center text-xs text-rose-300 font-medium animate-shake max-w-xs"
            >
              {error}
              {isLocked && (
                <span className="block text-[11px] text-slate-300/80 mt-1">
                  Harap tunggu {lockoutSeconds} detik
                </span>
              )}
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
