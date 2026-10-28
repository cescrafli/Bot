import { extractFactsFromUtterance } from "../packages/shared/src/memoryExtractor";

const testCases = [
  "makanan kesukaan saya ikan",
  "makanan kesukaan saya adalah ikan",
  "makanan kesukaan saya itu ikan",
  "ingat kalau makanan kesukaan saya ikan",
  "tolong ingat ya makanan kesukaan saya ikan",
  "makanan kesukaanku ikan",
  "makanan kesukaanku adalah ikan",
  "aku suka makan ikan",
  "saya suka makan ikan",
  "makanan kesukaan celyn itu ikan",
  "makanan kesukaan celyn ikan",
  "makanan kesukaan celyn adalah ikan",
  "celyn suka makan ikan",
  "celyn paling suka makan ikan",
  "ikan adalah makanan kesukaan saya",
  "ikan itu makanan kesukaan celyn",
  "kopi kesukaan rafli americano dingin",
  "minuman kesukaan celyn americano dingin",
];

console.log("=== RUNNING EXTRACTOR COMPREHENSIVE TEST ===");
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
