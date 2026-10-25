import { DEFAULT_VOICE_NAME } from "./avatar.js";

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR_VERSION = "143";
export const SEC_MS_GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`;
const WIN_EPOCH = 11644473600;

export { TRUSTED_CLIENT_TOKEN, CHROMIUM_MAJOR_VERSION };

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

const CS64_COEFFICIENTS: Array<[number, number]> = [
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

function rotr(val: number, n: number): number {
  return ((val >>> n) | (val << (32 - n))) >>> 0;
}

function rol16(val: number): number {
  return ((val << 16) | (val >>> 16)) >>> 0;
}

function sigma0(val: number): number {
  return (rotr(val, 7) ^ rotr(val, 18) ^ (val >>> 3)) >>> 0;
}

function sigma1(val: number): number {
  return (rotr(val, 17) ^ rotr(val, 19) ^ (val >>> 10)) >>> 0;
}

function sha256Rounds(state: number[], words: number[], firstRound = 0): number[] {
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

function expandSchedule(words: number[], firstWord = 16): void {
  for (let i = firstWord; i < 64; i++) {
    const s1 = sigma1(words[i - 2]);
    const s0 = sigma0(words[i - 15]);
    words.push((s1 + words[i - 7] + s0 + words[i - 16]) >>> 0);
  }
}

function sha256Init(data7: Uint8Array): number[] {
  const words = new Array<number>(14).fill(0);
  words.push(((data7[0] << 16) | (data7[1] << 8) | data7[2]) >>> 0);
  words.push(
    ((data7[3] << 24) | (data7[4] << 16) | (data7[5] << 8) | data7[6]) >>> 0
  );
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

function sha256Digest(data: Uint8Array): Uint8Array {
  const length = 57 + data.length;
  const padZeroLen = (55 - (length % 64) + 64) % 64;
  const tail = data.subarray(7);
  const padded = new Uint8Array(tail.length + 1 + padZeroLen + 8);
  padded.set(tail, 0);
  padded[tail.length] = 0x80;

  const bitLength = BigInt(length * 8);
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  view.setBigUint64(padded.length - 8, bitLength, false);

  let state = sha256Init(data.subarray(0, 7));
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words: number[] = [];
    for (let j = 0; j < 16; j++) {
      words.push(view.getUint32(offset + j * 4, false));
    }
    expandSchedule(words, 16);
    const working = sha256Rounds(state, words, 0);
    state = state.map((x, idx) => (x + working[idx]) >>> 0);
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let i = 0; i < 8; i++) {
    outView.setUint32(i * 4, state[i], false);
  }
  return out;
}

function wordsLe4Even(data: Uint8Array): number[] {
  const rem = (4 - (data.length % 4)) % 4;
  let padded = data;
  if (rem) {
    padded = new Uint8Array(data.length + rem);
    padded.set(data, 0);
  }
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  const words: number[] = [];
  for (let i = 0; i < padded.length; i += 4) {
    words.push(view.getUint32(i, true));
  }
  if (words.length % 2 !== 0) words.push(0);
  return words;
}

function uint8ToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex.toUpperCase();
}

function cs64Digest(data: Uint8Array, digest: Uint8Array): string {
  const digestView = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
  const keyA = (digestView.getUint32(0, true) | 1) >>> 0;
  const keyB = (digestView.getUint32(4, true) | 1) >>> 0;
  const factors = [
    Math.imul(keyA, CS64_FACTOR) >>> 0,
    Math.imul(keyB, CS64_FACTOR) >>> 0,
  ];
  const terms = CS64_COEFFICIENTS.map(([c], i) => Math.imul(c, factors[i % 2]) >>> 0);
  const offsets = CS64_COEFFICIENTS.map(([, o]) => o >>> 0);

  const prefixed = new Uint8Array(data.length + 1);
  prefixed[0] = 0;
  prefixed.set(data, 1);
  const words = wordsLe4Even(prefixed);

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

  let swapAcc = 0;
  let swapLast = 0;
  let state = 0;
  let acc = 0;
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i];
    const y = terms[i + 1];
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
  const out = new Uint8Array(8);
  const outView = new DataView(out.buffer, out.byteOffset, out.byteLength);
  outView.setUint32(0, (swapLast ^ state) >>> 0, true);
  outView.setUint32(4, (swapAcc ^ acc) >>> 0, true);
  return uint8ToHex(out);
}

export function generateSecMsGecV2(unixSeconds?: number): string {
  const nowSec = unixSeconds ?? Date.now() / 1000;
  let ticks = Math.floor(nowSec) + WIN_EPOCH;
  ticks -= ticks % 300;
  ticks *= 1e7;
  const str = `${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`;
  const data = new TextEncoder().encode(str);
  const digest = sha256Digest(data);
  const cs64 = cs64Digest(data, digest);
  return `${cs64}-${uint8ToHex(digest)}`;
}

/**
 * Membersihkan teks dari simbol formatting markdown & karakter kontrol,
 * lalu meng-escape entitas XML untuk SSML Microsoft Edge ReadAloud.
 */
export function cleanAndEscapeForSsml(rawText: string): string {
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

/**
 * Pemecah kalimat Bahasa Indonesia cerdas untuk streaming TTS:
 * - Anti-potong angka berformat desimal / ribuan (mis. "Rp 10.000", "versi 2.0")
 * - Anti-potong singkatan umum Indonesia (dll., dsb., dst., mis., no., rp., dr., prof., hlm.)
 * - Clause splitting pada koma/titik-koma jika klausa > 120 karakter
 */
export function extractIndonesianSentences(
  buffer: string,
  forceAll: boolean
): { sentences: string[]; remaining: string } {
  let text = buffer;
  const sentences: string[] = [];

  const ABBREVIATIONS = [
    "dll", "dsb", "dst", "mis", "hlm", "no", "dr", "prof", "rp", "thn", "bln", "jl",
  ];

  while (text.length > 0) {
    let splitIdx = -1;
    let matchLen = 0;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      // Periksa titik akhir kalimat, tanda seru, tanda tanya, atau newline
      if (char === "." || char === "!" || char === "?" || char === "\n") {
        if (char === ".") {
          // 1. Abaikan jika diapit angka (mis. "10.000" atau "2.5")
          const prevChar = i > 0 ? text[i - 1] : "";
          const nextChar = i + 1 < text.length ? text[i + 1] : "";
          if (/\d/.test(prevChar) && /\d/.test(nextChar)) {
            continue;
          }

          // 2. Abaikan jika didahului singkatan umum Indonesia (mis. "dll.")
          const beforePeriod = text.slice(Math.max(0, i - 6), i).toLowerCase();
          const isAbbr = ABBREVIATIONS.some((abbr) => {
            const regex = new RegExp(`(?:^|\\s)${abbr}$`, "i");
            return regex.test(beforePeriod);
          });
          if (isAbbr) {
            continue;
          }
        }

        // Tanda baca akhir kalimat yang valid
        if (char === "\n") {
          splitIdx = i;
          matchLen = 1;
          break;
        }

        // Kumpulkan tanda baca beruntun (mis. "?!" atau "...")
        let punctEnd = i + 1;
        while (
          punctEnd < text.length &&
          (text[punctEnd] === "." || text[punctEnd] === "!" || text[punctEnd] === "?")
        ) {
          punctEnd++;
        }

        // Saat streaming (forceAll=false), kita wajib menunggu spasi setelah tanda baca
        if (!forceAll) {
          if (punctEnd < text.length && /\s/.test(text[punctEnd])) {
            splitIdx = i;
            matchLen = punctEnd - i;
            break;
          }
        } else {
          splitIdx = i;
          matchLen = punctEnd - i;
          break;
        }
      }
    }

    // Jika buffer sangat panjang (> 120 char) saat streaming dan belum ada titik,
    // pecah secara halus pada koma atau titik-koma yang diikuti spasi
    if (splitIdx === -1 && text.length > 120) {
      for (let i = 80; i < text.length - 20; i++) {
        if ((text[i] === "," || text[i] === ";") && /\s/.test(text[i + 1])) {
          splitIdx = i;
          matchLen = 1;
          break;
        }
      }
    }

    if (splitIdx !== -1) {
      const sentence = text.slice(0, splitIdx + matchLen).trim();
      text = text.slice(splitIdx + matchLen).trimStart();
      if (sentence.length > 0) {
        sentences.push(sentence);
      }
    } else {
      break;
    }
  }

  if (forceAll) {
    const lastRemaining = text.trim();
    if (lastRemaining.length > 0) {
      sentences.push(lastRemaining);
    }
    text = "";
  }

  return { sentences, remaining: text };
}
