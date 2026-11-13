import dotenv from "dotenv";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env dari root project atau dari apps/server
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const rawGeminiKeys = [
  process.env.GEMINI_API_KEYS,
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_FALLBACK,
  process.env.GEMINI_API_KEY_SECRET,
]
  .filter(Boolean)
  .join(",");
const parsedKeys = rawGeminiKeys
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);
const geminiApiKeys = [...new Set(parsedKeys)].sort((a, b) => {
  if (a.startsWith("AIzaSy") && !b.startsWith("AIzaSy")) return -1;
  if (!a.startsWith("AIzaSy") && b.startsWith("AIzaSy")) return 1;
  return 0;
});
const primaryGeminiApiKey = geminiApiKeys[0] || "";

const isProductionEnv = process.env.NODE_ENV === "production";
const configuredAuthSecret = (process.env.AUTH_SECRET || "").trim();
const envAuthSeed = (
  process.env.TURSO_AUTH_TOKEN ||
  primaryGeminiApiKey ||
  process.env.ADMIN_PASSWORD ||
  ""
).trim();
if (!configuredAuthSecret && isProductionEnv) {
  console.warn(
    "[SECURITY] ⚠️ AUTH_SECRET belum disetel di production! Menggunakan derived session secret — harap konfigurasi AUTH_SECRET di environment."
  );
}

export const config = {
  port: parseInt(process.env.PORT || "3001", 10),
  adminPassword: process.env.ADMIN_PASSWORD || "admin",
  userPassword: process.env.USER_PASSWORD || "login",
  authSecret:
    configuredAuthSecret ||
    (envAuthSeed
      ? crypto.createHmac("sha256", "celyn-session-signing-salt-2026").update(envAuthSeed).digest("hex")
      : "celyn-secret-session-key-2026"),
  geminiApiKey: primaryGeminiApiKey,
  geminiApiKeys,
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.8-live",
  textModel: process.env.TEXT_MODEL || "gemini-3.8-flash",
  researchModel: process.env.RESEARCH_MODEL || process.env.TEXT_MODEL || "gemini-3.8-flash",
  geminiVoice: process.env.GEMINI_VOICE || "Aoede",
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  maxPayloadBytes: 5 * 1024 * 1024, // 5 MB batas frame WebSocket
  idleTimeoutMs: 300_000, // 5 menit tanpa interaksi = idle close
  heartbeatIntervalMs: 25_000, // 25 detik ping/pong
  sessionMaxDurationMs: 30 * 60 * 1000, // 30 menit durasi maksimal sesi live
  sessionWarningDurationMs: 25 * 60 * 1000, // 25 menit peringatan durasi
  docMaxUploadMb: parseInt(process.env.DOC_MAX_UPLOAD_MB || "0", 10), // 0 = unlimited / disk streaming
  docOcrModel: process.env.DOC_OCR_MODEL || process.env.TEXT_MODEL || "gemini-3.8-flash",
  docGenerateModel: process.env.DOC_GENERATE_MODEL || process.env.TEXT_MODEL || "gemini-3.8-flash",
  docMaxContextChars: parseInt(process.env.DOC_MAX_CONTEXT_CHARS || "60000", 10),
};

if (!config.geminiApiKey) {
  console.warn(
    "⚠️ [WARNING] GEMINI_API_KEY belum diisi di file .env! Harap lengkapi file .env untuk mengaktifkan AI."
  );
}
