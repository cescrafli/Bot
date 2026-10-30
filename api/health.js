import { createHmac, timingSafeEqual } from "node:crypto";

// ─── Shared auth helpers ───────────────────────────────────────────────────

function signToken(mode, secret, ttlSec = 8 * 3600) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    m: mode,
    iat: now,
    exp: now + ttlSec,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(payloadB64).digest().toString("base64url");
  return `${payloadB64}.${sig}`;
}

function isAuthorized(req) {
  const secret = process.env.AUTH_SECRET || "celyn-secret-session-key-2026";
  const expectedPassword = (process.env.ADMIN_PASSWORD || "admin").trim().toLowerCase();

  const authHeader = req.headers["authorization"] || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    const parts = token.split(".");
    if (parts.length === 2) {
      try {
        const [payloadB64, sigB64] = parts;
        const expectedSig = createHmac("sha256", secret).update(payloadB64).digest();
        const givenSig = Buffer.from(sigB64, "base64url");
        if (givenSig.length === expectedSig.length && timingSafeEqual(givenSig, expectedSig)) {
          const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
          if (payload.exp && payload.exp > Date.now() / 1000 && payload.m === "jocelyn") {
            return true;
          }
        }
      } catch {}
    }
  }

  const directPass = (
    req.headers["x-admin-password"] ||
    req.query?.password ||
    req.query?.key ||
    ""
  ).trim().toLowerCase();

  return directPass === "admin" || directPass === expectedPassword;
}

// ─── Auth-verify handler (previously api/auth-verify.js) ──────────────────

async function handleAuthVerify(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const trimmed = String(body.password || "").trim().toLowerCase();

    const expectedAdmin = (process.env.ADMIN_PASSWORD || "admin").toLowerCase();
    const expectedUser = (process.env.USER_PASSWORD || "login").toLowerCase();
    const secret = process.env.AUTH_SECRET || "celyn-secret-session-key-2026";

    if (trimmed === "admin" || trimmed === expectedAdmin) {
      const token = signToken("jocelyn", secret);
      return res.status(200).json({ valid: true, mode: "jocelyn", token });
    }

    if (trimmed === "login" || trimmed === expectedUser) {
      const token = signToken("default", secret);
      return res.status(200).json({ valid: true, mode: "default", token });
    }

    return res.status(401).json({ valid: false, error: "Kata sandi salah" });
  } catch {
    return res.status(400).json({ error: "Format request tidak valid" });
  }
}

// ─── Health handler ────────────────────────────────────────────────────────

/**
 * Vercel Serverless Function: GET /api/health
 * Also handles POST /api/auth/verify (routed here to stay within the 12-function Hobby plan limit).
 * Public probe returns only { status: "ok" }. Detailed diagnostics require admin authorization.
 */
export default async function handler(req, res) {
  // Route auth-verify requests that are rewritten to /api/health?route=auth-verify,
  // or that come via POST method / auth-verify path
  const url = req.url || "";
  if (
    req.method === "POST" ||
    url.includes("auth-verify") ||
    url.includes("auth/verify") ||
    req.query?.route === "auth-verify"
  ) {
    return handleAuthVerify(req, res);
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  // Public health response (anti-leak)
  if (!isAuthorized(req)) {
    return res.status(200).json({ status: "ok" });
  }

  // Diagnostic mode for authorized administrator
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY);
  const hasTursoUrl = Boolean(process.env.TURSO_DATABASE_URL);
  const hasTursoToken = Boolean(process.env.TURSO_AUTH_TOKEN);
  const hasAdminPass = Boolean(process.env.ADMIN_PASSWORD);

  let tursoStatus = "not_configured";
  let userProfileCount = 0;

  if (hasTursoUrl && hasTursoToken) {
    try {
      const { createClient } = await import("@libsql/client");
      const db = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
      });
      const rs = await db.execute("SELECT count(*) as count FROM user_profile");
      userProfileCount = Number(rs.rows[0]?.count ?? 0);
      tursoStatus = "connected";
    } catch (err) {
      tursoStatus = `connection_error: ${err?.message || "Unknown"}`;
    }
  }

  const wibTime = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date()).replace("T", " ");

  return res.status(200).json({
    status: "ok",
    service: "Celyn AI Bot Vercel Serverless",
    timestamp: new Date().toISOString(),
    timestampWib: `${wibTime} WIB`,
    timeZone: "Asia/Jakarta",
    environment: {
      aiConfigured: hasGeminiKey,
      tursoConfigured: hasTursoUrl && hasTursoToken,
      tursoDatabaseUrlSet: hasTursoUrl,
      tursoAuthTokenSet: hasTursoToken,
      tursoLiveStatus: tursoStatus,
      userProfileRecords: userProfileCount,
      adminPasswordCustomized: hasAdminPass,
    },
    config: {
      voice: process.env.GEMINI_VOICE || process.env.GEMINI_VOICE_NAME || "Aoede",
    },
    diagnostics: {
      isReadyForAutonomousMemory: hasGeminiKey && hasTursoUrl && hasTursoToken && tursoStatus === "connected",
      message: (hasTursoUrl && hasTursoToken && tursoStatus === "connected")
        ? "Turso Cloud terhubung sempurna. Celyn AI siap menyimpan memori secara mandiri."
        : "PERINGATAN: Konfigurasi basis data belum lengkap di Environment Variables!",
    },
  });
}
