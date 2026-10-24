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
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.8-live",
  geminiVoice: process.env.GEMINI_VOICE || "Aoede",
};

if (!config.geminiApiKey) {
  console.warn(
    "⚠️ [WARNING] GEMINI_API_KEY belum diisi di file .env! Dapatkan key di https://aistudio.google.com/ lalu isi ke .env"
  );
}
