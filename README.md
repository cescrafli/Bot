# 🌟 Celyn AI BOT
### *Next-Gen Real-time Multimodal AI Companion & Assistant*
*Didukung oleh Google Gemini Multimodal Live API, Avatar Responsif 2.5D Rigged Multi-Ekspresi & 3D VRM, Live Screen Sharing Hemat Token, serta Proteksi Sesi Server-side.*

![Celyn AI](apps/web/public/celyn_avatar.png)

---

## 📖 Tentang Celyn AI BOT

**Celyn AI BOT** adalah asisten AI visual interaktif generasi baru yang dirancang untuk komunikasi suara dua arah (*bidirectional audio*) berkecepatan tinggi dengan latensi sangat rendah (< 1 detik). 

Celyn memadukan kecerdasan multimodal mutakhir dengan persona yang hangat, ramah, dan berwawasan luas. Celyn mampu menjawab beragam pertanyaan—mulai dari sains, teknologi, pemrograman (*coding*), logika, matematika, analisis masalah, hingga obrolan santai sehari-hari dan teman curhat dengan empati alami.

Sistem dilengkapi avatar 2.5D dengan animasi pernapasan dinamis, kedipan mata alami, sinkronisasi gerak bibir (*dynamic lip-sync*), tatapan mata yang melirik ke layar (*gaze tracking*), dan 5 ekspresi emosi visual yang bertransisi secara mulus.

---

## ✨ Fitur-Fitur Utama

### 🧠 1. Google Gemini Multimodal Live API
- **Interaksi Audio Real-Time**: Berbicara langsung dengan Celyn layaknya panggilan suara / video call alami tanpa jeda konversi teks konvensional yang kaku.
- **Suara Lisan Alami**: Didukung opsi suara perempuan native Gemini (*Aoede*, *Zephyr*, *Leda*, *Kore*) yang mengalir, hidup, dan ekspresif.
- **Barge-In / Interupsi Spontan**: Begitu pengguna mulai berbicara, Celyn seketika berhenti bicara untuk mendengarkan, menciptakan dinamika percakapan manusiawi.

### 🎭 2. Dual Avatar Architecture (2.5D Rigged & 3D VRM)
- **Avatar 2.5D Rigged Multi-Ekspresi (Default)**:
  - 5 status ekspresi emosi: **Neutral/Happy** (senang/ramah), **Thinking** (mikir/analitis), **Surprised** (kaget/terkesan), **Sad** (empati/teduh), dan **Shy** (tersipu/malu manis).
  - Transisi emosi mulus berbasis GPU crossfade shader.
  - Kedipan mata periodik alami (*closed-eye textures*) dan animasi pernapasan (*procedural breathing*).
  - Sambungan anatomi organik pada bahu dan pergelangan tangan tanpa artefak patah.
- **Avatar 3D VRM (Opsional)**:
  - Didukung Three.js dan `@pixiv/three-vrm` lengkap dengan viseme blendshapes dan gaze tracking 3D.
  - Tombol toggle instan untuk berganti antara mode 2D dan 3D di antarmuka.

### 🖥️ 3. Live Screen Share Cerdas Hemat Token
- **Optimasi Token Vision**: Menggunakan algoritma deteksi perbedaan visual *thumbnail* 32×32 piksel, menghemat hingga **85%+ konsumsi kuota token penglihatan**.
- **Point-at-Screen Visual Reticle**: Saat membahas elemen di layar (misalnya kode program, artikel berita, atau diagram), Celyn dapat mengarahkan tatapan mata dan target visual ke koordinat yang sedang dibahas.

### 🌐 4. Omni-Knowledge & Penalaran Adaptif
- **Siap Menjawab Topik Apapun**: Memiliki wawasan luas untuk menjelaskan sains, koding, troubleshooting teknis, kalkulasi logika, sejarah, hingga tips praktis.
- **Adaptasi Konteks (Dual-Brain)**:
  - *Pertanyaan Informatif & Edukatif*: Dijelaskan secara cerdas, gamblang, runtut, dan tuntas dalam bahasa lisan yang mudah dipahami.
  - *Obrolan Curhat & Kondisi Lelah*: Menghadirkan respon penuh empati yang hangat tanpa menceramahi.
  - *Basa-Basi & Guyonan*: Santai, akrab, dan menyenangkan.

### 🔐 5. Keamanan & Proteksi Sesi (Passcode Protected Gate)
- **Gerbang Autentikasi Sesi**: Akses koneksi sesi Celyn dilindungi oleh sistem verifikasi sandi di tingkat backend untuk menjamin penggunaan yang terotentikasi dan aman.
- **Isolasi Mode Persona Server-side**:
  - Konfigurasi system prompt dibangun secara aman di sisi server Node.js dan tidak pernah terekspos ke bundle browser publik.
  - Memisahkan antara mode interaksi publik dan mode terotentikasi khusus.
- **Kerahasiaan Kunci & Kredensial**: API Key Gemini dan kredensial akses sepenuhnya terjaga di environment server.

### 🧪 6. Comprehensive Test Suite (92+ Tests)
- Dilengkapi test pipeline terintegrasi (`scripts/test-pipeline.ts`) untuk memverifikasi keutuhan sistem secara berkala: audio processing, SSML prosody, gesture/emotion inference, validasi aset rigging, dan boundary security.

---

## 📁 Struktur Monorepo

```
Celyn_AI_BOT/
├── apps/
│   ├── web/               # Frontend (React 18 + Vite + TypeScript + TailwindCSS + Three.js)
│   │   ├── public/        # Aset visual avatar 2.5D (torso, emosi, kedipan mata) & model 3D VRM
│   │   └── src/
│   │       ├── components/# UI AvatarCanvas2D, AvatarVRM, ControlBar, Passcode Modal
│   │       └── hooks/     # Audio Engine, Gemini Live WebSocket Client, Change Detection
│   └── server/            # Backend (Node.js + TypeScript + WebSocket Proxy ke Gemini Live)
│       └── src/
│           ├── geminiSession.ts  # Orkestrator sesi Gemini Live, Tool Call & Barge-in
│           ├── edgeTts.ts        # Fallback audio engine & SSML synthesizer
│           └── config.ts         # Konfigurasi environment & keamanan
├── packages/
│   └── shared/            # Shared Library (System Prompt, Persona, Enum Emosi, SSML Parser)
├── scripts/               # Script pengujian otomatis (Smoke Test Pipeline)
├── .env                   # Variabel lingkungan server (Lokal)
└── README.md
```

---

## 🚀 Panduan Memulai Cepat

### 1. Prasyarat Sistem
- **Node.js** v18, v20, atau versi LTS terbaru.
- **Google Gemini API Key** (dapat dibuat di [Google AI Studio](https://aistudio.google.com/)).

### 2. Pemasangan Dependensi
Jalankan perintah berikut di direktori utama:
```bash
npm install
```

### 3. Konfigurasi Lingkungan (`.env`)
Salin atau buat file `.env` di root direktori project:
```env
# Google Gemini API Key
GEMINI_API_KEY=your_gemini_api_key_here

# Port Server Backend
PORT=3001

# Model Gemini Live Multimodal
GEMINI_MODEL=gemini-3.8-live

# Suara Default Celyn (Aoede / Zephyr / Leda / Kore)
GEMINI_VOICE=Aoede

# Keamanan Sesi (Opsional: Tentukan passcode kustom Anda)
ADMIN_PASSWORD=your_custom_secure_passcode
```

> [!NOTE]
> Nilai `ADMIN_PASSWORD` dapat Anda atur sendiri secara bebas untuk melindungi akses sesi Celyn. Jangan membagikan file `.env` atau mengunggahnya ke repositori publik.

### 4. Menjalankan Server Lokal (Satu Perintah)
Jalankan backend dan frontend sekaligus dalam satu terminal:
```bash
npm run dev
```

Server backend akan berjalan di `http://localhost:3001` dan frontend di `http://localhost:5173`. Buka peramban Anda di:
👉 **`http://localhost:5173`**

### 5. Menjalankan Uji Otomatis (Testing)
Untuk memastikan seluruh 92+ uji pipeline lulus:
```bash
npx tsx scripts/test-pipeline.ts
```

Untuk memverifikasi build produksi:
```bash
npm run build
```

---

## 🎮 Cara Menggunakan

1. Buka `http://localhost:5173` di browser Anda.
2. Saat pertama kali masuk, Anda akan disambut dialog verifikasi sesi. Masukkan passcode akses yang telah Anda konfigurasikan di server.
3. Klik tombol **"Mulai Sesi Celyn"** di bilah kontrol bawah.
4. Berikan izin akses mikrofon saat diminta oleh browser.
5. Sapa Celyn dengan suara Anda atau ketik pesan teks:
   - *"Halo Celyn, bisa bantu jelaskan konsep black hole dalam fisika?"*
   - *"Celyn, aku lagi bingung milih struktur database, bagusan SQL atau NoSQL?"*
   - *"Celyn, hari ini kerjaanku padat banget, capek..."*
6. **Berbagi Layar**: Klik tombol **"Share Layar"** untuk meninjau baris kode, artikel web, atau diagram bersama Celyn secara interaktif.
7. **Ganti Avatar**: Gunakan tombol toggle **2D / 3D** untuk beralih antara avatar ilustrasi 2.5D Celyn dan model 3D VRM.

---

## 🛡️ Kebijakan Privasi & Keamanan

- **Zero Client Credential Leakage**: `GEMINI_API_KEY` dan logika verifikasi sandi sepenuhnya tersimpan di sisi backend server. Kunci API tidak pernah dikirim ke browser pengguna.
- **Passcode Confidentiality**: Repositori ini mematuhi standar keamanan ketat. Sandi akses atau memori personal pembuat tidak disebarluaskan di dokumentasi publik.
- **Proteksi Data Layar**: Frame layar hanya ditransmisikan saat terjadi perubahan visual nyata dan tidak disimpan secara permanen di server.

---

## 📄 Lisensi
Hak Cipta © 2026 Celyn AI Project. Dirilis di bawah [MIT License](LICENSE).
