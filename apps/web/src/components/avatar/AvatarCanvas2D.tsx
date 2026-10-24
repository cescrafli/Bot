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
      const t = (now - startTime) / 1000;
      setBreath(Math.sin(t * rigConfig.breathSpeed));
      setTick(now);
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [rigConfig.breathSpeed]);

  // Siklus Kedipan Alami Mata (130ms, acak tiap 3-5 detik)
  useEffect(() => {
    let blinkTimeout: number;

    const scheduleBlink = () => {
      const delay = Math.random() * 2600 + 2200;
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
          {/* GAMBAR UTUH CELYN BERSIH & PRESISI (Tubuh, Tangan & Rambut Asli) */}
          {/* ============================================================= */}
          <img
            src="/celyn_clean_cutout.png"
            alt="Celyn Avatar"
            className="w-full h-full object-contain filter drop-shadow-2xl relative z-10"
          />

          {/* ============================================================= */}
          {/* LAPISAN KEPALA, MATA & MULUT (Condong di Sendi Leher 50% 39%) */}
          {/* ============================================================= */}
          <div
            className="absolute inset-0 w-full h-full z-30 pointer-events-none"
            style={{
              transformOrigin: "50% 39%", // Poros leher
              transform: `rotate(${headTilt}deg)`,
              transition: "transform 0.08s ease-out",
            }}
          >
            {/* ============================================================= */}
            {/* KEDIPAN MATA ALAMI (Berdasarkan Gambar Asli, Bebas Double Eye!) */}
            {/* Saat mata terbuka: 100% menggunakan mata asli gambar Celyn */}
            {/* Saat berkedip (130ms): kelopak mata menutup halus sesuai warna kulit */}
            {/* ============================================================= */}
            {isBlinking && (
              <>
                {/* Kelopak Mata Kiri Menutup */}
                <div
                  className="absolute z-20 pointer-events-none transition-all duration-75"
                  style={{
                    left: "42.7%",
                    top: "24.9%",
                    transform: "translate(-50%, -50%)",
                    width: "28px",
                    height: "13px",
                    backgroundColor: "#eabbab",
                    borderRadius: "50% 50% 40% 40% / 30% 30% 70% 70%",
                    boxShadow: "inset 0 -2px 3px rgba(155, 90, 75, 0.45)",
                  }}
                >
                  <div className="absolute bottom-0.5 left-1.5 right-1.5 h-[2px] rounded-full bg-[#2a1714] shadow-sm" />
                </div>

                {/* Kelopak Mata Kanan Menutup */}
                <div
                  className="absolute z-20 pointer-events-none transition-all duration-75"
                  style={{
                    left: "59.4%",
                    top: "24.3%",
                    transform: "translate(-50%, -50%)",
                    width: "28px",
                    height: "13px",
                    backgroundColor: "#eabbab",
                    borderRadius: "50% 50% 40% 40% / 30% 30% 70% 70%",
                    boxShadow: "inset 0 -2px 3px rgba(155, 90, 75, 0.45)",
                  }}
                >
                  <div className="absolute bottom-0.5 left-1.5 right-1.5 h-[2px] rounded-full bg-[#2a1714] shadow-sm" />
                </div>
              </>
            )}

            {/* ============================================================= */}
            {/* MULUT BERBICARA / LIP-SYNC HALUS (Sesuai Proporsi Bibir Asli) */}
            {/* Saat diam: 100% bibir asli gambar Celyn yang tersenyum manis */}
            {/* Saat bersuara: bibir membuka-menutup proporsional (2px s/d 7px saja!) */}
            {/* ============================================================= */}
            {isSpeaking && dynamicMouthAmount > 0.08 && (
              <div
                className="absolute z-30 flex flex-col items-center justify-between overflow-hidden shadow-sm transition-all duration-75 pointer-events-none"
                style={{
                  left: "52.1%",
                  top: "33.3%",
                  transform: "translate(-50%, -50%)",
                  width: `${Math.round(26 + dynamicMouthAmount * 6)}px`,
                  height: `${Math.round(2 + dynamicMouthAmount * 6)}px`,
                  backgroundColor: "#541b22",
                  borderRadius: "50% 50% 50% 50% / 30% 30% 70% 70%",
                  border: "1px solid #994752",
                  boxShadow: "inset 0 1px 3px rgba(0,0,0,0.5)",
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
          </div>

          {/* ============================================================= */}
          {/* PENANDA TITIK POROS VISUAL (Hanya muncul saat showPivots aktif) */}
          {/* ============================================================= */}
          {rigConfig.showPivots && (
            <div className="absolute inset-0 w-full h-full pointer-events-none z-40">
              {/* Leher / Kepala */}
              <div
                className="absolute w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-rose-500 bg-rose-400 shadow-md flex items-center justify-center text-[7px] font-black text-black"
                style={{ left: "50%", top: "39%" }}
                title="Poros Leher"
              >
                H
              </div>
              {/* Mulut */}
              <div
                className="absolute w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-pink-400 bg-pink-300 shadow-md flex items-center justify-center text-[7px] font-black text-black"
                style={{ left: "52.1%", top: "33.3%" }}
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
