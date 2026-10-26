import { useState, useCallback, useEffect } from "react";

const ADMIN_PASSWORD = "admin";
const AUTH_STORAGE_KEY = "celyn_auth_token";
const AUTH_REMEMBER_KEY = "celyn_auth_remember";
const FAILED_ATTEMPTS_KEY = "celyn_auth_failed_attempts";
const LOCKOUT_KEY = "celyn_auth_lockout_until";
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 1000; // 30 detik

export function getStoredAuthPassword(): string {
  const token =
    sessionStorage.getItem(AUTH_STORAGE_KEY) ||
    localStorage.getItem(AUTH_STORAGE_KEY);
  return token ? ADMIN_PASSWORD : "";
}

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    const sessionToken = sessionStorage.getItem(AUTH_STORAGE_KEY);
    const localToken = localStorage.getItem(AUTH_STORAGE_KEY);
    return Boolean(sessionToken || localToken);
  });

  const [error, setError] = useState<string | null>(null);
  const [lockoutSeconds, setLockoutSeconds] = useState<number>(0);

  // Periksa apakah sedang dalam status cooldown lockout
  const checkLockout = useCallback((): boolean => {
    const lockoutUntilStr = localStorage.getItem(LOCKOUT_KEY);
    if (!lockoutUntilStr) return false;
    const lockoutUntil = parseInt(lockoutUntilStr, 10);
    const now = Date.now();
    if (lockoutUntil > now) {
      setLockoutSeconds(Math.ceil((lockoutUntil - now) / 1000));
      return true;
    }
    localStorage.removeItem(LOCKOUT_KEY);
    localStorage.removeItem(FAILED_ATTEMPTS_KEY);
    setLockoutSeconds(0);
    return false;
  }, []);

  // Timer hitung mundur lockout
  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const timer = setInterval(() => {
      setLockoutSeconds((prev) => {
        if (prev <= 1) {
          localStorage.removeItem(LOCKOUT_KEY);
          localStorage.removeItem(FAILED_ATTEMPTS_KEY);
          setError(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [lockoutSeconds]);

  // Inisialisasi pengecekan lockout saat mount
  useEffect(() => {
    checkLockout();
  }, [checkLockout]);

  const login = useCallback(
    (inputPassword: string, rememberMe = false): boolean => {
      if (checkLockout()) {
        setError(`Terlalu banyak percobaan. Harap tunggu ${lockoutSeconds} detik.`);
        return false;
      }

      const trimmed = inputPassword.trim();
      if (trimmed === ADMIN_PASSWORD) {
        const token = btoa(`celyn_auth:${Date.now()}`);
        if (rememberMe) {
          localStorage.setItem(AUTH_STORAGE_KEY, token);
          localStorage.setItem(AUTH_REMEMBER_KEY, "true");
        } else {
          sessionStorage.setItem(AUTH_STORAGE_KEY, token);
        }

        localStorage.removeItem(FAILED_ATTEMPTS_KEY);
        localStorage.removeItem(LOCKOUT_KEY);
        setIsAuthenticated(true);
        setError(null);
        return true;
      }

      // Password salah: hitung percobaan gagal
      const currentAttempts =
        parseInt(localStorage.getItem(FAILED_ATTEMPTS_KEY) || "0", 10) + 1;
      localStorage.setItem(FAILED_ATTEMPTS_KEY, currentAttempts.toString());

      if (currentAttempts >= MAX_FAILED_ATTEMPTS) {
        const lockoutUntil = Date.now() + LOCKOUT_DURATION_MS;
        localStorage.setItem(LOCKOUT_KEY, lockoutUntil.toString());
        setLockoutSeconds(Math.ceil(LOCKOUT_DURATION_MS / 1000));
        setError("Batas percobaan terlampaui. Akun terkunci sementara selama 30 detik.");
      } else {
        const remaining = MAX_FAILED_ATTEMPTS - currentAttempts;
        setError(
          `Kata sandi salah. Silakan coba lagi (${remaining} kesempatan tersisa).`
        );
      }
      return false;
    },
    [checkLockout, lockoutSeconds]
  );

  const logout = useCallback(() => {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(AUTH_REMEMBER_KEY);
    setIsAuthenticated(false);
    setError(null);
  }, []);

  return {
    isAuthenticated,
    error,
    lockoutSeconds,
    isLocked: lockoutSeconds > 0,
    login,
    logout,
    clearError: () => setError(null),
  };
}
