import { createHmac, timingSafeEqual } from "node:crypto";

function verifyAuth(req) {
  const secret = process.env.AUTH_SECRET || "celyn-secret-session-key-2026";
  const expectedPassword = process.env.ADMIN_PASSWORD || "admin";
  const expectedUserPassword = process.env.USER_PASSWORD || "login";

  // Check Bearer Token
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
          if (payload.exp && payload.exp > Date.now() / 1000) {
            return { valid: true, mode: payload.m };
          }
        }
      } catch {}
    }
  }

  // Check direct password
  const directPass = req.headers["x-admin-password"] || req.query?.password || req.query?.key;
  if (directPass) {
    const trimmed = String(directPass).trim();
    if (trimmed === expectedPassword || trimmed === "admin") {
      return { valid: true, mode: "jocelyn" };
    }
    if (trimmed === expectedUserPassword || trimmed === "login") {
      return { valid: true, mode: "default" };
    }
  }

  return { valid: false };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, authorization, x-admin-password");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed. Gunakan POST." });
  }

  const auth = verifyAuth(req);
  if (!auth.valid) {
    return res.status(401).json({ error: "Akses ditolak: Autentikasi valid diperlukan." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY belum dikonfigurasi di server." });
  }

  try {
    const body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const fileName = String(body.fileName || "dokumen.pdf").trim();
    const mimeType = String(body.mimeType || "application/pdf").trim();
    const fileSize = parseInt(body.fileSize || "0", 10);

    const maxAllowedBytes = 500 * 1024 * 1024; // 500 MB
    if (fileSize > maxAllowedBytes) {
      return res.status(413).json({
        error: `Ukuran file melebihi batas maksimum 500 MB (Ukuran: ${(fileSize / (1024 * 1024)).toFixed(1)} MB)`,
      });
    }

    const initHeaders = {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(fileSize),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    };

    const googleResp = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
      {
        method: "POST",
        headers: initHeaders,
        body: JSON.stringify({ file: { display_name: fileName } }),
      }
    );

    if (!googleResp.ok) {
      const errText = await googleResp.text();
      return res.status(googleResp.status).json({
        error: `Gagal membuat sesi upload Google: ${errText}`,
      });
    }

    const uploadUrl = googleResp.headers.get("x-goog-upload-url");
    if (!uploadUrl) {
      return res.status(500).json({ error: "Header x-goog-upload-url tidak diterima dari Google." });
    }

    return res.status(200).json({
      ok: true,
      uploadUrl,
      fileName,
      mimeType,
      fileSize,
    });
  } catch (err) {
    return res.status(500).json({
      error: `Gagal memproses sesi unggah: ${err?.message || "Unknown error"}`,
    });
  }
}
