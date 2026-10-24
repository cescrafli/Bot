import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
console.log("Testing with @google/genai SDK, API key exists:", !!apiKey);

const ai = new GoogleGenAI({ apiKey });
console.log("ai properties:", Object.keys(ai));
console.log("ai.live properties:", ai.live ? Object.keys(ai.live) : "none");
