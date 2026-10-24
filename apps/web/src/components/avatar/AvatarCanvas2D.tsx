import React, { useEffect, useRef, useState, useMemo } from "react";
import { EmotionType, LookAtTarget } from "@celyn/shared";
import { Sparkles, HelpCircle, Smile, AlertCircle, Heart } from "lucide-react";

interface AvatarCanvas2DProps {
  emotion: EmotionType;
  mouthOpen: number; // 0.0 - 1.0 (RMS amplitude)
  isSpeaking: boolean;
  lookAt: LookAtTarget | null;
}

export const AvatarCanvas2D: React.FC<AvatarCanvas2DProps> = ({
  emotion,
  mouthOpen,
  isSpeaking,
  lookAt,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = useState({ x: 0.5, y: 0.5 });
  const [isBlinking, setIsBlinking] = useState(false);

  // Reference gambar sumber
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Muat gambar celyn_perfect.png
  useEffect(() => {
    const img = new Image();
    img.src = "/celyn_perfect.png";
    img.onload = () => {
      imageRef.current = img;
      setImageLoaded(true);
    };
  }, []);

  // Mouse gaze tracking
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      setMousePos({ x: normX, y: normY });
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // Siklus Kedipan Alami (acak tiap 3-5 detik)
  useEffect(() => {
    let blinkTimeout: number;

    const scheduleBlink = () => {
      const delay = Math.random() * 2600 + 2400;
      blinkTimeout = window.setTimeout(() => {
        setIsBlinking(true);
        setTimeout(() => {
          setIsBlinking(false);
          scheduleBlink();
        }, 160); // Durasi kedipan ~160ms
      }, delay);
    };

    scheduleBlink();
    return () => clearTimeout(blinkTimeout);
  }, []);

  // Arah Tatapan Mata
  const gazeTarget = useMemo(() => {
    if (lookAt) {
      return { x: lookAt.x, y: lookAt.y };
    }
    return mousePos;
  }, [lookAt, mousePos]);

  // Konfigurasi Emosi
  const emotionConfig = {
    happy: {
      label: "Senang",
      icon: Smile,
      glowColor: "rgba(244, 63, 94, 0.4)",
      borderColor: "border-rose-500/40",
      textColor: "text-rose-300",
    },
    thinking: {
      label: "Menganalisis",
      icon: HelpCircle,
      glowColor: "rgba(245, 158, 11, 0.4)",
      borderColor: "border-amber-500/40",
      textColor: "text-amber-300",
    },
    surprised: {
      label: "Terkesan!",
      icon: AlertCircle,
      glowColor: "rgba(6, 182, 212, 0.4)",
      borderColor: "border-cyan-500/40",
      textColor: "text-cyan-300",
    },
    neutral: {
      label: "Siaga",
      icon: Sparkles,
      glowColor: "rgba(99, 102, 241, 0.3)",
      borderColor: "border-indigo-500/40",
      textColor: "text-indigo-300",
    },
    sad: {
      label: "Empati",
      icon: Heart,
      glowColor: "rgba(59, 130, 246, 0.3)",
      borderColor: "border-blue-500/40",
      textColor: "text-blue-300",
    },
  }[emotion] || {
    label: "Aktif",
    icon: Sparkles,
    glowColor: "rgba(244, 63, 94, 0.3)",
    borderColor: "border-rose-500/40",
    textColor: "text-rose-300",
  };

  const EmotionIcon = emotionConfig.icon;
  const mouthScale = Math.min(1.0, Math.max(0, mouthOpen * 1.8));

  // LOOP RENDERING DEFORMASI CANVAS (Live2D-Style 2D Mesh Animation)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageLoaded || !imageRef.current) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = imageRef.current;
    const cw = canvas.width;  // 768
    const ch = canvas.height; // 1024

    let animId: number;
    let startTime = performance.now();

    const render = (now: number) => {
      const t = (now - startTime) / 1000;

      ctx.clearRect(0, 0, cw, ch);

      // --- FISIKA INTERNAL ---
      // 1. Pernapasan internal dada (tanpa menggoyang kanvas/bingkai!)
      const breath = Math.sin(t * 1.8);
      // 2. Ombak angin rambut depan kiri & kanan
      const hairWindL = Math.sin(t * 2.6);
      const hairWindR = Math.sin(t * 2.3 + 1.2);
      // 3. Ayunan tangan & pergelangan tangan kiri (gelang) dan kanan (jam)
      const armSwingL = Math.sin(t * 1.8 - 0.4);
      const armSwingR = Math.sin(t * 1.8 + 0.4);

      // Kemiringan kepala halus (berputar pada leher x=384, y=400)
      let headAngle = (gazeTarget.x - 0.5) * 0.05;
      if (emotion === "thinking") {
        headAngle += 0.08;
      } else if (emotion === "happy") {
        headAngle -= 0.03;
      }

      // ==========================================
      // A. GAMBAR TUBUH DASAR & DADA BERNAPAS
      // ==========================================
      // Slicing horizontal dari y=0 s/d y=1024
      const sliceH = 8;
      for (let y = 0; y < ch; y += sliceH) {
        let drawX = 0;
        let drawW = cw;

        // Dada dan tulang rusuk (y=440 s/d y=840) mengembang-mengempis perlahan
        if (y >= 440 && y <= 840) {
          const factor = Math.sin(((y - 440) / 400) * Math.PI); // Puncak di tengah dada
          const expand = breath * 7 * factor;
          drawX = -expand / 2;
          drawW = cw + expand;
        }

        ctx.drawImage(img, 0, y, cw, sliceH, drawX, y, drawW, sliceH);
      }

      // ==========================================
      // B. DEFORMASI AYUNAN TANGAN KIRI (GELANG)
      // x: 120..220, y: 550..1010
      // ==========================================
      for (let y = 550; y < 1010; y += 6) {
        const progress = (y - 550) / 460; // 0 di siku, 1 di pergelangan tangan
        const offsetL = armSwingL * 7 * Math.pow(progress, 1.4);
        ctx.drawImage(img, 120, y, 100, 6, 120 + offsetL, y, 100, 6);
      }

      // ==========================================
      // C. DEFORMASI AYUNAN TANGAN KANAN (JAM TANGAN)
      // x: 550..650, y: 550..1010
      // ==========================================
      for (let y = 550; y < 1010; y += 6) {
        const progress = (y - 550) / 460;
        const offsetR = armSwingR * -7 * Math.pow(progress, 1.4);
        ctx.drawImage(img, 550, y, 100, 6, 550 + offsetR, y, 100, 6);
      }

      // ==========================================
      // D. DEFORMASI RAMBUT DEPAN SISI KIRI
      // x: 230..360, y: 220..680
      // ==========================================
      for (let y = 220; y < 680; y += 4) {
        const progress = (y - 220) / 460; // 0 di akar kepala, 1 di ujung bawah
        const dxL = Math.sin(t * 2.8 + y * 0.015) * 8.5 * Math.pow(progress, 1.3);
        ctx.drawImage(img, 230, y, 130, 4, 230 + dxL, y, 130, 4);
      }

      // ==========================================
      // E. DEFORMASI RAMBUT DEPAN SISI KANAN
      // x: 410..540, y: 220..680
      // ==========================================
      for (let y = 220; y < 680; y += 4) {
        const progress = (y - 220) / 460;
        const dxR = Math.sin(t * 2.5 + 1.2 + y * 0.015) * 8.5 * Math.pow(progress, 1.3);
        ctx.drawImage(img, 410, y, 130, 4, 410 + dxR, y, 130, 4);
      }

      // ==========================================
      // F. DETAIL WAJAH: MATA, KEDIPAN & MULUT
      // ==========================================
      const eyeL = { x: 336, y: 252 };
      const eyeR = { x: 432, y: 252 };
      const pupilX = (gazeTarget.x - 0.5) * 7;
      const pupilY = (gazeTarget.y - 0.5) * 5;

      if (isBlinking) {
        // --- KELOPAK MATA TERTUTUP (KEDIPAN ALAMI) ---
        // Tutup area soket mata kiri dengan warna kulit alami dan lengkungan bulu mata
        ctx.save();
        ctx.fillStyle = "#edd5c8";
        ctx.beginPath();
        ctx.ellipse(eyeL.x, eyeL.y + 2, 20, 11, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "#382017";
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.arc(eyeL.x, eyeL.y + 3, 16, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();

        // Bulu mata lentik kiri
        ctx.beginPath();
        ctx.moveTo(eyeL.x + 13, eyeL.y + 6);
        ctx.lineTo(eyeL.x + 18, eyeL.y + 3);
        ctx.stroke();

        // Soket mata kanan
        ctx.beginPath();
        ctx.ellipse(eyeR.x, eyeR.y + 2, 20, 11, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "#382017";
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.arc(eyeR.x, eyeR.y + 3, 16, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();

        // Bulu mata lentik kanan
        ctx.beginPath();
        ctx.moveTo(eyeR.x - 13, eyeR.y + 6);
        ctx.lineTo(eyeR.x - 18, eyeR.y + 3);
        ctx.stroke();
        ctx.restore();
      } else {
        // --- MATA TERBUKA: KILAU & PUPIL MENGIKUTI KURSOR ---
        ctx.save();
        // Pupil mata kiri
        ctx.fillStyle = "#1e120d";
        ctx.beginPath();
        ctx.ellipse(eyeL.x + pupilX, eyeL.y + pupilY, 6, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        // Pantulan cahaya mata kiri
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.beginPath();
        ctx.arc(eyeL.x + pupilX - 2, eyeL.y + pupilY - 3, 2, 0, Math.PI * 2);
        ctx.fill();

        // Pupil mata kanan
        ctx.fillStyle = "#1e120d";
        ctx.beginPath();
        ctx.ellipse(eyeR.x + pupilX, eyeR.y + pupilY, 6, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        // Pantulan cahaya mata kanan
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.beginPath();
        ctx.arc(eyeR.x + pupilX - 2, eyeR.y + pupilY - 3, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // ==========================================
      // G. MULUT DINAMIS (LIP-SYNC SUARA CELYN)
      // ==========================================
      if (isSpeaking && mouthScale > 0.05) {
        ctx.save();
        const mouthX = 384;
        const mouthY = 338;
        const mW = 16 + mouthScale * 14;
        const mH = 5 + mouthScale * 18;

        // Rongga mulut
        ctx.fillStyle = "#691f1f";
        ctx.beginPath();
        ctx.ellipse(mouthX, mouthY, mW, mH, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#401313";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Gigi atas
        if (mouthScale > 0.2) {
          ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
          ctx.beginPath();
          ctx.rect(mouthX - mW * 0.65, mouthY - mH + 1, mW * 1.3, mH * 0.45);
          ctx.fill();
        }

        // Lidah
        if (mouthScale > 0.35) {
          ctx.fillStyle = "#f472b6";
          ctx.beginPath();
          ctx.ellipse(mouthX, mouthY + mH * 0.5, mW * 0.6, mH * 0.4, 0, 0, Math.PI);
          ctx.fill();
        }
        ctx.restore();
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [imageLoaded, isBlinking, isSpeaking, mouthScale, gazeTarget, emotion]);

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col items-center justify-center w-full h-full select-none overflow-hidden"
    >
      {/* Halo Gelombang Suara (tetap halus di latar) */}
      {isSpeaking && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
          <div
            className="w-[480px] h-[480px] rounded-full border border-rose-500/25 animate-ping"
            style={{
              animationDuration: "2.5s",
              transform: `scale(${1 + mouthScale * 0.25})`,
            }}
          />
          <div
            className="absolute w-[620px] h-[620px] rounded-full border border-pink-500/15 animate-pulse"
            style={{ animationDuration: "3.5s" }}
          />
        </div>
      )}

      {/* Aura Cahaya Halus di Belakang Celyn */}
      <div
        className="absolute w-[440px] h-[440px] rounded-full blur-3xl transition-all duration-700 pointer-events-none"
        style={{
          background: emotionConfig.glowColor,
          transform: isSpeaking ? `scale(${1.15 + mouthScale * 0.2})` : "scale(1)",
          opacity: isSpeaking ? 0.85 : 0.45,
        }}
      />

      {/* Badge Status Emosi */}
      <div
        className={`absolute top-6 z-30 flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-pill border ${emotionConfig.borderColor} shadow-xl text-xs font-medium text-slate-200 transition-colors duration-300`}
      >
        <EmotionIcon className={`w-4 h-4 ${emotionConfig.textColor} animate-pulse`} />
        <span>Celyn:</span>
        <span className={`font-semibold ${emotionConfig.textColor}`}>
          {emotionConfig.label}
        </span>
      </div>

      {/* STAGE KANVAS CELYN (BINGKAI 100% KOKOH & DIAM DI TEMPAT!) */}
      <div className="relative z-10 w-full max-w-[440px] h-[580px] flex items-end justify-center pointer-events-none">
        <canvas
          ref={canvasRef}
          width={768}
          height={1024}
          className="w-full h-full object-contain filter drop-shadow-2xl"
        />
      </div>

      {/* Indikator Reticle LookAt jika sedang fokus pada elemen layar */}
      {lookAt && (
        <div className="absolute bottom-5 left-6 z-30 flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900/90 border border-cyan-500/50 text-xs text-cyan-300 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-left-3">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500" />
          </span>
          <span className="font-medium">
            Fokus Layar:{" "}
            <span className="text-white">
              {lookAt.description || `X: ${Math.round(lookAt.x * 100)}%, Y: ${Math.round(lookAt.y * 100)}%`}
            </span>
          </span>
        </div>
      )}
    </div>
  );
};
