import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Browser shim agar node:crypto tidak memicu externalization warning saat bundling @celyn/shared
      "node:crypto": path.resolve(__dirname, "src/shims/emptyCrypto.ts"),
    },
  },
  build: {
    // Mesin PDF.js Mozilla (~1.7 MB) & 3D VRM Three.js (~670 kB) berukuran besar secara alami;
    // naikkan batas peringatan agar tidak memicu false positive warning pada build CI/CD.
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        manualChunks: {
          "three-vrm": ["three", "@pixiv/three-vrm"],
          "genai-sdk": ["@google/genai"],
          "react-vendor": ["react", "react-dom", "lucide-react"],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
    },
  },
});
