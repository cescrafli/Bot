import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env dari root project atau dari apps/server
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

export const config = {
  port: parseInt(process.env.PORT || "3001", 10),
  adminPassword: process.env.ADMIN_PASSWORD || "admin",
  userPassword: process.env.USER_PASSWORD || "login",
  authSecret: process.env.AUTH_SECRET || "celyn-secret-session-key-2026",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.8-live",
  textModel: process.env.TEXT_MODEL || "gemini-3-flash-preview",
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
  docOcrModel: process.env.DOC_OCR_MODEL || process.env.TEXT_MODEL || "gemini-3-flash-preview",
  docGenerateModel: process.env.DOC_GENERATE_MODEL || process.env.TEXT_MODEL || "gemini-3-flash-preview",
  docMaxContextChars: parseInt(process.env.DOC_MAX_CONTEXT_CHARS || "60000", 10),
};

if (!config.geminiApiKey) {
  console.warn(
    "⚠️ [WARNING] GEMINI_API_KEY belum diisi di file .env! Harap lengkapi file .env untuk mengaktifkan AI."
  );
}
