import { GoogleGenAI } from "@google/genai";
import { inferExpertPersona } from "@celyn/shared";
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
  expertPersona: string;
  fieldLabel: string;
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
   * Mengadopsi persona pakar profesional senior secara otomatis sesuai topik riset.
   */
  async conductResearch(query: string): Promise<ResearchResult> {
    const expert = inferExpertPersona(query);

    if (!this.ai) {
      return {
        query,
        summary: "Layanan riset Celyn belum dapat terhubung ke jaringan saat ini.",
        sources: [],
        formattedMarkdown: "Maaf, fitur riset web belum dapat diakses tanpa koneksi API yang valid.",
        expertPersona: expert.persona,
        fieldLabel: expert.fieldLabel,
      };
    }

    const modelName = config.textModel || "gemini-3-flash-preview";

    try {
      // Execute generative search with search grounding & expert persona
      const response = await this.ai.models.generateContent({
        model: modelName,
        contents: [
          {
            text: `Anda adalah ${expert.persona}.
Lakukan riset mendalam, teliti, berbasis data riil, komprehensif, dan sempurna tanpa terkecuali untuk topik berikut:
Topik/Pertanyaan: "${query}"
Bidang Keahlian: ${expert.fieldLabel}

STANDAR RISET PROFESIONAL TINGKAT TINGGI (ULTRA-DEEP & THOROUGH):
1. BUKAN RISET ASAL-ASALAN: Sajikan analisis tingkat pakar paling berwibawa, berbobot, berbasis fakta riil, dan terverifikasi. Dilarang keras memberikan jawaban dangkal, sekadar definisi umum, atau kesimpulan klise.
2. FOKUS KEAHLIAN SPESIFIK (${expert.fieldLabel}):
${expert.promptGuide}
3. KEDALAMAN ANALISIS & DATA RIIL:
   - Sertakan metrik kuantitatif, angka perbandingan, persentase, valuasi, atau regulasi spesifik yang relevan.
   - Bahas dinamika historis singkat, kondisi riil saat ini, dan proyeksi/implikasi ke depan.
   - Kupas dari berbagai sudut pandang (multi-angle analysis) termasuk peluang, tantangan, dan skenario alternatif.
4. STRUKTUR LAPORAN RISET:
   - ## Ringkasan Eksekutif (Executive Summary)
   - ### Analisis Mendalam & Fakta Kunci
   - ### Evaluasi Peluang & Mitigasi Risiko
   - ### Rekomendasi Strategis & Tindakan Ahli
   - ### Sumber Referensi & Catatan Verifikasi
5. JANGAN mengarang data atau angka. Jika data masih bersifat estimasi atau terdapat dinamika pasar/regulasi, sebutkan secara terbuka dan objektif.
6. Cantumkan tautan / URL sumber rujukan asli secara eksplisit dalam format markdown: [Nama Sumber](https://url-sumber).
7. Buat daftar sumber di bagian akhir di bawah heading '### Sumber Referensi'.`,
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
        expertPersona: expert.persona,
        fieldLabel: expert.fieldLabel,
      };
    } catch (err: any) {
      console.warn(`[ResearchService] Grounding search fallback for '${query}':`, err?.message || err);

      // Fallback: standard generation without tools if search tool rejected on preview model
      try {
        const fallbackResp = await this.ai.models.generateContent({
          model: modelName,
          contents: [
            {
              text: `Anda adalah ${expert.persona} (${expert.fieldLabel}).
Jelaskan secara komprehensif, mendalam, dan akurat mengenai topik: "${query}".
Fokus keahlian: ${expert.promptGuide}

Sampaikan fakta penting, analisis kritis, peluang, risiko, dan rekomendasi tingkat ahli. Jika ada sumber rujukan umum (portal resmi, bursa, jurnal, regulasi), sebutkan tautan umumnya.`,
            },
          ],
        });
        const fallbackText = fallbackResp.text || "";
        return {
          query,
          summary: fallbackText,
          sources: [],
          formattedMarkdown: fallbackText,
          expertPersona: expert.persona,
          fieldLabel: expert.fieldLabel,
        };
      } catch (fallbackErr: any) {
        return {
          query,
          summary: `Riset untuk '${query}' belum berhasil diselesaikan.`,
          sources: [],
          formattedMarkdown: `Maaf, terjadi kendala saat meriset '${query}': ${fallbackErr?.message || "Koneksi terputus"}`,
          expertPersona: expert.persona,
          fieldLabel: expert.fieldLabel,
        };
      }
    }
  }
}

export const researchService = new ResearchService();
