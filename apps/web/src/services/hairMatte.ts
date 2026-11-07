/**
 * Soft-Matte Hair Recolor (v5)
 *
 * Mewarnai rambut secara halus & natural tanpa koordinat khusus gambar:
 *  1. Inti rambut  = komponen terhubung terbesar dari piksel berklas "rambut" di dalam targetBoxes.
 *  2. Jambul/uban  = piksel netral-terang yang tumbuh terbatas dari inti rambut.
 *  3. Closing r=2  = menyerap garis helai internal; kontur luar tetap tinta asli.
 *  4. Soft matte   = pita 2px, alpha dari unmixing warna latar lokal, recolor di foreground.
 *  5. Tone mapping = luminansi dipetakan ke rentang lebar (bayangan -> sorotan) agar volume tetap terlihat.
 *
 * Modul ini murni (tanpa DOM) sehingga dapat diuji langsung di Node.
 */

export interface PixelBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface HairMatteResult {
  /** Jumlah piksel inti rambut (komponen terbesar) */
  corePixels: number;
  /** Jumlah piksel yang diwarnai penuh (alpha = 1) */
  coloredPixels: number;
  /** Jumlah piksel tepi dengan alpha parsial (anti-alias) */
  softPixels: number;
}

type Rgb = [number, number, number];

const lumOf = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const colorDist = (a: Rgb, b: Rgb) =>
  Math.sqrt(2 * (a[0] - b[0]) ** 2 + 4 * (a[1] - b[1]) ** 2 + 3 * (a[2] - b[2]) ** 2);

export function isWarmSkin(r: number, g: number, b: number): boolean {
  const c = (r - b) / Math.max(r, 1);
  return r > 105 && g > 65 && c >= 0.33 && g - b >= 18 && r - g >= 25;
}

export function isFoliageOrDirt(r: number, g: number, b: number): boolean {
  const foliage =
    g >= 26 &&
    g > b * 1.35 &&
    (g >= r * 0.62 || (b < 25 && g >= 34 && r < 130 && r < g * 1.75)) &&
    !(r >= 36 && g <= 30 && b <= 16 && r >= g * 1.75);
  const dirt = r >= 72 && g >= 42 && b <= 55 && g >= r * 0.55;
  return foliage || dirt;
}

function isBrownHair(r: number, g: number, b: number): boolean {
  return r >= 16 && r <= 95 && g >= 2 && g <= 48 && b <= 34 && r - b >= 12 && r >= g * 1.45;
}

function isNeutralLight(r: number, g: number, b: number): boolean {
  const c = (r - b) / Math.max(r, 1);
  const l = lumOf(r, g, b);
  return l >= 80 && l <= 215 && c <= 0.33 && Math.abs(g - b) <= 22 && r >= 68 && b >= 46;
}

export function recolorHairSoftMatte(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  boxes: PixelBox[],
  targetRgb: Rgb,
  hairSamples: Rgb[] = []
): HairMatteResult {
  const N = width * height;
  const empty: HairMatteResult = { corePixels: 0, coloredPixels: 0, softPixels: 0 };
  if (!boxes.length) return empty;

  const px = (i: number): Rgb => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
  const lumI = (i: number) => lumOf(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  const inBox = (x: number, y: number) =>
    boxes.some((b) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY);

  // Jendela kerja = gabungan box + margin (membatasi biaya morfologi)
  const margin = 6;
  const win = {
    x0: Math.max(0, Math.min(...boxes.map((b) => b.minX)) - margin),
    x1: Math.min(width - 1, Math.max(...boxes.map((b) => b.maxX)) + margin),
    y0: Math.max(0, Math.min(...boxes.map((b) => b.minY)) - margin),
    y1: Math.min(height - 1, Math.max(...boxes.map((b) => b.maxY)) + margin),
  };

  // Sampel warna rambut dari Vision hanya dipakai bila valid (bukan rumput/tanah/kulit)
  const samples = hairSamples.filter(
    ([r, g, b]) => !isFoliageOrDirt(r, g, b) && !isWarmSkin(r, g, b) && Math.max(r, g, b) >= 16
  );
  const isHairColor = (r: number, g: number, b: number): boolean => {
    if (isFoliageOrDirt(r, g, b) || isWarmSkin(r, g, b)) return false;
    if (isBrownHair(r, g, b)) return true;
    for (const s of samples) if (colorDist([r, g, b], s) <= 40 && Math.max(r, g, b) >= 16) return true;
    return false;
  };

  // 1. Inti rambut: komponen terhubung terbesar di dalam box
  const cls = new Uint8Array(N);
  for (let y = win.y0; y <= win.y1; y++) {
    for (let x = win.x0; x <= win.x1; x++) {
      if (!inBox(x, y)) continue;
      const i = y * width + x;
      const [r, g, b] = px(i);
      if (isHairColor(r, g, b)) cls[i] = 1;
    }
  }
  const comp = new Int32Array(N).fill(-1);
  const sizes: number[] = [];
  for (let s = win.y0 * width; s < (win.y1 + 1) * width; s++) {
    if (!cls[s] || comp[s] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    const q = [s];
    comp[s] = id;
    for (let h = 0; h < q.length; h++) {
      const c = q[h];
      const cx = c % width;
      const cy = (c / width) | 0;
      n++;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          if (cls[ni] && comp[ni] < 0) {
            comp[ni] = id;
            q.push(ni);
          }
        }
      }
    }
    sizes.push(n);
  }
  if (!sizes.length) return empty;
  let best = 0;
  sizes.forEach((s, i) => {
    if (s > sizes[best]) best = i;
  });
  if (sizes[best] < 30) return empty;

  const mask = new Uint8Array(N);
  let core = 0;
  for (let i = 0; i < N; i++) {
    if (comp[i] === best) {
      mask[i] = 1;
      core++;
    }
  }

  // 2. Jambul / uban: piksel netral-terang yang tumbuh terbatas dari inti
  {
    const streak: number[] = [];
    const seen = new Uint8Array(N);
    let frontier: number[] = [];
    for (let i = 0; i < N; i++) if (mask[i]) frontier.push(i);
    for (let hop = 0; hop < 40 && frontier.length; hop++) {
      const next: number[] = [];
      for (const c of frontier) {
        const cx = c % width;
        const cy = (c / width) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (!inBox(nx, ny)) continue;
            const ni = ny * width + nx;
            if (mask[ni] || seen[ni]) continue;
            const [r, g, b] = px(ni);
            if (isNeutralLight(r, g, b) && !isWarmSkin(r, g, b)) {
              seen[ni] = 1;
              streak.push(ni);
              next.push(ni);
            }
          }
        }
      }
      frontier = next;
    }
    // Pengaman: bila "jambul" terlalu besar (mis. latar abu-abu), buang
    if (streak.length <= core * 0.15) for (const i of streak) mask[i] = 2;
  }

  // 3. Closing morfologi r=2 (hanya dalam jendela kerja)
  const morph = (m: Uint8Array, r: number, wantAny: boolean): Uint8Array => {
    const o = new Uint8Array(N);
    for (let y = win.y0; y <= win.y1; y++) {
      for (let x = win.x0; x <= win.x1; x++) {
        let v = wantAny ? 0 : 1;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            const on = nx >= 0 && ny >= 0 && nx < width && ny < height && m[ny * width + nx] > 0;
            if (wantAny && on) v = 1;
            if (!wantAny && !on) v = 0;
          }
        }
        o[y * width + x] = v;
      }
    }
    return o;
  };
  const bin = new Uint8Array(N);
  for (let i = 0; i < N; i++) bin[i] = mask[i] > 0 ? 1 : 0;
  const closed = morph(morph(bin, 2, true), 2, false);
  const strandInk = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (closed[i] && !bin[i]) {
      const [r, g, b] = px(i);
      if (!isWarmSkin(r, g, b) && !isFoliageOrDirt(r, g, b)) strandInk[i] = 1;
      else closed[i] = 0;
    }
  }

  // 4. Soft matte pada pita 2px
  const dil = morph(closed, 2, true);
  const hairMean: Rgb = [0, 0, 0];
  {
    let n = 0;
    for (let i = 0; i < N; i++) {
      if (mask[i] === 1) {
        const p = px(i);
        hairMean[0] += p[0];
        hairMean[1] += p[1];
        hairMean[2] += p[2];
        n++;
      }
    }
    for (let k = 0; k < 3; k++) hairMean[k] /= Math.max(1, n);
  }
  const localBg = (x: number, y: number): Rgb | null => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (dil[ni] || lumI(ni) < 30) continue;
        const p = px(ni);
        r += p[0];
        g += p[1];
        b += p[2];
        n++;
      }
    }
    return n ? [r / n, g / n, b / n] : null;
  };

  const alpha = new Float32Array(N);
  const fg = new Float32Array(N * 3);
  const bg = new Float32Array(N * 3);
  let soft = 0;
  for (let y = win.y0; y <= win.y1; y++) {
    for (let x = win.x0; x <= win.x1; x++) {
      const i = y * width + x;
      if (closed[i]) {
        alpha[i] = 1;
        const p = px(i);
        fg[i * 3] = p[0];
        fg[i * 3 + 1] = p[1];
        fg[i * 3 + 2] = p[2];
        continue;
      }
      if (!dil[i]) continue;
      const C = px(i);
      const l = lumI(i);
      if (l < 22) continue; // kontur tinta luar dipertahankan
      const B = localBg(x, y);
      if (!B) continue;
      const dh = colorDist(C, hairMean);
      const db = colorDist(C, B);
      let a = db / (dh + db + 1e-6);
      a = smooth(0.4, 0.8, a) * smooth(22, 40, l); // piksel campuran tinta tidak ikut terang
      if (a <= 0.02) continue;
      alpha[i] = a;
      soft++;
      for (let k = 0; k < 3; k++) {
        fg[i * 3 + k] = Math.min(255, Math.max(0, (C[k] - (1 - a) * B[k]) / a));
        bg[i * 3 + k] = B[k];
      }
    }
  }

  // 5. Tone mapping luminance-preserving berdimensi
  const isWhite = targetRgb[0] >= 220 && targetRgb[1] >= 220 && targetRgb[2] >= 220;
  const hi: Rgb = isWhite ? [253, 253, 254] : [targetRgb[0], targetRgb[1], targetRgb[2]];
  const shadowFor = (ink: boolean): Rgb =>
    isWhite
      ? ink
        ? [108, 111, 124]
        : [180, 183, 194]
      : ink
      ? [hi[0] * 0.3, hi[1] * 0.3, hi[2] * 0.3]
      : [hi[0] * 0.42, hi[1] * 0.42, hi[2] * 0.42];

  let colored = 0;
  for (let i = 0; i < N; i++) {
    const a = alpha[i];
    if (a <= 0) continue;
    const l = lumOf(fg[i * 3], fg[i * 3 + 1], fg[i * 3 + 2]);
    const t = Math.pow(Math.min(1, Math.max(0, (l - 10) / 70)), 0.8);
    const sh = shadowFor(strandInk[i] === 1);
    const di = i * 4;
    for (let k = 0; k < 3; k++) {
      const tone = sh[k] + (hi[k] - sh[k]) * t;
      data[di + k] = a >= 0.999 ? Math.round(tone) : Math.round(a * tone + (1 - a) * bg[i * 3 + k]);
    }
    if (a >= 0.999) colored++;
  }

  return { corePixels: core, coloredPixels: colored, softPixels: soft };
}
