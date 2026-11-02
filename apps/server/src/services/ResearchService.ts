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
      "gemini-2.5-flash",
      "gemini-3-flash-preview",
      config.textModel,
      "gemini-3.8-flash",
    ].filter((m, i, a): m is string => Boolean(m) && a.indexOf(m) === i);

    const wibDateStr = getWibFormattedString(new Date());

    const promptText = `Anda adalah ${expert.persona}.
Sajikan laporan riset mendalam tingkat pakar (Deep Research & Comprehensive Analysis) yang berbasis data riil, tajam, terstruktur, komprehensif, dan didukung banyak sumber terpercaya untuk topik berikut:
Topik/Pertanyaan: "${query}"
Bidang Keahlian: ${expert.fieldLabel}
Waktu Acuan Riset (WIB / Jakarta, UTC+7): ${wibDateStr}
Panduan Analisis: ${expert.promptGuide}
PENTING ZONA WAKTU: Gunakan waktu acuan Jakarta (WIB, UTC+7) di atas sebagai patokan resmi hari, tanggal, dan rentang "minggu ini". JANGAN PERNAH mengikuti waktu UTC server.

7 KETENTUAN EMAS RISET MENDALAM & RANGKUMAN DETAIL LENGKAP:
1. Telusuri topik secara menyeluruh dari multi-sudut pandang (jangan puas dengan 1-2 pencarian sekilas).
2. Kumpulkan sebanyak dan seberagam mungkin fakta riil, kronologi peristiwa, dan angka kuantitatif dari sumber primer/terpercaya.
3. Rangkum temuan menjadi sintesis runtut dan jelaskan setiap poin penting secara mendalam dalam bahasa yang mudah dipahami tanpa menghilangkan detail substansial.
4. Jika mencakup pergerakan data/keuangan/pasar modal/indikator, WAJIB sajikan tabel data kuantitatif komparatif (misal dinamika hari ke hari, metrik teknikal/fundamental, atau indikator kunci).
5. Evaluasi peluang strategis dan mitigasi risiko secara objektif, kritis, dan terukur.
6. Berikan kesimpulan dan rekomendasi konkret yang dapat langsung dieksekusi.
7. Cantumkan seluruh referensi rujukan dalam format tautan markdown [Nama Sumber/Institusi](https://url-sumber).

STRUKTUR LAPORAN RISET MENDALAM (WAJIB MEMENUHI 7 BAGIAN LENGKAP):
## Ringkasan Eksekutif & Sintesis Utama
Sintesis temuan utama dan ikhtisar kondisi terkini dalam bahasa yang jernih, runtut, dan terstruktur.

### Penjelasan Detail & Dekonstruksi Masalah/Temuan
Penjelasan mendalam setiap poin penting, mekanisme kerja, regulasi, kronologi, atau latar belakang secara tuntas tanpa pemotongan.

### Data Kuantitatif, Fakta Kunci & Tabel Perbandingan
Tabel Markdown data riil (format: | Indikator / Parameter | Nilai / Data Riil | Keterangan / Tren |) berisi metrik numerik dan fakta terukur.

### Analisis Multi-Sudut Pandang / Komparatif Sektoral
Pemetaan komparatif antar sektor, entitas terkait, pro vs kontra, atau dinamika historis vs tren masa kini.

### Evaluasi Peluang & Mitigasi Risiko Terukur
Analisis peluang strategis yang dapat dimanfaatkan serta potensi risiko dan langkah pencegahan/mitigasi preventif.

### Rekomendasi Strategis & Rencana Aksi Ahli
Panduan langkah konkret, aplikatif, dan terukur bagi pengambil keputusan.

### Sumber Referensi & Catatan Riset
Daftar tautan rujukan asli dalam format markdown [Nama Sumber / Judul](https://url-sumber).`;

    // Tahap 1: Coba Grounding dengan cascade kandidat model
    let lastGroundingErr: any = null;
    for (const modelName of candidateModels) {
      try {
        const response = await this.ai.models.generateContent({
          model: modelName,
          contents: [{ text: promptText }],
          config: {
            tools: [{ googleSearch: {} } as any],
            maxOutputTokens: 8192,
          },
        });

        const text = response.text || "";
        if (!text) continue;

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

        // Ekstraksi tautan markdown [Judul](https://...)
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

        let formattedMarkdown = text;
        if (sources.length > 0 && !text.includes("### Sumber Referensi")) {
          formattedMarkdown +=
            "\n\n### Sumber Referensi:\n" +
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
        lastGroundingErr = err;
        console.warn(`[ResearchService] Grounding gagal pada model '${modelName}':`, err?.message || err);
      }
    }

    console.warn(`[ResearchService] Seluruh model grounding gagal untuk '${query}', beralih ke fallback non-grounded...`);

    // Tahap 2: Fallback tanpa tools jika grounding ditolak
    let fallbackText = "";
    let lastFallbackErr: any = null;

    for (const modelToTry of candidateModels) {
      try {
        const fallbackResp = await this.ai.models.generateContent({
          model: modelToTry,
          contents: [{ text: promptText }],
          config: {
            maxOutputTokens: 8192,
          },
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
      formattedMarkdown: `Maaf, terjadi kendala saat meriset '${query}': ${lastFallbackErr?.message || lastGroundingErr?.message || "Koneksi terputus"}`,
      expertPersona: expert.persona,
      fieldLabel: expert.fieldLabel,
    };
  }
}

export const researchService = new ResearchService();
