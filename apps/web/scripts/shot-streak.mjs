/**
 * V20 Feature 2 screenshot helper (not a test — run manually).
 *
 * Screenshots the StreakWidget. The temporary /streak-preview fixture page
 * (rendering StreakWidgetLoaded with synthetic data) was deleted after the
 * verification screenshot; recreate it (see git history / task notes) or
 * point BASE at a dev server and screenshot /dashboard (signed in) instead.
 *
 * Usage: (npx next dev -p 3105 &) && node scripts/shot-streak.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.SHOT_BASE ?? 'http://localhost:3105';
const OUT = '/tmp/streak-shots';
const PATH = process.env.SHOT_PATH ?? '/streak-preview';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

await page.goto(BASE + PATH, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/streak-widget.png` });
console.log('saved streak-widget.png');

await browser.close();
console.log('done');
