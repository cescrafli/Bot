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

  // Animation Loop (60 FPS: Menggerakkan Napas, Gestur, dan Siklus Bicara Suku Kata)
  useEffect(() => {
    let animId: number;
    const startTime = performance.now();

    const loop = (now: number) => {
      if (document.visibilityState !== "hidden") {
        const t = (now - startTime) / 1000;
        setBreath(Math.sin(t * rigConfig.breathSpeed));
        setTick(now);
      }
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [rigConfig.breathSpeed]);

  // Preload semua aset tekstur rig agar perpindahan frame instan dan mulus
  useEffect(() => {
    [
      "/celyn_torso_rig.png",
      "/celyn_torso_rig_closed.png",
      "/celyn_arm_l_clean.png",
      "/celyn_arm_r_clean.png",
    ].forEach((src) => {
      const img = new Image();
      img.src = src;
    });
  }, []);

  // Siklus Kedipan Alami Mata (130ms, acak tiap 2.5 - 4.5 detik)
  useEffect(() => {
    let blinkTimeout: number;

    const scheduleBlink = () => {
      const delay = Math.random() * 2000 + 2500;
      blinkTimeout = window.setTimeout(() => {
        setIsBlinking(true);
        setTimeout(() => {
          setIsBlinking(false);
          scheduleBlink();
        }, 130);
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

  // Kemiringan Kepala Halus (mengikuti tatapan kursor mouse)
  let headTilt = (gazeTarget.x - 0.5) * 3.2;
  if (emotion === "thinking") {
    headTilt += 4.5;
  } else if (emotion === "happy") {
    headTilt -= 1.8;
  }

  // =========================================================================
  // LOGIKA LIP-SYNC MULUT DINAMIS & HALUS (Sesuai Proporsi Bibir Asli)
  // Saat diam: 100% bibir asli gambar Celyn yang tersenyum manis
  // Saat bersuara: bibir membuka-menutup natural proporsional (2px s/d 7px saja)
  // =========================================================================
  const speechCadence = Math.sin(tick / 85) * 0.45 + 0.55; // 0.10 s/d 1.0 gelombang suku kata
  const dynamicMouthAmount = isSpeaking
    ? Math.max(mouthOpen * 2.8, speechCadence * (mouthOpen > 0.01 ? 0.92 : 0.82))
    : 0;

  // =========================================================================
  // KINEMATIKA PROSEDURAL 2D RIGGING (Napas Tubuh, Tangan & Gestur Hidup)
  // =========================================================================
  const tSec = tick / 1000;

  // 1. Fisika Napas (Translasi & Kompresi-Peregangan Volume Tubuh)
  const breathY = breath * -rigConfig.breathIntensity;
  const breathScaleY = 1 + breath * 0.009;
  const breathScaleX = 1 - breath * 0.004; // Volume preservation

  // 2. Kemiringan & Gestur Badan Saat Berbicara (Living Conversational Motion)
  const bodyTilt = isSpeaking
    ? Math.sin(tSec * 2.6) * 0.8 + (gazeTarget.x - 0.5) * 1.5
    : (gazeTarget.x - 0.5) * 1.0;

  // 3. Kinematika Independen Lengan & Tangan Kiri-Kanan (Independent Arm Sway & Gestures)
  // - Ayunan Napas: saat bernapas (inhale/exhale), lengan bergerak sedikit keluar-masuk
  const armBreathL = -breath * 0.9;
  const armBreathR = breath * 0.9;

  // - Ayunan Bicara: gestur tangan bergerak mengayun alami mengikuti suku kata suara
  const speechArmL = isSpeaking
    ? Math.sin(tSec * 2.8) * (rigConfig.armMaxRot * 0.85) + (dynamicMouthAmount * 1.5)
    : 0;
  const speechArmR = isSpeaking
    ? -Math.cos(tSec * 2.4 + 0.4) * (rigConfig.armMaxRot * 0.8) - (dynamicMouthAmount * 1.3)
    : 0;

  // - Inersia Halus Tatapan Kursor (Parallax Reaction)
  const armGazeOffset = (gazeTarget.x - 0.5) * 1.6;

  const armAngleLeft = Math.max(-6, Math.min(6, armBreathL + speechArmL + armGazeOffset));
  const armAngleRight = Math.max(-6, Math.min(6, armBreathR + speechArmR + armGazeOffset));

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
        
        {/* KONTAINER UTAMA DENGAN GERAK NAPAS & GESTUR BADAN/TANGAN (Poros di panggul) */}
        <div
          className="relative w-full h-full flex items-end justify-center"
          style={{
            transformOrigin: "50% 90%", // Poros pinggang
            transform: `translateY(${breathY}px) scaleY(${breathScaleY}) scaleX(${breathScaleX}) rotate(${bodyTilt}deg)`,
            transition: "transform 0.05s linear",
          }}
        >
          {/* ============================================================= */}
          {/* LAPISAN TUBUH UTAMA (Kepala, Leher, Badan, Rambut & Pakaian) */}
          {/* Normal: Mata Terbuka (/celyn_torso_rig.png) */}
          {/* Kedip (130ms): Mata Merem Alami (/celyn_torso_rig_closed.png) */}
          {/* ============================================================= */}
          <img
            src={isBlinking ? "/celyn_torso_rig_closed.png" : "/celyn_torso_rig.png"}
            alt="Celyn Avatar Body"
            className="w-full h-full object-contain filter drop-shadow-2xl relative z-10 select-none pointer-events-none"
            draggable={false}
          />

          {/* ============================================================= */}
          {/* LENGAN KIRI BERGERAK INDEPENDEN (Poros di Sendi Bahu Kiri) */}
          {/* ============================================================= */}
          <div
            className="absolute inset-0 w-full h-full pointer-events-none z-20"
            style={{
              transformOrigin: `${rigConfig.armPivotLX}% ${rigConfig.armPivotLY}%`,
              transform: `rotate(${armAngleLeft}deg)`,
              transition: "transform 0.05s linear",
            }}
          >
            <img
              src="/celyn_arm_l_clean.png"
              alt="Celyn Left Arm"
              className="w-full h-full object-contain filter drop-shadow-md select-none pointer-events-none"
              draggable={false}
            />
          </div>

          {/* ============================================================= */}
          {/* LENGAN KANAN BERGERAK INDEPENDEN (Poros di Sendi Bahu Kanan) */}
          {/* ============================================================= */}
          <div
            className="absolute inset-0 w-full h-full pointer-events-none z-20"
            style={{
              transformOrigin: `${rigConfig.armPivotRX}% ${rigConfig.armPivotRY}%`,
              transform: `rotate(${armAngleRight}deg)`,
              transition: "transform 0.05s linear",
            }}
          >
            <img
              src="/celyn_arm_r_clean.png"
              alt="Celyn Right Arm"
              className="w-full h-full object-contain filter drop-shadow-md select-none pointer-events-none"
              draggable={false}
            />
          </div>

          {/* ============================================================= */}
          {/* LAPISAN MULUT LIP-SYNC HALUS (Presisi Terkunci pada Bibir) */}
          {/* Saat diam: 100% bibir asli gambar Celyn yang tersenyum manis */}
          {/* Saat bersuara: membuka-menutup proporsional (2px s/d 6px saja) */}
          {/* ============================================================= */}
          {isSpeaking && dynamicMouthAmount > 0.08 && (
            <div
              className="absolute z-30 flex flex-col items-center justify-between overflow-hidden shadow-sm transition-all duration-75 pointer-events-none"
              style={{
                left: `${rigConfig.mouthPivotX}%`,
                top: `${rigConfig.mouthPivotY}%`,
                transform: `translate(-50%, -50%) scale(${rigConfig.mouthScale})`,
                width: `${Math.round(24 + dynamicMouthAmount * 6)}px`,
                height: `${Math.round(2 + dynamicMouthAmount * 5)}px`,
                backgroundColor: "#4d161d",
                borderRadius: "50% 50% 50% 50% / 30% 30% 70% 70%",
                border: "1px solid #8e3e48",
                boxShadow: "inset 0 1px 2px rgba(0,0,0,0.5)",
              }}
            >
              {/* Gigi Atas Halus */}
              <div
                className="w-3/4 h-[1.5px] bg-[#fffbfb] rounded-b-sm mt-0.2 transition-opacity duration-75"
                style={{ opacity: dynamicMouthAmount > 0.35 ? 0.95 : 0 }}
              />

              {/* Lidah Halus */}
              <div
                className="w-2/3 h-1.5 bg-[#d96e7e] rounded-t-full mb-0.2 transition-all duration-75"
                style={{ opacity: dynamicMouthAmount > 0.4 ? 0.9 : 0 }}
              />
            </div>
          )}

          {/* ============================================================= */}
          {/* PENANDA TITIK POROS VISUAL (Hanya muncul saat showPivots aktif) */}
          {/* ============================================================= */}
          {rigConfig.showPivots && (
            <div className="absolute inset-0 w-full h-full pointer-events-none z-40">
              {/* Bahu Kiri */}
              <div
                className="absolute w-4 h-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-emerald-500 bg-emerald-400 shadow-md flex items-center justify-center text-[7px] font-black text-black"
                style={{ left: `${rigConfig.armPivotLX}%`, top: `${rigConfig.armPivotLY}%` }}
                title="Sendi Bahu Kiri"
              >
                AL
              </div>
              {/* Bahu Kanan */}
              <div
                className="absolute w-4 h-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-emerald-500 bg-emerald-400 shadow-md flex items-center justify-center text-[7px] font-black text-black"
                style={{ left: `${rigConfig.armPivotRX}%`, top: `${rigConfig.armPivotRY}%` }}
                title="Sendi Bahu Kanan"
              >
                AR
              </div>
              {/* Mulut */}
              <div
                className="absolute w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-pink-400 bg-pink-300 shadow-md flex items-center justify-center text-[7px] font-black text-black"
                style={{ left: `${rigConfig.mouthPivotX}%`, top: `${rigConfig.mouthPivotY}%` }}
                title="Mulut"
              >
                M
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
