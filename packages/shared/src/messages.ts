/**
 * Standard user-facing messages & status texts for Celyn AI.
 * Free from third-party vendor names or leaking internal stack details.
 */

export const MESSAGES = {
  APP_NAME: "Celyn AI",
  VENDOR_BRAND: "Celyn AI",
  ERROR_GENERIC: "Terjadi kesalahan pada layanan Celyn. Silakan coba lagi.",

  // Document Protection & Format
  PASSWORD_REQUIRED:
    "File ini dilindungi password sehingga tidak dapat saya buka. Silakan masukkan password atau kirim versi tanpa password.",
  LEGACY_FORMAT:
    "Format biner lama (.doc/.xls) ini tidak dapat diproses secara langsung. Silakan buka file tersebut di aplikasi Office lalu 'Simpan Sebagai' format modern (.docx atau .xlsx).",
  INVALID_FILE_TYPE:
    "Tipe file tidak didukung atau isi file tidak valid. Celyn AI mendukung file PDF (.pdf), Word (.docx), dan Excel (.xlsx).",
  FILE_CORRUPTED:
    "File tidak dapat dibaca karena rusak atau tidak lengkap. Coba kirim ulang filenya ya.",

  // Operations
  NEEDS_TARGET_LANGUAGE:
    "Mau diterjemahkan ke bahasa apa? (Misalnya: Bahasa Inggris, Bahasa Jepang, Bahasa Mandarin, dll.)",
  PDF_LAYOUT_EDIT_UNSUPPORTED:
    "Format PDF dirancang sebagai tata letak tetap. Celyn dapat mengekstrak isinya, menyunting dan menyimpannya sebagai Word (.docx) yang rapi, atau membuat PDF ringkasan baru. Kamu ingin opsi yang mana?",

  // Background Processing & Research
  RESEARCH_STATUS_TEXT: "Tunggu sebentar ya, saya sedang research...",
  WORKING_STATUS_TEXT: "Sedang memproses dokumen di latar belakang...",
  JOB_STARTED: "Tugas sedang dikerjakan di latar belakang. Kamu tetap bisa lanjut ngobrol dengan Celyn!",
  JOB_COMPLETED: "Dokumen sudah selesai diproses dan siap diunduh!",
  JOB_FAILED: "Maaf, pemrosesan dokumen mengalami kendala. Silakan coba lagi.",

  // Connectivity & Auth
  AUTH_REQUIRED: "Akses ditolak: Kata sandi valid diperlukan untuk melanjutkan.",
  AUTH_INVALID: "Kata sandi salah. Silakan periksa kembali kata sandi kamu.",
  RATE_LIMITED: "Terlalu banyak permintaan dalam waktu singkat. Harap tunggu sebentar ya.",
  SERVICE_UNAVAILABLE: "Layanan Celyn sedang sibuk atau belum siap. Silakan coba sesaat lagi.",
  SESSION_ENDED: "Sesi percakapan Celyn telah berakhir.",
  SESSION_CONNECTING: "Menghubungkan Celyn...",
  SESSION_ERROR: "Koneksi Celyn bermasalah. Mencoba menyambungkan kembali...",
} as const;

export type MessageKey = keyof typeof MESSAGES;

export function getUserMessage(key: MessageKey, fallback?: string): string {
  return MESSAGES[key] || fallback || "Terjadi kesalahan pada layanan Celyn.";
}
