import { GoogleGenAI, Modality } from "@google/genai";
import dotenv from "dotenv";
import fs from "fs";
import path from "node:path";
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function generateGreetingAudio() {
  console.log("Connecting to Gemini Live to generate Celyn greeting wav...");
  const chunks: Buffer[] = [];

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
            if (p.inlineData?.data) {
              const buf = Buffer.from(p.inlineData.data, "base64");
              chunks.push(buf);
            }
          }
        }
      },
      onerror: console.error,
      onclose: () => console.log("Stream closed"),
    },
  });

  console.log("Requesting greeting speech...");
  await session.sendClientContent({
    turns: [
      {
        role: "user",
        parts: [
          {
            text: "Ucapkan persis kalimat ini dengan nada ceria dan ramah: 'Halo! Aku Celyn. Suara dan gerak mulutku sudah aktif dan siap membantumu!'",
          },
        ],
      },
    ],
    turnComplete: true,
  });

  await new Promise((r) => setTimeout(r, 6000));
  session.close();

  const fullPcm = Buffer.concat(chunks);
  console.log("Total PCM bytes collected:", fullPcm.length);

  // Convert raw 24kHz mono 16-bit PCM to standard WAV header
  const wavHeader = Buffer.alloc(44);
  const totalDataLen = fullPcm.length;
  const totalFileLen = totalDataLen + 36;
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;

  wavHeader.write("RIFF", 0);
  wavHeader.writeUInt32LE(totalFileLen, 4);
  wavHeader.write("WAVE", 8);
  wavHeader.write("fmt ", 12);
  wavHeader.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  wavHeader.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  wavHeader.writeUInt16LE(numChannels, 22);
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(byteRate, 28);
  wavHeader.writeUInt16LE(blockAlign, 32);
  wavHeader.writeUInt16LE(bitsPerSample, 34);
  wavHeader.write("data", 36);
  wavHeader.writeUInt32LE(totalDataLen, 40);

  const finalWav = Buffer.concat([wavHeader, fullPcm]);
  const outPath = path.resolve(process.cwd(), "apps/web/public/celyn_test_greeting.wav");
  fs.writeFileSync(outPath, finalWav);
  console.log("✅ Successfully saved test WAV to:", outPath, "File size:", finalWav.length);
}

generateGreetingAudio().catch(console.error);
