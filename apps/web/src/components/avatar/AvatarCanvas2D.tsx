import React, { useEffect, useRef, useState } from "react";
import { EmotionType, LookAtTarget } from "@celyn/shared";
import { Sparkles, HelpCircle, Smile, AlertCircle } from "lucide-react";

interface AvatarCanvas2DProps {
  emotion: EmotionType;
  mouthOpen: number; // 0.0 - 1.0
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
  const containerRef = useRef<HTMLDivElement>(null);

  // Siklus Kedipan Mata Alami (acak tiap 3-5 detik)
  useEffect(() => {
    let blinkTimeout: number;

    const scheduleBlink = () => {
      const delay = Math.random() * 3000 + 2500;
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

  // Hitung sudut kemiringan kepala (tilt) berdasarkan emosi atau lookAt
  let headTilt = 0;
  if (emotion === "thinking") {
    headTilt = 4.5; // Kepala miring saat berpikir
  } else if (lookAt) {
    headTilt = (lookAt.x - 0.5) * 6; // Menoleh ke arah elemen layar
  }

  // Aura warna dinamis sesuai emosi
  const emotionConfig = {
    happy: {
      color: "from-rose-500/20 via-pink-500/10 to-transparent",
      badge: "Senang 😊",
      icon: Smile,
      glow: "rgba(244, 63, 94, 0.35)",
    },
    thinking: {
      color: "from-amber-500/20 via-yellow-500/10 to-transparent",
      badge: "Menganalisis 🧐",
      icon: HelpCircle,
      glow: "rgba(245, 158, 11, 0.35)",
    },
    surprised: {
      color: "from-cyan-500/20 via-sky-500/10 to-transparent",
      badge: "Terkejut! 😲",
      icon: AlertCircle,
      glow: "rgba(6, 182, 212, 0.35)",
    },
    neutral: {
      color: "from-indigo-500/15 via-purple-500/5 to-transparent",
      badge: "Siaga 💬",
      icon: Sparkles,
      glow: "rgba(99, 102, 241, 0.25)",
    },
    sad: {
      color: "from-blue-500/15 via-slate-500/5 to-transparent",
      badge: "Prihatin 🥺",
      icon: Sparkles,
      glow: "rgba(59, 130, 246, 0.25)",
    },
  }[emotion] || {
    color: "from-rose-500/20 via-pink-500/10 to-transparent",
    badge: "Aktif",
    icon: Sparkles,
    glow: "rgba(244, 63, 94, 0.25)",
  };

  const EmotionIcon = emotionConfig.icon;

  // Nilai bukaan mulut dengan batasan aman
  const mouthScale = Math.min(1.4, Math.max(0.1, mouthOpen * 1.5));

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col items-center justify-center w-full h-full select-none overflow-hidden"
    >
      {/* Background Aura Glow di belakang Celyn */}
      <div
        className="absolute w-[420px] h-[420px] rounded-full blur-3xl transition-all duration-700 pointer-events-none"
        style={{
          background: emotionConfig.glow,
          transform: isSpeaking ? "scale(1.2)" : "scale(1)",
          opacity: isSpeaking ? 0.8 : 0.45,
        }}
      />

      {/* Badge Status Emosi Celyn */}
      <div className="absolute top-6 z-20 flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-pill border border-white/10 shadow-lg text-xs font-medium text-slate-200">
        <EmotionIcon className="w-4 h-4 text-rose-400 animate-pulse" />
        <span>Celyn:</span>
        <span className="text-white font-semibold">{emotionConfig.badge}</span>
      </div>

      {/* Container Karakter Avatar */}
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

        {/* Dynamic Eye Blink Overlay (Terletak tepat di koordinat mata Celyn) */}
        {isBlinking && (
          <div
            className="absolute z-20 pointer-events-none transition-opacity duration-75"
            style={{
              top: "22.5%",
              width: "115px",
              height: "24px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "0 10px",
            }}
          >
            {/* Kelopak mata kiri */}
            <div
              className="w-8 h-2 rounded-full"
              style={{
                backgroundColor: "#52372d",
                boxShadow: "0 1px 2px rgba(0,0,0,0.4)",
              }}
            />
            {/* Kelopak mata kanan */}
            <div
              className="w-8 h-2 rounded-full"
              style={{
                backgroundColor: "#52372d",
                boxShadow: "0 1px 2px rgba(0,0,0,0.4)",
              }}
            />
          </div>
        )}

        {/* Dynamic Mouth Lip-Sync Overlay (Terletak di koordinat bibir Celyn) */}
        {isSpeaking && mouthOpen > 0.08 && (
          <div
            className="absolute z-20 pointer-events-none transition-all duration-75"
            style={{
              top: "30.4%",
              width: "36px",
              height: `${Math.round(8 + mouthScale * 18)}px`,
              backgroundColor: "#7f2b2b",
              borderRadius: "50% 50% 45% 45% / 30% 30% 70% 70%",
              border: "1.5px solid #5a1e1e",
              boxShadow: "inset 0 2px 4px rgba(0,0,0,0.6)",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              overflow: "hidden",
            }}
          >
            {/* Gigi atas */}
            <div
              className="w-5 h-1.5 bg-white/90 rounded-b-sm mb-auto mt-0.5"
              style={{ opacity: mouthScale > 0.4 ? 1 : 0 }}
            />
            {/* Lidah / rongga mulut */}
            <div
              className="w-4 h-2 bg-rose-400 rounded-t-full mt-auto"
              style={{ opacity: mouthScale > 0.3 ? 0.9 : 0 }}
            />
          </div>
        )}
      </div>

      {/* Indikator Titik Fokus Layar (LookAt Marker) jika aktif */}
      {lookAt && (
        <div className="absolute bottom-4 left-6 z-20 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/80 border border-cyan-500/40 text-xs text-cyan-300 shadow-md">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
          <span>Fokus Layar: {lookAt.description || `X: ${Math.round(lookAt.x * 100)}%, Y: ${Math.round(lookAt.y * 100)}%`}</span>
        </div>
      )}
    </div>
  );
};
