import { extractFactsFromUtterance } from "../packages/shared/src/memoryExtractor.js";

const phrases = [
  "tolong ingatin saya kalau makanan kesukaanku sate maranggi",
  "tolong ingatin saya kalau aku suka sate maranggi",
  "tolong ingatkan aku kalau kesukaanku sate maranggi",
  "tolong ingat ya makanan kesukaan saya sate maranggi",
  "tolong ingatin aku besok ada meeting jam 10 pagi",
  "tolong ingatkan saya nanti malam jam 8 ada webinar",
  "tolong ingatin saya kalau celyn suka makan sate",
  "tolong ingatin kalau aku lagi ngerjain website celyn",
  "tolong ingat ya kalau aku suka minum americano dingin",
  "tolong ingatin saya ya"
];

for (const p of phrases) {
  const res = extractFactsFromUtterance(p);
  console.log(`Input: "${p}"`);
  console.log("Result:", res);
  console.log("-------------------");
}
