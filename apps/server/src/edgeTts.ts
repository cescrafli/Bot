import crypto from "node:crypto";
import { WebSocket } from "ws";
import {
  DEFAULT_VOICE_NAME,
  generateSecMsGecV2,
  cleanAndEscapeForSsml,
  inferIndonesianProsody,
  buildExpressiveSsml,
  EmotionType,
  SEC_MS_GEC_VERSION,
  TRUSTED_CLIENT_TOKEN,
  CHROMIUM_MAJOR_VERSION,
} from "@celyn/shared";

export { generateSecMsGecV2, cleanAndEscapeForSsml, buildExpressiveSsml };

let clockSkewSeconds = 0;

export interface EdgeTtsOptions {
  voice?: string;
  rate?: string;
  pitch?: string;
  volume?: string;
  emotion?: EmotionType;
  timeoutMs?: number;
}

interface WarmSocketEntry {
  ws: WebSocket;
  createdAt: number;
}

let warmPool: WarmSocketEntry[] = [];
const MAX_WARM = 2;
let isReplenishing = false;

function buildEdgeWs(): WebSocket {
  const connId = crypto.randomBytes(16).toString("hex");
  const muid = crypto.randomBytes(16).toString("hex").toUpperCase();
  const gec = generateSecMsGecV2(Date.now() / 1000 + clockSkewSeconds);
  const url =
    `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
    `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&ConnectionId=${connId}` +
    `&Sec-MS-GEC=${gec}` +
    `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

  return new WebSocket(url, {
    headers: {
      Pragma: "no-cache",
      "Cache-Control": "no-cache",
      Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
      "User-Agent":
        `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
        `(KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 ` +
        `Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      Cookie: `muid=${muid};`,
    },
  });
}

function sendConfig(ws: WebSocket): void {
  const timestamp = new Date(Date.now() + clockSkewSeconds * 1000).toUTCString();
  const configPayload = JSON.stringify({
    context: {
      synthesis: {
        audio: {
          metadataoptions: {
            sentenceBoundaryEnabled: "false",
            wordBoundaryEnabled: "false",
          },
          outputFormat: "audio-24khz-48kbitrate-mono-mp3",
        },
      },
    },
  });

  ws.send(
    `X-Timestamp:${timestamp}\r\n` +
      `Content-Type:application/json; charset=utf-8\r\n` +
      `Path:speech.config\r\n\r\n` +
      `${configPayload}\r\n`
  );
}

export function replenishWarmPool(): void {
  const now = Date.now();
  // Bersihkan socket yang sudah tertutup atau lebih tua dari 35 detik (Edge timeout ~60s)
  warmPool = warmPool.filter((entry) => {
    if (entry.ws.readyState === WebSocket.OPEN && now - entry.createdAt < 35000) {
      return true;
    }
    try {
      entry.ws.removeAllListeners();
      entry.ws.close();
    } catch {}
    return false;
  });

  if (warmPool.length >= MAX_WARM || isReplenishing) return;
  isReplenishing = true;

  try {
    const ws = buildEdgeWs();
    const entry: WarmSocketEntry = { ws, createdAt: Date.now() };

    const cleanup = () => {
      warmPool = warmPool.filter((e) => e !== entry);
      try {
        ws.removeAllListeners();
        ws.close();
      } catch {}
    };

    ws.once("open", () => {
      try {
        sendConfig(ws);
        entry.createdAt = Date.now();
        warmPool.push(entry);
      } catch {
        cleanup();
      } finally {
        isReplenishing = false;
        if (warmPool.length < MAX_WARM) {
          replenishWarmPool();
        }
      }
    });

    ws.once("error", () => {
      cleanup();
      isReplenishing = false;
    });

    ws.once("close", () => {
      cleanup();
      isReplenishing = false;
    });
  } catch {
    isReplenishing = false;
  }
}

// Inisialisasi pool koneksi hangat (pre-warm) di latar belakang
setTimeout(replenishWarmPool, 100);

/**
 * Mencoba satu kali koneksi WebSocket ke Microsoft Edge ReadAloud TTS
 * Menggunakan Pre-Warmed WebSocket Pool jika tersedia untuk latensi 0ms handshake
 */
function trySynthesizeOnce(
  rawText: string,
  options: EdgeTtsOptions
): Promise<Buffer> {
  const timeoutMs = options.timeoutMs || 10000;

  return new Promise<Buffer>((resolve, reject) => {
    let ws: WebSocket | null = null;
    let isPreWarmed = false;

    // Ambil socket hangat dari pool jika ada yang siap
    while (warmPool.length > 0) {
      const candidate = warmPool.shift();
      if (candidate && candidate.ws.readyState === WebSocket.OPEN) {
        ws = candidate.ws;
        ws.removeAllListeners();
        isPreWarmed = true;
        break;
      } else if (candidate) {
        try {
          candidate.ws.removeAllListeners();
          candidate.ws.close();
        } catch {}
      }
    }

    // Selalu picu pengisian ulang pool koneksi hangat di latar belakang
    replenishWarmPool();

    if (!ws) {
      ws = buildEdgeWs();
    }

    const audioChunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          ws?.close();
        } catch {}
        reject(new Error(`Edge TTS timeout (${timeoutMs}ms)`));
      }
    }, timeoutMs);

    const onAudioMessage = (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (isBinary) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
        if (buf.length < 2) return;
        const headerLen = buf.readUInt16BE(0);
        const headerStr = buf.subarray(2, 2 + headerLen).toString("utf-8");
        if (headerStr.includes("Path:audio")) {
          const audioData = buf.subarray(2 + headerLen);
          if (audioData.length > 0) {
            audioChunks.push(audioData);
          }
        }
      } else {
        const textMsg = data.toString();
        if (textMsg.includes("Path:turn.end")) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            try {
              ws?.close();
            } catch {}
            resolve(Buffer.concat(audioChunks));
          }
        }
      }
    };

    ws.on("message", onAudioMessage);

    ws.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    ws.on("close", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        if (audioChunks.length > 0) {
          resolve(Buffer.concat(audioChunks));
        } else {
          reject(new Error("Koneksi Edge TTS tertutup tanpa data audio."));
        }
      }
    });

    const sendSsmlPayload = () => {
      const timestamp = new Date(Date.now() + clockSkewSeconds * 1000).toUTCString();
      const reqId = crypto.randomBytes(16).toString("hex");
      const ssml = buildExpressiveSsml(rawText, options);

      ws!.send(
        `X-RequestId:${reqId}\r\n` +
          `Content-Type:application/ssml+xml\r\n` +
          `X-Timestamp:${timestamp}Z\r\n` +
          `Path:ssml\r\n\r\n` +
          `${ssml}`
      );
    };

    if (isPreWarmed && ws.readyState === WebSocket.OPEN) {
      // ⚡ PRE-WARMED SOCKET: Kirim SSML seketika dengan 0ms jabat tangan!
      sendSsmlPayload();
    } else {
      // COLD SOCKET: Tunggu koneksi terbuka, kirim config, lalu SSML
      ws.on("unexpected-response", (_req, res) => {
        const serverDate = res.headers["date"];
        if (serverDate) {
          const parsedMs = Date.parse(serverDate);
          if (!Number.isNaN(parsedMs)) {
            clockSkewSeconds = parsedMs / 1000 - Date.now() / 1000;
          }
        }
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Edge TTS unexpected HTTP ${res.statusCode}`));
        }
      });

      ws.on("open", () => {
        sendConfig(ws!);
        sendSsmlPayload();
      });
    }
  });
}

/**
 * Menyintesis teks Bahasa Indonesia menjadi Buffer MP3 (24kHz 48kbps Mono)
 * menggunakan Microsoft Edge Neural TTS (Default: id-ID-GadisNeural / Gadis)
 * dengan auto-retry otomatis jika terjadi clock-skew.
 */
export async function synthesizeEdgeTTS(
  text: string,
  options: EdgeTtsOptions = {}
): Promise<Buffer> {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return Buffer.alloc(0);
  }

  // Terapkan Dynamic Emotional Prosody secara otomatis sesuai konteks kalimat & emosi
  const dynamicProsody = inferIndonesianProsody(trimmed, options.emotion);
  const resolvedOptions: EdgeTtsOptions = {
    ...options,
    rate: options.rate || dynamicProsody.rate,
    pitch: options.pitch || dynamicProsody.pitch,
    volume: options.volume || dynamicProsody.volume,
  };

  try {
    return await trySynthesizeOnce(trimmed, resolvedOptions);
  } catch (firstErr) {
    console.warn("⚠️ Percobaan 1 Edge TTS gagal, mencoba ulang dengan koreksi clock-skew...", firstErr);
    // Coba sekali lagi dengan waktu yang sudah disesuaikan
    return await trySynthesizeOnce(trimmed, {
      ...resolvedOptions,
      timeoutMs: options.timeoutMs ? options.timeoutMs + 2000 : 12000,
    });
  }
}
