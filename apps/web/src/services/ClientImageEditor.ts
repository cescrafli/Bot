/**
 * ClientImageEditor.ts
 * Mesin Pengolah & Komposisi Foto Cerdas Sisi Klien (100% Gratis & Isomorfik Peramban).
 * Mendukung Segmentasi Subjek Otomatis (Alpha Matting), Penggantian Warna Latar,
 * Penempatan Objek di Belakang Subjek (Layering), Filter, Transformasi, dan Watermark.
 */
import { recolorHairSoftMatte } from "./hairMatte";

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
  saturation?: number; // -50 s.d 50
  grayscale?: boolean;
  invert?: boolean;
  watermarkText?: string;
  watermarkColor?: string;
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
   * Mengekstrak mask subjek depan (foreground) menggunakan Multi-Cluster Border Palette
   * flood-fill dan Connected-Component Retention agar ornamen latar (bunga/daun/tekstur)
   * ikut terklasifikasi sebagai background tanpa memotong kaki atau siluet karakter.
   */
  static extractForegroundSubjectMask(
    img: HTMLImageElement,
    subjectBox?: SubjectBoundingBox
  ): HTMLCanvasElement {
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;

    ctx.drawImage(img, 0, 0, width, height);
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const total = width * height;
    const isBg = new Uint8Array(total);

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
      return Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11);
    };

    // 1. Kumpulkan palet warna tepi terkuantisasi (deduplikasi jarak <= 14 agar BFS sangat cepat)
    const borderSamples: Array<[number, number, number]> = [];
    const stepX = Math.max(1, Math.floor(width / 60));
    const stepY = Math.max(1, Math.floor(height / 60));

    const pushSample = (x: number, y: number) => {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      for (let i = 0; i < borderSamples.length; i++) {
        const s = borderSamples[i];
        if (colorDist(r, g, b, s[0], s[1], s[2]) <= 14) return;
      }
      borderSamples.push([r, g, b]);
    };

    for (let x = 0; x < width; x += stepX) {
      pushSample(x, 2);
      pushSample(x, Math.min(height - 1, Math.floor(height * 0.08)));
      // Sudut bawah kiri/kanan saja agar bagian tengah-bawah (kaki/baju subjek) tidak dijadikan sampel latar
      if (x < width * 0.22 || x > width * 0.78) {
        pushSample(x, Math.max(0, height - 3));
      }
    }
    for (let y = 0; y < height; y += stepY) {
      pushSample(2, y);
      pushSample(Math.max(0, width - 3), y);
    }

    const matchesBorderPalette = (r: number, g: number, b: number, threshold: number): boolean => {
      for (let i = 0; i < borderSamples.length; i++) {
        const s = borderSamples[i];
        if (colorDist(r, g, b, s[0], s[1], s[2]) <= threshold) return true;
      }
      return false;
    };

    // 2. Flood-fill BFS dari tepi luar, berhenti pada outline tinta gelap (maxCh < 26)
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;

    const trySeed = (x: number, y: number) => {
      const p = y * width + x;
      if (isBg[p]) return;
      const idx = p * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      if (Math.max(r, g, b) < 26) return;
      isBg[p] = 1;
      queue[tail++] = p;
    };

    for (let x = 0; x < width; x++) {
      trySeed(x, 0);
      if (x < width * 0.22 || x > width * 0.78) {
        trySeed(x, height - 1);
      }
    }
    for (let y = 0; y < height; y++) {
      trySeed(0, y);
      trySeed(width - 1, y);
    }

    while (head < tail) {
      const curr = queue[head++];
      const cx = curr % width;
      const cy = (curr - cx) / width;
      const cIdx = curr * 4;
      const cr = data[cIdx];
      const cg = data[cIdx + 1];
      const cb = data[cIdx + 2];

      const n0 = cx > 0 ? curr - 1 : -1;
      const n1 = cx < width - 1 ? curr + 1 : -1;
      const n2 = cy > 0 ? curr - width : -1;
      const n3 = cy < height - 1 ? curr + width : -1;

      for (let ni = 0; ni < 4; ni++) {
        const np = ni === 0 ? n0 : ni === 1 ? n1 : ni === 2 ? n2 : n3;
        if (np < 0 || isBg[np]) continue;
        const nIdx = np * 4;
        const nr = data[nIdx];
        const ng = data[nIdx + 1];
        const nb = data[nIdx + 2];

        // Jangan menembus garis tinta hitam karakter
        if (Math.max(nr, ng, nb) < 26) continue;

        const localStepDist = colorDist(cr, cg, cb, nr, ng, nb);
        if (localStepDist <= 30 && matchesBorderPalette(nr, ng, nb, 58)) {
          isBg[np] = 1;
          queue[tail++] = np;
        }
      }
    }

    // 3. Connected-Component Foreground Retention: pertahankan siluet utama & komponen bermakna dalam subjectBox
    const boxLeft = subjectBox ? Math.floor((subjectBox.xmin / 1000) * width) : Math.floor(width * 0.18);
    const boxTop = subjectBox ? Math.floor((subjectBox.ymin / 1000) * height) : Math.floor(height * 0.12);
    const boxRight = subjectBox ? Math.ceil((subjectBox.xmax / 1000) * width) : Math.ceil(width * 0.82);
    const boxBottom = subjectBox ? Math.ceil((subjectBox.ymax / 1000) * height) : Math.ceil(height * 0.95);

    const visited = new Uint8Array(total);
    const components: Array<{ pixels: number[]; boxOverlap: number }> = [];
    let largestLen = 0;

    for (let i = 0; i < total; i++) {
      if (isBg[i] || visited[i]) continue;
      const comp: number[] = [i];
      let boxOverlap = 0;
      let qHead = 0;
      visited[i] = 1;

      while (qHead < comp.length) {
        const p = comp[qHead++];
        const px = p % width;
        const py = (p - px) / width;
        if (px >= boxLeft && px <= boxRight && py >= boxTop && py <= boxBottom) {
          boxOverlap++;
        }

        if (px > 0 && !isBg[p - 1] && !visited[p - 1]) {
          visited[p - 1] = 1;
          comp.push(p - 1);
        }
        if (px < width - 1 && !isBg[p + 1] && !visited[p + 1]) {
          visited[p + 1] = 1;
          comp.push(p + 1);
        }
        if (py > 0 && !isBg[p - width] && !visited[p - width]) {
          visited[p - width] = 1;
          comp.push(p - width);
        }
        if (py < height - 1 && !isBg[p + width] && !visited[p + width]) {
          visited[p + width] = 1;
          comp.push(p + width);
        }
      }

      if (comp.length > largestLen) largestLen = comp.length;
      components.push({ pixels: comp, boxOverlap });
    }

    const finalSubjectMask = new Uint8Array(total);
    for (const c of components) {
      const isPrimary = c.pixels.length === largestLen;
      const isSignificantInsideBox =
        c.pixels.length >= Math.max(120, Math.round(largestLen * 0.08)) &&
        c.boxOverlap >= c.pixels.length * 0.5;
      if (isPrimary || isSignificantInsideBox) {
        for (let k = 0; k < c.pixels.length; k++) {
          finalSubjectMask[c.pixels[k]] = 1;
        }
      }
    }

    // 4. Terapkan alpha mask dengan feathering 1px pada batas siluet
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        const idx = p * 4;
        if (!finalSubjectMask[p]) {
          data[idx + 3] = 0;
          continue;
        }
        const touchesBg =
          (x > 0 && !finalSubjectMask[p - 1]) ||
          (x < width - 1 && !finalSubjectMask[p + 1]) ||
          (y > 0 && !finalSubjectMask[p - width]) ||
          (y < height - 1 && !finalSubjectMask[p + width]);
        data[idx + 3] = touchesBg ? 185 : 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  /**
   * Estimasi kotak batas anatomi secara lokal berbasis deteksi cluster warna kulit (skin-tone)
   * sehingga mode offline / fallback tetap akurat untuk potret mana pun tanpa koordinat hardcoded.
   */
  private static detectAnatomyBoxesLocally(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    targetPart: string
  ): { targetBoxes: BoundingBox01000[]; excludeBoxes: BoundingBox01000[] } {
    const stride = Math.max(2, Math.round(Math.min(width, height) / 180));
    const maxFaceScanY = Math.floor(height * 0.72);
    const xs: number[] = [];
    const ys: number[] = [];

    for (let y = Math.floor(height * 0.06); y < maxFaceScanY; y += stride) {
      for (let x = Math.floor(width * 0.05); x < Math.floor(width * 0.95); x += stride) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];
        if (a < 128) continue;

        const maxCh = Math.max(r, g, b);
        const minCh = Math.min(r, g, b);
        if (
          r > 95 &&
          g > 40 &&
          b > 20 &&
          r > g &&
          r > b &&
          r - b > 15 &&
          Math.abs(r - g) < 115 &&
          maxCh - minCh > 15
        ) {
          xs.push((x / width) * 1000);
          ys.push((y / height) * 1000);
        }
      }
    }

    let faceBox: BoundingBox01000 | null = null;
    if (xs.length >= 25) {
      const sortedX = [...xs].sort((a, b) => a - b);
      const sortedY = [...ys].sort((a, b) => a - b);
      const medX = sortedX[Math.floor(sortedX.length * 0.5)];
      const medY = sortedY[Math.floor(sortedY.length * 0.5)];

      // Saring outlier (misal tangan di tepi) agar hanya mengambil klaster wajah utama
      const clusterX = sortedX.filter((vx) => Math.abs(vx - medX) <= 180);
      const clusterY = sortedY.filter((vy) => Math.abs(vy - medY) <= 180);

      if (clusterX.length >= 15 && clusterY.length >= 15) {
        const xmin = clusterX[Math.floor(clusterX.length * 0.08)];
        const xmax = clusterX[Math.floor(clusterX.length * 0.92)];
        const ymin = clusterY[Math.floor(clusterY.length * 0.08)];
        const ymax = clusterY[Math.floor(clusterY.length * 0.92)];
        faceBox = {
          ymin: Math.max(40, Math.round(ymin)),
          xmin: Math.max(40, Math.round(xmin)),
          ymax: Math.min(900, Math.round(Math.max(ymin + 85, ymax))),
          xmax: Math.min(960, Math.round(Math.max(xmin + 85, xmax))),
        };
      }
    }

    if (faceBox) {
      const fW = Math.max(90, faceBox.xmax - faceBox.xmin);
      const fH = Math.max(90, faceBox.ymax - faceBox.ymin);

      if (targetPart === "hair") {
        return {
          targetBoxes: [
            {
              ymin: Math.max(0, Math.round(faceBox.ymin - fH * 0.65)),
              xmin: Math.max(0, Math.round(faceBox.xmin - fW * 0.5)),
              ymax: Math.min(1000, Math.round(faceBox.ymin + fH * 0.85)),
              xmax: Math.min(1000, Math.round(faceBox.xmax + fW * 0.5)),
            },
          ],
          excludeBoxes: [
            {
              ymin: Math.round(faceBox.ymin + fH * 0.16),
              xmin: Math.round(faceBox.xmin + fW * 0.12),
              ymax: Math.round(faceBox.ymax),
              xmax: Math.round(faceBox.xmax - fW * 0.12),
            },
            {
              ymin: Math.min(990, Math.round(faceBox.ymax + fH * 0.05)),
              xmin: Math.max(0, Math.round(faceBox.xmin - fW * 0.9)),
              ymax: 1000,
              xmax: Math.min(1000, Math.round(faceBox.xmax + fW * 0.9)),
            },
          ],
        };
      }

      if (targetPart === "face" || targetPart === "skin") {
        return { targetBoxes: [faceBox], excludeBoxes: [] };
      }

      if (
        targetPart === "clothes" ||
        targetPart === "suit" ||
        targetPart === "shirt" ||
        targetPart === "baju"
      ) {
        return {
          targetBoxes: [
            {
              ymin: Math.min(980, Math.round(faceBox.ymax - fH * 0.05)),
              xmin: Math.max(0, Math.round(faceBox.xmin - fW * 1.1)),
              ymax: Math.min(1000, Math.round(faceBox.ymax + fH * 3.0)),
              xmax: Math.min(1000, Math.round(faceBox.xmax + fW * 1.1)),
            },
          ],
          excludeBoxes: [faceBox],
        };
      }
    }

    // Fallback anatomi simetris netral (jika potret tidak terdeteksi cluster kulitnya)
    if (targetPart === "hair") {
      return {
        targetBoxes: [{ ymin: 70, xmin: 220, ymax: 480, xmax: 780 }],
        excludeBoxes: [
          { ymin: 220, xmin: 340, ymax: 460, xmax: 660 },
          { ymin: 480, xmin: 180, ymax: 980, xmax: 820 },
        ],
      };
    }

    if (targetPart === "clothes" || targetPart === "suit" || targetPart === "shirt" || targetPart === "baju") {
      return {
        targetBoxes: [{ ymin: 420, xmin: 200, ymax: 960, xmax: 800 }],
        excludeBoxes: [{ ymin: 150, xmin: 320, ymax: 440, xmax: 680 }],
      };
    }

    return {
      targetBoxes: [{ ymin: 120, xmin: 120, ymax: 880, xmax: 880 }],
      excludeBoxes: [],
    };
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

    // Normalisasi Target & Exclude Boxes secara dinamis berbasis anatomi lokal bila belum dipasok AI
    const localAnatomy =
      !targetBoxes || targetBoxes.length === 0 || (targetPart === "hair" && (!excludeBoxes || excludeBoxes.length === 0))
        ? this.detectAnatomyBoxesLocally(data, width, height, targetPart)
        : null;

    const rawTargetBoxes =
      targetBoxes && targetBoxes.length > 0
        ? targetBoxes
        : localAnatomy!.targetBoxes;

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
        : localAnatomy?.excludeBoxes || [];

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

    // Masker piksel target (1 = harus diwarnai) — jalur non-rambut
    const targetMask = new Uint8Array(width * height);
    const weightMask = new Float32Array(width * height);

    if (targetPart === "hair") {
      // Rambut: soft-matte (alpha parsial, shading terjaga, tanpa koordinat khusus gambar)
      const hairSamples = sourceClusters.filter((c) => Math.max(c[0], c[1], c[2]) >= 16);
      const matte = recolorHairSoftMatte(data, width, height, pixelTargetBoxes, targetRgb, hairSamples);
      if (matte.corePixels === 0) {
        console.warn("[recolorTargetPart] Inti rambut tidak ditemukan di dalam targetBoxes; foto tidak diubah.");
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
          const lumCheck = 0.299 * r + 0.587 * g + 0.114 * b;
          // Pertahankan garis tinta hitam (ink outline) dan bayangan lipatan terdalam
          if (maxVal < 36 && lumCheck < 32) continue;

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
          // Kurva Soft-Shadow Luminance Preservation: bayangan gelap meredup proporsional tanpa menjadi stiker datar
          const normalizedLum = lum / 255;
          const shadowPreservingScale =
            normalizedLum < 0.25
              ? Math.pow(normalizedLum / 0.25, 1.35) * 0.45
              : 0.45 + ((normalizedLum - 0.25) / 0.75) * 0.75;
          newR = Math.min(255, Math.round(targetRgb[0] * shadowPreservingScale));
          newG = Math.min(255, Math.round(targetRgb[1] * shadowPreservingScale));
          newB = Math.min(255, Math.round(targetRgb[2] * shadowPreservingScale));
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
      saturation = 0,
      grayscale = false,
      invert = false,
      watermarkText = "",
      watermarkColor = "#ffffff",
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

    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();

    // Terapkan filter visual global (brightness, contrast, saturation, grayscale, invert)
    const filters = [
      `brightness(${100 + brightness}%)`,
      `contrast(${100 + contrast}%)`,
      saturation !== 0 ? `saturate(${100 + saturation}%)` : "",
      grayscale ? "grayscale(100%)" : "",
      invert ? "invert(100%)" : "",
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

      ctx.fillStyle = watermarkColor || "#ffffff";
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
