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

  // Fisika Animasi Berkelanjutan (requestAnimationFrame)
  const [physics, setPhysics] = useState({
    breath: 0,
    sway: 0,
    hairLeft: 0,
    hairRight: 0,
    armLeft: 0,
    armRight: 0,
  });

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

  // Loop Fisika Rambut, Napas, dan Tangan (60 FPS smooth physics loop)
  useEffect(() => {
    let animId: number;
    let startTime = performance.now();

    const loop = (now: number) => {
      const t = (now - startTime) / 1000;

      // 1. Napas & Goyang Badan Halus
      const breath = Math.sin(t * 1.8);
      const sway = Math.sin(t * 0.9) * 1.2;

      // 2. Gerakan Rambut Depan (Inersia + Angin Halus)
      const hairLeft = Math.sin(t * 2.4) * 3.5 + Math.sin(t * 4.1) * 0.8;
      const hairRight = Math.sin(t * 2.2 + 1.2) * 3.5 + Math.sin(t * 3.8 + 0.8) * 0.8;

      // 3. Ayunan Lengan / Tangan Alami
      const armLeft = Math.sin(t * 1.8 - 0.4) * 2.2;
      const armRight = Math.sin(t * 1.8 + 0.4) * -2.2;

      setPhysics({
        breath,
        sway,
        hairLeft,
        hairRight,
        armLeft,
        armRight,
      });

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Siklus Kedipan Alami Mata (acak tiap 3-5 detik)
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

  // Arah Tatapan Mata (prioritas lookAt dari AI, atau kursor mouse)
  const gazeTarget = useMemo(() => {
    if (lookAt) {
      return { x: lookAt.x, y: lookAt.y };
    }
    return mousePos;
  }, [lookAt, mousePos]);

  // Offset pergerakan pupil mata
  const pupilOffsetX = (gazeTarget.x - 0.5) * 6;
  const pupilOffsetY = (gazeTarget.y - 0.5) * 5;

  // Kemiringan Kepala
  let headTilt = (gazeTarget.x - 0.5) * 3.5;
  if (emotion === "thinking") {
    headTilt = 5.5; // Kepala miring saat sedang menganalisis
  } else if (emotion === "happy") {
    headTilt = -2.5;
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
            className="w-[480px] h-[480px] rounded-full border border-rose-500/30 animate-ping"
            style={{
              animationDuration: "2.4s",
              transform: `scale(${1 + mouthScale * 0.3})`,
            }}
          />
          <div
            className="absolute w-[600px] h-[600px] rounded-full border border-pink-500/15 animate-pulse"
            style={{ animationDuration: "3.2s" }}
          />
        </div>
      )}

      {/* Aura Cahaya Halus di Belakang Celyn */}
      <div
        className="absolute w-[450px] h-[450px] rounded-full blur-3xl transition-all duration-700 pointer-events-none"
        style={{
          background: emotionConfig.glowColor,
          transform: isSpeaking ? `scale(${1.2 + mouthScale * 0.25})` : "scale(1)",
          opacity: isSpeaking ? 0.9 : 0.5,
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

      {/* STAGE KARAKTER 2D MULTI-LAYER BERGERAK */}
      <div
        className="relative z-10 w-full max-w-[460px] h-[580px] flex items-end justify-center"
        style={{
          // Gerak badan dan napas alami dari poros bawah
          transformOrigin: "bottom center",
          transform: `translateY(${physics.breath * -5}px) rotate(${physics.sway}deg) scale(${1 + physics.breath * 0.012})`,
          transition: "transform 0.05s linear",
        }}
      >
        {/* LAYER 1: BASE BODY CUTOUT (Tubuh utama transparan) */}
        <img
          src="/celyn_cutout.png"
          alt="Celyn AI Avatar"
          className="w-full h-full object-contain filter drop-shadow-2xl pointer-events-none"
        />

        {/* LAYER 2: TANGAN & LENGAN KIRI (Dengan 2 Gelang - Ayunan Alami) */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            transformOrigin: "23% 45%", // Sendi bahu kiri
            transform: `rotate(${physics.armLeft + (emotion === "happy" ? -4 : 0)}deg) translateY(${physics.breath * -2}px)`,
            transition: "transform 0.05s linear",
          }}
        >
          <img
            src="/celyn_arm_left.png"
            alt="Left Arm"
            className="w-full h-full object-contain"
          />
        </div>

        {/* LAYER 3: TANGAN & LENGAN KANAN (Dengan Jam Tangan - Ayunan Alami) */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            transformOrigin: "77% 45%", // Sendi bahu kanan
            transform: `rotate(${physics.armRight}deg) translateY(${physics.breath * -2}px)`,
            transition: "transform 0.05s linear",
          }}
        >
          <img
            src="/celyn_arm_right.png"
            alt="Right Arm"
            className="w-full h-full object-contain"
          />
        </div>

        {/* LAYER 4: RAMBUT DEPAN SISI KIRI (Mengayun lembut kena angin) */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            transformOrigin: "35% 24%", // Pangkal helai rambut kiri
            transform: `rotate(${physics.hairLeft + headTilt * 0.4}deg) skewX(${physics.hairLeft * 0.6}deg)`,
            transition: "transform 0.05s linear",
          }}
        >
          <img
            src="/celyn_hair_left.png"
            alt="Hair Left"
            className="w-full h-full object-contain filter drop-shadow-md"
          />
        </div>

        {/* LAYER 5: RAMBUT DEPAN SISI KANAN (Mengayun lembut kena angin) */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            transformOrigin: "65% 24%", // Pangkal helai rambut kanan
            transform: `rotate(${physics.hairRight + headTilt * 0.4}deg) skewX(${physics.hairRight * 0.6}deg)`,
            transition: "transform 0.05s linear",
          }}
        >
          <img
            src="/celyn_hair_right.png"
            alt="Hair Right"
            className="w-full h-full object-contain filter drop-shadow-md"
          />
        </div>

        {/* LAYER 6: KEPALA & KEDIPAN MATA ALAMI */}
        <div
          className="absolute z-20 pointer-events-none flex justify-between items-center transition-all duration-150"
          style={{
            top: "23.4%",
            width: "106px",
            height: "22px",
            padding: "0 8px",
            transformOrigin: "center 80px", // Leher
            transform: `rotate(${headTilt}deg)`,
          }}
        >
          {/* Mata Kiri */}
          <div className="relative w-8 h-4 flex items-center justify-center overflow-hidden">
            {isBlinking ? (
              <div className="w-full h-2 rounded-full bg-[#3d241a] shadow-md border-b border-[#25150f] animate-in fade-in" />
            ) : (
              <div
                className="w-3.5 h-3.5 rounded-full bg-[#231510] shadow-inner transition-transform duration-75 flex items-center justify-center"
                style={{
                  transform: `translate(${pupilOffsetX}px, ${pupilOffsetY}px)`,
                }}
              >
                <div className="w-1 h-1 rounded-full bg-white/90 self-start ml-0.5 mt-0.5" />
              </div>
            )}
          </div>

          {/* Mata Kanan */}
          <div className="relative w-8 h-4 flex items-center justify-center overflow-hidden">
            {isBlinking ? (
              <div className="w-full h-2 rounded-full bg-[#3d241a] shadow-md border-b border-[#25150f] animate-in fade-in" />
            ) : (
              <div
                className="w-3.5 h-3.5 rounded-full bg-[#231510] shadow-inner transition-transform duration-75 flex items-center justify-center"
                style={{
                  transform: `translate(${pupilOffsetX}px, ${pupilOffsetY}px)`,
                }}
              >
                <div className="w-1 h-1 rounded-full bg-white/90 self-start ml-0.5 mt-0.5" />
              </div>
            )}
          </div>
        </div>

        {/* LAYER 7: MULUT BERGERAK (LIP-SYNC) */}
        {isSpeaking && mouthScale > 0.05 && (
          <div
            className="absolute z-25 pointer-events-none transition-all duration-75 flex flex-col items-center justify-between overflow-hidden shadow-inner"
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
              transformOrigin: "center top",
              transform: `rotate(${headTilt * 0.5}deg)`,
            }}
          >
            {/* Gigi Atas */}
            <div
              className="w-3/4 h-2 bg-white/95 rounded-b-sm mt-0.5 transition-opacity duration-75"
              style={{ opacity: mouthScale > 0.25 ? 1 : 0 }}
            />

            {/* Lidah */}
            <div
              className="w-2/3 h-2.5 bg-rose-400 rounded-t-full mb-0.5 transition-all duration-75"
              style={{ opacity: mouthScale > 0.35 ? 0.95 : 0 }}
            />
          </div>
        )}
      </div>

      {/* Reticle LookAt jika Celyn sedang menunjuk ke elemen layar */}
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
