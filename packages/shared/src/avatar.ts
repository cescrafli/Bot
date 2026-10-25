export type EmotionType = "neutral" | "happy" | "thinking" | "surprised" | "sad";

/**
 * Memetakan variasi atau sinonim emosi dari LLM ke enum EmotionType yang valid.
 */
export function normalizeEmotion(raw: unknown): EmotionType {
  if (typeof raw !== "string") return "neutral";
  const lower = raw.trim().toLowerCase();

  if (["happy", "senang", "friendly", "gembira", "excited", "cheerful", "smile", "joy"].includes(lower)) {
    return "happy";
  }
  if (["thinking", "mikir", "analisis", "curious", "confused", "pondering", "analyzing", "wonder"].includes(lower)) {
    return "thinking";
  }
  if (["surprised", "kaget", "terkesan", "shocked", "amazed", "wow"].includes(lower)) {
    return "surprised";
  }
  if (["sad", "sedih", "empati", "empathetic", "concerned", "sorry"].includes(lower)) {
    return "sad";
  }
  return "neutral";
}

export interface LookAtTarget {
  x: number; // 0.0 (kiri) s/d 1.0 (kanan)
  y: number; // 0.0 (atas) s/d 1.0 (bawah)
  description?: string;
}

export interface AvatarState {
  emotion: EmotionType;
  emotionIntensity: number; // 0.0 - 1.0
  mouthOpen: number; // 0.0 - 1.0
  isBlinking: boolean;
  lookAt: LookAtTarget | null;
  mode: "2d" | "3d";
}

export interface AvatarController {
  setMouthOpen(val: number): void;
  setEmotion(emotion: EmotionType, intensity?: number): void;
  lookAt(x: number, y: number, description?: string): void;
  resetLookAt(): void;
  getState(): AvatarState;
}
