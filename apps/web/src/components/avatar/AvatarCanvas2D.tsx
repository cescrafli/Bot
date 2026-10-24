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
  const containerRef = useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = useState({ x: 0.5, y: 0.5 });
  const [isBlinking, setIsBlinking] = useState(false);

  // Fisika Pernapasan & Kemiringan Kepala Alami
  const [breath, setBreath] = useState(0);

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

  // Loop Pernapasan Halus (60 FPS - Halus & Organik)
  useEffect(() => {
    let animId: number;
    const startTime = performance.now();

    const loop = (now: number) => {
      const t = (now - startTime) / 1000;
      // Ritme napas dada halus (periode ~3.8 detik)
      setBreath(Math.sin(t * 1.65));
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Siklus Kedipan Alami Mata (acak tiap 3-5 detik)
  useEffect(() => {
    let blinkTimeout: number;

    const scheduleBlink = () => {
      const delay = Math.random() * 2800 + 2200;
      blinkTimeout = window.setTimeout(() => {
        setIsBlinking(true);
        setTimeout(() => {
          setIsBlinking(false);
          scheduleBlink();
        }, 150); // Durasi kedipan ~150ms
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

  // Offset pergerakan pupil mata (0..1 -> -5px s/d +5px)
  const pupilOffsetX = (gazeTarget.x - 0.5) * 6;
  const pupilOffsetY = (gazeTarget.y - 0.5) * 4;

  // Kemiringan Kepala Halus saat berpikir atau melihat kursor
  let headTilt = (gazeTarget.x - 0.5) * 2.8;
  if (emotion === "thinking") {
    headTilt += 4.5; // Kepala miring saat sedang menganalisis
  } else if (emotion === "happy") {
    headTilt -= 1.8;
  }

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

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col items-center justify-center w-full h-full select-none overflow-hidden"
    >
      {/* Halo gelombang suara saat Celyn berbicara */}
      {isSpeaking && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
          <div
            className="w-[480px] h-[480px] rounded-full border border-rose-500/25 animate-ping"
            style={{
              animationDuration: "2.4s",
              transform: `scale(${1 + mouthScale * 0.25})`,
            }}
          />
          <div
            className="absolute w-[620px] h-[620px] rounded-full border border-pink-500/15 animate-pulse"
            style={{ animationDuration: "3.2s" }}
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

      {/* STAGE UTAMA AVATAR CELYN */}
      <div className="relative z-10 w-full max-w-[440px] h-[580px] flex items-end justify-center pointer-events-none">
        
        {/* GAMBAR KARAKTER CELYN UTUH & BERSIH (Tanpa garis robek/seam glitch) */}
        <div
          className="relative w-full h-full flex items-end justify-center"
          style={{
            transformOrigin: "50% 90%", // Poros pernapasan di pinggang
            transform: `translateY(${breath * -3}px) scaleY(${1 + breath * 0.008})`,
            transition: "transform 0.05s linear",
          }}
        >
          <img
            src="/celyn_clean_cutout.png"
            alt="Celyn Avatar"
            className="w-full h-full object-contain filter drop-shadow-2xl"
          />

          {/* LAYER KEPALA, MATA & MULUT (Condong halus mengikuti kursor/emosi) */}
          <div
            className="absolute inset-0 w-full h-full"
            style={{
              transformOrigin: "50% 39%", // Poros leher
              transform: `rotate(${headTilt}deg)`,
              transition: "transform 0.08s ease-out",
            }}
          >
            {/* ANIMASI KEDIPAN MATA ALAMI */}
            <div
              className="absolute z-20 flex justify-between items-center"
              style={{
                top: "23.4%",
                left: "50%",
                transform: "translateX(-50%)",
                width: "106px",
                height: "22px",
                padding: "0 8px",
              }}
            >
              {/* Mata Kiri */}
              <div className="relative w-8 h-4 flex items-center justify-center overflow-hidden">
                {isBlinking ? (
                  // Kelopak mata menutup halus dengan lengkungan bulu mata alami
                  <div className="w-full h-2 rounded-full bg-[#382017] shadow-sm border-b border-[#231510] animate-in fade-in duration-75" />
                ) : (
                  // Pupil mata melirik kursor
                  <div
                    className="w-3.5 h-3.5 rounded-full bg-[#1e120d] shadow-inner transition-transform duration-75 flex items-center justify-center"
                    style={{
                      transform: `translate(${pupilOffsetX}px, ${pupilOffsetY}px)`,
                    }}
                  >
                    <div className="w-1 h-1 rounded-full bg-white/95 self-start ml-0.5 mt-0.5" />
                  </div>
                )}
              </div>

              {/* Mata Kanan */}
              <div className="relative w-8 h-4 flex items-center justify-center overflow-hidden">
                {isBlinking ? (
                  // Kelopak mata menutup halus
                  <div className="w-full h-2 rounded-full bg-[#382017] shadow-sm border-b border-[#231510] animate-in fade-in duration-75" />
                ) : (
                  // Pupil mata melirik kursor
                  <div
                    className="w-3.5 h-3.5 rounded-full bg-[#1e120d] shadow-inner transition-transform duration-75 flex items-center justify-center"
                    style={{
                      transform: `translate(${pupilOffsetX}px, ${pupilOffsetY}px)`,
                    }}
                  >
                    <div className="w-1 h-1 rounded-full bg-white/95 self-start ml-0.5 mt-0.5" />
                  </div>
                )}
              </div>
            </div>

            {/* ANIMASI MULUT BERBICARA (LIP-SYNC SUARA CELYN) */}
            {isSpeaking && mouthScale > 0.05 && (
              <div
                className="absolute z-25 flex flex-col items-center justify-between overflow-hidden shadow-inner transition-all duration-75"
                style={{
                  top: "30.4%",
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: `${Math.round(26 + mouthScale * 14)}px`,
                  height: `${Math.round(8 + mouthScale * 20)}px`,
                  backgroundColor: "#6e2121",
                  borderRadius:
                    mouthScale > 0.45
                      ? "45% 45% 50% 50% / 30% 30% 70% 70%"
                      : "50% 50% 40% 40% / 30% 30% 70% 70%",
                  border: "1.5px solid #4a1515",
                  boxShadow: "inset 0 2px 4px rgba(0,0,0,0.6)",
                }}
              >
                {/* Gigi Atas */}
                <div
                  className="w-3/4 h-2 bg-white/95 rounded-b-sm mt-0.5 transition-opacity duration-75"
                  style={{ opacity: mouthScale > 0.22 ? 1 : 0 }}
                />

                {/* Lidah */}
                <div
                  className="w-2/3 h-2.5 bg-rose-400 rounded-t-full mb-0.5 transition-all duration-75"
                  style={{ opacity: mouthScale > 0.35 ? 0.95 : 0 }}
                />
              </div>
            )}
          </div>
        </div>
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
