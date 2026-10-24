import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function testFull() {
  console.log("Connecting with GoogleGenAI SDK...");
  const session = await ai.live.connect({
    model: "gemini-3.8-live",
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: "Aoede" },
        },
      },
      systemInstruction: {
        parts: [
          {
            text: "Nama kamu adalah Celyn. Jawab sapaan pengguna dengan ramah dan singkat dalam Bahasa Indonesia.",
          },
        ],
      },
    },
    callbacks: {
      onmessage: (msg: any) => {
        if (msg.serverContent?.modelTurn?.parts) {
          for (const p of msg.serverContent.modelTurn.parts) {
            if (p.inlineData) {
              console.log("🔊 Audio chunk received from Gemini! Data length:", p.inlineData.data?.length);
            }
            if (p.text) {
              console.log("💬 Transcript:", p.text);
            }
          }
        }
      },
      onerror: (err) => console.error("Error:", err),
      onclose: () => console.log("Closed"),
    },
  });

  console.log("✅ SDK Live Session Connected! Testing sendClientContent...");
  await session.sendClientContent({
    turns: [{ role: "user", parts: [{ text: "Halo Celyn!" }] }],
    turnComplete: true,
  });

  await new Promise((r) => setTimeout(r, 6000));
  session.close();
  console.log("Test finished.");
}

testFull().catch(console.error);
