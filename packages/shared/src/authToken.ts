import * as crypto from "node:crypto";
import type { AuthMode } from "./avatar.js";

interface TokenPayload {
  m: AuthMode;
  exp: number;
  iat: number;
}

const toBase64Url = (buf: Uint8Array): string => {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(buf).toString("base64url");
  }
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (str: string): Uint8Array => {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str, "base64url");
  }
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  const bin = atob(base64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
};

/**
 * Sign an authentication token using HMAC-SHA256
 * @param mode AuthMode ("default" or "jocelyn")
 * @param secret Secret key for signing
 * @param ttlSec Time to live in seconds (default: 8 hours)
 */
export function signAuthToken(mode: AuthMode, secret: string, ttlSec = 8 * 3600): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    m: mode,
    iat: now,
    exp: now + ttlSec,
  };
  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  if (!crypto.createHmac) {
    throw new Error("HMAC signing is only supported in Node.js server environments.");
  }
  const signature = crypto.createHmac("sha256", secret).update(payloadB64).digest();
  const signatureB64 = toBase64Url(signature);
  return `${payloadB64}.${signatureB64}`;
}

/**
 * Verify an authentication token
 * @param token The token string (header Bearer or query param)
 * @param secret Secret key for verification
 */
export function verifyAuthToken(token: string | undefined | null, secret: string): { mode: AuthMode } | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.trim().split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, signatureB64] = parts;
  if (!payloadB64 || !signatureB64) return null;

  try {
    if (!crypto.createHmac || !crypto.timingSafeEqual) {
      return null;
    }
    const expectedSig = crypto.createHmac("sha256", secret).update(payloadB64).digest();
    const givenSig = fromBase64Url(signatureB64);

    if (givenSig.length !== expectedSig.length || !crypto.timingSafeEqual(givenSig, expectedSig)) {
      return null;
    }

    const payloadRaw = new TextDecoder().decode(fromBase64Url(payloadB64));
    const payload = JSON.parse(payloadRaw) as TokenPayload;

    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp <= now) {
      return null;
    }

    if (payload.m !== "default" && payload.m !== "jocelyn") {
      return null;
    }

    return { mode: payload.m };
  } catch {
    return null;
  }
}

/**
 * Constant-time password validation helper
 */
export function verifyPassword(provided: string, expected: string): boolean {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  if (!crypto.timingSafeEqual || typeof Buffer === "undefined") {
    return provided === expected;
  }
  const provBuf = Buffer.from(provided);
  const expBuf = Buffer.from(expected);
  if (provBuf.length !== expBuf.length) {
    // Prevent timing attack while still comparing
    crypto.timingSafeEqual(provBuf, provBuf);
    return false;
  }
  return crypto.timingSafeEqual(provBuf, expBuf);
}

/**
 * High-level authentication check against supported passwords ("admin" or "login")
 */
export function authenticateWithPassword(password: string): { valid: boolean; mode?: AuthMode } {
  if (verifyPassword(password, "admin")) {
    return { valid: true, mode: "jocelyn" };
  }
  if (verifyPassword(password, "login")) {
    return { valid: true, mode: "default" };
  }
  return { valid: false };
}
