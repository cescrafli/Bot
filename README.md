# Celyn AI Bot

Teman ngobrol visual AI interaktif yang bisa berbicara dua arah lewat suara langsung (real-time voice), berekspresi secara visual, serta mengingat obrolan dan preferensimu secara mandiri.

![Celyn AI](apps/web/public/celyn_avatar.png)

---

## Fitur Utama

- 🎙️ **Real-Time Voice Streaming**: Ngobrol dua arah dengan latensi rendah layaknya telepon biasa. Mendukung selaan langsung (interruption handling) kapan pun kamu mulai bicara.
- 🎭 **Visual Avatar (2.5D Canvas & 3D VRM)**: Ekspresi wajah dan gerak bibir (lip-sync) responsif mengikuti emosi obrolan (senang, mikir, kaget, sedih, tersipu).
- 🧠 **Smart Autonomous Memory (Turso Cloud)**:
  - Otomatis merangkum preferensi, jadwal, hobi, dan tugas ke database cloud tanpa perlu diperintah manual.
  - Dilengkapi filter anti-soal teknis dan anti-interogatif agar pertanyaan/tebakan tidak merusak data profil.
  - *Smart Context Update*: Jika konteks topik sudah pernah dicatat, data lama otomatis diperbarui tanpa membuat baris duplikat.
  - Mengingat hingga 200 putaran riwayat percakapan terakhir (*cross-session topic recall*).
- 🖥️ **Screen Share Aware**: Celyn bisa melihat layarmu saat koding, browsing, atau membaca tugas dengan algoritma *change detection* hemat token.
- 📄 **Dokumen Cerdas (PDF, Word, Excel)**:
  - **Membaca Dokumen**: Ekstraksi digital super cepat untuk PDF, Word (.docx), dan Excel (.xlsx) menjadi tabel/teks Markdown, dilengkapi *Hybrid OCR* via Gemini Vision jika PDF berupa hasil scan/foto.
  - **Membuat Dokumen**: Celyn dapat diminta menyusun dan mengekspor dokumen laporan PDF (font Unicode), Word (.docx berpenomoran halaman), atau lembar kerja Excel (.xlsx berpola zebra, header beku, dan format angka/Rupiah) yang langsung diunduh secara *stateless*.
  - **Konteks Transien**: Isi dokumen dijadikan referensi obrolan sesi tanpa mencemari memori profil jangka panjang di Turso.
- 🌐 **Deployment Fleksibel**: Siap dijalankan di komputer lokal (Node.js) maupun dideploy langsung ke cloud via Vercel Serverless.

---

## Struktur Proyek

Monorepo berbasis npm workspaces:

- **`apps/web`**: Frontend React, Vite, Tailwind CSS, Three.js (VRM 3D), dan Web Audio API.
- **`apps/server`**: Server backend Node.js, WebSocket, engine dokumen (Reader & Writer), dan Edge TTS proxy.
- **`packages/shared`**: Modul bersama berisi aturan persona Celyn, ekstraktor memori, skema Zod dokumen, dan tipedata.
- **`api/`**: Serverless functions untuk Vercel (`token`, `record`, `remember`, `summarize`, `documents-read`, `documents-generate`, `health`).
- **`scripts/`**: Kumpulan script uji pipeline otomatis (`test-pipeline.ts`) dan pemeliharaan database.

---

## Cara Menjalankan di Lokal

### 1. Kebutuhan Sistem
- **Node.js** v18+
- **Gemini API Key** (gratis di [Google AI Studio](https://aistudio.google.com/))
- *(Opsional)* Database untuk memori
### 2. Instalasi
```bash
git clone https://github.com/cescrafli/Bot.git
cd Bot
npm install
```

### 3. Konfigurasi Environment (`.env`)
Salin atau buat file `.env` di direktori utama:

```env
# Gemini API Key (Wajib)
GEMINI_API_KEY=isi_api_key_kamu_di_sini
GEMINI_MODEL=gemini-3.8-live
GEMINI_VOICE=Aoede

# Database Turso (Opsional untuk memori permanen)
DATABASE_URL=libsql://nama-db
AUTH_TOKEN=token

# Password Sesi Admin
ADMIN_PASSWORD=admin

# Port Server Lokal
PORT=3001
```

### 4. Jalankan Aplikasi
```bash
npm run dev
```
Akses antarmuka web di **`http://localhost:5173`**.

---

## Perintah npm

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Menjalankan client dan backend bersamaan |
| `npm run test:pipeline` | Menjalankan smoke test terpadu (audio, emosi, prompt, dan database) |
| `npm run build` | Melakukan build produksi seluruh paket |
| `npm run db:check` | Memeriksa isi memori yang tersimpan di database |

---

## Lisensi
Hak Cipta © 2026 Rafli.
