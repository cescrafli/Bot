# 🌟 Celyn AI BOT
### *AI Assistant Real-time dengan Avatar Bergerak (2D & 3D VRM) + Live Screen Share + Gemini Multimodal Live API*

![Celyn AI](apps/web/public/celyn_avatar.png)

Celyn AI BOT adalah asisten AI interaktif dengan respon suara real-time, kemampuan melihat layar pengguna (*live screen sharing*), serta avatar responsif yang bernapas, berkedip, bergerak bibirnya (*lip-sync*), dan mengubah ekspresi emosi sesuai alur percakapan.

---

## ✨ Fitur Utama

- 🧠 **Gemini Multimodal Live API**: Komunikasi suara 2 arah ultra-low latency (< 1 detik) melalui koneksi WebSocket persisten.
- 🖥️ **Live Screen Share Hemat Token**: Membaca layar pada 1 FPS dengan deteksi perubahan visual berbasis thumbnail 32x32 piksel (menghemat hingga 85%+ biaya token vision).
- 🎭 **Dual Avatar System**:
  - **Mode 2D (Default)**: Menggunakan ilustrasi karakter Celyn dengan animasi bernapas, kedipan mata alami, dynamic lip-sync berbasis volume RMS, dan aura emosi.
  - **Mode 3D (VRM)**: Menggunakan Three.js & `@pixiv/three-vrm` dengan viseme blendshapes dan gaze tracking.
- 🛡️ **Secure Backend Proxy**: `GEMINI_API_KEY` aman di server Node.js, tidak pernah terekspos ke bundle browser pengguna.
- 💬 **Tool Calling Real-time**:
  - `set_expression`: AI mengubah ekspresi wajah (Happy, Thinking, Surprised, Neutral, Sad).
  - `point_at_screen`: AI mengarahkan tatapan mata dan target reticle ke elemen layar yang sedang dibahas.
- ⚡ **Barge-in / Interupsi Spontan**: Begitu pengguna mulai berbicara, AI langsung menghentikan suara sebelumnya seketika.

---

## 📁 Struktur Monorepo

```
celyn-ai-bot/
├── apps/
│   ├── web/               # Frontend (React 18 + Vite + TypeScript + Three.js)
│   └── server/            # Backend (Node.js + WebSocket Proxy ke Gemini Live API)
├── packages/
│   └── shared/            # Type definitions TypeScript bersama
├── .env                   # Tempat meletakkan GEMINI_API_KEY
└── README.md
```

---

## 🚀 Panduan Memulai Cepat

### 1. Prasyarat
- **Node.js** v18+ atau v20+ (diuji pada v24)
- **Google Gemini API Key** (Dapatkan di [Google AI Studio](https://aistudio.google.com/))

### 2. Pasang Dependencies
Jalankan perintah ini di root project:
```bash
npm install
```

### 3. Konfigurasi API Key
Buka file `.env` di root project, lalu masukkan API Key Anda:
```env
GEMINI_API_KEY=AIzaSy...your_gemini_api_key_here
PORT=3001
GEMINI_MODEL=gemini-2.0-flash-exp
GEMINI_VOICE=Aoede
```

### 4. Jalankan Aplikasi

**Jalankan Backend Server:**
```bash
npm run dev:server
```
*Server aktif di `http://localhost:3001` (WebSocket: `ws://localhost:3001`)*

**Jalankan Frontend Web:**
Buka terminal baru:
```bash
npm run dev:web
```
*Buka browser di: `http://localhost:5173`*

---

## 🎮 Cara Menggunakan

1. Buka `http://localhost:5173`.
2. Klik tombol **"Mulai Celyn"** di bar kontrol bawah.
3. Izinkan akses mikrofon saat diminta oleh browser.
4. Ucapkan *"Halo Celyn, apa kabar?"* dan dengarkan respon suara langsung dari Celyn. Perhatikan mulut avatar bergerak seirama dengan suara.
5. Klik tombol **"Share Layar"** dan pilih jendela/layar yang ingin Anda bahas bersama Celyn (misal kode editor, artikel berita, atau error di konsol).
6. Tanyakan: *"Celyn, coba lihat layar saya, ada apa di bagian tengah?"* — Celyn akan membaca dan melirik ke arah elemen tersebut!
7. Klik ikon **"Mode 2D / 3D"** untuk berganti antara avatar 2D Celyn dan avatar 3D VRM.

---

## 📄 Lisensi
MIT License.
