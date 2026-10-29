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
    }
  | {
      type: "barge_in";
    }
  | {
      type: "audio_stream_end";
    }
  | {
      type: "doc_context";
      text: string;
      docId?: string;
      fileName?: string;
      silent?: boolean;
    };

// Pesan Server -> Client
export type ServerMessage =
  | {
      type: "audio";
      data: string; // Base64 MP3 (id-ID-GadisNeural) atau PCM 24kHz mono
      mimeType?: string;
    }
  | {
      type: "transcript";
      speaker: "user" | "celyn";
      text: string;
      isFinal?: boolean;
    }
  | {
      type: "tool_call";
      id?: string;
      name: "set_expression" | "point_at_screen" | "remember_fact" | "create_document" | "process_document" | "research";
      args: Record<string, unknown>;
    }
  | {
      type: "interrupted";
    }
  | {
      type: "status";
      status: "idle" | "listening" | "thinking" | "researching" | "working" | "speaking" | "error";
      message?: string;
    }
  | {
      type: "job";
      jobId: string;
      kind: "read" | "summarize" | "translate" | "paraphrase" | "edit" | "create" | "research" | "custom";
      stage: "queued" | "running" | "done" | "error" | "needs_input";
      progress: number;
      message?: string;
      fileName?: string;
      resultId?: string;
      downloadUrl?: string;
      error?: { code: string; userMessage: string };
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
