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
    <div className="relative flex items-center justify-center min-h-[100dvh] w-full bg-[#0b0f17] px-4 py-8 select-none font-sans overflow-hidden">
      {/* Kartu Utama Minimalis Versi Dark Mode Sesuai Desain Referensi */}
      <div
        className={`w-full max-w-4xl min-h-[440px] sm:min-h-[520px] bg-[#121824] border border-slate-800/80 rounded-2xl sm:rounded-3xl shadow-2xl flex flex-col items-center justify-center px-6 py-12 sm:px-16 sm:py-20 transition-all duration-200 ${
          isShaking ? "animate-shake" : ""
        }`}
      >
        {/* Judul Halaman */}
        <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight text-center mb-6 sm:mb-7">
          Protected Page
        </h1>

        {/* Label Password */}
        <label
          htmlFor="protected-password-input"
          className="text-xs sm:text-sm font-medium text-slate-400 text-center mb-2.5 sm:mb-3 block"
        >
          Password
        </label>

        {/* Form Input & Submit */}
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-[280px] sm:max-w-[320px] flex flex-col items-center"
        >
          <div className="relative w-full mb-3">
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
              placeholder={isLocked ? "Terkunci sementara..." : "Enter your password"}
              className="w-full px-4 py-2 sm:py-2.5 rounded-lg sm:rounded-xl bg-[#0b0f17] border border-slate-700/80 focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20 text-white placeholder-slate-500 text-xs sm:text-sm outline-none transition-all pr-9 disabled:opacity-50 disabled:cursor-not-allowed shadow-inner"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              tabIndex={-1}
              disabled={isLocked}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40"
              title={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          <button
            type="submit"
            disabled={!password.trim() || isLocked}
            className="w-full py-2 sm:py-2.5 px-4 rounded-lg sm:rounded-xl bg-[#1d64d8] hover:bg-[#1a5bc4] active:scale-[0.98] text-white text-xs sm:text-sm font-medium transition-all shadow-md shadow-blue-900/20 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            Submit
          </button>

          {/* Notifikasi Error / Cooldown */}
          {error && (
            <div className="mt-3.5 text-center text-xs text-rose-400 font-medium animate-shake max-w-xs">
              {error}
              {isLocked && (
                <span className="block text-[11px] text-slate-400 mt-1">
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
