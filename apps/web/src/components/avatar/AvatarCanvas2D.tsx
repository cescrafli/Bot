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
  const [isBlinking, setIsBlinking] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0.5, y: 0.5 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Track pergerakan mouse kursor untuk eye-tracking alami saat tidak ada point_at_screen
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

  // Siklus Kedipan Mata Alami (acak tiap 3-5.5 detik)
  useEffect(() => {
    let blinkTimeout: number;

    const scheduleBlink = () => {
      const delay = Math.random() * 2800 + 2600;
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

  // Tentukan arah tatapan mata (prioritaskan lookAt dari AI jika aktif, atau kursor mouse)
  const gazeTarget = useMemo(() => {
    if (lookAt) {
      return { x: lookAt.x, y: lookAt.y };
    }
    return mousePos;
  }, [lookAt, mousePos]);

  // Offset pergerakan pupil mata (-4px s/d +4px)
  const pupilOffsetX = (gazeTarget.x - 0.5) * 6;
  const pupilOffsetY = (gazeTarget.y - 0.5) * 5;

  // Sudut kemiringan kepala (tilt)
  let headTilt = (gazeTarget.x - 0.5) * 3;
  if (emotion === "thinking") {
    headTilt = 5.2; // Kepala miring saat sedang menganalisis
  } else if (emotion === "happy") {
    headTilt = -2.0;
  }

  // Konfigurasi visual emosi
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

  // Nilai pembukaan mulut yang telah diamplifikasi & dihaluskan
  const mouthScale = Math.min(1.0, Math.max(0, mouthOpen * 1.8));

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col items-center justify-center w-full h-full select-none overflow-hidden"
    >
      {/* Gelombang Audio Halo Rings di belakang avatar saat berbicara */}
      {isSpeaking && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
          <div
            className="w-[450px] h-[450px] rounded-full border border-rose-500/30 animate-ping"
            style={{
              animationDuration: "2.2s",
              transform: `scale(${1 + mouthScale * 0.3})`,
            }}
          />
          <div
            className="absolute w-[580px] h-[580px] rounded-full border border-pink-500/15 animate-pulse"
            style={{ animationDuration: "3s" }}
          />
        </div>
      )}

      {/* Aura Cahaya Halus di Belakang Celyn */}
      <div
        className="absolute w-[440px] h-[440px] rounded-full blur-3xl transition-all duration-700 pointer-events-none"
        style={{
          background: emotionConfig.glowColor,
          transform: isSpeaking ? `scale(${1.15 + mouthScale * 0.25})` : "scale(1)",
          opacity: isSpeaking ? 0.85 : 0.45,
        }}
      />

      {/* Badge Status Emosi */}
      <div
        className={`absolute top-6 z-20 flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-pill border ${emotionConfig.borderColor} shadow-xl text-xs font-medium text-slate-200 transition-colors duration-300`}
      >
        <EmotionIcon className={`w-4 h-4 ${emotionConfig.textColor} animate-pulse`} />
        <span>Celyn:</span>
        <span className={`font-semibold ${emotionConfig.textColor}`}>
          {emotionConfig.label}
        </span>
      </div>

      {/* Container Karakter Celyn */}
      <div
        className="relative z-10 w-full max-w-[460px] h-[580px] flex items-end justify-center transition-transform duration-300 avatar-breathe"
        style={{
          transform: `rotate(${headTilt}deg)`,
        }}
      >
        {/* Gambar Dasar Karakter Celyn */}
        <img
          src="/celyn_avatar.png"
          alt="Celyn AI Avatar"
          className="w-full h-full object-contain filter drop-shadow-2xl pointer-events-none"
        />

        {/* Dynamic Eye Tracking / Blink Layer */}
        <div
          className="absolute z-20 pointer-events-none flex justify-between items-center transition-all duration-150"
          style={{
            top: "23.4%",
            width: "106px",
            height: "22px",
            padding: "0 8px",
          }}
        >
          {/* Mata Kiri */}
          <div className="relative w-8 h-4 flex items-center justify-center overflow-hidden">
            {isBlinking ? (
              <div className="w-full h-2 rounded-full bg-[#4a3025] shadow-sm animate-in fade-in" />
            ) : (
              <div
                className="w-3.5 h-3.5 rounded-full bg-[#2c1d18] shadow-inner transition-transform duration-75 flex items-center justify-center"
                style={{
                  transform: `translate(${pupilOffsetX}px, ${pupilOffsetY}px)`,
                }}
              >
                {/* Pantulan cahaya mata */}
                <div className="w-1 h-1 rounded-full bg-white/80 self-start ml-0.5 mt-0.5" />
              </div>
            )}
          </div>

          {/* Mata Kanan */}
          <div className="relative w-8 h-4 flex items-center justify-center overflow-hidden">
            {isBlinking ? (
              <div className="w-full h-2 rounded-full bg-[#4a3025] shadow-sm animate-in fade-in" />
            ) : (
              <div
                className="w-3.5 h-3.5 rounded-full bg-[#2c1d18] shadow-inner transition-transform duration-75 flex items-center justify-center"
                style={{
                  transform: `translate(${pupilOffsetX}px, ${pupilOffsetY}px)`,
                }}
              >
                {/* Pantulan cahaya mata */}
                <div className="w-1 h-1 rounded-full bg-white/80 self-start ml-0.5 mt-0.5" />
              </div>
            )}
          </div>
        </div>

        {/* Dynamic Responsive Lip-Sync Mouth */}
        {isSpeaking && mouthScale > 0.06 && (
          <div
            className="absolute z-20 pointer-events-none transition-all duration-75 flex flex-col items-center justify-between overflow-hidden shadow-inner"
            style={{
              top: "30.3%",
              width: `${Math.round(26 + mouthScale * 14)}px`,
              height: `${Math.round(8 + mouthScale * 22)}px`,
              backgroundColor: "#732424",
              borderRadius:
                mouthScale > 0.5
                  ? "45% 45% 50% 50% / 30% 30% 70% 70%"
                  : "50% 50% 40% 40% / 30% 30% 70% 70%",
              border: "1.5px solid #521919",
              boxShadow: "inset 0 2px 4px rgba(0,0,0,0.6)",
            }}
          >
            {/* Gigi Atas (muncul saat bukaan mulut cukup) */}
            <div
              className="w-3/4 h-2 bg-white/95 rounded-b-sm mt-0.5 transition-opacity duration-75"
              style={{ opacity: mouthScale > 0.25 ? 1 : 0 }}
            />

            {/* Lidah / rongga mulut bawah */}
            <div
              className="w-2/3 h-2.5 bg-rose-400 rounded-t-full mb-0.5 transition-all duration-75"
              style={{ opacity: mouthScale > 0.35 ? 0.95 : 0 }}
            />
          </div>
        )}
      </div>

      {/* Indikator Reticle LookAt jika sedang fokus pada elemen layar */}
      {lookAt && (
        <div className="absolute bottom-5 left-6 z-20 flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900/90 border border-cyan-500/50 text-xs text-cyan-300 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-left-3">
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
