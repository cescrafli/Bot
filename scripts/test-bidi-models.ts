import { WebSocket } from "ws";
import dotenv from "dotenv";

dotenv.config();
const key = process.env.GEMINI_API_KEY;

const modelsToTest = [
  "gemini-3.8-live",
  "gemini-3.8-live-extended-thinking",
  "gemini-2.5-flash-native-audio-preview-12-2025",
  "gemini-3.5-transcribe-live"
];

async function testModel(m: string, version = "v1beta"): Promise<boolean> {
  return new Promise((resolve) => {
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${version}.GenerativeService.BidiGenerateContent?key=${key}`;
    const ws = new WebSocket(url);

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          setup: {
            model: `models/${m}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
            },
          },
        })
      );
    });

    ws.on("message", (data) => {
      console.log(`✅ SUCCESS for ${m} on ${version}:`, data.toString().slice(0, 100));
      ws.close();
      resolve(true);
    });

    ws.on("close", (code, reason) => {
      console.log(`❌ FAILED for ${m} on ${version} (code: ${code}): ${reason.toString().slice(0, 120)}`);
      resolve(false);
    });

    ws.on("error", (err) => {
      console.log(`⚠️ ERROR for ${m}:`, err.message);
      resolve(false);
    });
  });
}

async function run() {
  for (const m of modelsToTest) {
    let ok = await testModel(m, "v1beta");
    if (!ok) {
      ok = await testModel(m, "v1alpha");
    }
    if (ok) {
      console.log(`\n🎉 FOUND WORKING BIDI MODEL: ${m}`);
      break;
    }
  }
}

run();
