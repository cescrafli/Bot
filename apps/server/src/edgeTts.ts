import crypto from "node:crypto";
import { WebSocket } from "ws";
import {
  DEFAULT_VOICE_NAME,
  generateSecMsGecV2,
  cleanAndEscapeForSsml,
  SEC_MS_GEC_VERSION,
  TRUSTED_CLIENT_TOKEN,
  CHROMIUM_MAJOR_VERSION,
} from "@celyn/shared";

export { generateSecMsGecV2, cleanAndEscapeForSsml };

let clockSkewSeconds = 0;

export interface EdgeTtsOptions {
  voice?: string;
  rate?: string;
  pitch?: string;
  volume?: string;
  timeoutMs?: number;
}

/**
 * Mencoba satu kali koneksi WebSocket ke Microsoft Edge ReadAloud TTS
 */
function trySynthesizeOnce(
  escapedText: string,
  options: EdgeTtsOptions
): Promise<Buffer> {
  const voice = options.voice || DEFAULT_VOICE_NAME;
  const rate = options.rate || "+0%";
  const pitch = options.pitch || "+0Hz";
  const volume = options.volume || "+0%";
  const timeoutMs = options.timeoutMs || 10000;

  return new Promise<Buffer>((resolve, reject) => {
    const connId = crypto.randomBytes(16).toString("hex");
    const muid = crypto.randomBytes(16).toString("hex").toUpperCase();
    const gec = generateSecMsGecV2(Date.now() / 1000 + clockSkewSeconds);
    const url =
      `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
      `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
      `&ConnectionId=${connId}` +
      `&Sec-MS-GEC=${gec}` +
      `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

    const ws = new WebSocket(url, {
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

    const audioChunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          ws.close();
        } catch {}
        reject(new Error(`Edge TTS timeout (${timeoutMs}ms)`));
      }
    }, timeoutMs);

    ws.on("unexpected-response", (_req, res) => {
      // Koreksi clock skew otomatis jika jam sistem selisih dari server Microsoft
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

      const reqId = crypto.randomBytes(16).toString("hex");
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='id-ID'>` +
        `<voice name='${voice}'>` +
        `<prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>` +
        `${escapedText}` +
        `</prosody>` +
        `</voice>` +
        `</speak>`;

      ws.send(
        `X-RequestId:${reqId}\r\n` +
          `Content-Type:application/ssml+xml\r\n` +
          `X-Timestamp:${timestamp}Z\r\n` +
          `Path:ssml\r\n\r\n` +
          `${ssml}`
      );
    });

    ws.on("message", (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
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
              ws.close();
            } catch {}
            resolve(Buffer.concat(audioChunks));
          }
        }
      }
    });

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
  const escapedText = cleanAndEscapeForSsml(text);
  if (!escapedText) {
    return Buffer.alloc(0);
  }

  try {
    return await trySynthesizeOnce(escapedText, options);
  } catch (firstErr) {
    console.warn("⚠️ Percobaan 1 Edge TTS gagal, mencoba ulang dengan koreksi clock-skew...", firstErr);
    // Coba sekali lagi dengan waktu yang sudah disesuaikan
    return await trySynthesizeOnce(escapedText, {
      ...options,
      timeoutMs: options.timeoutMs ? options.timeoutMs + 2000 : 12000,
    });
  }
}
