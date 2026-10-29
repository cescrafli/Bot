/**
 * Document Security & Protection Detection
 * Strict magic byte verification & password detection for PDF, Word, and Excel.
 * Completely isomorphic & browser-safe (pure Uint8Array without bare Node Buffer).
 */

// Magic byte signatures using standard Uint8Array
const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // PK.. (ZIP / OOXML)
const CFB_MAGIC = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // Compound File Binary (Encrypted OOXML or legacy binary)

function matchesPrefix(data: Uint8Array, prefix: Uint8Array): boolean {
  if (!data || data.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (data[i] !== prefix[i]) return false;
  }
  return true;
}

function findSequence(data: Uint8Array, seq: Uint8Array, maxOffset = 1024): number {
  if (!data || data.length < seq.length) return -1;
  const limit = Math.min(data.length - seq.length, maxOffset);
  for (let i = 0; i <= limit; i++) {
    let match = true;
    for (let j = 0; j < seq.length; j++) {
      if (data[i + j] !== seq[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

export type SupportedDocKind = "pdf" | "docx" | "xlsx" | "xlsm" | "xlsb" | "xls" | "doc" | "docm" | "dotx" | "csv" | "tsv" | "txt" | "md" | "rtf";
export type ProtectionKind = "none" | "pdf-password" | "ooxml-encrypted" | "legacy-binary";

export interface MagicByteValidationResult {
  valid: boolean;
  kind: "pdf" | "docx" | "xlsx" | "xlsm" | "xlsb" | "xls" | "doc" | "docm" | "dotx" | "csv" | "tsv" | "txt" | "md" | "rtf" | "cfb" | "unknown";
  detectedMime?: string;
  error?: string;
}

export interface ProtectionResult {
  isProtected: boolean;
  kind: ProtectionKind;
  userMessage?: string;
}

export const PASSWORD_REQUIRED_MESSAGE =
  "File ini dilindungi password sehingga tidak dapat saya buka. Silakan masukkan password atau kirim versi tanpa password.";

export const LEGACY_FORMAT_MESSAGE =
  "Format biner lama (.doc/.xls) ini tidak dapat diproses secara langsung. Silakan buka file tersebut di aplikasi Office lalu 'Simpan Sebagai' format modern (.docx atau .xlsx).";

// Text extensions that require no magic-byte check (just null-byte validation)
const TEXT_EXTS = new Set(["csv", "tsv", "txt", "md", "rtf"]);
// OOXML ZIP-container extensions (macro-enabled and template variants are still ZIP)
const OOXML_EXTS = new Set(["docx", "xlsx", "xlsm", "xlsb", "docm", "dotx"]);
// Legacy CFB binary extensions that are parsed by word-extractor / XLSX
const CFB_EXTS = new Set(["doc", "xls"]);

function hasNullBytes(data: Uint8Array, checkLen = 512): boolean {
  const end = Math.min(data.length, checkLen);
  for (let i = 0; i < end; i++) {
    if (data[i] === 0x00) return true;
  }
  return false;
}

/**
 * Validates document magic bytes strictly against its extension
 * Rejects disguised scripts, executables, or corrupted files with certainty.
 */
export function validateDocumentMagicBytes(head: Uint8Array, fileName: string): MagicByteValidationResult {
  if (!head || head.length < 4) {
    return {
      valid: false,
      kind: "unknown",
      error: "File terlalu kecil atau kosong untuk divalidasi.",
    };
  }

  const lowerName = fileName.toLowerCase();
  const ext = lowerName.split(".").pop() || "";

  // 1. PDF Check
  if (ext === "pdf") {
    const pdfIndex = findSequence(head, PDF_MAGIC, 1024);
    if (pdfIndex !== -1) {
      return { valid: true, kind: "pdf", detectedMime: "application/pdf" };
    }
    return {
      valid: false,
      kind: "unknown",
      error: "Header file tidak sesuai dengan format standar PDF valid (%PDF-).",
    };
  }

  // 2. OOXML family (ZIP container): docx, xlsx, xlsm, xlsb, docm, dotx
  if (OOXML_EXTS.has(ext)) {
    if (matchesPrefix(head, ZIP_MAGIC)) {
      const isWordFamily = ext === "docx" || ext === "docm" || ext === "dotx";
      return {
        valid: true,
        kind: ext as MagicByteValidationResult["kind"],
        detectedMime: isWordFamily
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
    }
    // Encrypted OOXML wrapped in CFB
    if (matchesPrefix(head, CFB_MAGIC)) {
      return { valid: true, kind: "cfb", detectedMime: "application/x-cfb" };
    }
    return {
      valid: false,
      kind: "unknown",
      error: `File .${ext} bukan arsip Office OpenXML yang valid (Magic header tidak cocok).`,
    };
  }

  // 3. Legacy CFB binary: doc, xls — now supported via word-extractor / SheetJS
  if (CFB_EXTS.has(ext)) {
    if (matchesPrefix(head, CFB_MAGIC)) {
      return {
        valid: true,
        kind: ext as MagicByteValidationResult["kind"],
        detectedMime: "application/x-cfb",
      };
    }
    return {
      valid: false,
      kind: "unknown",
      error: `File .${ext} bukan format biner Office yang valid.`,
    };
  }

  // 4. Plaintext / delimited: csv, tsv, txt, md, rtf
  if (TEXT_EXTS.has(ext)) {
    if (hasNullBytes(head)) {
      return {
        valid: false,
        kind: "unknown",
        error: "File teks mengandung byte null — kemungkinan file biner yang salah ekstensi.",
      };
    }
    return {
      valid: true,
      kind: ext as MagicByteValidationResult["kind"],
      detectedMime: "text/plain",
    };
  }

  return {
    valid: false,
    kind: "unknown",
    error: `Ekstensi .${ext} tidak didukung. Celyn AI mendukung: PDF, Excel (.xlsx, .xls, .xlsm, .xlsb, .csv), Word (.docx, .doc), dan Teks (.txt, .md, .rtf).`,
  };
}

/**
 * Detects whether a document is encrypted / password protected without attempting brute force.
 */
export async function detectDocumentProtection(
  buffer: Uint8Array,
  fileName: string
): Promise<ProtectionResult> {
  const lowerName = fileName.toLowerCase();
  const ext = lowerName.split(".").pop() || "";
  const head = buffer.subarray(0, Math.min(buffer.length, 8192));

  // Check CFB header
  const isCfb = matchesPrefix(head, CFB_MAGIC);

  if ((ext === "docx" || ext === "xlsx") && isCfb) {
    // An OOXML document with CFB container is an EncryptedPackage
    return {
      isProtected: true,
      kind: "ooxml-encrypted",
      userMessage: PASSWORD_REQUIRED_MESSAGE,
    };
  }

  if ((ext === "doc" || ext === "xls") && isCfb) {
    // Legacy CFB binary — now parseable by word-extractor / SheetJS; only treat as protected
    // if the CFB contains an EncryptedPackage stream (i.e. it was password-protected legacy Office)
    // For simplicity, pass through — the parser will throw if truly encrypted.
    return {
      isProtected: false,
      kind: "none",
    };
  }

  if (ext === "pdf") {
    // Check for PDF password protection:
    // A) Fast heuristic: search for /Encrypt dictionary
    const slice = buffer.subarray(0, Math.min(buffer.length, 65536));
    let rawStr = "";
    for (let i = 0; i < slice.length; i++) {
      rawStr += String.fromCharCode(slice[i]);
    }
    if (/\/Encrypt[\s<0-9]/i.test(rawStr)) {
      return {
        isProtected: true,
        kind: "pdf-password",
        userMessage: PASSWORD_REQUIRED_MESSAGE,
      };
    }

    try {
      const { getDocumentProxy } = await import("unpdf");
      await getDocumentProxy(new Uint8Array(buffer));
    } catch (err: any) {
      const errMsg = String(err?.message || err?.name || "").toLowerCase();
      if (
        err?.name === "PasswordException" ||
        errMsg.includes("password") ||
        errMsg.includes("encrypted") ||
        errMsg.includes("need a password")
      ) {
        return {
          isProtected: true,
          kind: "pdf-password",
          userMessage: PASSWORD_REQUIRED_MESSAGE,
        };
      }
      // If it's another error, pass through or throw
    }
  }

  return {
    isProtected: false,
    kind: "none",
  };
}

