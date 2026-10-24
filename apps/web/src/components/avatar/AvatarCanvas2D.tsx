import React, { useEffect, useRef, useState, useMemo } from "react";
import { EmotionType, LookAtTarget } from "@celyn/shared";
import { Sparkles, HelpCircle, Smile, AlertCircle, Heart, Sliders } from "lucide-react";
import {
  RigCalibrationPanel,
  RigConfig,
  DEFAULT_RIG_CONFIG,
} from "./RigCalibrationPanel";

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
  const [tick, setTick] = useState(0);

  // Konfigurasi Rigging (tersimpan di localStorage)
  const [rigConfig, setRigConfig] = useState<RigConfig>(() => {
    const saved = localStorage.getItem("celyn_rig_config");
    if (saved) {
      try {
        return { ...DEFAULT_RIG_CONFIG, ...JSON.parse(saved) };
      } catch {}
    }
    return DEFAULT_RIG_CONFIG;
  });

  const [isRigPanelOpen, setIsRigPanelOpen] = useState(() => {
    return window.location.search.includes("debugRig=1");
  });

  const handleRigChange = (newConfig: RigConfig) => {
    setRigConfig(newConfig);
    localStorage.setItem("celyn_rig_config", JSON.stringify(newConfig));
  };

  const handleRigReset = () => {
    setRigConfig(DEFAULT_RIG_CONFIG);
    localStorage.removeItem("celyn_rig_config");
  };

  // Keyboard shortcut Alt+R untuk toggle panel kalibrasi
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.code === "KeyR") {
        e.preventDefault();
        setIsRigPanelOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Fisika Pernapasan & Waktu Bicara
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

  // Animation Loop (60 FPS: Menggerakkan Napas, Lengan, Rambut, dan Suku Kata Bicara)
  useEffect(() => {
    let animId: number;
    const startTime = performance.now();

    const loop = (now: number) => {
      const t = (now - startTime) / 1000;
      setBreath(Math.sin(t * rigConfig.breathSpeed));
      setTick(now);
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [rigConfig.breathSpeed]);

  // Siklus Kedipan Alami Mata (acak tiap 3-5 detik)
  useEffect(() => {
    let blinkTimeout: number;

    const scheduleBlink = () => {
      const delay = Math.random() * 2600 + 2200;
      blinkTimeout = window.setTimeout(() => {
        setIsBlinking(true);
        setTimeout(() => {
          setIsBlinking(false);
          scheduleBlink();
        }, 150);
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

  // Offset pergerakan pupil mata (-5px s/d +5px)
  const pupilOffsetX = (gazeTarget.x - 0.5) * 6;
  const pupilOffsetY = (gazeTarget.y - 0.5) * 4;

  // Kemiringan Kepala Halus
  let headTilt = (gazeTarget.x - 0.5) * 2.8;
  if (emotion === "thinking") {
    headTilt += 4.5;
  } else if (emotion === "happy") {
    headTilt -= 1.8;
  }

  // =========================================================================
  // LOGIKA LIP-SYNC MULUT DINAMIS
  // Saat isSpeaking aktif: padukan volume audio riil dengan ritme suku kata bicara (3.5Hz)
  // Menjamin 100% mulut Celyn PASTI membuka-menutup natural saat bersuara!
  // =========================================================================
  const speechCadence = Math.sin(tick / 85) * 0.45 + 0.55; // 0.10 s/d 1.0 gelombang suku kata
  const dynamicMouthAmount = isSpeaking
    ? Math.max(mouthOpen * 2.8, speechCadence * (mouthOpen > 0.01 ? 0.92 : 0.82))
    : 0;

  // =========================================================================
  // KINEMATIKA PROSEDURAL 2D RIGGING (Lengan, Rambut, Napas Tubuh)
  // =========================================================================
  const tSec = tick / 1000;

  // 1. Ayunan Lengan (dengan dorongan gestur bukaan sudut saat berbicara)
  const armSwayBase = Math.sin(tSec * rigConfig.breathSpeed - 0.4);
  const speechGesture = isSpeaking ? dynamicMouthAmount * 1.5 : 0;
  const armRotL = armSwayBase * rigConfig.armMaxRot + speechGesture;
  const armRotR = -armSwayBase * rigConfig.armMaxRot - speechGesture;

  // 2. Ayunan Rambut (dengan efek inersia saat kepala menoleh)
  const hairSwayBase = Math.sin(tSec * (rigConfig.breathSpeed * 1.15) - 0.8);
  const hairRotL = hairSwayBase * rigConfig.hairMaxRot + headTilt * 0.25;
  const hairRotR = -hairSwayBase * rigConfig.hairMaxRot + headTilt * 0.25;

  // 3. Napas tubuh (translasi vertikal halus + peregangan mikro)
  const breathY = breath * -rigConfig.breathIntensity;
  const breathScaleY = 1 + breath * 0.007;

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

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col items-center justify-center w-full h-full select-none overflow-hidden"
    >
      {/* Tombol Pintas Kalibrasi Rig (Pojok Kiri Atas) */}
      <button
        onClick={() => setIsRigPanelOpen((prev) => !prev)}
        className="absolute top-6 left-6 z-40 flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-pill border border-white/10 hover:border-rose-500/40 text-slate-400 hover:text-white text-xs font-medium transition-all shadow-lg hover:scale-105"
        title="Buka Panel Kalibrasi Rig 2D (Alt+R)"
      >
        <Sliders className="w-3.5 h-3.5 text-rose-400" />
        <span>Kalibrasi Rig</span>
      </button>

      {/* Panel Kalibrasi Rig Interaktif */}
      {isRigPanelOpen && (
        <RigCalibrationPanel
          config={rigConfig}
          onChange={handleRigChange}
          onReset={handleRigReset}
          onClose={() => setIsRigPanelOpen(false)}
        />
      )}

      {/* Halo gelombang suara saat Celyn berbicara */}
      {isSpeaking && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
          <div
            className="w-[480px] h-[480px] rounded-full border border-rose-500/30 animate-ping"
            style={{
              animationDuration: "2.2s",
              transform: `scale(${1 + dynamicMouthAmount * 0.25})`,
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
          transform: isSpeaking ? `scale(${1.15 + dynamicMouthAmount * 0.2})` : "scale(1)",
          opacity: isSpeaking ? 0.9 : 0.45,
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
        
        {/* KONTAINER UTAMA DENGAN GERAK NAPAS (Poros di panggul) */}
        <div
          className="relative w-full h-full flex items-end justify-center"
          style={{
            transformOrigin: "50% 90%", // Poros pinggang
            transform: `translateY(${breathY}px) scaleY(${breathScaleY})`,
            transition: "transform 0.05s linear",
          }}
        >
          {/* ============================================================= */}
          {/* LAPISAN 1: GAMBAR DASAR TUBUH & TORSO (Z-10) */}
          {/* ============================================================= */}
          <img
            src="/celyn_clean_cutout.png"
            alt="Celyn Base"
            className="w-full h-full object-contain filter drop-shadow-2xl relative z-10"
          />

          {/* ============================================================= */}
          {/* LAPISAN 2: LENGAN KIRI (Z-15) - Gerak Bahu & Gestur */}
          {/* ============================================================= */}
          <img
            src="/celyn_arm_left.png"
            alt="Celyn Left Arm"
            className="absolute inset-0 w-full h-full object-contain pointer-events-none z-15"
            style={{
              transformOrigin: `${rigConfig.armPivotLX}% ${rigConfig.armPivotLY}%`,
              transform: `rotate(${armRotL}deg)`,
              transition: "transform 0.06s ease-out",
            }}
          />

          {/* ============================================================= */}
          {/* LAPISAN 3: LENGAN KANAN (Z-15) - Gerak Bahu & Gestur */}
          {/* ============================================================= */}
          <img
            src="/celyn_arm_right.png"
            alt="Celyn Right Arm"
            className="absolute inset-0 w-full h-full object-contain pointer-events-none z-15"
            style={{
              transformOrigin: `${rigConfig.armPivotRX}% ${rigConfig.armPivotRY}%`,
              transform: `rotate(${armRotR}deg)`,
              transition: "transform 0.06s ease-out",
            }}
          />

          {/* ============================================================= */}
          {/* LAPISAN 4: HELAI RAMBUT KIRI (Z-20) - Inersia & Ayunan Lembut */}
          {/* ============================================================= */}
          <img
            src="/celyn_hair_l_clean.png"
            alt="Celyn Left Hair"
            className="absolute inset-0 w-full h-full object-contain pointer-events-none z-20"
            style={{
              transformOrigin: `${rigConfig.hairPivotLX}% ${rigConfig.hairPivotLY}%`,
              transform: `rotate(${hairRotL}deg)`,
              transition: "transform 0.08s ease-out",
            }}
          />

          {/* ============================================================= */}
          {/* LAPISAN 5: HELAI RAMBUT KANAN (Z-20) - Inersia & Ayunan Lembut */}
          {/* ============================================================= */}
          <img
            src="/celyn_hair_r_clean.png"
            alt="Celyn Right Hair"
            className="absolute inset-0 w-full h-full object-contain pointer-events-none z-20"
            style={{
              transformOrigin: `${rigConfig.hairPivotRX}% ${rigConfig.hairPivotRY}%`,
              transform: `rotate(${hairRotR}deg)`,
              transition: "transform 0.08s ease-out",
            }}
          />

          {/* ============================================================= */}
          {/* LAPISAN 6: KEPALA, MATA & MULUT (Z-30) - Condong di Sendi Leher */}
          {/* ============================================================= */}
          <div
            className="absolute inset-0 w-full h-full z-30 pointer-events-none"
            style={{
              transformOrigin: "50% 39%", // Poros leher
              transform: `rotate(${headTilt}deg)`,
              transition: "transform 0.08s ease-out",
            }}
          >
            {/* MATA KIRI (Presisi Koordinat: X=42.7%, Y=24.9%) */}
            <div
              className="absolute z-20"
              style={{
                left: "42.7%",
                top: "24.9%",
                transform: "translate(-50%, -50%)",
                width: "28px",
                height: "16px",
              }}
            >
              {isBlinking ? (
                <div className="w-full h-1.5 mt-1.5 rounded-full bg-[#341d14] shadow-sm border-b border-[#20100a] animate-in fade-in duration-75" />
              ) : (
                <div
                  className="w-4 h-4 mx-auto rounded-full bg-[#180e0a] shadow-inner transition-transform duration-75 flex items-center justify-center relative overflow-hidden"
                  style={{
                    transform: `translate(${pupilOffsetX}px, ${pupilOffsetY}px)`,
                  }}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-white/95 absolute top-0.5 left-0.5" />
                </div>
              )}
            </div>

            {/* MATA KANAN (Presisi Koordinat: X=59.4%, Y=24.3%) */}
            <div
              className="absolute z-20"
              style={{
                left: "59.4%",
                top: "24.3%",
                transform: "translate(-50%, -50%)",
                width: "28px",
                height: "16px",
              }}
            >
              {isBlinking ? (
                <div className="w-full h-1.5 mt-1.5 rounded-full bg-[#341d14] shadow-sm border-b border-[#20100a] animate-in fade-in duration-75" />
              ) : (
                <div
                  className="w-4 h-4 mx-auto rounded-full bg-[#180e0a] shadow-inner transition-transform duration-75 flex items-center justify-center relative overflow-hidden"
                  style={{
                    transform: `translate(${pupilOffsetX}px, ${pupilOffsetY}px)`,
                  }}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-white/95 absolute top-0.5 left-0.5" />
                </div>
              )}
            </div>

            {/* MULUT BERBICARA / LIP-SYNC (Presisi Koordinat: X=52.1%, Y=33.3%) */}
            {isSpeaking && dynamicMouthAmount > 0.05 ? (
              <div
                className="absolute z-30 flex flex-col items-center justify-between overflow-hidden shadow-lg transition-all duration-75 pointer-events-none"
                style={{
                  left: "52.1%",
                  top: "33.3%",
                  transform: "translate(-50%, -50%)",
                  width: `${Math.round(28 + dynamicMouthAmount * 16)}px`,
                  height: `${Math.round(6 + dynamicMouthAmount * 22)}px`,
                  backgroundColor: "#4c1318",
                  borderRadius:
                    dynamicMouthAmount > 0.4
                      ? "46% 46% 54% 54% / 32% 32% 68% 68%"
                      : "50% 50% 45% 45% / 28% 28% 72% 72%",
                  border: "1.5px solid #a8585f",
                  boxShadow: "inset 0 2px 5px rgba(0,0,0,0.65)",
                }}
              >
                {/* Gigi Atas Bersih */}
                <div
                  className="w-4/5 h-2 bg-[#fffdfd] rounded-b-sm mt-0.5 shadow-sm transition-opacity duration-75"
                  style={{ opacity: dynamicMouthAmount > 0.15 ? 1 : 0 }}
                />

                {/* Lidah Merah Muda Anime */}
                <div
                  className="w-3/4 h-3 bg-[#e87a8e] rounded-t-full mb-0.5 shadow-inner transition-all duration-75"
                  style={{
                    opacity: dynamicMouthAmount > 0.3 ? 0.95 : 0,
                    transform: `scale(${0.8 + dynamicMouthAmount * 0.2})`,
                  }}
                />
              </div>
            ) : null}
          </div>

          {/* ============================================================= */}
          {/* PENANDA TITIK POROS VISUAL (Hanya muncul saat showPivots aktif) */}
          {/* ============================================================= */}
          {rigConfig.showPivots && (
            <div className="absolute inset-0 w-full h-full pointer-events-none z-40">
              {/* Bahu Kiri */}
              <div
                className="absolute w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-rose-500 bg-rose-400 shadow-md flex items-center justify-center text-[7px] font-black text-black"
                style={{ left: `${rigConfig.armPivotLX}%`, top: `${rigConfig.armPivotLY}%` }}
                title="Bahu Kiri"
              >
                L
              </div>
              {/* Bahu Kanan */}
              <div
                className="absolute w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-rose-500 bg-rose-400 shadow-md flex items-center justify-center text-[7px] font-black text-black"
                style={{ left: `${rigConfig.armPivotRX}%`, top: `${rigConfig.armPivotRY}%` }}
                title="Bahu Kanan"
              >
                R
              </div>
              {/* Rambut Kiri */}
              <div
                className="absolute w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-pink-400 bg-pink-300 shadow-md flex items-center justify-center text-[7px] font-black text-black"
                style={{ left: `${rigConfig.hairPivotLX}%`, top: `${rigConfig.hairPivotLY}%` }}
                title="Rambut Kiri"
              >
                H
              </div>
              {/* Rambut Kanan */}
              <div
                className="absolute w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-pink-400 bg-pink-300 shadow-md flex items-center justify-center text-[7px] font-black text-black"
                style={{ left: `${rigConfig.hairPivotRX}%`, top: `${rigConfig.hairPivotRY}%` }}
                title="Rambut Kanan"
              >
                H
              </div>
            </div>
          )}
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
