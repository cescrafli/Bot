import { createHmac, timingSafeEqual } from "node:crypto";

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

export default async function handler(req, res) {
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
