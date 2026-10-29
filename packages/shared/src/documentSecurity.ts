/**
 * Document Security & Protection Detection
 * Strict magic byte verification & password detection for PDF, Word, and Excel.
 */

// Magic byte signatures
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK.. (ZIP / OOXML)
const CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // Compound File Binary (Encrypted OOXML or legacy binary)

export type SupportedDocKind = "pdf" | "docx" | "xlsx";
export type ProtectionKind = "none" | "pdf-password" | "ooxml-encrypted" | "legacy-binary";

export interface MagicByteValidationResult {
  valid: boolean;
  kind: "pdf" | "docx" | "xlsx" | "cfb" | "unknown";
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

/**
 * Validates document magic bytes strictly against its extension
 * Rejects disguised scripts, executables, or corrupted files with certainty.
 */
export function validateDocumentMagicBytes(head: Buffer, fileName: string): MagicByteValidationResult {
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
    // PDF must start with %PDF- within the first 1024 bytes (typically offset 0)
    const pdfIndex = head.indexOf(PDF_MAGIC);
    if (pdfIndex !== -1 && pdfIndex <= 1024) {
      return { valid: true, kind: "pdf", detectedMime: "application/pdf" };
    }
    return {
      valid: false,
      kind: "unknown",
      error: "Header file tidak sesuai dengan format standar PDF valid (%PDF-).",
    };
  }

  // 2. OOXML (DOCX, XLSX) Check
  if (ext === "docx" || ext === "xlsx") {
    // Case A: Standard unencrypted OOXML is a ZIP archive (starts with PK\x03\x04)
    if (head.subarray(0, 4).equals(ZIP_MAGIC)) {
      return {
        valid: true,
        kind: ext as "docx" | "xlsx",
        detectedMime:
          ext === "docx"
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
    }

    // Case B: Password-protected/encrypted OOXML is wrapped in a CFB (Compound File Binary) container!
    if (head.length >= 8 && head.subarray(0, 8).equals(CFB_MAGIC)) {
      return {
        valid: true,
        kind: "cfb",
        detectedMime: "application/x-cfb",
      };
    }

    return {
      valid: false,
      kind: "unknown",
      error: `File .${ext} bukan arsip Office OpenXML yang valid (Magic header tidak cocok).`,
    };
  }

  // 3. Legacy extensions (.doc, .xls)
  if (ext === "doc" || ext === "xls") {
    if (head.length >= 8 && head.subarray(0, 8).equals(CFB_MAGIC)) {
      return {
        valid: true,
        kind: "cfb",
        detectedMime: "application/x-cfb",
      };
    }
    return {
      valid: false,
      kind: "unknown",
      error: `File .${ext} bukan format biner Office yang valid.`,
    };
  }

  return {
    valid: false,
    kind: "unknown",
    error: `Ekstensi .${ext} tidak didukung. Celyn AI hanya mendukung PDF (.pdf), Excel (.xlsx), dan Word (.docx).`,
  };
}

/**
 * Detects whether a document is encrypted / password protected without attempting brute force.
 */
export async function detectDocumentProtection(
  buffer: Buffer,
  fileName: string
): Promise<ProtectionResult> {
  const lowerName = fileName.toLowerCase();
  const ext = lowerName.split(".").pop() || "";
  const head = buffer.subarray(0, Math.min(buffer.length, 8192));

  // Check CFB header
  const isCfb = head.length >= 8 && head.subarray(0, 8).equals(CFB_MAGIC);

  if ((ext === "docx" || ext === "xlsx") && isCfb) {
    // An OOXML document with CFB container is an EncryptedPackage
    return {
      isProtected: true,
      kind: "ooxml-encrypted",
      userMessage: PASSWORD_REQUIRED_MESSAGE,
    };
  }

  if ((ext === "doc" || ext === "xls") && isCfb) {
    return {
      isProtected: true,
      kind: "legacy-binary",
      userMessage: LEGACY_FORMAT_MESSAGE,
    };
  }

  if (ext === "pdf") {
    // Check for PDF password protection:
    // A) Fast heuristic: search for /Encrypt dictionary
    const rawStr = buffer.subarray(0, Math.min(buffer.length, 65536)).toString("latin1");
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
