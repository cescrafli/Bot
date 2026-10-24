import { WebSocket } from "ws";
import dotenv from "dotenv";

dotenv.config();
const key = process.env.GEMINI_API_KEY;

const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${key}`;
const ws = new WebSocket(url);

ws.on("open", () => {
  console.log("Connected to Gemini WebSocket");
  ws.send(
    JSON.stringify({
      setup: {
        model: "models/gemini-3.8-live",
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Aoede",
              },
            },
          },
        },
      },
    })
  );
});

ws.on("message", (raw) => {
  const data = JSON.parse(raw.toString());
  console.log("Received from Gemini:", Object.keys(data));

  if (data.setupComplete) {
    console.log("Setup complete! Sending real-time audio chunk (PCM 16k)...");
    // Generate 1 second of 16kHz PCM audio
    const samples = new Int16Array(16000);
    for (let i = 0; i < samples.length; i++) {
      // 440 Hz tone
      samples[i] = Math.sin((i / 16000) * 440 * 2 * Math.PI) * 10000;
    }
    const uint8 = new Uint8Array(samples.buffer);
    let binary = "";
    for (let i = 0; i < uint8.byteLength; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    const b64 = Buffer.from(binary, "binary").toString("base64");

    ws.send(
      JSON.stringify({
        realtimeInput: {
          audio: {
            mimeType: "audio/pcm;rate=16000",
            data: b64,
          },
        },
      })
    );
  }

  if (data.serverContent?.modelTurn?.parts) {
    for (const part of data.serverContent.modelTurn.parts) {
      if (part.inlineData) {
        console.log("🎉 SUCCESS! Received audio response chunk:", part.inlineData.mimeType, part.inlineData.data.length);
      }
    }
  }
});

ws.on("error", (err) => console.error("Error:", err));
ws.on("close", (code, reason) => console.log("Closed:", code, reason.toString()));
