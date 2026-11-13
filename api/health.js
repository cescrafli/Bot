import { createHmac, timingSafeEqual } from "node:crypto";

// ─── Shared auth & CORS helpers ─────────────────────────────────────────────

function safeTimingMatch(a, b) {
  const ba = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (!ba.length || ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function resolveApiAuthSecret() {
  const configured = (process.env.AUTH_SECRET || "").trim();
  if (configured) return configured;
  const envSeed = (
    process.env.TURSO_AUTH_TOKEN ||
    process.env.GEMINI_API_KEY ||
    process.env.GEMINI_API_KEYS ||
    process.env.ADMIN_PASSWORD ||
    ""
  ).trim();
  if (envSeed) {
    return createHmac("sha256", "celyn-session-signing-salt-2026").update(envSeed).digest("hex");
  }
  return "celyn-secret-session-key-2026";
}

function verifyEnvPassword(rawPass) {
  const trimmed = String(rawPass || "").trim();
  if (!trimmed) return null;
  const adminPass = (process.env.ADMIN_PASSWORD || "").trim();
  const userPass = (process.env.USER_PASSWORD || "").trim();

  if (adminPass) {
    if (safeTimingMatch(trimmed, adminPass)) return "jocelyn";
  } else if (safeTimingMatch(trimmed.toLowerCase(), "admin")) {
    return "jocelyn";
  }

  if (userPass) {
    if (safeTimingMatch(trimmed, userPass)) return "default";
  } else if (safeTimingMatch(trimmed.toLowerCase(), "login")) {
    return "default";
  }

  return null;
}

function applyCors(req, res, methods = "GET, POST, OPTIONS") {
  const origin = typeof req.headers?.origin === "string" ? req.headers.origin.trim() : "";
  const allowed = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const host = typeof req.headers?.host === "string" ? req.headers.host.trim() : "";
  const isSameHost = Boolean(host && (origin === `https://${host}` || origin === `http://${host}`));
  const isVercelUrl = Boolean(
    origin &&
      ((process.env.VERCEL_URL && origin === `https://${process.env.VERCEL_URL}`) ||
        (process.env.VERCEL_PROJECT_PRODUCTION_URL &&
          origin === `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`))
  );
  const isLocalDev =
    process.env.NODE_ENV !== "production" &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);

  if (origin && (allowed.includes(origin) || isSameHost || isVercelUrl || isLocalDev)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-password, x-gemini-key");
}

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
  const secret = resolveApiAuthSecret();

  const authHeader = req.headers["authorization"] || "";
  if (secret && authHeader.startsWith("Bearer ")) {
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

  const directPass =
    req.headers["x-admin-password"] ||
    req.query?.password ||
    req.query?.key ||
    "";

  return verifyEnvPassword(directPass) === "jocelyn";
}

// ─── Auth-verify handler (previously api/auth-verify.js) ──────────────────

async function handleAuthVerify(req, res) {
  applyCors(req, res, "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const secret = resolveApiAuthSecret();
    if (!secret) {
      return res.status(503).json({
        valid: false,
        error: "Konfigurasi keamanan AUTH_SECRET belum disetel pada server.",
      });
    }

    const mode = verifyEnvPassword(body.password);
    if (mode === "jocelyn" || mode === "default") {
      const token = signToken(mode, secret);
      return res.status(200).json({ valid: true, mode, token });
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

  applyCors(req, res, "GET, POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  // Public health response (anti-leak)
  if (!isAuthorized(req)) {
    return res.status(200).json({ status: "ok" });
  }

  // Diagnostic mode for authorized administrator
  const hasGeminiKey = Boolean(
    process.env.GEMINI_API_KEY ||
    process.env.GEMINI_API_KEYS ||
    process.env.GEMINI_API_KEY_FALLBACK ||
    process.env.GEMINI_API_KEY_SECRET
  );
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
