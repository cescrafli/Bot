import sharp from "sharp";

async function inspectMouth() {
  const metadata = await sharp("c:/laragon/www/Celyn_AI_BOT/apps/web/public/celyn_clean_cutout.png").metadata();
  console.log("Image dimensions:", metadata.width, "x", metadata.height);

  // Let's crop around x=350 to 450, y=300 to 420
  await sharp("c:/laragon/www/Celyn_AI_BOT/apps/web/public/celyn_clean_cutout.png")
    .extract({ left: 340, top: 300, width: 120, height: 120 })
    .toFile("C:/Users/cescr/.gemini/antigravity/brain/00098009-5c58-42f6-aff5-f8bc807aed03/mouth_crop.png");
  console.log("Mouth crop saved!");
}

inspectMouth().catch(console.error);
