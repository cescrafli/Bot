import crypto from "node:crypto";
import { WebSocket } from "ws";

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR_VERSION = "143";
const SEC_MS_GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`;
const WIN_EPOCH = 11644473600;
const DEFAULT_VOICE = "id-ID-GadisNeural";

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];
const SHA256_STATE = [
  0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a,
  0x6c006f49, 0x04bd35ab, 0xfeb0a7e4, 0x03effbd2,
];
const SHA256_SCHEDULE = [
  0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0x0cfa32ba,
  0xa622ee8c, 0xd1dd9491, 0xc0dd25a0, 0xf9e70ab6,
  0xf0c31573, 0x7058ce4e, 0x7188e606, 0x00e5ab33,
  0xd258b060, 0x72766564,
];
const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const SHA256_ADJUSTMENT = 0xc9dc06a7;
const SHA256_BLOCK_CONSTANTS = [
  ...SHA256_ROUND_CONSTANTS.slice(0, 14),
  SHA256_ADJUSTMENT,
  ...SHA256_ROUND_CONSTANTS.slice(15),
];
const SHA256_SIGMA0_ADJUSTMENT = 0x059c0b80;
const SHA256_SIGMA1_ADJUSTMENT = 0x000b92c0;

const CS64_COEFFICIENTS = [
  [0xe82e91b1, 0xb32700d0],
  [0x44de24c6, 0x88dff51d],
  [0x3beb65bc, 0x29514038],
  [0xc89c5933, 0xb328cbdf],
  [0x8d1ec211, 0xd405b4d5],
  [0x314ef5d5, 0x26e55f3c],
  [0xe92491b1, 0x607801c6],
  [0xf0a5b9d5, 0x82b2c1fb],
  [0x06064cf3, 0xfa51a3da],
  [0xda79fa60, 0x207cc464],
  [0xbed20560, 0x3c3c74f3],
  [0x89f9c9f8, 0xd2d14b61],
  [0x35fa38c6, 0xbb04a2c1],
  [0xcb49e3c6, 0xc5626167],
];
const CS64_FACTOR = 0x82893933;
const CS64_ADJUSTMENT0 = 0xf2f90b1a;
const CS64_ADJUSTMENT1 = 0x0b1a0000;

let clockSkewSeconds = 0;

function rotr(val, n) {
  return ((val >>> n) | (val << (32 - n))) >>> 0;
}
function rol16(val) {
  return ((val << 16) | (val >>> 16)) >>> 0;
}
function sigma0(val) {
  return (rotr(val, 7) ^ rotr(val, 18) ^ (val >>> 3)) >>> 0;
}
function sigma1(val) {
  return (rotr(val, 17) ^ rotr(val, 19) ^ (val >>> 10)) >>> 0;
}

function sha256Rounds(state, words, firstRound = 0) {
  let [a, b, c, d, e, f, g, h] = state;
  const constants = firstRound === 14 ? SHA256_BLOCK_CONSTANTS : SHA256_ROUND_CONSTANTS;
  for (let i = firstRound; i < 64; i++) {
    const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
    const ch = (g ^ (e & (f ^ g))) >>> 0;
    const t1 = (h + s1 + ch + constants[i] + words[i]) >>> 0;
    const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
    const maj = ((a & b) | (c & (a | b))) >>> 0;
    const t2 = (s0 + maj) >>> 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) >>> 0;
  }
  return [a, b, c, d, e, f, g, h];
}

function expandSchedule(words, firstWord = 16) {
  for (let i = firstWord; i < 64; i++) {
    const s1 = sigma1(words[i - 2]);
    const s0 = sigma0(words[i - 15]);
    words.push((s1 + words[i - 7] + s0 + words[i - 16]) >>> 0);
  }
}

function sha256Init(data7) {
  const words = new Array(14).fill(0);
  words.push(((data7[0] << 16) | (data7[1] << 8) | data7[2]) >>> 0);
  words.push(data7.readUInt32BE(3));
  for (let i = 16; i < 30; i++) {
    let val = SHA256_SCHEDULE[i - 16];
    if (i - 2 >= 14) {
      val = (val + (i === 16 ? (sigma1(words[i - 2]) ^ SHA256_SIGMA1_ADJUSTMENT) : sigma1(words[i - 2]))) >>> 0;
    }
    if (i - 7 >= 14) {
      val = (val + words[i - 7]) >>> 0;
    }
    if (i - 15 >= 14) {
      val = (val + (i === 29 ? (sigma0(words[i - 15]) ^ SHA256_SIGMA0_ADJUSTMENT) : sigma0(words[i - 15]))) >>> 0;
    }
    words.push(val >>> 0);
  }
  words.push(
    (sigma1(words[28]) + words[23] + sigma0(words[15]) + words[14] + SHA256_ADJUSTMENT - SHA256_ROUND_CONSTANTS[14]) >>> 0
  );
  expandSchedule(words, 31);
  const working = sha256Rounds(SHA256_STATE, words, 14);
  return SHA256_INITIAL.map((x, idx) => (x + working[idx]) >>> 0);
}

function sha256Digest(data) {
  const length = 57 + data.length;
  const padZeroLen = (55 - (length % 64) + 64) % 64;
  const tail = data.subarray(7);
  const padded = Buffer.alloc(tail.length + 1 + padZeroLen + 8);
  tail.copy(padded, 0);
  padded[tail.length] = 0x80;
  padded.writeBigUInt64BE(BigInt(length * 8), padded.length - 8);

  let state = sha256Init(data.subarray(0, 7));
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = [];
    for (let j = 0; j < 16; j++) {
      words.push(padded.readUInt32BE(offset + j * 4));
    }
    expandSchedule(words, 16);
    const working = sha256Rounds(state, words, 0);
    state = state.map((x, idx) => (x + working[idx]) >>> 0);
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 8; i++) out.writeUInt32BE(state[i], i * 4);
  return out;
}

function wordsLe4Even(data) {
  const rem = (4 - (data.length % 4)) % 4;
  const padded = rem ? Buffer.concat([data, Buffer.alloc(rem)]) : data;
  const words = [];
  for (let i = 0; i < padded.length; i += 4) {
    words.push(padded.readUInt32LE(i));
  }
  if (words.length % 2 !== 0) words.push(0);
  return words;
}

function cs64Digest(data, digest) {
  const keyA = (digest.readUInt32LE(0) | 1) >>> 0;
  const keyB = (digest.readUInt32LE(4) | 1) >>> 0;
  const factors = [
    Math.imul(keyA, CS64_FACTOR) >>> 0,
    Math.imul(keyB, CS64_FACTOR) >>> 0,
  ];
  const terms = CS64_COEFFICIENTS.map(([c], i) => Math.imul(c, factors[i % 2]) >>> 0);
  const offsets = CS64_COEFFICIENTS.map(([, o]) => o >>> 0);

  const words = wordsLe4Even(Buffer.concat([Buffer.from([0]), data]));
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    let term = Math.imul(word, i % 2 === 0 ? keyA : keyB) >>> 0;
    let offset = Math.imul(rol16(word), i % 2 === 0 ? 0xef0569fb : 0xc31713db) >>> 0;
    if (i === 0) {
      term = (term + Math.imul(CS64_ADJUSTMENT0, factors[0])) >>> 0;
      offset = (offset + CS64_ADJUSTMENT1) >>> 0;
    }
    terms.push(term);
    offsets.push(offset);
  }

  let swapAcc = 0, swapLast = 0, state = 0, acc = 0;
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i], y = terms[i + 1];
    let t = rol16((offsets[i] + x) >>> 0);
    let q = Math.imul(t, 0x76f50f34) >>> 0;
    swapAcc = (swapAcc + ((Math.imul(rol16(q), 0xc3efea97) + q) >>> 0)) >>> 0;

    t = rol16((offsets[i + 1] + y) >>> 0);
    q = Math.imul(t, 0x1881ce3c) >>> 0;
    swapLast = (Math.imul(rol16(q), 0x35bd1ec9) + q) >>> 0;
    swapAcc = (swapAcc + swapLast) >>> 0;

    state = (Math.imul(state, keyA) + x) >>> 0;
    state = Math.imul(rol16(state), 0xcf98b111) >>> 0;
    state = Math.imul(rol16(state), 0x87085b9f) >>> 0;
    state = Math.imul(rol16(state), 0x12ceb96d) >>> 0;
    state = Math.imul(rol16(state), 0x257e1d83) >>> 0;
    acc = (acc + state) >>> 0;

    t = (Math.imul(state, keyB) + y) >>> 0;
    t = Math.imul(rol16(t), 0xa27416f5) >>> 0;
    t = Math.imul(rol16(t), 0xd38396ff) >>> 0;
    state = Math.imul(rol16(Math.imul(rol16(t), 0x7c932b89) >>> 0), 0xbfa49f69) >>> 0;
    acc = (acc + state) >>> 0;
  }
  const out = Buffer.alloc(8);
  out.writeUInt32LE((swapLast ^ state) >>> 0, 0);
  out.writeUInt32LE((swapAcc ^ acc) >>> 0, 4);
  return out.toString("hex").toUpperCase();
}

function generateSecMsGecV2() {
  let ticks = Math.floor(Date.now() / 1000 + clockSkewSeconds) + WIN_EPOCH;
  ticks -= ticks % 300;
  ticks *= 1e7;
  const data = Buffer.from(`${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`, "ascii");
  const digest = sha256Digest(data);
  const cs64 = cs64Digest(data, digest);
  return `${cs64}-${digest.toString("hex").toUpperCase()}`;
}

function cleanAndEscapeForSsml(rawText) {
  const cleaned = String(rawText || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`+/g, "")
    .replace(/[*_#~]+/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function synthesizeEdgeTTS(text, voice = DEFAULT_VOICE) {
  const escapedText = cleanAndEscapeForSsml(text);
  if (!escapedText) return Promise.resolve(Buffer.alloc(0));

  return new Promise((resolve, reject) => {
    const connId = crypto.randomBytes(16).toString("hex");
    const muid = crypto.randomBytes(16).toString("hex").toUpperCase();
    const gec = generateSecMsGecV2();
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

    const audioChunks = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          ws.close();
        } catch {}
        reject(new Error("Edge TTS timeout"));
      }
    }, 12000);

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
        reject(new Error(`Edge TTS HTTP ${res.statusCode}`));
      }
    });

    ws.on("open", () => {
      const timestamp = new Date().toUTCString();
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
        `<prosody pitch='+0Hz' rate='+0%' volume='+0%'>` +
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

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (buf.length < 2) return;
        const headerLen = buf.readUInt16BE(0);
        const headerStr = buf.subarray(2, 2 + headerLen).toString("utf-8");
        if (headerStr.includes("Path:audio")) {
          const audioData = buf.subarray(2 + headerLen);
          if (audioData.length > 0) audioChunks.push(audioData);
        }
      } else if (data.toString().includes("Path:turn.end")) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          try {
            ws.close();
          } catch {}
          resolve(Buffer.concat(audioChunks));
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
          reject(new Error("Edge TTS closed without audio"));
        }
      }
    });
  });
}

/**
 * Vercel Serverless Function: POST / GET /api/tts
 * Menyintesis kalimat Bahasa Indonesia menjadi suara Microsoft Edge Neural (id-ID-GadisNeural).
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  let text = "";
  let voice = DEFAULT_VOICE;

  if (req.method === "GET") {
    text = req.query?.text || "";
    voice = req.query?.voice || DEFAULT_VOICE;
  } else if (req.method === "POST") {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    text = body.text || "";
    voice = body.voice || DEFAULT_VOICE;
  } else {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: "Parameter 'text' wajib diisi." });
  }

  try {
    const mp3Buffer = await synthesizeEdgeTTS(String(text).slice(0, 1500), voice);
    return res.status(200).json({
      audio: mp3Buffer.toString("base64"),
      mimeType: "audio/mp3",
      voice,
    });
  } catch (err) {
    console.error("[Vercel API /api/tts] Error:", err);
    return res.status(500).json({
      error: `Gagal menyintesis suara ${voice}: ${err?.message || "Unknown error"}`,
    });
  }
}
