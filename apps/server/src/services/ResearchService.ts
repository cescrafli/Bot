import { GoogleGenAI } from "@google/genai";
import { inferExpertPersona, getWibFormattedString } from "@celyn/shared";
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

    const candidateModels = [
      config.textModel,
      "gemini-3.8-flash",
      "gemini-3-flash-preview",
    ].filter((m): m is string => Boolean(m));
    const modelName = candidateModels[0] || "gemini-3.8-flash";

    const wibDateStr = getWibFormattedString(new Date());

    try {
      // Execute generative search with search grounding & expert persona
      const response = await this.ai.models.generateContent({
        model: modelName,
        contents: [
          {
            text: `Anda adalah ${expert.persona}.
Sajikan laporan riset mendalam tingkat pakar (Deep Research & Comprehensive Analysis) yang berbasis data riil, tajam, terstruktur, dan didukung banyak sumber terpercaya untuk topik berikut:
Topik/Pertanyaan: "${query}"
Bidang Keahlian: ${expert.fieldLabel}
Waktu Acuan Riset (WIB / Jakarta, UTC+7): ${wibDateStr}
Panduan Analisis: ${expert.promptGuide}
PENTING ZONA WAKTU: Gunakan waktu acuan Jakarta (WIB, UTC+7) di atas sebagai patokan resmi hari, tanggal, dan rentang "minggu ini". JANGAN PERNAH mengikuti waktu UTC server.

7 KETENTUAN EMAS RISET MENDALAM:
1. Telusuri topik secara menyeluruh dari multi-sudut pandang (jangan puas dengan 1-2 pencarian sekilas).
2. Kumpulkan sebanyak dan seberagam mungkin fakta dan angka riil dari sumber primer/terpercaya.
3. Rangkum temuan menjadi sintesis runtut dan jelaskan poin pentingnya dengan bahasa yang mudah dipahami.
4. Jika mencakup pergerakan mingguan (seperti pasar modal/saham/ekonomi), paparkan dinamika hari ke hari serta performa sektor/emiten unggulan.
5. Evaluasi peluang dan mitigasi risiko secara objektif dan terukur.
6. Berikan rekomendasi konkret aplikatif bagi pengambil keputusan.
7. Cantumkan seluruh referensi rujukan dalam format tautan markdown [Nama Sumber/Institusi](https://url-sumber).

STRUKTUR LAPORAN RISET MENDALAM:
## Ringkasan Eksekutif
Sintesis temuan utama dan ikhtisar kondisi terkini dalam bahasa yang jernih dan terstruktur.
### Fakta Kunci, Data Kuantitatif & Dinamika Harian
Data terukur, persentase perubahan, metrik finansial/teknikal, dan katalis pendorong riil.
### Analisis Komparatif Sektoral / Pemetaan Masalah
Perbandingan performa sektor, pemangku kepentingan, atau entitas terkait.
### Evaluasi Peluang & Mitigasi Risiko
Peluang strategis dan identifikasi potensi risiko serta langkah mitigasi preventif.
### Rekomendasi Strategis Ahli
Panduan langkah konkret dan aplikatif yang dapat langsung dieksekusi.
### Sumber Referensi & Catatan Riset
Tautan rujukan asli dalam format markdown [Nama Sumber](https://url-sumber).`,
          },
        ],
        config: {
          // Enable Google Search tool for live web retrieval if available
          tools: [{ googleSearch: {} } as any],
        },
      });

      const text = response.text || "";
      const sources: ResearchSource[] = [];
      const seenUrls = new Set<string>();

      // Extract grounding metadata if provided by API
      const candidate = (response as any)?.candidates?.[0];
      const groundingMeta = candidate?.groundingMetadata;
      if (groundingMeta?.groundingChunks && Array.isArray(groundingMeta.groundingChunks)) {
        for (const chunk of groundingMeta.groundingChunks) {
          if (chunk.web?.uri && !seenUrls.has(chunk.web.uri)) {
            seenUrls.add(chunk.web.uri);
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
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
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
      let fallbackText = "";
      let lastFallbackErr: any = null;

      for (const modelToTry of candidateModels) {
        try {
          const fallbackResp = await this.ai.models.generateContent({
            model: modelToTry,
            contents: [
              {
                text: `Anda adalah ${expert.persona} (${expert.fieldLabel}).
Jelaskan secara komprehensif, mendalam, dan akurat mengenai topik: "${query}".
Fokus keahlian: ${expert.promptGuide}

Sampaikan fakta penting, analisis kritis, peluang, risiko, dan rekomendasi tingkat ahli. Jika ada sumber rujukan umum (portal resmi, bursa, jurnal, regulasi), sebutkan tautan umumnya.`,
              },
            ],
          });
          fallbackText = fallbackResp.text || "";
          if (fallbackText) break;
        } catch (fbErr: any) {
          lastFallbackErr = fbErr;
        }
      }

      if (fallbackText) {
        return {
          query,
          summary: fallbackText,
          sources: [],
          formattedMarkdown: fallbackText,
          expertPersona: expert.persona,
          fieldLabel: expert.fieldLabel,
        };
      }

      return {
        query,
        summary: `Riset untuk '${query}' belum berhasil diselesaikan.`,
        sources: [],
        formattedMarkdown: `Maaf, terjadi kendala saat meriset '${query}': ${lastFallbackErr?.message || "Koneksi terputus"}`,
        expertPersona: expert.persona,
        fieldLabel: expert.fieldLabel,
      };
    }
  }
}

export const researchService = new ResearchService();
