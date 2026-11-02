# Celyn AI Bot

Teman ngobrol visual AI interaktif cerdas yang bisa berbicara dua arah lewat suara langsung (*real-time voice*), berekspresi secara visual, membaca dan mengedit dokumen hingga 500 MB, serta mengingat preferensi dan riwayat obrolan secara otonom.

![Celyn AI](apps/web/public/celyn_avatar.png)

---

## Fitur Utama

- 🔍 **Riset Mendalam & Analisis Pakar (7 Ketentuan Emas)**:
  - **Peneliti Teliti & Komprehensif**: Melakukan riset topik menyeluruh berbasis data riil dengan persona pakar profesional senior secara otomatis.
  - **Pencarian Web Real-Time (Search Grounding & Sitasi)**: Mengumpulkan banyak sumber primer terpercaya dan menyertakan sitasi tautan sumber langsung.
  - **Visual & Matriks Data**: Dilengkapi tabel data komparatif, dinamika perkembangan harian, dan metrik kinerja sektor/saham saat diminta chart/grafik.
  - **Multi-Key Failover Pool**: Mendukung rotasi otomatis multi-kunci API (`GEMINI_API_KEYS`) untuk mencegah kegagalan batas kuota 429.

- 🎙️ **Real-Time Voice Streaming (24kHz HD Audio)**:
  - Berbincang dua arah secara langsung dengan latensi rendah layaknya telepon suara biasa.
  - Mendukung selaan alami (*real-time interruption handling*) kapan pun kamu mulai berbicara.
  - **100% Suara Perempuan Muda**: Dilengkapi 4 karakter vokal native HD (`Aoede`, `Zephyr`, `Leda`, `Kore`) dan cadangan Edge Neural (`id-ID-GadisNeural`). Seluruh opsi suara laki-laki diblokir mutlak oleh sistem sanitizer multi-layer.

- 🇮🇩 **100% Bahasa Indonesia (Kecuali Belajar Bahasa Lain)**:
  - Seluruh obrolan sehari-hari, pembahasan koding, sains, analisis layar, dan dokumen terkunci 100% dalam Bahasa Indonesia lisan yang luwes.
  - **Pengecualian Edukasi Bahasa**: Celyn siap menjadi teman belajar bahasa asing jika kamu secara eksplisit meminta diajari atau ingin berlatih percakapan (*conversation practice*, misal: *"Celyn, ajarin aku bahasa Inggris/Jepang dong"*).

- 📄 **Sistem Dokumen Cerdas (s.d 500 MB & Edit PDF In-Place)**:
  - **Dukungan Dokumen Raksasa hingga 500 MB**: Menggunakan *Client-Side In-Memory Engine* (Mozilla PDF.js) yang mengekstrak teks PDF langsung di memori peramban dalam 1–2 detik tanpa terhambat batas ukuran serverless atau CORS.
  - **Dual-Track Fallback**: File $\le$ 4.5 MB diproses dengan serverless Hybrid OCR Vision; file besar diproses instan di browser.
  - **Sapaan Proaktif Otomatis**: Begitu dokumen selesai diunggah, Celyn langsung menyapa, menyebut nama file, dan menawarkan bantuan (meringkas, menganalisis, menerjemahkan, atau mengedit).
  - **Edit PDF In-Place & Pratinjau Teks**: Celyn mampu merevisi atau memodifikasi dokumen PDF secara langsung dan menghasilkan file PDF baru. Pengguna juga dapat mempratinjau dan menyalin hasil Vision OCR secara instan di peramban.
  - **Ekspor Dokumen Baru**: Dapat menyusun dan mengunduh laporan PDF, Word (.docx), atau lembar kerja Excel (.xlsx) otomatis.

- 🎭 **Visual Avatar Interaktif (2.5D Canvas & 3D VRM)**:
  - Ekspresi wajah dan gerak bibir (*lip-sync*) responsif mengikuti emosi obrolan (senang, mikir, kaget, sedih, tersipu).
  - Transisi emosi alami dengan *auto-decay* kembali ke netral.

- 🧠 **Autonomous Long-Term Memory (Turso Cloud Database)**:
  - Otomatis merangkum preferensi, hobi, makanan kesukaan, jadwal, dan tugas penting ke database cloud (*summarize-before-store*).
  - *Smart Filter Anti-Soal Teknis*: Pertanyaan koding umum atau matematika langsung dijawab secara lisan tanpa mencemari memori profil pengguna.
  - *Universal Cross-Session Topic Recall*: Mengingat riwayat percakapan sesi sebelumnya saat ditanya kembali.

- 🖥️ **Screen Share & Visual Awareness**:
  - Celyn dapat melihat layarmu saat koding, browsing, atau mengerjakan tugas dengan algoritma deteksi perubahan piksel (*change detection*) yang hemat token.

- 🌐 **Arsitektur Fleksibel & Stateless Deployment**:
  - Berjalan mulus di server lokal (Node.js & WebSocket persisten port 3001) maupun cloud serverless (Vercel Ephemeral Token & Edge Network).

---

## Struktur Monorepo

Proyek ini dibangun menggunakan npm workspaces monorepo:

- **`apps/web`**: Frontend React 18, Vite, Tailwind CSS, Three.js (VRM 3D), Web Audio API (PCM Streamer), dan Client Document Reader.
- **`apps/server`**: Backend Node.js, WebSocket Server, Document Writer/Reader Service, Memory Service, dan Edge TTS Proxy.
- **`packages/shared`**: Modul bersama berisi aturan persona Celyn, sistem filter suara & emosi, skema Zod dokumen, dan logika autentikasi.
- **`api/`**: Serverless functions untuk deployment Vercel (`/api/token`, `/api/documents/read`, `/api/documents/generate`, `/api/health`, dll).
- **`scripts/`**: Suite pengujian otomatis komprehensif (`test-pipeline.ts`) mencakup 350+ skenario uji unit, integrasi, keamanan, dan paritas arsitektur.

---

## Panduan Menjalankan di Komputer Lokal

### 1. Kebutuhan Lingkungan
- **Node.js** versi 18 atau lebih baru
- **NPM** versi 9 atau lebih baru
- **API Key** (dapatkan dari portal Google AI Studio)
- *(Opsional)* URL Database Turso untuk memori jangka panjang

### 2. Pemasangan (Instalasi)
```bash
git clone https://github.com/cescrafli/Bot.git
cd Bot
npm install
```

### 3. Konfigurasi Lingkungan (`.env`)
Buat file `.env` di folder utama (root) proyek:

```env
# Kredensial AI Live & Multi-Key Failover Pool
GEMINI_API_KEY=isi_api_key_kamu_di_sini
GEMINI_API_KEYS=key_1_di_sini,key_2_di_sini
GEMINI_MODEL=gemini-3.8-live
GEMINI_VOICE=Aoede
RESEARCH_MODEL=gemini-3.8-flash
TEXT_MODEL=gemini-3.8-flash

# Database Turso Cloud (Penyimpanan memori otonom profil pengguna)
TURSO_DATABASE_URL=libsql://nama-database.turso.io
TURSO_AUTH_TOKEN=token_rahasia_turso

# Kata Sandi Sesi & Keamanan HMAC
ADMIN_PASSWORD=admin
USER_PASSWORD=login
AUTH_SECRET=rahasia_salt_32_karakter_di_sini

# Port Server Lokal
PORT=3001
```

### 4. Menjalankan Mode Pengembangan
```bash
npm run dev
```
Buka peramban dan akses antarmuka Celyn di **`http://localhost:5173`**.

---

## Perintah NPM

| Perintah | Deskripsi |
|---|---|
| `npm run dev` | Menjalankan frontend web dan backend server secara bersamaan |
| `npm run test:pipeline` | Menjalankan 350+ uji otomatis (audio, suara perempuan, prompt 100% ID, dokumen, memori, paritas, riset) |
| `npm run build` | Melakukan kompilasi produksi seluruh paket (TypeScript + Vite) |
| `npm run db:check` | Memeriksa tabel dan baris memori yang tersimpan di database |

---

## Lisensi
Hak Cipta © 2026 Rafli. Seluruh hak cipta dilindungi undang-undang.
