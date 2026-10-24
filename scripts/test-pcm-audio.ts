import { GoogleGenAI, Modality } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function testPCM() {
  const session = await ai.live.connect({
    model: "gemini-3.8-live",
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
      },
    },
    callbacks: {
      onmessage: (msg: any) => {
        if (msg.serverContent?.modelTurn?.parts) {
          for (const p of msg.serverContent.modelTurn.parts) {
            if (p.inlineData) {
              const b64 = p.inlineData.data;
              const bin = Buffer.from(b64, "base64");
              console.log(
                "MimeType:",
                p.inlineData.mimeType,
                "Bytes:",
                bin.length,
                "Odd?",
                bin.length % 2 !== 0
              );
              const int16 = new Int16Array(bin.buffer, bin.byteOffset, Math.floor(bin.length / 2));
              let max = 0;
              for (let i = 0; i < int16.length; i++) {
                if (Math.abs(int16[i]) > max) max = Math.abs(int16[i]);
              }
              console.log("Peak amplitude:", max);
            }
          }
        }
      },
      onerror: console.error,
      onclose: () => console.log("Closed"),
    },
  });

  await session.sendClientContent({
    turns: [{ role: "user", parts: [{ text: "Halo Celyn!" }] }],
    turnComplete: true,
  });

  await new Promise((r) => setTimeout(r, 4000));
  session.close();
}

testPCM().catch(console.error);
