import { EmotionType } from "./avatar.js";

// Pesan Client -> Server
export type ClientMessage =
  | {
      type: "audio";
      data: string; // Base64 PCM 16-bit 16kHz mono
    }
  | {
      type: "screen";
      data: string; // Base64 JPEG
    }
  | {
      type: "text";
      text: string;
    }
  | {
      type: "tool_response";
      id: string;
      output: Record<string, unknown>;
    };

// Pesan Server -> Client
export type ServerMessage =
  | {
      type: "audio";
      data: string; // Base64 PCM 24kHz mono
    }
  | {
      type: "transcript";
      speaker: "user" | "celyn";
      text: string;
      isFinal?: boolean;
    }
  | {
      type: "tool_call";
      id: string;
      name: "set_expression" | "point_at_screen";
      args: Record<string, unknown>;
    }
  | {
      type: "interrupted";
    }
  | {
      type: "status";
      status: "idle" | "listening" | "thinking" | "speaking" | "error";
      message?: string;
    }
  | {
      type: "session_info";
      model: string;
      voice: string;
    }
  | {
      type: "error";
      message: string;
    };

export interface SetExpressionArgs {
  emotion: EmotionType;
  intensity?: number;
}

export interface PointAtScreenArgs {
  x: number;
  y: number;
  description?: string;
}
