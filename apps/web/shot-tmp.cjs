const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 800, height: 1000 }, deviceScaleFactor: 2 });
  await page.goto("http://localhost:3111/share-card-preview", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "/tmp/share-cards-preview.png", fullPage: true });
  await browser.close();
  console.log("saved");
})();
