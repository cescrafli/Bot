# Celyn AI Bot

Teman ngobrol visual AI interaktif yang dirancang untuk berbicara langsung lewat suara, berekspresi secara visual, dan mengingat hal-hal penting seputar keseharianmu.

![Celyn AI](apps/web/public/celyn_avatar.png)

---

## Yang Bisa Dilakukan Celyn

- 🎙️ **Ngobrol Suara Langsung**: Berbicara dua arah layaknya teleponan tanpa jeda kaku. Celyn bisa disela kapan saja saat kamu mulai bicara.
- 🎭 **Avatar 2.5D & 3D**: Ekspresi wajah dan gerak bibir dinamis (senang, mikir, kaget, sedih, malu) dengan dukungan model 3D VRM.
- 🧠 **Memori Jangka Panjang**: Celyn otomatis merangkum dan mengingat preferensi, makanan/minuman kesukaan, cerita harian, jadwal, dan tugas pentingmu ke database cloud (Turso).
- 🖥️ **Bisa Lihat Layar (Screen Share)**: Nemenin kamu saat koding, membaca dokumen, atau membahas materi di layar dengan konsumsi token yang hemat.
- 💬 **Fleksibel & Terbuka**: Siap menjawab berbagai hal—mulai dari koding, sains, fakta umum, hingga obrolan santai dan teman curhat.

---

## Struktur Folder

Proyek ini menggunakan arsitektur monorepo sederhana:

- **`apps/web`**: Frontend antarmuka avatar, visual canvas, dan audio streaming (React, Vite, Tailwind CSS, Three.js).
- **`apps/server`**: Server backend lokal dan WebSocket proxy (Node.js, TypeScript).
- **`packages/shared`**: Modul bersama berisi kepribadian Celyn, aturan memori, dan fungsi utilitas.
- **`api/`**: Serverless functions untuk deployment Vercel (`/api/token`, `/api/record`, `/api/remember`, `/api/summarize`, `/api/health`).
- **`scripts/`**: Kumpulan script pengujian otomatis (`test-pipeline.ts`) dan utilitas database.

---

## Cara Menjalankan di Komputer Lokal

### 1. Kebutuhan Sistem
- **Node.js** v18 atau yang lebih baru.
- **Gemini API Key** (dapat dibuat gratis di [Google AI Studio](https://aistudio.google.com/)).
- *(Opsional untuk memori cloud)* Database **Turso** (dapat dibuat gratis di [turso.tech](https://turso.tech)).

### 2. Install Dependensi
```bash
npm install
```

### 3. Konfigurasi Lingkungan (`.env`)
Buat file `.env` di folder utama:

```env
# Gemini API Key (Wajib)
GEMINI_API_KEY=isi_dengan_api_key_gemini_kamu

# Konfigurasi Database Turso (Untuk Memori Jangka Panjang)
TURSO_DATABASE_URL=libsql://nama-db.turso.io
TURSO_AUTH_TOKEN=isi_dengan_token_turso_kamu

# Password Akses Sesi Admin
ADMIN_PASSWORD=admin

# Port Server Lokal
PORT=3001
```

### 4. Jalankan Aplikasi
Jalankan backend dan frontend sekaligus dengan satu perintah:

```bash
npm run dev
```

Buka browser di **`http://localhost:5173`**.

---

## Perintah Penting

| Perintah | Deskripsi |
|---|---|
| `npm run dev` | Menjalankan web client dan backend server secara bersamaan |
| `npm run test:pipeline` | Menjalankan seluruh pengujian otomatis sistem |
| `npm run build` | Melakukan kompilasi build produksi untuk semua workspace |
| `npm run db:check` | Memeriksa isi memori yang tersimpan di database Turso |

---

## Lisensi
Hak Cipta © 2026 Rafli. Dirilis di bawah lisensi MIT.
