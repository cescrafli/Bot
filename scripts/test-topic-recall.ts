import { extractFactsFromUtterance } from "../packages/shared/src/memoryExtractor";

const testCases = [
  // Proyek / Pekerjaan
  "aku lagi ngerjain website bot AI Celyn pakai Vite dan React",
  "proyekku saat ini adalah membangun sistem kecerdasan buatan",
  // Cerita / Pengalaman
  "kemarin aku ketemu teman lama di Senayan Park",
  "tadi di kantor server database sempat error",
  // Rencana
  "besok sore aku mau jogging keliling stadion",
  "minggu depan ada rencana mau liburan ke Jogja",
  // Topik Obrolan
  "kita lagi bahas tentang arsitektur database Turso",
  "aku mau bahas soal machine learning pipeline",
  // Kepemilikan Personal
  "kucingku namanya Mochi",
  "laptopku merknya Asus ROG",
  // Preferensi yang sudah ada (tidak boleh rusak!)
  "makanan kesukaan saya ikan",
  "makanan kesukaan celyn itu ikan",
  "celyn suka minum americano dingin",
];

console.log("=== TEST TOPIC & DISCUSSION EXTRACTION ===");
for (const tc of testCases) {
  const res = extractFactsFromUtterance(tc);
  console.log(`\nInput: "${tc}"`);
  if (res.length === 0) {
    console.log("  [FAILED] No facts extracted!");
  } else {
    for (const r of res) {
      console.log(`  -> [${r.category}] ${r.fact} (importance: ${r.importance})`);
    }
  }
}
