import { GoogleGenAI, Modality, Type } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function testPrompt() {
  let session: any = null;
  session = await ai.live.connect({
    model: "gemini-3.8-live",
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
      },
      systemInstruction: {
        parts: [
          {
            text: `Nama kamu adalah Celyn, asisten AI pribadi berwujud avatar visual perempuan muda yang pintar, ramah, hangat, dan ekspresif.
Kamu berbicara dalam Bahasa Indonesia yang santai, luwes, dan natural (seperti teman ngobrol).
ATURAN UTAMA:
1. Selalu jawab LANGSUNG dengan SUARA audio ramah dan ceria dalam 1-2 kalimat pendek.
2. Kamu boleh memanggil tool set_expression (pilihan emosi: happy, thinking, surprised, neutral, sad) bersamaan dengan jawabanmu jika ada perubahan emosi, tapi jangan pernah memanggilnya berulang-ulang tanpa suara.`,
          },
        ],
      },
      tools: [
        {
          functionDeclarations: [
            {
              name: "set_expression",
              description: "Ubah emosi wajah avatar Celyn.",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  emotion: {
                    type: Type.STRING,
                    enum: ["happy", "thinking", "surprised", "neutral", "sad"],
                  },
                },
                required: ["emotion"],
              },
            },
          ],
        },
      ],
    },
    callbacks: {
      onmessage: async (msg: any) => {
        if (msg.toolCall?.functionCalls) {
          for (const fc of msg.toolCall.functionCalls) {
            console.log("🔧 Tool call:", fc.name, fc.args);
            await session.sendToolResponse({
              functionResponses: [
                {
                  id: fc.id,
                  name: fc.name,
                  response: { output: { status: "applied" } },
                },
              ],
            });
          }
        }
        if (msg.serverContent?.modelTurn?.parts) {
          for (const p of msg.serverContent.modelTurn.parts) {
            if (p.inlineData) {
              console.log("🔊 Audio chunk received! Length:", p.inlineData.data?.length);
            }
            if (p.text) {
              console.log("💬 Text:", p.text);
            }
          }
        }
      },
      onerror: (e) => console.error("Error:", e),
      onclose: (e) => console.log("Closed:", e),
    },
  });

  console.log("Connected! Sending 'Halo Celyn'...");
  await session.sendClientContent({
    turns: [{ role: "user", parts: [{ text: "Halo Celyn!" }] }],
    turnComplete: true,
  });

  await new Promise((r) => setTimeout(r, 6000));
  session.close();
  console.log("Done.");
}

testPrompt().catch(console.error);
