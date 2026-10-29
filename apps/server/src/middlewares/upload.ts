import http from "node:http";
import Busboy from "busboy";
import { validateDocumentMagicBytes } from "@celyn/shared";

export interface UploadedFile {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

/**
 * Parse multipart upload with streaming chunks and strict magic byte validation.
 * @param req Incoming HTTP request
 * @param maxBytes Max bytes allowed (0 = unlimited / no artificial cap)
 */
export async function parseMultipartUpload(
  req: http.IncomingMessage,
  maxBytes: number = 0
): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    let fileBuffer: Buffer | null = null;
    let fileName = "document";
    let fileMime = "application/octet-stream";
    let fileSize = 0;
    let limitExceeded = false;

    let bb: any;
    try {
      bb = Busboy({
        headers: req.headers,
        limits: {
          fileSize: maxBytes > 0 ? maxBytes : undefined,
          files: 1,
        },
      });
    } catch {
      return reject(new Error("INVALID_MULTIPART_HEADERS"));
    }

    bb.on("file", (_fieldname: string, fileStream: NodeJS.ReadableStream, info: any) => {
      fileName = info.filename || "document";
      fileMime = info.mimeType || "application/octet-stream";

      const chunks: Buffer[] = [];
      fileStream.on("data", (chunk: Buffer) => {
        fileSize += chunk.length;
        if (maxBytes > 0 && fileSize > maxBytes) {
          limitExceeded = true;
          fileStream.resume();
          return;
        }
        chunks.push(chunk);
      });

      fileStream.on("limit", () => {
        limitExceeded = true;
      });

      fileStream.on("end", () => {
        if (!limitExceeded) {
          fileBuffer = Buffer.concat(chunks);
        }
      });
    });

    bb.on("finish", async () => {
      if (limitExceeded) {
        return reject(new Error("FILE_TOO_LARGE"));
      }
      if (!fileBuffer || fileBuffer.length === 0) {
        return reject(new Error("NO_FILE_UPLOADED"));
      }

      // Validasi Magic Bytes secara ketat dari 8 KB pertama
      const head = fileBuffer.subarray(0, Math.min(fileBuffer.length, 8192));
      const validation = validateDocumentMagicBytes(head, fileName);

      if (!validation.valid) {
        return reject(new Error("INVALID_FILE_TYPE"));
      }

      const finalMime = validation.detectedMime || fileMime;
      resolve({
        buffer: fileBuffer,
        fileName,
        mimeType: finalMime,
      });
    });

    bb.on("error", (err: any) => {
      reject(err);
    });

    req.pipe(bb);
  });
}
