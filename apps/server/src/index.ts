import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI } from "@google/genai";
import { config } from "./config.js";
import { GeminiSession } from "./geminiSession.js";
import { synthesizeEdgeTTS } from "./edgeTts.js";
import { memoryService } from "./services/MemoryService.js";
import { ClientMessage, DEFAULT_VOICE_NAME, normalizeEmotion, AuthMode, DocumentKind, signAuthToken, verifyAuthToken } from "@celyn/shared";
import { parseMultipartUpload } from "./middlewares/upload.js";
import { documentReaderService } from "./services/DocumentReaderService.js";
import { documentService } from "./services/DocumentService.js";
import { jobService } from "./services/JobService.js";

// Metrik Global Server
const serverStats = {
  startTime: Date.now(),
  totalConnections: 0,
  activeConnections: 0,
};

// Rate limiter sederhana per IP (maksimal 5 koneksi bersamaan per IP)
const ipConnectionCount = new Map<string, number>();

// Ekstraksi IP asli klien yang aman terhadap proxy chains (Cloudflare / NGINX / Vercel)
function getClientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].split(",")[0].trim();
  }
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string") return realIp.trim();
  return req.socket.remoteAddress || "unknown";
}

/**
 * Resolves authentication status from Bearer Token or legacy passwords ('admin' / 'login')
 */
function getReqAuth(req: http.IncomingMessage): { valid: boolean; mode?: AuthMode } {
  // 1. Cek Authorization Header (Bearer token)
  const authHeader = req.headers["authorization"] || "";
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    const verified = verifyAuthToken(token, config.authSecret);
    if (verified) {
      return { valid: true, mode: verified.mode };
    }
  }

  // 2. Cek Header atau Query sandi langsung
  const parsedUrl = new URL(req.url || "/", `http://localhost:${config.port}`);
  const rawHeader = req.headers["x-admin-password"];
  const headerPass = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  const pass = (
    headerPass ||
    parsedUrl.searchParams.get("password") ||
    parsedUrl.searchParams.get("key") ||
    ""
  ).trim().toLowerCase();

  const adminPass = config.adminPassword.toLowerCase();
  const userPass = config.userPassword.toLowerCase();

  if (pass === "admin" || pass === adminPass) {
    return { valid: true, mode: "jocelyn" };
  }
  if (pass === "login" || pass === userPass) {
    return { valid: true, mode: "default" };
  }

  return { valid: false };
}

const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-password, authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check endpoint publik (Liveness & Readiness Probe - anti vendor leak)
  if (req.url === "/api/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // Diagnostics endpoint khusus admin terotentikasi
  if (req.url === "/api/admin/diagnostics") {
    const auth = getReqAuth(req);
    if (!auth.valid || auth.mode !== "jocelyn") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Akses ditolak: Hanya mode admin yang diizinkan." }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        service: "Celyn AI Bot Backend Server",
        aiConfigured: !!config.geminiApiKey,
        tursoConnected: memoryService.isReady(),
        memoryProvider: "Turso Cloud libSQL (aws-ap-southeast-1)",
        activeConnections: serverStats.activeConnections,
        uptimeSeconds: Math.floor((Date.now() - serverStats.startTime) / 1000),
      })
    );
    return;
  }

  // Endpoint Verifikasi Autentikasi (Server-side Auth dengan HMAC Token)
  if (req.url === "/api/auth/verify" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        const trimmed = String(parsed.password || "").trim().toLowerCase();
        if (trimmed === "admin" || trimmed === config.adminPassword.toLowerCase()) {
          const token = signAuthToken("jocelyn", config.authSecret);
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ valid: true, mode: "jocelyn", token }));
        }
        if (trimmed === "login" || trimmed === config.userPassword.toLowerCase()) {
          const token = signAuthToken("default", config.authSecret);
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ valid: true, mode: "default", token }));
        }
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ valid: false, error: "Kata sandi salah" }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Format request tidak valid" }));
      }
    });
    return;
  }

  // Stats endpoint publik (sanitized dari nama vendor model AI)
  if (req.url === "/api/stats") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        uptimeSeconds: Math.floor((Date.now() - serverStats.startTime) / 1000),
        totalConnections: serverStats.totalConnections,
        activeConnections: serverStats.activeConnections,
      })
    );
    return;
  }

  // Endpoint Unduh Dokumen Hasil Proses Latar Belakang (RFC 6266)
  if (req.url?.startsWith("/api/documents/download")) {
    const parsedUrl = new URL(req.url, `http://localhost:${config.port}`);
    const jobId = parsedUrl.searchParams.get("id");
    const job = jobId ? jobService.getJob(jobId) : undefined;
    if (!job || !job.resultBuffer) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Dokumen tidak ditemukan atau sudah kedaluwarsa." }));
      return;
    }
    const safeName = job.fileName || "dokumen";
    const asciiName = safeName.replace(/[^a-zA-Z0-9._-]/g, "_");
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      "Content-Length": job.resultBuffer.length,
    });
    res.end(job.resultBuffer);
    return;
  }

  // Endpoint Memori Turso (Untuk Serverless Parity & Direct Client)
  if (req.url === "/api/memory" || req.url?.startsWith("/api/memory?") || req.url?.startsWith("/api/memory/block")) {
    const parsedUrl = new URL(req.url, `http://localhost:${config.port}`);
    const rawHeader = req.headers["x-admin-password"];
    const headerPass = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const authPass =
      headerPass ||
      parsedUrl.searchParams.get("password") ||
      parsedUrl.searchParams.get("key");

    // Zero-leak security: Hanya admin yang diizinkan mengambil blok memori
    if (authPass !== "admin" && authPass !== config.adminPassword) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ memoryContext: null, mode: "default" }));
      return;
    }

    (async () => {
      try {
        const memoryContext = await memoryService.getMemoryPromptBlock();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ memoryContext, mode: "jocelyn" }));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err?.message || "Gagal mengambil data memori" }));
      }
    })();
    return;
  }

  // Endpoint Simpan Log Giliran (Untuk Mode Serverless & Client Direct)
  if (req.url === "/api/record" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(body || "{}");
        const rawHeader = req.headers["x-admin-password"];
        const headerPass = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
        const authPass = headerPass || parsed.password;

        if (authPass !== "admin" && authPass !== config.adminPassword) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: false, message: "Ignored for non-admin" }));
        }

        const { sessionId, role, content } = parsed;
        if (sessionId && role && content) {
          await memoryService.recordTurn(sessionId, role, content);
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: true }));
        }
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Data tidak lengkap" }));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err?.message }));
      }
    });
    return;
  }

  // Endpoint Meringkas Sesi Obrolan (Untuk Mode Serverless & Client Direct)
  if (req.url === "/api/summarize" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(body || "{}");
        const rawHeader = req.headers["x-admin-password"];
        const headerPass = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
        const authPass = headerPass || parsed.password;

        if (authPass !== "admin" && authPass !== config.adminPassword) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: false, message: "Ignored for non-admin" }));
        }

        const { sessionId } = parsed;
        if (sessionId) {
          await memoryService.summarizeAndPersistSession(sessionId);
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: true }));
        }
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "SessionId tidak disertakan" }));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err?.message }));
      }
    });
    return;
  }

  // Endpoint Simpan Memori/Fakta Real-Time (Tool remember_fact)
  if ((req.url === "/api/memory/remember" || req.url === "/api/remember") && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(body || "{}");
        const rawHeader = req.headers["x-admin-password"];
        const headerPass = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
        const authPass = headerPass || parsed.password;

        if (authPass !== "admin" && authPass !== config.adminPassword) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: false, message: "Ignored for non-admin" }));
        }

        const { fact, category = "fakta", importance = 2 } = parsed;
        if (fact && String(fact).trim().length >= 3) {
          const saved = await memoryService.saveUserFact(fact, category, importance);
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: saved }));
        }
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Parameter fact tidak valid" }));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err?.message }));
      }
    });
    return;
  }

  // Ephemeral Token endpoint (kompatibel dengan mode Vercel Serverless)
  if (req.url?.startsWith("/api/token")) {
    const parsedUrl = new URL(req.url, `http://localhost:${config.port}`);
    const authPass =
      req.headers["x-admin-password"] ||
      parsedUrl.searchParams.get("password") ||
      parsedUrl.searchParams.get("key");

    const validPasswords = ["admin", "login", config.adminPassword];
    if (!authPass || !validPasswords.includes(String(authPass).trim())) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Akses ditolak: Kata sandi valid ('admin' atau 'login') diperlukan." }));
      return;
    }

    if (!config.geminiApiKey) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "GEMINI_API_KEY belum diisi di .env" }));
      return;
    }

    const selectedVoice = parsedUrl.searchParams.get("voice") || config.geminiVoice;

    (async () => {
      try {
        const ai = new GoogleGenAI({
          apiKey: config.geminiApiKey,
          httpOptions: { apiVersion: "v1alpha" },
        });
        const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        const tokenResource = await ai.authTokens.create({
          config: { uses: 5, expireTime },
        });
        const isAdmin = authPass === "admin" || authPass === config.adminPassword;
        const memoryContext = isAdmin ? await memoryService.getMemoryPromptBlock() : undefined;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            token: tokenResource.name,
            model: config.geminiModel,
            voice: selectedVoice,
            expireTime,
            memoryContext: memoryContext || null,
          })
        );
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err?.message || "Gagal membuat token" }));
      }
    })();
    return;
  }

  // Endpoint TTS Microsoft Edge Neural (id-ID-GadisNeural)
  if (req.url?.startsWith("/api/tts")) {
    let rawBody = "";
    let bodyTooLarge = false;
    req.on("data", (chunk) => {
      rawBody += chunk.toString();
      if (rawBody.length > 32 * 1024) {
        bodyTooLarge = true;
        req.destroy();
      }
    });
    req.on("end", async () => {
      if (bodyTooLarge) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Payload Too Large (maks 32KB)" }));
        return;
      }
      try {
        const parsedUrl = new URL(req.url || "/api/tts", `http://localhost:${config.port}`);
        let text = parsedUrl.searchParams.get("text") || "";
        let voice = parsedUrl.searchParams.get("voice") || config.geminiVoice || DEFAULT_VOICE_NAME;
        let emotion = parsedUrl.searchParams.get("emotion") || "neutral";
        let rate = parsedUrl.searchParams.get("rate") || "";
        let pitch = parsedUrl.searchParams.get("pitch") || "";
        let volume = parsedUrl.searchParams.get("volume") || "";

        if (rawBody) {
          try {
            const parsedBody = JSON.parse(rawBody);
            if (parsedBody.text) text = parsedBody.text;
            if (parsedBody.voice) voice = parsedBody.voice;
            if (parsedBody.emotion) emotion = parsedBody.emotion;
            if (parsedBody.rate) rate = parsedBody.rate;
            if (parsedBody.pitch) pitch = parsedBody.pitch;
            if (parsedBody.volume) volume = parsedBody.volume;
          } catch {}
        }

        if (!text.trim()) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Parameter 'text' wajib diisi." }));
          return;
        }

        const mp3Buffer = await synthesizeEdgeTTS(text.slice(0, 1500), {
          voice,
          emotion: normalizeEmotion(emotion),
          rate,
          pitch,
          volume,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            audio: mp3Buffer.toString("base64"),
            mimeType: "audio/mp3",
            voice,
          })
        );
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err?.message || "Gagal menyintesis suara Edge TTS" }));
      }
    });
    return;
  }

  // Endpoint Unggah & Baca Dokumen (PDF, Excel, Word dengan Hybrid OCR)
  if (
    (req.url === "/api/documents/read" ||
      req.url === "/api/documents/upload" ||
      req.url?.startsWith("/api/documents/read?") ||
      req.url?.startsWith("/api/documents/upload?")) &&
    req.method === "POST"
  ) {
    const auth = getReqAuth(req);
    if (!auth.valid) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Akses ditolak: Autentikasi diperlukan." }));
      return;
    }

    parseMultipartUpload(req, config.docMaxUploadMb * 1024 * 1024)
      .then(async (uploaded) => {
        try {
          const parsed = await documentReaderService.readDocument(
            uploaded.buffer,
            uploaded.fileName,
            uploaded.mimeType
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, document: parsed }));
        } catch (readErr: any) {
          if (readErr.message === "PASSWORD_REQUIRED") {
            res.writeHead(422, { "Content-Type": "application/json" });
            return res.end(
              JSON.stringify({
                code: "PASSWORD_REQUIRED",
                error: "File ini dilindungi password sehingga tidak dapat saya buka. Silakan masukkan password atau kirim versi tanpa password.",
              })
            );
          }
          if (readErr.message === "LEGACY_FORMAT") {
            res.writeHead(422, { "Content-Type": "application/json" });
            return res.end(
              JSON.stringify({
                code: "LEGACY_FORMAT",
                error: "Format biner lama (.doc/.xls) ini belum bisa dibaca langsung. Simpan ulang sebagai .docx atau .xlsx lalu kirim lagi.",
              })
            );
          }
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: `Gagal membaca isi dokumen: ${readErr?.message || "Unknown error"}`,
            })
          );
        }
      })
      .catch((err: any) => {
        if (err.message === "PASSWORD_REQUIRED") {
          res.writeHead(422, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              code: "PASSWORD_REQUIRED",
              error: "File ini dilindungi password sehingga tidak dapat saya buka. Silakan masukkan password atau kirim versi tanpa password.",
            })
          );
        } else if (err.message === "LEGACY_FORMAT") {
          res.writeHead(422, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              code: "LEGACY_FORMAT",
              error: "Format biner lama (.doc/.xls) ini belum bisa dibaca langsung. Simpan ulang sebagai .docx atau .xlsx lalu kirim lagi.",
            })
          );
        } else if (err.message === "FILE_TOO_LARGE") {
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: `Ukuran file melebihi batas maksimum (${config.docMaxUploadMb} MB)`,
            })
          );
        } else if (err.message === "INVALID_FILE_TYPE") {
          res.writeHead(415, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Format file tidak didukung atau isi file tidak valid. Celyn mendukung PDF, Excel (.xlsx), atau Word (.docx).",
            })
          );
        } else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: err?.message || "Gagal memproses file unggahan",
            })
          );
        }
      });
    return;
  }

  // Endpoint Pembuat Dokumen AI (Generate PDF, Word, atau Excel)
  if (
    (req.url === "/api/documents/generate" || req.url?.startsWith("/api/documents/generate?")) &&
    req.method === "POST"
  ) {
    const auth = getReqAuth(req);
    if (!auth.valid) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Akses ditolak: Autentikasi diperlukan." }));
      return;
    }

    let rawBody = "";
    let bodyTooLarge = false;
    req.on("data", (chunk) => {
      rawBody += chunk.toString();
      if (rawBody.length > 256 * 1024) {
        bodyTooLarge = true;
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Ukuran JSON permintaan melebihi batas 256 KB." }));
        req.destroy();
      }
    });

    req.on("end", async () => {
      if (bodyTooLarge) return;
      try {
        const body = JSON.parse(rawBody || "{}");
        const kind: DocumentKind = body.kind;
        const title = String(body.title || "Dokumen Celyn").trim();
        const instruction = String(body.instruction || "Buat dokumen berdasarkan data obrolan").trim();
        const context = body.context ? String(body.context) : undefined;

        if (!["pdf", "docx", "xlsx"].includes(kind)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Parameter 'kind' wajib bernilai 'pdf', 'docx', atau 'xlsx'",
            })
          );
          return;
        }

        const result = await documentService.generateDocument({
          kind,
          title,
          instruction,
          context,
        });

        const safeName = result.fileName;
        const asciiName = safeName.replace(/[^a-zA-Z0-9._-]/g, "_");
        res.writeHead(200, {
          "Content-Type": result.mimeType,
          "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
          "Content-Length": result.buffer.length,
        });
        res.end(result.buffer);
      } catch (genErr: any) {
        console.error("[Index /api/documents/generate] Error:", genErr);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: `Gagal menghasilkan dokumen: ${genErr?.message || "Unknown error"}`,
          })
        );
      }
    });
    return;
  }

  // Endpoint Proses Dokumen In-Place (Edit, Translate, Summarize, Paraphrase)
  if (
    (req.url === "/api/documents/process" || req.url?.startsWith("/api/documents/process?")) &&
    req.method === "POST"
  ) {
    const auth = getReqAuth(req);
    if (!auth.valid) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Akses ditolak: Autentikasi diperlukan." }));
      return;
    }

    let rawBody = "";
    let bodyTooLarge = false;
    req.on("data", (chunk) => {
      rawBody += chunk.toString();
      if (rawBody.length > 512 * 1024) {
        bodyTooLarge = true;
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Ukuran JSON permintaan melebihi batas 512 KB." }));
        req.destroy();
      }
    });

    req.on("end", async () => {
      if (bodyTooLarge) return;
      try {
        const body = JSON.parse(rawBody || "{}");
        const fileName = String(body.fileName || "dokumen.pdf").trim();
        const operation = body.operation || "edit";
        const originalContent = String(body.originalContent || "").trim();
        const instruction = body.instruction ? String(body.instruction).trim() : undefined;
        const targetLanguage = body.targetLanguage ? String(body.targetLanguage).trim() : undefined;
        const kind: DocumentKind | undefined = body.kind;

        if (!originalContent) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Parameter 'originalContent' wajib disertakan untuk proses in-place." }));
          return;
        }

        const result = await documentService.processDocumentInPlace({
          fileName,
          kind,
          operation,
          originalContent,
          instruction,
          targetLanguage,
        });

        const safeName = result.fileName;
        const asciiName = safeName.replace(/[^a-zA-Z0-9._-]/g, "_");
        res.writeHead(200, {
          "Content-Type": result.mimeType,
          "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
          "Content-Length": result.buffer.length,
        });
        res.end(result.buffer);
      } catch (procErr: any) {
        console.error("[Index /api/documents/process] Error:", procErr);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: `Gagal memproses dokumen in-place: ${procErr?.message || "Unknown error"}`,
          })
        );
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

const wss = new WebSocketServer({
  server,
  maxPayload: config.maxPayloadBytes,
});

// Interface untuk melacak heartbeat klien
interface AliveWebSocket extends WebSocket {
  isAlive?: boolean;
}

// Heartbeat ping interval untuk mendeteksi koneksi mati (dead peer)
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws: AliveWebSocket) => {
    if (ws.isAlive === false) {
      console.log("⏱️ [Heartbeat] Klien tidak merespons ping, menutup koneksi.");
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, config.heartbeatIntervalMs);

wss.on("close", () => {
  clearInterval(heartbeatInterval);
});

wss.on("connection", async (ws: AliveWebSocket, req) => {
  const clientIp = getClientIp(req);

  // Tandai klien aktif saat pertama terhubung dan saat merespons pong
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  // Periksa batas koneksi per IP
  const currentCount = ipConnectionCount.get(clientIp) || 0;
  if (currentCount >= 5) {
    console.warn(`⛔ [Rate Limit] IP ${clientIp} melebihi batas 5 koneksi simultan.`);
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Batas koneksi per IP terlampaui (maksimal 5 koneksi simultan).",
      })
    );
    ws.close(1008, "Rate limit exceeded");
    return;
  }

  ipConnectionCount.set(clientIp, currentCount + 1);
  serverStats.totalConnections++;
  serverStats.activeConnections++;

  console.log(`🔌 [Klien Masuk] Terhubung dari ${clientIp} (Aktif: ${serverStats.activeConnections})`);

  const parsedUrl = new URL(req.url || "/", `http://localhost:${config.port}`);
  // Verifikasi Autentikasi WebSocket (Token HMAC atau Kata Sandi)
  const token = parsedUrl.searchParams.get("token") || undefined;
  let authMode: AuthMode = "default";
  let isAuthorized = false;

  if (token) {
    const verified = verifyAuthToken(token, config.authSecret);
    if (verified) {
      isAuthorized = true;
      authMode = verified.mode;
    }
  }

  if (!isAuthorized) {
    const rawHeader = req.headers["x-admin-password"];
    const headerPass = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const authPass = (
      headerPass ||
      parsedUrl.searchParams.get("password") ||
      parsedUrl.searchParams.get("key") ||
      ""
    ).trim().toLowerCase();

    const adminPass = config.adminPassword.toLowerCase();
    const userPass = config.userPassword.toLowerCase();

    if (authPass === "admin" || authPass === adminPass) {
      isAuthorized = true;
      authMode = "jocelyn";
    } else if (authPass === "login" || authPass === userPass) {
      isAuthorized = true;
      authMode = "default";
    } else if (authPass) {
      console.warn(`⛔ [Auth Failed] Koneksi WebSocket ditolak: Password salah dari ${clientIp}`);
      ws.send(JSON.stringify({ type: "error", message: "Akses ditolak: Kata sandi salah." }));
      ws.close(1008, "Unauthorized");
      return;
    }
  }

  const requestedVoice = parsedUrl.searchParams.get("voice") || config.geminiVoice;
  const requestedSessionId = parsedUrl.searchParams.get("sessionId") || undefined;
  // Memori jangka panjang Turso HANYA diakses untuk password 'admin' (mode jocelyn)
  // Mode 'login' (default) selalu mulai dari awal tanpa memori Turso (zero data leak)
  const memoryContext =
    authMode === "jocelyn" ? await memoryService.getMemoryPromptBlock() : undefined;
  const session = new GeminiSession(ws, requestedVoice, authMode, requestedSessionId, memoryContext);
  session.connect();

  // Idle timeout timer: jika tidak ada interaksi dalam 5 menit, putuskan sesi secara tertib
  let idleTimer: NodeJS.Timeout | null = null;
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      console.log(`💤 [Idle Timeout] Sesi untuk ${clientIp} dihentikan karena tidak ada aktivitas.`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "status",
            status: "idle",
            message: "Sesi ditutup otomatis karena tidak ada aktivitas selama 5 menit.",
          })
        );
        ws.close(1000, "Idle timeout");
      }
    }, config.idleTimeoutMs);
  };
  resetIdleTimer();

  // Rate limit pesan dari klien (maks 80 pesan / detik untuk mendukung audio 64ms streaming)
  let messageCounter = 0;
  const rateLimitInterval = setInterval(() => {
    messageCounter = 0;
  }, 1000);

  ws.on("message", (data: Buffer) => {
    resetIdleTimer();
    messageCounter++;
    if (messageCounter > 80) {
      console.warn(`⚠️ [Throttled] Klien ${clientIp} mengirim pesan terlalu cepat.`);
      return;
    }

    try {
      const msg = JSON.parse(data.toString("utf8")) as ClientMessage;
      session.handleClientMessage(msg);
    } catch (err) {
      console.error("Gagal mem-parse pesan dari klien:", err);
    }
  });

  const cleanup = () => {
    if (idleTimer) clearTimeout(idleTimer);
    clearInterval(rateLimitInterval);
    const count = ipConnectionCount.get(clientIp) || 1;
    if (count <= 1) {
      ipConnectionCount.delete(clientIp);
    } else {
      ipConnectionCount.set(clientIp, count - 1);
    }
    serverStats.activeConnections = Math.max(0, serverStats.activeConnections - 1);
    console.log(`❌ [Klien Keluar] ${clientIp} terputus (Tersisa: ${serverStats.activeConnections})`);
    session.close();
  };

  ws.on("close", cleanup);
  ws.on("error", (err) => {
    console.error(`WebSocket error untuk ${clientIp}:`, err.message);
    cleanup();
  });
});

// Graceful shutdown
const handleShutdown = () => {
  console.log("\n🛑 Mematikan server Celyn AI secara tertib...");
  wss.clients.forEach((client) => {
    client.close(1001, "Server shutdown");
  });
  server.close(() => {
    console.log("Server berhasil dihentikan.");
    process.exit(0);
  });
};

process.on("SIGINT", handleShutdown);
process.on("SIGTERM", handleShutdown);

// Inisialisasi skema memori Turso di latar belakang
memoryService.initSchema().catch((err) => {
  console.warn("[MEMORY] ⚠️ Gagal menginisialisasi skema Turso:", err?.message || err);
});

server.listen(config.port, () => {
  console.log(`
=====================================================
🚀 Celyn AI BOT Server siap melayani!
🌐 URL: http://localhost:${config.port}
🔌 WebSocket endpoint: ws://localhost:${config.port}
🎯 Gemini Model: ${config.geminiModel} | Voice: ${config.geminiVoice}
🔑 API Key status: ${config.geminiApiKey ? "TERPASANG ✅" : "BELUM TERPASANG ⚠️"}
📊 Health check: http://localhost:${config.port}/api/health
=====================================================
  `);
});
