export type EmotionType = "neutral" | "happy" | "thinking" | "surprised" | "sad";

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
