import http from "node:http";
import Busboy from "busboy";
import { fileTypeFromBuffer } from "file-type";

export interface UploadedFile {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

export async function parseMultipartUpload(
  req: http.IncomingMessage,
  maxBytes: number = 4 * 1024 * 1024
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
          fileSize: maxBytes,
          files: 1,
        },
      });
    } catch (e) {
      return reject(new Error("INVALID_MULTIPART_HEADERS"));
    }

    bb.on("file", (_fieldname: string, fileStream: NodeJS.ReadableStream, info: any) => {
      fileName = info.filename || "document";
      fileMime = info.mimeType || "application/octet-stream";

      const chunks: Buffer[] = [];
      fileStream.on("data", (chunk: Buffer) => {
        fileSize += chunk.length;
        if (fileSize > maxBytes) {
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

      const lowerName = fileName.toLowerCase();
      const isPdfExt = lowerName.endsWith(".pdf");
      const isExcelExt = lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls");
      const isWordExt = lowerName.endsWith(".docx") || lowerName.endsWith(".doc");

      if (!isPdfExt && !isExcelExt && !isWordExt) {
        return reject(new Error("INVALID_FILE_TYPE"));
      }

      // Validasi Magic Bytes
      const detected = await fileTypeFromBuffer(fileBuffer);
      const ALLOWED_MIMES = [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/zip", // DOCX dan XLSX berbasis kontainer ZIP
        "application/x-cfb", // Format legacy binary XLS / DOC
      ];

      // Jika terdeteksi tipe biner berbahaya (seperti exe, dll)
      if (detected && !ALLOWED_MIMES.includes(detected.mime)) {
        return reject(new Error("INVALID_FILE_TYPE"));
      }

      const finalMime = detected?.mime || fileMime;
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
