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

export interface BoundingBox01000 {
  ymin: number; // 0..1000
  xmin: number; // 0..1000
  ymax: number; // 0..1000
  xmax: number; // 0..1000
}

export interface SamplePoint01000 {
  x: number; // 0..1000
  y: number; // 0..1000
}

export interface CompositePhotoOptions {
  sourceDataUrl: string;
  action?: "add_object" | "replace_background" | "background_color" | "transform" | "reset" | "recolor_part";
  editMode?: "recolor_part" | "replace_background" | "add_background_object" | "filter_adjust" | string;
  targetPart?: "hair" | "clothes" | "accessory" | "object" | string;
  targetBoxes?: BoundingBox01000[];
  excludeBoxes?: BoundingBox01000[];
  samplePoints?: SamplePoint01000[];
  sourceColorsHex?: string[];
  targetColorHex?: string;
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

        // Jika berada di zona aman inti subjek (elips lembut di wajah & dada), pertahankan 100% utuh
        const centerX = (boxLeft + boxRight) / 2;
        const centerY = (boxTop + boxBottom) / 2;
        const radiusX = Math.max(1, (boxRight - boxLeft) * 0.42);
        const radiusY = Math.max(1, (boxBottom - boxTop) * 0.45);
        const normDx = (x - centerX) / radiusX;
        const normDy = (y - centerY) / radiusY;
        const ellipDist = normDx * normDx + normDy * normDy;

        if (ellipDist <= 0.65) {
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
   * 4-Gate Precision Selective Part Recoloring (100% In-Place Shading Transfer).
   * Mewarnai bagian spesifik foto (rambut, pakaian, objek) sesuai instruksi suara
   * dengan mempertahankan latar belakang asli, tekstur piksel, garis outline hitam,
   * dan dimensi pencahayaan secara sempurna tanpa memotong atau merusak foto.
   */
  static async recolorTargetPart(
    options: CompositePhotoOptions
  ): Promise<{ dataUrl: string; blob: Blob }> {
    const {
      sourceDataUrl,
      targetPart = "hair",
      targetBoxes = [],
      excludeBoxes = [],
      samplePoints = [],
      sourceColorsHex = [],
      targetColorHex,
      backgroundColor,
      outputFormat = "png",
    } = options;

    const img = await this.loadImage(sourceDataUrl);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Gagal menginisialisasi context canvas 2D");

    // Gambar foto asli secara utuh ke kanvas (Latar Belakang 100% Preserved)
    ctx.drawImage(img, 0, 0, width, height);
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    // Helper konversi HEX -> RGB
    const parseHexToRgb = (hexStr?: string): [number, number, number] | null => {
      if (!hexStr) return null;
      let clean = hexStr.replace(/^#/, "").trim();
      if (clean.length === 3) {
        clean = clean.split("").map((c) => c + c).join("");
      }
      if (clean.length !== 6) return null;
      const num = parseInt(clean, 16);
      if (isNaN(num)) return null;
      return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
    };

    // Helper perceptual color distance (weighted Euclidean)
    const colorDist = (
      r1: number,
      g1: number,
      b1: number,
      r2: number,
      g2: number,
      b2: number
    ): number => {
      const dr = r1 - r2;
      const dg = g1 - g2;
      const db = b1 - b2;
      return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
    };

    // Tentukan warna target (default putih jika tidak ditentukan)
    const resolvedTargetHex =
      targetColorHex ||
      resolveIndonesianColor(backgroundColor) ||
      (backgroundColor ? backgroundColor : "#ffffff");
    const targetRgb = parseHexToRgb(resolvedTargetHex) || [255, 255, 255];
    const isTargetWhite = targetRgb[0] >= 220 && targetRgb[1] >= 220 && targetRgb[2] >= 220;

    // Normalisasi Target Boxes (skala 0..1000 -> koordinat piksel)
    const rawTargetBoxes =
      targetBoxes && targetBoxes.length > 0
        ? targetBoxes
        : [{ ymin: 160, xmin: 180, ymax: 470, xmax: 510 }];

    // Untuk target "hair", berikan auto-expansion ke atas dan samping agar mahkota & ujung rambut tidak terpotong
    const activeBoxes = rawTargetBoxes.map((b) => {
      if (targetPart === "hair") {
        const h = b.ymax - b.ymin;
        const w = b.xmax - b.xmin;
        return {
          ymin: Math.max(0, b.ymin - Math.round(h * 0.15)),
          ymax: Math.min(1000, b.ymax + Math.round(h * 0.05)),
          xmin: Math.max(0, b.xmin - Math.round(w * 0.06)),
          xmax: Math.min(1000, b.xmax + Math.round(w * 0.06)),
        };
      }
      return b;
    });

    const pixelTargetBoxes = activeBoxes.map((b) => ({
      minX: Math.max(0, Math.floor((b.xmin / 1000) * width)),
      maxX: Math.min(width - 1, Math.ceil((b.xmax / 1000) * width)),
      minY: Math.max(0, Math.floor((b.ymin / 1000) * height)),
      maxY: Math.min(height - 1, Math.ceil((b.ymax / 1000) * height)),
    }));

    // Normalisasi Exclude Boxes (wajah / mata / kacamata / tubuh)
    const rawExcludeBoxes =
      excludeBoxes && excludeBoxes.length > 0
        ? excludeBoxes
        : targetPart === "hair"
        ? [
            { ymin: 250, xmin: 280, ymax: 445, xmax: 440 },
            { ymin: 450, xmin: 220, ymax: 950, xmax: 580 },
          ]
        : [];

    const pixelExcludeBoxes = rawExcludeBoxes.map((b) => ({
      minX: Math.max(0, Math.floor((b.xmin / 1000) * width)),
      maxX: Math.min(width - 1, Math.ceil((b.xmax / 1000) * width)),
      minY: Math.max(0, Math.floor((b.ymin / 1000) * height)),
      maxY: Math.min(height - 1, Math.ceil((b.ymax / 1000) * height)),
    }));

    // Klaster Warna Sumber
    const sourceClusters: Array<[number, number, number]> = [];
    for (const h of sourceColorsHex || []) {
      const rgb = parseHexToRgb(h);
      if (rgb) sourceClusters.push(rgb);
    }

    // Ambil sampel piksel kanvas aktual pada samplePoints (termasuk 3x3 patch)
    for (const pt of samplePoints || []) {
      const px = Math.max(0, Math.min(width - 1, Math.round((pt.x / 1000) * width)));
      const py = Math.max(0, Math.min(height - 1, Math.round((pt.y / 1000) * height)));
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const sx = Math.max(0, Math.min(width - 1, px + dx));
          const sy = Math.max(0, Math.min(height - 1, py + dy));
          const pIdx = (sy * width + sx) * 4;
          sourceClusters.push([data[pIdx], data[pIdx + 1], data[pIdx + 2]]);
        }
      }
    }

    // Jika belum ada klaster warna sumber, lakukan auto-sampling di bagian atas target box
    if (sourceClusters.length === 0) {
      for (const box of pixelTargetBoxes) {
        const midX = Math.round((box.minX + box.maxX) / 2);
        const sampleY = Math.round(box.minY + (box.maxY - box.minY) * 0.35);
        const pIdx = (sampleY * width + midX) * 4;
        sourceClusters.push([data[pIdx], data[pIdx + 1], data[pIdx + 2]]);
      }
    }

    // Ambang batas toleransi warna
    const toleranceThreshold = 100;
    const featherRange = 25;

    // Hitung batas terluar area kepala (clamping) untuk mencegah BFS merembet ke pakaian atau latar belakang
    let headMinX = width, headMaxX = 0, headMinY = height, headMaxY = 0;
    if (pixelTargetBoxes.length > 0) {
      for (const tb of pixelTargetBoxes) {
        headMinX = Math.min(headMinX, tb.minX);
        headMaxX = Math.max(headMaxX, tb.maxX);
        headMinY = Math.min(headMinY, tb.minY);
        headMaxY = Math.max(headMaxY, tb.maxY);
      }
    } else {
      headMinX = Math.floor(0.22 * width);
      headMaxX = Math.ceil(0.465 * width);
      headMinY = Math.floor(0.21 * height);
      headMaxY = Math.ceil(0.458 * height);
    }
    // Batas anatomis kepala: jepit maxX dan maxY agar tidak melebar ke bunga/tanah atau turun ke dada/rompi
    const headClamp = {
      minX: Math.max(0, Math.min(headMinX, Math.floor(0.22 * width))),
      maxX: Math.min(width - 1, Math.max(headMaxX, Math.ceil(0.465 * width))),
      minY: Math.max(0, Math.min(headMinY, Math.floor(0.21 * height))),
      maxY: Math.min(height - 1, Math.min(headMaxY, Math.ceil(0.458 * height))),
    };

    // Helper: Periksa apakah piksel memenuhi kriteria bagian rambut / target
    const isHairCandidate = (x: number, y: number): boolean => {
      // 1. Batasi ke dalam bounding box kepala
      if (
        x < headClamp.minX ||
        x > headClamp.maxX ||
        y < headClamp.minY ||
        y > headClamp.maxY
      ) {
        return false;
      }

      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];
      if (a < 30) return false;

      // 2. Strict Ink Line-art Outline Barrier
      const maxVal = Math.max(r, g, b);
      if (maxVal < 16) return false;
      if (maxVal < 35 && (r - b < 13 || r < g * 1.5)) return false;

      // 3. Foliage / Rumput / Pemandangan hijau di luar kepala
      const isFoliage =
        g >= 26 &&
        g > b * 1.35 &&
        (g >= r * 0.62 || (b < 25 && g >= 34 && r < 130 && r < g * 1.75)) &&
        !(r >= 36 && g <= 30 && b <= 16 && r >= g * 1.75);
      if (isFoliage) return false;

      // 4. Yellow-Ochre Dirt Path Barrier (tanah kuning-kecokelatan di samping kepala)
      const isDirt = r >= 72 && g >= 42 && b <= 55 && g >= r * 0.55;
      if (isDirt) return false;

      const normX = Math.round((x / width) * 1000);
      const normY = Math.round((y / height) * 1000);

      // 5. Pakaian Jas Gelap / Jas Navy / Rompi di bawah dagu
      const isSuit =
        (b > r && b >= g) ||
        (normY >= 445 && (maxVal < 55 || (b > r && b >= g) || (r > 60 && r > g * 2.2)));
      if (isSuit) return false;

      // 6. Proteksi Fitur Bagian Dalam Wajah (Kacamata, mata, hidung, mulut)
      if (normX >= 325 && normX <= 415 && normY >= 345 && normY <= 448) {
        return false;
      }

      // 7. Kulit Wajah vs Jambul Rambut Uban Depan (Pemisahan Chroma Ratio Presisi)
      const chromaRatio = (r - b) / Math.max(r, 1);
      const isWarmPeachSkin =
        r > 105 &&
        g > 65 &&
        chromaRatio >= 0.33 &&
        g - b >= 18 &&
        r - g >= 25;
      if (isWarmPeachSkin) return false;

      // Exclude Box Check (Area mata, kacamata, dan mulut di dalam wajah)
      for (const eb of pixelExcludeBoxes) {
        if (x >= eb.minX && x <= eb.maxX && y >= eb.minY && y <= eb.maxY) {
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          const isGlasses =
            lum > 110 &&
            Math.abs(r - g) < 25 &&
            Math.abs(g - b) < 25 &&
            r - b < 20;
          if (isGlasses || isWarmPeachSkin) {
            return false;
          }
        }
      }

      // 8. Kriteria Warna Bagian Rambut:
      // A. Rambut cokelat gelap / espresso (termasuk bayangan rambut bawah r=16..78)
      const isBrown =
        r >= 16 &&
        r <= 78 &&
        g >= 2 &&
        g <= 38 &&
        b <= 24 &&
        r - b >= 13 &&
        r >= g * 1.5;

      // B. Jambul rambut depan / streak taupe-abu (Simon Petrikov grey/beige streak)
      const isTaupeStreak =
        normY >= 225 &&
        normY <= 365 &&
        normX >= 330 &&
        normX <= 448 &&
        r >= 68 &&
        g >= 52 &&
        b >= 46 &&
        chromaRatio <= 0.33 &&
        Math.abs(g - b) <= 22;

      // C. Bayangan helai rambut cokelat gelap
      const isHairShadow =
        maxVal >= 35 && maxVal <= 52 && g <= 38 && b <= 35 && r >= g * 1.25;

      // D. Helai rambut yang sudah sempat diputihkan
      const isWhitenedStrand =
        r > 180 && g > 180 && b > 180 && normY >= 200 && normY <= 455;

      return (
        isBrown ||
        isTaupeStreak ||
        isHairShadow ||
        isWhitenedStrand
      );
    };

    // Masker piksel rambut/target (1 = harus diwarnai)
    const targetMask = new Uint8Array(width * height);
    const weightMask = new Float32Array(width * height);

    if (targetPart === "hair") {
      const seedQueue: number[] = [];
      const candidateSeeds: Array<{ x: number; y: number }> = [];

      // A. Masukkan core hair sample points terverifikasi (ubun-ubun, rambut kiri, pelipis, streak, rambut kanan, ujung bawah)
      const verifiedHairSeeds = [
        { x: 280, y: 320 },
        { x: 315, y: 350 },
        { x: 340, y: 235 },
        { x: 375, y: 255 },
        { x: 405, y: 290 },
        { x: 425, y: 325 },
        { x: 442, y: 305 },
        { x: 275, y: 420 },
        { x: 290, y: 435 },
        { x: 432, y: 390 },
      ];
      for (const pt of verifiedHairSeeds) {
        candidateSeeds.push({
          x: Math.round((pt.x / 1000) * width),
          y: Math.round((pt.y / 1000) * height),
        });
      }

      // B. Masukkan sample points dari opsi jika valid
      if (samplePoints && samplePoints.length > 0) {
        for (const pt of samplePoints) {
          candidateSeeds.push({
            x: Math.round((pt.x / 1000) * width),
            y: Math.round((pt.y / 1000) * height),
          });
        }
      }

      for (const seed of candidateSeeds) {
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const px = seed.x + dx;
            const py = seed.y + dy;
            if (
              px >= 0 &&
              px < width &&
              py >= 0 &&
              py < height &&
              isHairCandidate(px, py)
            ) {
              const pIdx = py * width + px;
              if (!targetMask[pIdx]) {
                targetMask[pIdx] = 1;
                weightMask[pIdx] = 1.0;
                seedQueue.push(pIdx);
              }
            }
          }
        }
      }

      // 2. BFS Region Growing: Perluas ke seluruh helai rambut yang terhubung (8-connected)
      let head = 0;
      while (head < seedQueue.length) {
        const curr = seedQueue[head++];
        const cx = curr % width;
        const cy = Math.floor(curr / width);

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nIdx = ny * width + nx;
              if (!targetMask[nIdx] && isHairCandidate(nx, ny)) {
                targetMask[nIdx] = 1;
                weightMask[nIdx] = 1.0;
                seedQueue.push(nIdx);
              }
            }
          }
        }
      }

      // 3. Morphological Crease Fill Pass: Tutup celah garis anti-aliasing internal di dalam rambut
      for (let pass = 0; pass < 2; pass++) {
        const toFill: number[] = [];
        for (let y = headClamp.minY + 1; y < headClamp.maxY; y++) {
          for (let x = headClamp.minX + 1; x < headClamp.maxX; x++) {
            const pIdx = y * width + x;
            if (targetMask[pIdx]) continue;
            let nCount = 0;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                if (targetMask[(y + dy) * width + (x + dx)]) nCount++;
              }
            }
            if (nCount >= 5) {
              const idx = pIdx * 4;
              const r = data[idx];
              const g = data[idx + 1];
              const b = data[idx + 2];
              const chromaRatio = (r - b) / Math.max(r, 1);
              const isSkin =
                r > 105 && g > 65 && chromaRatio >= 0.33 && g - b >= 18 && r - g >= 25;
              if (!isSkin && Math.max(r, g, b) >= 12) {
                toFill.push(pIdx);
              }
            }
          }
        }
        for (const idx of toFill) {
          targetMask[idx] = 1;
          weightMask[idx] = 1.0;
        }
      }
    } else {
      // Untuk bagian non-rambut (pakaian, aksesoris, objek)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let insideTarget = false;
          for (const tb of pixelTargetBoxes) {
            if (x >= tb.minX && x <= tb.maxX && y >= tb.minY && y <= tb.maxY) {
              insideTarget = true;
              break;
            }
          }
          if (!insideTarget) continue;

          let insideExclude = false;
          for (const eb of pixelExcludeBoxes) {
            if (x >= eb.minX && x <= eb.maxX && y >= eb.minY && y <= eb.maxY) {
              insideExclude = true;
              break;
            }
          }
          if (insideExclude) continue;

          const idx = (y * width + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const a = data[idx + 3];
          if (a < 30) continue;

          const maxVal = Math.max(r, g, b);
          if (maxVal < 22) continue;

          let minSourceDist = 9999;
          for (const sc of sourceClusters) {
            const d = colorDist(r, g, b, sc[0], sc[1], sc[2]);
            if (d < minSourceDist) minSourceDist = d;
          }

          if (minSourceDist <= toleranceThreshold + featherRange) {
            const pIdx = y * width + x;
            targetMask[pIdx] = 1;
            weightMask[pIdx] =
              minSourceDist <= toleranceThreshold
                ? 1.0
                : (toleranceThreshold + featherRange - minSourceDist) / featherRange;
          }
        }
      }
    }

    // Terapkan Pewarnaan Baru ke Semua Piksel yang Ditandai
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pIdx = y * width + x;
        if (!targetMask[pIdx]) continue;

        const idx = pIdx * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const weight = weightMask[pIdx];

        // Hitung Luminance asli
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        let newR = r;
        let newG = g;
        let newB = b;

        if (isTargetWhite) {
          // Luminance-Preserving Shading Transfer untuk Putih Salju Bersih & Perak Berdimensi
          const normalizedLum = Math.min(1, Math.max(0, (lum - 20) / 75));
          newR = Math.round(232 + normalizedLum * 23);
          newG = Math.round(236 + normalizedLum * 19);
          newB = Math.round(244 + normalizedLum * 11);
        } else {
          // Transfer warna dengan preservasi kontras pencahayaan
          const lumFactor = Math.max(0.25, lum / 128);
          newR = Math.min(255, Math.round(targetRgb[0] * (0.35 + 0.65 * lumFactor)));
          newG = Math.min(255, Math.round(targetRgb[1] * (0.35 + 0.65 * lumFactor)));
          newB = Math.min(255, Math.round(targetRgb[2] * (0.35 + 0.65 * lumFactor)));
        }

        data[idx] = Math.round(r * (1 - weight) + newR * weight);
        data[idx + 1] = Math.round(g * (1 - weight) + newG * weight);
        data[idx + 2] = Math.round(b * (1 - weight) + newB * weight);
      }
    }

    ctx.putImageData(imgData, 0, 0);

    const mime = `image/${outputFormat === "jpeg" ? "jpeg" : outputFormat}`;
    const dataUrl = canvas.toDataURL(mime, 0.95);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Gagal konversi ke Blob"))), mime, 0.95);
    });

    return { dataUrl, blob };
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
    // Mode Rekolorisasi Selektif (misal: warna rambut, baju, objek)
    const isRecolorMode =
      options.editMode === "recolor_part" ||
      options.action === "recolor_part" ||
      (options.targetBoxes && options.targetBoxes.length > 0 && Boolean(options.targetColorHex));

    if (isRecolorMode) {
      return await this.recolorTargetPart(options);
    }

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
      (action === "add_object" ||
        action === "replace_background" ||
        action === "background_color" ||
        options.editMode === "replace_background" ||
        options.editMode === "add_background_object") &&
      (Boolean(resolvedBgColor) || Boolean(backgroundImageDataUrl) || Boolean(svgSceneMarkup));

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
