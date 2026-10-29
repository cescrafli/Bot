import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";

export interface ResearchSource {
  title: string;
  url: string;
}

export interface ResearchResult {
  query: string;
  summary: string;
  sources: ResearchSource[];
  formattedMarkdown: string;
}

export class ResearchService {
  private ai: GoogleGenAI | null = null;

  constructor() {
    if (config.geminiApiKey) {
      this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    }
  }

  /**
   * Conduct research with real-time web search grounding & source citations.
   */
  async conductResearch(query: string): Promise<ResearchResult> {
    if (!this.ai) {
      return {
        query,
        summary: "Layanan riset Celyn belum dapat terhubung ke jaringan saat ini.",
        sources: [],
        formattedMarkdown: "Maaf, fitur riset web belum dapat diakses tanpa koneksi API yang valid.",
      };
    }

    const modelName = config.textModel || "gemini-3-flash-preview";

    try {
      // Execute generative search with search grounding
      const response = await this.ai.models.generateContent({
        model: modelName,
        contents: [
          {
            text: `Lakukan riset mendalam dan kumpulkan fakta terbaru untuk topik berikut:
Topik/Pertanyaan: "${query}"

PANDUAN:
1. Berikan rangkuman komprehensif, akurat, dan netral dalam Bahasa Indonesia.
2. JANGAN mengarang fakta. Jelaskan apa yang diketahui dan sebutkan jika ada hal yang belum pasti.
3. Cantumkan tautan / URL sumber rujukan asli secara eksplisit dalam format markdown: [Nama Sumber](https://url-sumber).
4. Buat daftar sumber di bagian akhir di bawah heading '### Sumber Referensi'.`,
          },
        ],
        config: {
          // Enable Google Search tool for live web retrieval if available
          tools: [{ googleSearch: {} } as any],
        },
      });

      const text = response.text || "";
      const sources: ResearchSource[] = [];

      // Extract grounding metadata if provided by API
      const candidate = (response as any)?.candidates?.[0];
      const groundingMeta = candidate?.groundingMetadata;
      if (groundingMeta?.groundingChunks && Array.isArray(groundingMeta.groundingChunks)) {
        for (const chunk of groundingMeta.groundingChunks) {
          if (chunk.web?.uri) {
            sources.push({
              title: chunk.web.title || new URL(chunk.web.uri).hostname,
              url: chunk.web.uri,
            });
          }
        }
      }

      // Also extract any markdown links [Title](http...) directly from text
      const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
      let match: RegExpExecArray | null;
      while ((match = linkRegex.exec(text)) !== null) {
        const title = match[1].trim();
        const url = match[2].trim();
        if (!sources.some((s) => s.url === url)) {
          sources.push({ title, url });
        }
      }

      // Format markdown output with source links
      let formattedMarkdown = text;
      if (sources.length > 0 && !text.includes("### Sumber Referensi")) {
        formattedMarkdown += "\n\n### Sumber Referensi:\n" +
          sources.map((s) => `- [${s.title}](${s.url})`).join("\n");
      }

      return {
        query,
        summary: text,
        sources,
        formattedMarkdown,
      };
    } catch (err: any) {
      console.warn(`[ResearchService] Grounding search fallback for '${query}':`, err?.message || err);

      // Fallback: standard generation without tools if search tool rejected on preview model
      try {
        const fallbackResp = await this.ai.models.generateContent({
          model: modelName,
          contents: [
            {
              text: `Jelaskan secara komprehensif dan akurat informasi mengenai: "${query}".
Sampaikan fakta penting, konteksnya, dan tingkat keyakinanmu secara jujur. Jika ada sumber umum yang terpercaya (seperti Wikipedia, dokumentasi resmi, atau portal berita resmi), sebutkan tautan umumnya.`,
            },
          ],
        });
        const fallbackText = fallbackResp.text || "";
        return {
          query,
          summary: fallbackText,
          sources: [],
          formattedMarkdown: fallbackText,
        };
      } catch (fallbackErr: any) {
        return {
          query,
          summary: `Riset untuk '${query}' belum berhasil diselesaikan.`,
          sources: [],
          formattedMarkdown: `Maaf, terjadi kendala saat meriset '${query}': ${fallbackErr?.message || "Koneksi terputus"}`,
        };
      }
    }
  }
}

export const researchService = new ResearchService();
