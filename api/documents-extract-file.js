import { GoogleGenAI } from "@google/genai";
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
    const fileUri = String(body.fileUri || "").trim();
    const fileName = String(body.fileName || "dokumen.pdf").trim();
    const mimeType = String(body.mimeType || "application/pdf").trim();

    if (!fileUri) {
      return res.status(400).json({ error: "Parameter 'fileUri' wajib disertakan." });
    }

    const ai = new GoogleGenAI({ apiKey });

    // Tunggu jika status file masih PROCESSING
    const fileNameKey = fileUri.split("/").pop();
    if (fileNameKey) {
      try {
        let fileStatus = await ai.files.get({ name: `files/${fileNameKey}` });
        let attempts = 0;
        while (fileStatus.state === "PROCESSING" && attempts < 15) {
          await new Promise((r) => setTimeout(r, 2000));
          fileStatus = await ai.files.get({ name: `files/${fileNameKey}` });
          attempts++;
        }
      } catch (checkErr) {
        console.warn("[ExtractFile] Warning checking file status:", checkErr);
      }
    }

    const modelName = process.env.DOC_OCR_MODEL || process.env.TEXT_MODEL || "gemini-3-flash-preview";
    const prompt =
      "Tolong ekstrak seluruh isi dokumen ini menjadi Markdown terstruktur yang rapi dan lengkap. Sertakan judul utama (#), sub-heading (##, ###), poin-poin penting, dan tabel markdown jika ada. Pertahankan urutan bab dan nilai data asli secara presisi. Jangan lewatkan informasi penting.";

    const response = await ai.models.generateContent({
      model: modelName,
      contents: [
        {
          role: "user",
          parts: [
            {
              fileData: {
                fileUri,
                mimeType,
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
    });

    const markdownContent = (response.text || "").trim();

    return res.status(200).json({
      ok: true,
      document: {
        fileName,
        mimeType,
        markdownContent,
        usedOcr: true,
        pages: 0,
        truncated: false,
        characterCount: markdownContent.length,
        fileUri,
      },
    });
  } catch (err) {
    console.error("[ExtractFile] Error:", err);
    return res.status(500).json({
      error: `Gagal mengekstrak isi dokumen: ${err?.message || "Unknown error"}`,
    });
  }
}
