import React, { useEffect, useRef, useState, useMemo } from "react";
import { EmotionType, LookAtTarget } from "@celyn/shared";
import { Sparkles, HelpCircle, Smile, AlertCircle, Heart, Sliders } from "lucide-react";
import { AvatarFaceOverlay } from "./AvatarFaceOverlay";
import {
  RigCalibrationPanel,
  RigConfig,
  DEFAULT_RIG_CONFIG,
} from "./RigCalibrationPanel";

interface AvatarCanvas2DProps {
  emotion: EmotionType;
  mouthOpen: number; // 0.0 - 1.0 (RMS amplitude)
  intonation?: number; // 0.0 - 1.0 (vocal emphasis & stress)
  isSpeaking: boolean;
  lookAt: LookAtTarget | null;
  isRigPanelOpen?: boolean;
  onToggleRigPanel?: () => void;
}

export const AvatarCanvas2D: React.FC<AvatarCanvas2DProps> = ({
  emotion,
  mouthOpen,
  intonation = 0,
  isSpeaking,
  lookAt,
  isRigPanelOpen: externalRigPanelOpen,
  onToggleRigPanel,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const torsoContainerRef = useRef<HTMLDivElement>(null);
  const leftArmRef = useRef<HTMLDivElement>(null);
  const rightArmRef = useRef<HTMLDivElement>(null);
  const mouthOverlayRef = useRef<HTMLDivElement>(null);
  const upperTeethRef = useRef<HTMLDivElement>(null);
  const tongueRef = useRef<HTMLDivElement>(null);
  const auraGlowRef = useRef<HTMLDivElement>(null);
  const haloRingRef = useRef<HTMLDivElement>(null);

  const mousePosRef = useRef({ x: 0.5, y: 0.5 });
  const [isBlinking, setIsBlinking] = useState(false);

  // Konfigurasi Rigging (tersimpan di localStorage v3)
  const [rigConfig, setRigConfig] = useState<RigConfig>(() => {
    const saved = localStorage.getItem("celyn_rig_config_v3");
    if (saved) {
      try {
        return { ...DEFAULT_RIG_CONFIG, ...JSON.parse(saved) };
      } catch {}
    }
    return DEFAULT_RIG_CONFIG;
  });

  const [internalRigPanelOpen, setInternalRigPanelOpen] = useState(() => {
    return window.location.search.includes("debugRig=1");
  });

  const isRigPanelOpen =
    externalRigPanelOpen !== undefined ? externalRigPanelOpen : internalRigPanelOpen;

  const toggleRigPanel = () => {
    if (onToggleRigPanel) {
      onToggleRigPanel();
    } else {
      setInternalRigPanelOpen((prev) => !prev);
    }
  };

  const handleRigChange = (newConfig: RigConfig) => {
    setRigConfig(newConfig);
    localStorage.setItem("celyn_rig_config_v3", JSON.stringify(newConfig));
  };

  const handleRigReset = () => {
    setRigConfig(DEFAULT_RIG_CONFIG);
    localStorage.removeItem("celyn_rig_config_v3");
  };

  // Keyboard shortcut Alt+R untuk toggle panel kalibrasi
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.code === "KeyR") {
        e.preventDefault();
        toggleRigPanel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleRigPanel]);

  // Simpan props & config terbaru dalam ref agar loop 60 FPS membacanya langsung tanpa re-render React
  const propsRef = useRef({ emotion, mouthOpen, intonation, isSpeaking, lookAt, rigConfig });
  useEffect(() => {
    propsRef.current = { emotion, mouthOpen, intonation, isSpeaking, lookAt, rigConfig };
  }, [emotion, mouthOpen, intonation, isSpeaking, lookAt, rigConfig]);

  // Mouse & Touch gaze tracking (Dukungan Sentuh Jari di Layar HP tanpa re-render)
  useEffect(() => {
    const handleMove = (clientX: number, clientY: number) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const normX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const normY = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      mousePosRef.current = { x: normX, y: normY };
    };

    const handleMouseMove = (e: MouseEvent) => {
      handleMove(e.clientX, e.clientY);
    };

    const handleTouch = (e: TouchEvent) => {
      if (e.touches && e.touches[0]) {
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    window.addEventListener("touchstart", handleTouch, { passive: true });
    window.addEventListener("touchmove", handleTouch, { passive: true });

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("touchstart", handleTouch);
      window.removeEventListener("touchmove", handleTouch);
    };
  }, []);

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

  // ⚡ ULTRA-SMOOTH GPU ANIMATION LOOP (0 React Re-renders / sec)
  // Memanipulasi transform 2.5D volumetrik secara langsung pada layer GPU compositor
  useEffect(() => {
    let animId: number;
    const startTime = performance.now();

    // State lerp kinematika 2.5D volumetrik & intonasi vokal
    let currPitch = 0;
    let currYaw = 0;
    let currRoll = 0;
    let currDepthZ = 0;
    let currSlumpY = 0;
    let currShiftX = 0;
    let currArmDamping = 1.0;

    const loop = (now: number) => {
      if (document.visibilityState !== "hidden") {
        const {
          emotion: curEmotion,
          mouthOpen: curMouthOpen,
          intonation: curIntonation = 0,
          isSpeaking: curIsSpeaking,
          lookAt: curLookAt,
          rigConfig: curRig,
        } = propsRef.current;

        const tSec = (now - startTime) / 1000;

        const gazeTarget = curLookAt
          ? { x: curLookAt.x, y: curLookAt.y }
          : mousePosRef.current;

        // 🎯 1. Profil Target Kinematika Sesuai Emosi (Sedih, Ceria, Berpikir, Kaget, Tersipu, Netral)
        let targetPitch = 0;
        let targetYaw = (gazeTarget.x - 0.5) * 7.5;
        let targetRoll = 0;
        let targetDepthZ = 0;
        let targetSlumpY = 0;
        let targetShiftX = 0;
        let targetSpeedMult = 1.0;
        let targetArmDamping = 1.0;

        if (curEmotion === "sad") {
          // Sedih / Empati: Tubuh merosot, kepala menunduk sayu, helaan napas lambat
          const sigh = Math.max(0, Math.sin(tSec * 0.72)) * 3.5;
          targetPitch = 4.2;
          targetYaw = (gazeTarget.x - 0.5) * 5.0;
          targetRoll = -1.5;
          targetDepthZ = -6.0;
          targetSlumpY = 8.0 + sigh;
          targetShiftX = -1.5;
          targetSpeedMult = 0.85;
          targetArmDamping = 0.45;
        } else if (curEmotion === "happy") {
          // Ceria / Gembira: Tubuh tegap maju ke depan, membal ritmis, ayunan lincah
          const bounce = Math.sin(tSec * 2.8) * 1.5;
          targetPitch = -2.0;
          targetYaw = (gazeTarget.x - 0.5) * 9.0;
          targetRoll = Math.sin(tSec * 2.2) * 1.6;
          targetDepthZ = 12.0;
          targetSlumpY = -3.5 + bounce;
          targetShiftX = Math.sin(tSec * 1.4) * 2.5;
          targetSpeedMult = 1.35;
          targetArmDamping = 1.4;
        } else if (curEmotion === "thinking") {
          // Berpikir: Kepala miring menyamping, dagu terangkat sedikit, bobot geser ke sisi
          targetPitch = -2.8;
          targetYaw = (gazeTarget.x - 0.5) * 6.0;
          targetRoll = 4.5; // Quizzical tilt
          targetDepthZ = 2.0;
          targetSlumpY = 1.0;
          targetShiftX = -5.0;
          targetSpeedMult = 0.95;
          targetArmDamping = 0.85;
        } else if (curEmotion === "surprised") {
          // Kaget: Recoil sentakan ke belakang instan, kepala mundur
          targetPitch = -4.5;
          targetYaw = (gazeTarget.x - 0.5) * 4.0;
          targetRoll = 0;
          targetDepthZ = -22.0;
          targetSlumpY = -5.0;
          targetShiftX = 0;
          targetSpeedMult = 1.6;
          targetArmDamping = 1.5;
        } else if (curEmotion === "shy") {
          // Tersipu / Malu Manis: Sedikit memalingkan wajah, menunduk manis
          targetPitch = 3.2;
          targetYaw = -4.8;
          targetRoll = 2.2;
          targetDepthZ = 4.0;
          targetSlumpY = 3.0;
          targetShiftX = 2.0;
          targetSpeedMult = 1.0;
          targetArmDamping = 0.6;
        }

        // Lerp halus 60 FPS untuk seluruh parameter rotasi & posisi
        const lerpFactor = 0.085;
        currPitch += (targetPitch - currPitch) * lerpFactor;
        currYaw += (targetYaw - currYaw) * lerpFactor;
        currRoll += (targetRoll - currRoll) * lerpFactor;
        currDepthZ += (targetDepthZ - currDepthZ) * lerpFactor;
        currSlumpY += (targetSlumpY - currSlumpY) * lerpFactor;
        currShiftX += (targetShiftX - currShiftX) * lerpFactor;
        currArmDamping += (targetArmDamping - currArmDamping) * lerpFactor;

        // ⚡ Aksentuasi Intonasi Vokal (Emphasis Micro-Nod saat kata ditekankan)
        const intonationAccent = curIsSpeaking ? curIntonation * 3.4 : 0;
        const totalPitch = currPitch + intonationAccent;
        const accentDepthZ = curIsSpeaking ? curIntonation * 7.5 : 0;

        // Napas prosedural yang dipengaruhi kecepatan emosi
        const breathSpeed = curRig.breathSpeed * targetSpeedMult;
        const breath = Math.sin(tSec * breathSpeed);

        // Active listening micro-nod saat mendengarkan
        const listeningNod = !curIsSpeaking
          ? Math.sin(tSec * 1.8) * 0.4 * Math.max(0, Math.sin(tSec * 0.45))
          : 0;

        const breathY = breath * -curRig.breathIntensity + Math.abs(listeningNod) * 1.2;
        const breathScaleY = 1 + breath * 0.009;
        const breathScaleX = 1 - breath * 0.004;

        const bodyTilt = curIsSpeaking
          ? Math.sin(tSec * 2.6) * 0.8 + (gazeTarget.x - 0.5) * 1.5
          : (gazeTarget.x - 0.5) * 1.0 + listeningNod;

        // Lip-Sync dinamis proporsional terhadap amplop suara vokal asli
        const speechCadence = Math.sin(now / 85) * 0.4 + 0.6;
        const dynamicMouthAmount =
          curIsSpeaking && curMouthOpen >= 0.015
            ? Math.min(1, curMouthOpen * 2.5 * (0.8 + speechCadence * 0.25))
            : 0;

        // Kinematika Lengan Kiri & Kanan (Mengikuti Damping & Aksentuasi Intonasi)
        const armBreathL = -breath * 0.9 * currArmDamping;
        const armBreathR = breath * 0.9 * currArmDamping;
        const speechArmL = curIsSpeaking
          ? (Math.sin(tSec * 2.8) * (curRig.armMaxRot * 0.85) + dynamicMouthAmount * 1.5 + curIntonation * 2.5) * currArmDamping
          : 0;
        const speechArmR = curIsSpeaking
          ? (-Math.cos(tSec * 2.4 + 0.4) * (curRig.armMaxRot * 0.8) - dynamicMouthAmount * 1.3 - curIntonation * 2.2) * currArmDamping
          : 0;
        const armGazeOffset = (gazeTarget.x - 0.5) * 1.6;

        // Gestur lengan thinking: lengan kanan terangkat ke arah dada/dagu
        const thinkingArmBonus = curEmotion === "thinking" ? 4.8 : 0;

        const armAngleLeft = Math.max(-7, Math.min(7, armBreathL + speechArmL + armGazeOffset));
        const armAngleRight = Math.max(-7, Math.min(7, armBreathR + speechArmR + armGazeOffset + thinkingArmBonus));

        // 1. Update Torso Container Transform (2.5D Volumetric GPU Layer)
        if (torsoContainerRef.current) {
          torsoContainerRef.current.style.transform = `
            perspective(900px)
            translate3d(${currShiftX.toFixed(2)}px, ${(breathY + currSlumpY).toFixed(2)}px, ${(currDepthZ + accentDepthZ).toFixed(2)}px)
            rotateX(${totalPitch.toFixed(2)}deg)
            rotateY(${currYaw.toFixed(2)}deg)
            rotateZ(${(bodyTilt + currRoll).toFixed(2)}deg)
            scaleY(${breathScaleY.toFixed(3)})
            scaleX(${breathScaleX.toFixed(3)})
          `;
        }

        // 2. Update Lengan Kiri & Kanan
        if (leftArmRef.current) {
          leftArmRef.current.style.transform = `rotate(${armAngleLeft.toFixed(2)}deg)`;
        }
        if (rightArmRef.current) {
          rightArmRef.current.style.transform = `rotate(${armAngleRight.toFixed(2)}deg)`;
        }

        // 3. Update Lapisan Mulut
        if (mouthOverlayRef.current) {
          if (curIsSpeaking && dynamicMouthAmount > 0.08) {
            mouthOverlayRef.current.style.display = "flex";
            const w = (5.5 + dynamicMouthAmount * 1.4) * curRig.mouthScale;
            const h = (0.45 + dynamicMouthAmount * 0.9) * curRig.mouthScale;
            mouthOverlayRef.current.style.left = `${curRig.mouthPivotX}%`;
            mouthOverlayRef.current.style.top = `${curRig.mouthPivotY}%`;
            mouthOverlayRef.current.style.width = `${w.toFixed(2)}%`;
            mouthOverlayRef.current.style.height = `${h.toFixed(2)}%`;

            if (upperTeethRef.current) {
              upperTeethRef.current.style.opacity = dynamicMouthAmount > 0.35 ? "0.95" : "0";
            }
            if (tongueRef.current) {
              tongueRef.current.style.opacity = dynamicMouthAmount > 0.4 ? "0.9" : "0";
            }
          } else {
            mouthOverlayRef.current.style.display = "none";
          }
        }

        // 4. Update Aura Glow & Halo
        if (auraGlowRef.current) {
          const auraScale = curIsSpeaking ? (1.15 + dynamicMouthAmount * 0.2).toFixed(2) : "1";
          auraGlowRef.current.style.transform = `scale(${auraScale})`;
          auraGlowRef.current.style.opacity = curIsSpeaking ? "0.9" : "0.45";
        }
        if (haloRingRef.current) {
          haloRingRef.current.style.transform = `scale(${(1 + dynamicMouthAmount * 0.25).toFixed(
            2
          )})`;
        }
      }
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []);

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
    shy: {
      label: "Tersipu",
      icon: Heart,
      glowColor: "rgba(244, 63, 94, 0.45)",
      borderColor: "border-pink-500/40",
      textColor: "text-pink-300",
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
      {/* Panel Kalibrasi Rig Interaktif (Dibuka via Pengaturan Gear atau Alt+R) */}
      {isRigPanelOpen && (
        <RigCalibrationPanel
          config={rigConfig}
          onChange={handleRigChange}
          onReset={handleRigReset}
          onClose={() => (onToggleRigPanel ? onToggleRigPanel() : setInternalRigPanelOpen(false))}
        />
      )}

      {/* Gentle Backdrop Glow Halo behind Avatar */}
      <div className="absolute w-[420px] md:w-[500px] h-[520px] rounded-full bg-rose-500/10 blur-[85px] pointer-events-none z-0" />

      {/* Halo gelombang suara saat Celyn berbicara (Responsif Layar HP & Desktop) */}
      <div
        className={`absolute inset-0 flex items-center justify-center pointer-events-none z-0 transition-opacity duration-300 ${
          isSpeaking ? "opacity-100" : "opacity-0"
        }`}
      >
        <div
          ref={haloRingRef}
          className="w-[75vw] max-w-[440px] aspect-square rounded-full border border-rose-500/30 animate-ping will-change-transform"
          style={{ animationDuration: "2.2s" }}
        />
        <div
          className="absolute w-[88vw] max-w-[560px] aspect-square rounded-full border border-pink-500/15 animate-pulse"
          style={{ animationDuration: "3.2s" }}
        />
      </div>

      {/* Aura Cahaya Halus di Belakang Celyn */}
      <div
        ref={auraGlowRef}
        className="absolute w-[70vw] max-w-[420px] aspect-square rounded-full blur-3xl transition-opacity duration-500 pointer-events-none will-change-transform z-0"
        style={{
          background: emotionConfig.glowColor,
          opacity: isSpeaking ? 0.9 : 0.45,
        }}
      />

      {/* STAGE UTAMA AVATAR CELYN: Uncluttered Breathing Room dengan animate-float-avatar */}
      <div className="relative z-10 w-[min(90vw,calc(65dvh*0.75))] sm:w-[min(85vw,calc(72dvh*0.75))] max-w-[440px] aspect-[3/4] flex items-end justify-center pointer-events-none select-none transition-transform duration-700 animate-float-avatar">
        
        {/* KONTAINER UTAMA DENGAN GERAK NAPAS & GESTUR BADAN/TANGAN (Poros di panggul) */}
        <div
          ref={torsoContainerRef}
          className="relative w-full h-full flex items-end justify-center will-change-transform"
          style={{
            transformOrigin: "50% 90%", // Poros pinggang
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
          {/* LAPISAN WAJAH PROSEDURAL DINAMIS (Alis, Mata, Rona & Bibir)  */}
          {/* ============================================================= */}
          <AvatarFaceOverlay
            emotion={emotion}
            isSpeaking={isSpeaking}
            mouthOpen={mouthOpen}
            intonation={intonation}
            mouthPivotX={rigConfig.mouthPivotX}
            mouthPivotY={rigConfig.mouthPivotY}
            mouthScale={rigConfig.mouthScale}
          />

          {/* ============================================================= */}
          {/* LENGAN KIRI BERGERAK INDEPENDEN (Poros di Sendi Bahu Kiri) */}
          {/* ============================================================= */}
          <div
            ref={leftArmRef}
            className="absolute inset-0 w-full h-full pointer-events-none z-20 will-change-transform"
            style={{
              transformOrigin: `${rigConfig.armPivotLX}% ${rigConfig.armPivotLY}%`,
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
            ref={rightArmRef}
            className="absolute inset-0 w-full h-full pointer-events-none z-20 will-change-transform"
            style={{
              transformOrigin: `${rigConfig.armPivotRX}% ${rigConfig.armPivotRY}%`,
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
          {/* Menggunakan persentase proporsional terhadap rasio wajah 3:4 */}
          {/* ============================================================= */}
          <div
            ref={mouthOverlayRef}
            className="absolute z-30 flex flex-col items-center justify-between overflow-hidden pointer-events-none will-change-transform"
            style={{
              display: "none",
              left: `${rigConfig.mouthPivotX}%`,
              top: `${rigConfig.mouthPivotY}%`,
              transform: `translate(-50%, -50%) scale(${rigConfig.mouthScale})`,
              background: "radial-gradient(ellipse at 50% 35%, #8c2535 0%, #58121f 55%, #2a050c 100%)",
              borderRadius: "50% 50% 50% 50% / 40% 40% 60% 60%",
              boxShadow: "0 0 1.5px rgba(220, 80, 100, 0.45), inset 0 1px 2.5px rgba(20, 2, 5, 0.75)",
            }}
          >
            {/* Gigi Atas Halus */}
            <div
              ref={upperTeethRef}
              className="w-4/5 h-[1.5px] bg-[#fffcfc]/90 rounded-b-[2px] transition-opacity duration-75"
              style={{ opacity: 0 }}
            />

            {/* Lidah Halus */}
            <div
              ref={tongueRef}
              className="w-3/4 h-[2px] bg-[#e2697b] rounded-t-full transition-opacity duration-75"
              style={{ opacity: 0 }}
            />
          </div>

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

        {/* Seamless Soft Vignette at Base */}
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-[#08080d] via-transparent to-transparent opacity-90 z-35" />
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
