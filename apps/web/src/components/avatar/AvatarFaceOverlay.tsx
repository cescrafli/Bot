import React, { useMemo } from "react";
import { EmotionType } from "@celyn/shared";

interface AvatarFaceOverlayProps {
  emotion: EmotionType;
  isSpeaking: boolean;
  mouthOpen: number;
  intonation: number; // 0.0 - 1.0 (vocal emphasis & stress)
  mouthPivotX: number; // percentage
  mouthPivotY: number; // percentage
  mouthScale: number;
}

/**
 * Komponen layer ekspresi wajah prosedural 2.5D untuk Celyn AI.
 * Menghidupkan mimik wajah (alis lentur, mata sayu/tersenyum, air mata mikro berkaca-kaca,
 * rona pipi, dan bibir melengkung sedih) yang merespons emosi dan intonasi secara real-time.
 */
export const AvatarFaceOverlay: React.FC<AvatarFaceOverlayProps> = ({
  emotion,
  isSpeaking,
  mouthOpen,
  intonation,
  mouthPivotX,
  mouthPivotY,
  mouthScale,
}) => {
  // Pengaruh intonasi pada kelenturan alis (terangkat saat intonasi vokal meninggi)
  const intonationBrowLift = isSpeaking ? intonation * 2.8 : 0;

  // Konfigurasi kurva alis SVG berdasarkan emosi (dikoordinasikan pada rasio wajah 3:4)
  const browConfig = useMemo(() => {
    switch (emotion) {
      case "sad":
        // Alis sedih / empati: bagian dalam terangkat tinggi ke atas, bagian luar melengkung ke bawah
        return {
          leftD: "M 10 22 Q 22 14 36 21",
          rightD: "M 14 21 Q 28 14 40 22",
          strokeWidth: 2.4,
          opacity: 0.92,
          color: "#4a353d",
          transform: `translateY(${-1 - intonationBrowLift * 0.5}px)`,
        };
      case "happy":
        // Alis ceria: melengkung santai dan terangkat manis
        return {
          leftD: "M 10 18 Q 24 11 36 17",
          rightD: "M 14 17 Q 26 11 40 18",
          strokeWidth: 2.2,
          opacity: 0.88,
          color: "#4a353d",
          transform: `translateY(${-2 - intonationBrowLift}px)`,
        };
      case "thinking":
        // Alis berpikir: asimetris (kiri datar penasaran, kanan terangkat tinggi)
        return {
          leftD: "M 10 20 Q 23 18 36 19",
          rightD: "M 14 14 Q 27 7 40 15",
          strokeWidth: 2.3,
          opacity: 0.9,
          color: "#4a353d",
          transform: `translateY(${-1 - intonationBrowLift}px)`,
        };
      case "surprised":
        // Alis kaget: melompat tinggi melengkung kaget
        return {
          leftD: "M 10 12 Q 23 5 36 11",
          rightD: "M 14 11 Q 27 5 40 12",
          strokeWidth: 2.3,
          opacity: 0.95,
          color: "#4a353d",
          transform: `translateY(${-4 - intonationBrowLift}px)`,
        };
      case "shy":
        // Alis tersipu: melengkung lembut sedikit rendah
        return {
          leftD: "M 10 20 Q 23 15 36 19",
          rightD: "M 14 19 Q 27 15 40 20",
          strokeWidth: 2.1,
          opacity: 0.85,
          color: "#4a353d",
          transform: `translateY(${0 - intonationBrowLift * 0.5}px)`,
        };
      case "neutral":
      default:
        // Alis netral santai
        return {
          leftD: "M 10 19 Q 23 14 36 18",
          rightD: "M 14 18 Q 27 14 40 19",
          strokeWidth: 2.2,
          opacity: 0.85,
          color: "#4a353d",
          transform: `translateY(${-intonationBrowLift}px)`,
        };
    }
  }, [emotion, intonationBrowLift]);

  return (
    <div className="absolute inset-0 w-full h-full pointer-events-none z-25 overflow-hidden">
      {/* ============================================================== */}
      {/* 1. LAYER ALIS DINAMIS (SVG Path Morphing & Responsive Intonation) */}
      {/* ============================================================== */}
      <div
        className="absolute w-[24%] h-[6%] transition-transform duration-200 ease-out"
        style={{
          left: "38.5%",
          top: "19.6%",
          transform: browConfig.transform,
        }}
      >
        <svg
          viewBox="0 0 100 35"
          className="w-full h-full overflow-visible drop-shadow-[0_1px_1px_rgba(0,0,0,0.25)]"
        >
          {/* Alis Kiri (Sisi Kiri Penonton) */}
          <path
            d={browConfig.leftD}
            fill="none"
            stroke={browConfig.color}
            strokeWidth={browConfig.strokeWidth}
            strokeLinecap="round"
            opacity={browConfig.opacity}
            style={{ transition: "d 240ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}
          />

          {/* Alis Kanan (Sisi Kanan Penonton) */}
          <path
            d={browConfig.rightD}
            fill="none"
            stroke={browConfig.color}
            strokeWidth={browConfig.strokeWidth}
            strokeLinecap="round"
            opacity={browConfig.opacity}
            style={{ transition: "d 240ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}
          />
        </svg>
      </div>

      {/* ============================================================== */}
      {/* 2. LAYER KELOPAK & PANTULAN MATA (Sayu Sedih / Ceria Menyempit) */}
      {/* ============================================================== */}
      {/* Mata Kiri (Screen Left: 43.0% - 48.5%, Top 22.8% - 26.8%) */}
      <div
        className="absolute w-[6.5%] h-[4.2%] transition-all duration-300 pointer-events-none"
        style={{ left: "43.2%", top: "23.0%" }}
      >
        {/* Kelopak Sedih Sayu (Turun lembut menutupi bagian atas mata) */}
        {emotion === "sad" && (
          <div
            className="absolute inset-x-0 top-0 h-[45%] rounded-b-[45%] bg-[#422c35]/85 shadow-sm transition-all duration-300"
            style={{
              clipPath: "ellipse(50% 60% at 50% 30%)",
            }}
          />
        )}

        {/* Mata Tersenyum Ceria (Crescent eye crease saat senang) */}
        {emotion === "happy" && (
          <div
            className="absolute inset-x-0 bottom-0 h-[40%] rounded-t-full bg-[#fce7ec]/80 transition-all duration-300"
            style={{
              clipPath: "ellipse(50% 50% at 50% 60%)",
            }}
          />
        )}

        {/* Binar Kilau Air Mata Mikro saat Sedih (Glistening Tear reflection) */}
        {emotion === "sad" && (
          <>
            <div
              className="absolute right-0.5 bottom-0.5 w-1.5 h-1.5 rounded-full bg-cyan-200/90 blur-[0.4px] animate-pulse"
              style={{ animationDuration: "2s" }}
            />
            <div className="absolute right-0 bottom-[-2px] w-1 h-2 rounded-full bg-cyan-300/60 blur-[0.6px]" />
          </>
        )}
      </div>

      {/* Mata Kanan (Screen Right: 55.0% - 60.5%, Top 22.8% - 26.8%) */}
      <div
        className="absolute w-[6.5%] h-[4.2%] transition-all duration-300 pointer-events-none"
        style={{ left: "54.8%", top: "23.0%" }}
      >
        {/* Kelopak Sedih Sayu */}
        {emotion === "sad" && (
          <div
            className="absolute inset-x-0 top-0 h-[45%] rounded-b-[45%] bg-[#422c35]/85 shadow-sm transition-all duration-300"
            style={{
              clipPath: "ellipse(50% 60% at 50% 30%)",
            }}
          />
        )}

        {/* Mata Tersenyum Ceria */}
        {emotion === "happy" && (
          <div
            className="absolute inset-x-0 bottom-0 h-[40%] rounded-t-full bg-[#fce7ec]/80 transition-all duration-300"
            style={{
              clipPath: "ellipse(50% 50% at 50% 60%)",
            }}
          />
        )}

        {/* Binar Kilau Air Mata Mikro saat Sedih */}
        {emotion === "sad" && (
          <>
            <div
              className="absolute left-0.5 bottom-0.5 w-1.5 h-1.5 rounded-full bg-cyan-200/90 blur-[0.4px] animate-pulse"
              style={{ animationDuration: "2.4s" }}
            />
            <div className="absolute left-0 bottom-[-2px] w-1 h-2 rounded-full bg-cyan-300/60 blur-[0.6px]" />
          </>
        )}
      </div>

      {/* ============================================================== */}
      {/* 3. LAYER RONA PIPI (Merona Pink Ceria/Shy & Shading Melankolis) */}
      {/* ============================================================== */}
      {/* Pipi Kiri */}
      <div
        className="absolute w-[7.5%] h-[4.5%] rounded-full blur-[3px] transition-opacity duration-500"
        style={{
          left: "40.5%",
          top: "28.5%",
          background:
            emotion === "shy"
              ? "radial-gradient(circle, rgba(244,63,94,0.65) 0%, rgba(244,63,94,0) 80%)"
              : emotion === "happy"
              ? "radial-gradient(circle, rgba(251,113,133,0.45) 0%, rgba(251,113,133,0) 80%)"
              : "transparent",
          opacity: emotion === "shy" ? 0.95 : emotion === "happy" ? 0.8 : 0,
        }}
      />

      {/* Pipi Kanan */}
      <div
        className="absolute w-[7.5%] h-[4.5%] rounded-full blur-[3px] transition-opacity duration-500"
        style={{
          left: "56.5%",
          top: "28.5%",
          background:
            emotion === "shy"
              ? "radial-gradient(circle, rgba(244,63,94,0.65) 0%, rgba(244,63,94,0) 80%)"
              : emotion === "happy"
              ? "radial-gradient(circle, rgba(251,113,133,0.45) 0%, rgba(251,113,133,0) 80%)"
              : "transparent",
          opacity: emotion === "shy" ? 0.95 : emotion === "happy" ? 0.8 : 0,
        }}
      />

      {/* Shading Melankolis Lembut saat Sedih */}
      {emotion === "sad" && (
        <div
          className="absolute w-[24%] h-[7%] rounded-full blur-md transition-opacity duration-700 pointer-events-none"
          style={{
            left: "40.5%",
            top: "22.5%",
            background: "radial-gradient(ellipse at 50% 50%, rgba(99,102,241,0.18) 0%, transparent 80%)",
            opacity: 0.9,
          }}
        />
      )}

      {/* ============================================================== */}
      {/* 4. OVERLAY BIBIR MELENGKUNG SEDIH SAAT IDLE                    */}
      {/* Menutupi senyuman bawaan sprite saat Celyn sedang sedih/diam   */}
      {/* ============================================================== */}
      {emotion === "sad" && !isSpeaking && (
        <div
          className="absolute transition-all duration-300 pointer-events-none"
          style={{
            left: `${mouthPivotX}%`,
            top: `${mouthPivotY}%`,
            transform: `translate(-50%, -50%) scale(${mouthScale})`,
            width: "5.8%",
            height: "1.4%",
          }}
        >
          {/* Patch penutup warna bibir melengkung ke bawah (downturned sorrowful lips) */}
          <div
            className="w-full h-full rounded-t-[50%] rounded-b-[20%]"
            style={{
              background:
                "linear-gradient(to bottom, #ca6c79 0%, #b34a5a 60%, #872938 100%)",
              boxShadow: "0 1px 1px rgba(70, 15, 25, 0.5), inset 0 -0.5px 1px rgba(255,255,255,0.25)",
              clipPath: "ellipse(48% 42% at 50% 62%)", // Lengkungan cemberut lembut
            }}
          />
        </div>
      )}

      {/* Overlay Bibir Tersipu saat Shy & Idle */}
      {emotion === "shy" && !isSpeaking && (
        <div
          className="absolute transition-all duration-300 pointer-events-none"
          style={{
            left: `${mouthPivotX}%`,
            top: `${mouthPivotY}%`,
            transform: `translate(-50%, -50%) scale(${mouthScale})`,
            width: "5.2%",
            height: "1.2%",
          }}
        >
          <div
            className="w-full h-full rounded-full"
            style={{
              background:
                "linear-gradient(to bottom, #d4707e 0%, #ba4d5d 70%, #94303f 100%)",
              boxShadow: "0 1px 1px rgba(70, 15, 25, 0.4)",
            }}
          />
        </div>
      )}
    </div>
  );
};
