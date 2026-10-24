import { GoogleGenAI, Modality, Type } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function testTools() {
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
            text: "Nama kamu adalah Celyn. Jawab sapaan pengguna dengan ramah dan singkat.",
          },
        ],
      },
      tools: [
        {
          functionDeclarations: [
            {
              name: "set_expression",
              description: "Ubah ekspresi wajah avatar.",
              parameters: {
                type: Type.OBJECT,
                properties: { emotion: { type: Type.STRING } },
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
            console.log("🔧 Tool call received:", fc.name, fc.args);
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

  console.log("Connected! Sending client content...");
  await session.sendClientContent({
    turns: [{ role: "user", parts: [{ text: "Halo Celyn!" }] }],
    turnComplete: true,
  });

  await new Promise((r) => setTimeout(r, 7000));
  session.close();
  console.log("Test finished.");
}

testTools().catch(console.error);
