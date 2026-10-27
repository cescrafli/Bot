import React from "react";
import { EmotionType } from "@celyn/shared";

interface AvatarFaceOverlayProps {
  emotion: EmotionType;
  isSpeaking: boolean;
  mouthOpen: number;
  intonation: number;
  mouthPivotX: number;
  mouthPivotY: number;
  mouthScale: number;
}

/**
 * Layer suasana wajah halus (ambient blush & subtle mood atmosphere).
 * Tidak menggambar garis SVG kasar / stiker di atas wajah agar estetika
 * ilustrasi asli Celyn tetap 100% bersih, cantik, dan konsisten.
 */
export const AvatarFaceOverlay: React.FC<AvatarFaceOverlayProps> = ({
  emotion,
  isSpeaking,
  intonation,
}) => {
  return (
    <div className="absolute inset-0 w-full h-full pointer-events-none z-25 overflow-hidden">
      {/* ============================================================== */}
      {/* 1. RONA PIPI AMBIEN (Merona Merah Muda Manis saat Happy / Shy)  */}
      {/* ============================================================== */}
      {/* Pipi Kiri */}
      <div
        className="absolute w-[8%] h-[5%] rounded-full blur-[4px] transition-opacity duration-500 pointer-events-none"
        style={{
          left: "40.5%",
          top: "28.5%",
          background:
            emotion === "shy"
              ? "radial-gradient(circle, rgba(244,63,94,0.55) 0%, transparent 80%)"
              : emotion === "happy"
              ? "radial-gradient(circle, rgba(251,113,133,0.38) 0%, transparent 80%)"
              : "transparent",
          opacity: emotion === "shy" ? 0.9 : emotion === "happy" ? 0.75 : 0,
        }}
      />

      {/* Pipi Kanan */}
      <div
        className="absolute w-[8%] h-[5%] rounded-full blur-[4px] transition-opacity duration-500 pointer-events-none"
        style={{
          left: "56.5%",
          top: "28.5%",
          background:
            emotion === "shy"
              ? "radial-gradient(circle, rgba(244,63,94,0.55) 0%, transparent 80%)"
              : emotion === "happy"
              ? "radial-gradient(circle, rgba(251,113,133,0.38) 0%, transparent 80%)"
              : "transparent",
          opacity: emotion === "shy" ? 0.9 : emotion === "happy" ? 0.75 : 0,
        }}
      />

      {/* Shading Melankolis Lembut saat Sedih (Sangat tipis dan halus) */}
      {emotion === "sad" && (
        <div
          className="absolute w-[26%] h-[8%] rounded-full blur-lg transition-opacity duration-700 pointer-events-none"
          style={{
            left: "39.5%",
            top: "21.5%",
            background: "radial-gradient(ellipse at 50% 50%, rgba(99,102,241,0.12) 0%, transparent 80%)",
            opacity: 0.8,
          }}
        />
      )}

      {/* Kilau Tatapan Mata Hidup Mengikuti Intonasi Vokal saat Berbicara */}
      {isSpeaking && intonation > 0.15 && (
        <div
          className="absolute w-[18%] h-[3%] rounded-full blur-[2px] transition-opacity duration-150 pointer-events-none"
          style={{
            left: "41%",
            top: "24.5%",
            background: "radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.22) 0%, transparent 80%)",
            opacity: Math.min(1, intonation * 1.1),
          }}
        />
      )}
    </div>
  );
};
