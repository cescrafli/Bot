import { useState, useCallback, useEffect } from "react";
import { AuthMode } from "@celyn/shared";

export type { AuthMode };

const AUTH_STORAGE_KEY = "celyn_auth_token";
const AUTH_MODE_KEY = "celyn_auth_mode";
const LEGACY_AUTH_PASSWORD_KEY = "celyn_auth_pass";
const AUTH_REMEMBER_KEY = "celyn_auth_remember";
const FAILED_ATTEMPTS_KEY = "celyn_auth_failed_attempts";
const LOCKOUT_KEY = "celyn_auth_lockout_until";
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 1000; // 30 detik

// Bersihkan sisa penyimpanan password plaintext lama jika masih tersisa di browser
try {
  sessionStorage.removeItem(LEGACY_AUTH_PASSWORD_KEY);
  localStorage.removeItem(LEGACY_AUTH_PASSWORD_KEY);
} catch {}

export function isTokenValid(token: string | null): boolean {
  if (!token) return false;
  try {
    if (!token.includes(".")) return false;
    const [payloadB64] = token.split(".");
    const jsonStr = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(jsonStr);
    return Boolean(payload.exp && payload.exp > Math.floor(Date.now() / 1000));
  } catch {
    return false;
  }
}

export function getStoredAuthToken(): string | null {
  const sessionToken = sessionStorage.getItem(AUTH_STORAGE_KEY);
  if (sessionToken && isTokenValid(sessionToken)) return sessionToken;
  const localToken = localStorage.getItem(AUTH_STORAGE_KEY);
  if (localToken && isTokenValid(localToken)) return localToken;
  return null;
}

export function getStoredAuthMode(): AuthMode {
  const token = getStoredAuthToken();
  if (token && token.includes(".")) {
    try {
      const [payloadB64] = token.split(".");
      const jsonStr = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));
      const payload = JSON.parse(jsonStr);
      if (payload.m === "jocelyn" || payload.m === "default") {
        return payload.m as AuthMode;
      }
    } catch {}
  }

  const sessionMode = sessionStorage.getItem(AUTH_MODE_KEY) as AuthMode | null;
  if (sessionMode === "jocelyn" || sessionMode === "default") return sessionMode;
  const localMode = localStorage.getItem(AUTH_MODE_KEY) as AuthMode | null;
  if (localMode === "jocelyn" || localMode === "default") return localMode;

  return "default";
}

export function buildAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  const token = getStoredAuthToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const customKey = (localStorage.getItem("celyn_custom_gemini_key") || "").trim();
  if (customKey) {
    headers["x-gemini-key"] = customKey;
  }
  return headers;
}

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    const sessionToken = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (sessionToken) {
      if (isTokenValid(sessionToken)) return true;
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
    }
    const localToken = localStorage.getItem(AUTH_STORAGE_KEY);
    if (localToken) {
      if (isTokenValid(localToken)) return true;
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
    return false;
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
    async (inputPassword: string, rememberMe = false): Promise<boolean> => {
      if (checkLockout()) {
        setError(`Terlalu banyak percobaan. Harap tunggu ${lockoutSeconds} detik.`);
        return false;
      }

      const rawPassword = inputPassword.trim();
      if (!rawPassword) {
        setError("Kata sandi tidak boleh kosong.");
        return false;
      }

      // Wajib verifikasi server-side (HMAC signed token) — tanpa bypass client-side
      let verifiedMode: AuthMode | null = null;
      let sessionToken: string | null = null;
      let serverError: string | null = null;

      try {
        const resp = await fetch("/api/auth/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: rawPassword }),
        });
        const data = await resp.json().catch(() => null);
        if (resp.ok && data?.valid && data?.mode && data?.token) {
          verifiedMode = data.mode;
          sessionToken = data.token;
        } else if (resp.status >= 500) {
          serverError = data?.error || "Server autentikasi mengalami gangguan konfigurasi.";
        }
      } catch {
        serverError = "Tidak dapat menjangkau server autentikasi. Pastikan backend berjalan.";
      }

      if (serverError) {
        setError(serverError);
        return false;
      }

      if (verifiedMode && sessionToken) {
        if (rememberMe) {
          localStorage.setItem(AUTH_STORAGE_KEY, sessionToken);
          localStorage.setItem(AUTH_MODE_KEY, verifiedMode);
          localStorage.setItem(AUTH_REMEMBER_KEY, "true");
        } else {
          sessionStorage.setItem(AUTH_STORAGE_KEY, sessionToken);
          sessionStorage.setItem(AUTH_MODE_KEY, verifiedMode);
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
    sessionStorage.removeItem(AUTH_MODE_KEY);
    sessionStorage.removeItem(LEGACY_AUTH_PASSWORD_KEY);
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(AUTH_MODE_KEY);
    localStorage.removeItem(LEGACY_AUTH_PASSWORD_KEY);
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
