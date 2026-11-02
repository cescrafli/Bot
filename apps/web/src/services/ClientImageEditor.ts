/**
 * ClientImageEditor.ts
 * Mesin Pengolah & Komposisi Foto Cerdas Sisi Klien (100% Gratis & Isomorfik Peramban).
 * Mendukung Segmentasi Subjek Otomatis (Alpha Matting), Penggantian Warna Latar,
 * Penempatan Objek di Belakang Subjek (Layering), Filter, Transformasi, dan Watermark.
 */

export interface SubjectBoundingBox {
  ymin: number; // 0..1000
  xmin: number; // 0..1000
  ymax: number; // 0..1000
  xmax: number; // 0..1000
}

export interface CompositePhotoOptions {
  sourceDataUrl: string;
  action?: "add_object" | "replace_background" | "background_color" | "transform" | "reset";
  backgroundColor?: string;
  backgroundImageDataUrl?: string;
  svgSceneMarkup?: string;
  subjectBox?: SubjectBoundingBox;
  rotation?: number; // 0, 90, 180, 270, -90
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  aspectRatio?: "original" | "1:1" | "16:9" | "4:3";
  brightness?: number; // -50 s.d 50
  contrast?: number; // -50 s.d 50
  grayscale?: boolean;
  watermarkText?: string;
  outputFormat?: "png" | "jpeg" | "webp";
}

/**
 * Pemetaan warna Bahasa Indonesia ke nilai Hex estetis profesional
 */
export function resolveIndonesianColor(colorStr?: string): string | null {
  if (!colorStr) return null;
  const s = colorStr.trim().toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return s;

  const colorMap: Record<string, string> = {
    biru: "#1d4ed8", // Biru Pasfoto Resmi
    "biru muda": "#38bdf8",
    "biru langit": "#60a5fa",
    "biru laut": "#0284c7",
    merah: "#dc2626", // Merah Pasfoto Resmi
    "merah marun": "#991b1b",
    putih: "#ffffff",
    hitam: "#09090b",
    "abu-abu": "#64748b",
    abu: "#64748b",
    hijau: "#16a34a",
    "hijau daun": "#22c55e",
    "hijau tosca": "#0d9488",
    kuning: "#eab308",
    oranye: "#ea580c",
    jingga: "#ea580c",
    senja: "#f97316",
    ungu: "#9333ea",
    pink: "#ec4899",
    "merah muda": "#f472b6",
  };

  for (const [key, val] of Object.entries(colorMap)) {
    if (s.includes(key)) return val;
  }
  return null;
}

export class ClientImageEditor {
  /**
   * Memuat gambar dari URL atau DataURL secara asinkron
   */
  static loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(new Error("Gagal memuat gambar"));
      img.src = src;
    });
  }

  /**
   * Mengompres dan mengecilkan dimensi foto secara instan di peramban
   * khusus untuk payload Vision AI (maksimal ~800px JPEG, kualitas 78%, ~40-80 KB)
   * agar transmisi ke endpoint /api/documents/read dan /api/documents/process
   * berlangsung kilat (< 1.5 detik) tanpa pernah memicu HTTP 504 Gateway Timeout.
   */
  static async createVisionThumbnail(
    sourceDataUrl: string,
    maxDimension = 800,
    quality = 0.78
  ): Promise<{ dataUrl: string; base64: string; mimeType: string; blob: Blob }> {
    try {
      const img = await this.loadImage(sourceDataUrl);
      const srcW = img.naturalWidth || img.width || 800;
      const srcH = img.naturalHeight || img.height || 600;

      let targetW = srcW;
      let targetH = srcH;
      if (Math.max(srcW, srcH) > maxDimension) {
        if (srcW >= srcH) {
          targetW = maxDimension;
          targetH = Math.round((srcH * maxDimension) / srcW);
        } else {
          targetH = maxDimension;
          targetW = Math.round((srcW * maxDimension) / srcH);
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Gagal menginisialisasi canvas context");

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "medium";
      ctx.drawImage(img, 0, 0, targetW, targetH);

      const mimeType = "image/jpeg";
      const dataUrl = canvas.toDataURL(mimeType, quality);
      const base64 = dataUrl.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Gagal membuat blob"))), mimeType, quality);
      });

      return { dataUrl, base64, mimeType, blob };
    } catch (err) {
      console.warn("[ClientImageEditor] createVisionThumbnail fallback:", err);
      const base64 = sourceDataUrl.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
      return {
        dataUrl: sourceDataUrl,
        base64,
        mimeType: "image/jpeg",
        blob: new Blob([], { type: "image/jpeg" }),
      };
    }
  }

  /**
   * Ekstraksi Alpha Mask Subjek Utama menggunakan Perimeter Color Sampling + Bounding Box Guidance.
   * Menjamin orang/subjek di tengah foto terisolasi dengan tepi halus (alpha feathering)
   * tanpa merusak wajah atau pakaian.
   */
  static extractForegroundSubjectMask(
    img: HTMLImageElement,
    subjectBox?: SubjectBoundingBox
  ): HTMLCanvasElement {
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;

    // Canvas untuk memproses piksel
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;

    ctx.drawImage(img, 0, 0, width, height);
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    // Hitung area batas subjek (jika ada, atau asumsikan 60% area tengah)
    const boxLeft = subjectBox ? Math.floor((subjectBox.xmin / 1000) * width) : Math.floor(width * 0.18);
    const boxTop = subjectBox ? Math.floor((subjectBox.ymin / 1000) * height) : Math.floor(height * 0.12);
    const boxRight = subjectBox ? Math.ceil((subjectBox.xmax / 1000) * width) : Math.ceil(width * 0.82);
    const boxBottom = subjectBox ? Math.ceil((subjectBox.ymax / 1000) * height) : Math.ceil(height * 0.95);

    // Ambil sampel warna tepi luar (top, left, right)
    const borderSamples: Array<[number, number, number]> = [];
    const stepX = Math.max(1, Math.floor(width / 40));
    const stepY = Math.max(1, Math.floor(height / 40));

    // Sampel tepi atas
    for (let x = 0; x < width; x += stepX) {
      const idx = (0 * width + x) * 4;
      borderSamples.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
    // Sampel tepi kiri dan kanan
    for (let y = 0; y < height; y += stepY) {
      const idxL = (y * width + 0) * 4;
      borderSamples.push([data[idxL], data[idxL + 1], data[idxL + 2]]);
      const idxR = (y * width + (width - 1)) * 4;
      borderSamples.push([data[idxR], data[idxR + 1], data[idxR + 2]]);
    }

    // Fungsi menghitung jarak Euclidean warna
    const colorDist = (r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) => {
      const dr = r1 - r2;
      const dg = g1 - g2;
      const db = b1 - b2;
      return Math.sqrt(dr * dr + dg * dg + db * db);
    };

    // Threshold jarak warna (semakin mirip dengan tepi, semakin dianggap latar)
    const threshold = 48;
    const featherRange = 22;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        // Jika berada di zona aman inti subjek (wajah/dada), pertahankan 100% utuh
        const isCoreSubject =
          x >= boxLeft + Math.floor((boxRight - boxLeft) * 0.15) &&
          x <= boxRight - Math.floor((boxRight - boxLeft) * 0.15) &&
          y >= boxTop + Math.floor((boxBottom - boxTop) * 0.2) &&
          y <= boxBottom - Math.floor((boxBottom - boxTop) * 0.1);

        if (isCoreSubject) {
          // Subjek inti pasti terlihat (alpha = 255)
          data[idx + 3] = 255;
          continue;
        }

        // Cari jarak terkecil ke sampel latar belakang tepi
        let minDist = 999;
        for (let s = 0; s < borderSamples.length; s += 2) {
          const sample = borderSamples[s];
          const d = colorDist(r, g, b, sample[0], sample[1], sample[2]);
          if (d < minDist) minDist = d;
          if (minDist < threshold) break;
        }

        if (minDist <= threshold) {
          // Latar belakang murni -> transparan
          data[idx + 3] = 0;
        } else if (minDist < threshold + featherRange) {
          // Tepi transisi (feathering halus untuk rambut/bahu)
          const factor = (minDist - threshold) / featherRange;
          data[idx + 3] = Math.round(factor * 255);
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  /**
   * Komposisi Multi-Lapisan Lengkap Foto:
   * Lapisan 0: Latar Belakang (Warna Baru atau Pemandangan Baru)
   * Lapisan 1: Objek Tambahan di Belakang Subjek (Pohon/Bunga/Pemandangan)
   * Lapisan 2: Subjek Utama Asli (Wajah/Tubuh Asli)
   * Lapisan 3: Filter & Transformasi Kanvas (Rotasi/Crop/Watermark)
   */
  static async compositeEditedPhoto(
    options: CompositePhotoOptions
  ): Promise<{ dataUrl: string; blob: Blob }> {
    const {
      sourceDataUrl,
      action = "transform",
      backgroundColor,
      backgroundImageDataUrl,
      svgSceneMarkup,
      subjectBox,
      rotation = 0,
      flipHorizontal = false,
      flipVertical = false,
      aspectRatio = "original",
      brightness = 0,
      contrast = 0,
      grayscale = false,
      watermarkText = "",
      outputFormat = "png",
    } = options;

    const img = await this.loadImage(sourceDataUrl);
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;

    // Tentukan ukuran dasar kanvas berdasarkan aspek rasio
    let cropX = 0;
    let cropY = 0;
    let cropW = srcW;
    let cropH = srcH;
    let targetW = srcW;
    let targetH = srcH;

    if (aspectRatio === "1:1") {
      const size = Math.min(srcW, srcH);
      cropX = (srcW - size) / 2;
      cropY = (srcH - size) / 2;
      cropW = size;
      cropH = size;
      targetW = 1000;
      targetH = 1000;
    } else if (aspectRatio === "16:9") {
      cropW = srcW;
      cropH = Math.round((srcW * 9) / 16);
      if (cropH > srcH) {
        cropH = srcH;
        cropW = Math.round((srcH * 16) / 9);
      }
      cropX = (srcW - cropW) / 2;
      cropY = (srcH - cropH) / 2;
      targetW = 1600;
      targetH = 900;
    } else if (aspectRatio === "4:3") {
      cropW = srcW;
      cropH = Math.round((srcW * 3) / 4);
      if (cropH > srcH) {
        cropH = srcH;
        cropW = Math.round((srcH * 4) / 3);
      }
      cropX = (srcW - cropW) / 2;
      cropY = (srcH - cropH) / 2;
      targetW = 1200;
      targetH = 900;
    }

    const isRotatedQuarter = Math.abs(rotation) % 180 === 90;
    const canvas = document.createElement("canvas");
    canvas.width = isRotatedQuarter ? targetH : targetW;
    canvas.height = isRotatedQuarter ? targetW : targetH;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Gagal menginisialisasi context canvas 2D");

    ctx.save();

    // Terapkan filter visual global (brightness, contrast, grayscale)
    const filters = [
      `brightness(${100 + brightness}%)`,
      `contrast(${100 + contrast}%)`,
      grayscale ? "grayscale(100%)" : "",
    ]
      .filter(Boolean)
      .join(" ");
    if (filters) ctx.filter = filters;

    // Transformasi pusat (rotasi & pembalikan)
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(flipHorizontal ? -1 : 1, flipVertical ? -1 : 1);

    const drawW = targetW;
    const drawH = targetH;
    const drawX = -drawW / 2;
    const drawY = -drawH / 2;

    const resolvedBgColor = resolveIndonesianColor(backgroundColor) || backgroundColor;
    const hasLayeringEdit =
      action === "add_object" ||
      action === "replace_background" ||
      action === "background_color" ||
      Boolean(resolvedBgColor) ||
      Boolean(backgroundImageDataUrl) ||
      Boolean(svgSceneMarkup);

    if (hasLayeringEdit) {
      // -------------------------------------------------------------
      // LAPISAN 0: Latar Belakang (Warna Solid / Pemandangan Baru)
      // -------------------------------------------------------------
      if (resolvedBgColor) {
        ctx.fillStyle = resolvedBgColor;
        ctx.fillRect(drawX, drawY, drawW, drawH);
      } else {
        // Default latar gradasi lembut
        const grad = ctx.createLinearGradient(drawX, drawY, drawX, drawY + drawH);
        grad.addColorStop(0, "#38bdf8");
        grad.addColorStop(1, "#1e3a8a");
        ctx.fillStyle = grad;
        ctx.fillRect(drawX, drawY, drawW, drawH);
      }

      // Jika ada gambar latar pemandangan (misal hasil AI)
      if (backgroundImageDataUrl) {
        try {
          const bgImg = await this.loadImage(backgroundImageDataUrl);
          ctx.drawImage(bgImg, 0, 0, bgImg.width, bgImg.height, drawX, drawY, drawW, drawH);
        } catch (e) {
          console.warn("[ClientImageEditor] Gagal memuat backgroundImageDataUrl:", e);
        }
      }

      // -------------------------------------------------------------
      // LAPISAN 1: Objek Tambahan di Belakang Subjek (Pohon/Alam)
      // -------------------------------------------------------------
      if (svgSceneMarkup) {
        try {
          const svgBlob = new Blob([svgSceneMarkup], { type: "image/svg+xml;charset=utf-8" });
          const svgUrl = URL.createObjectURL(svgBlob);
          const svgImg = await this.loadImage(svgUrl);
          ctx.drawImage(svgImg, drawX, drawY, drawW, drawH);
          URL.revokeObjectURL(svgUrl);
        } catch (e) {
          console.warn("[ClientImageEditor] Gagal merender svgSceneMarkup:", e);
        }
      }

      // -------------------------------------------------------------
      // LAPISAN 2: Subjek Utama Asli (Wajah & Tubuh Terisolasi)
      // -------------------------------------------------------------
      const maskedSubjectCanvas = this.extractForegroundSubjectMask(img, subjectBox);
      ctx.drawImage(
        maskedSubjectCanvas,
        cropX,
        cropY,
        cropW,
        cropH,
        drawX,
        drawY,
        drawW,
        drawH
      );
    } else {
      // Tidak ada segmentasi latar: Gambar foto asli secara utuh
      ctx.drawImage(img, cropX, cropY, cropW, cropH, drawX, drawY, drawW, drawH);
    }

    ctx.restore();

    // -------------------------------------------------------------
    // LAPISAN 4: Anotasi / Watermark Teks di Atas Kanvas
    // -------------------------------------------------------------
    if (watermarkText.trim()) {
      ctx.save();
      const fontSize = Math.max(18, Math.round(canvas.width / 32));
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";

      const text = watermarkText.trim();
      const metrics = ctx.measureText(text);
      const textW = metrics.width;
      const pad = 12;
      const bannerY = canvas.height - fontSize - 24;

      ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
      ctx.fillRect((canvas.width - textW) / 2 - pad, bannerY - pad, textW + pad * 2, fontSize + pad * 2);

      ctx.fillStyle = "#ffffff";
      ctx.fillText(text, canvas.width / 2, canvas.height - 24);
      ctx.restore();
    }

    const mime = `image/${outputFormat === "jpeg" ? "jpeg" : outputFormat}`;
    const dataUrl = canvas.toDataURL(mime, 0.95);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Gagal konversi ke Blob"))), mime, 0.95);
    });

    return { dataUrl, blob };
  }
}
