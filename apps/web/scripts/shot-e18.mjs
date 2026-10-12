/**
 * V18 Phase E screenshot script (not a test — run manually).
 * Serves the production build on :3100 and screenshots pages with
 * mocked API responses (no DB needed).
 *
 * Usage: npm run build && (npm run start -- -p 3100 &) && node scripts/shot-e18.mjs
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3101';
const OUT = '/tmp/e18-shots';

const ME = {
  user: { id: 'u1', email: 'shot@example.com', name: 'Shot User' },
  profile: { ramadanMode: true, country: 'PK', language: 'en' },
  subscription: { planId: 'free', status: 'active' },
};

const FOODS = [
  {
    id: 'food-roti', name: 'Whole wheat roti', brand: null,
    servingSize: 40, servingUnit: 'g',
    perServing: { kcal: 120, proteinG: 4, carbsG: 24, fatG: 1, fiberG: 2 },
    source: 'seeded', verified: true, verification: 'verified', basis: null,
    categoryId: 'cat-breads', categoryName: 'Breads',
  },
  {
    id: 'food-paratha', name: 'Aloo paratha (fried)', brand: null,
    servingSize: 100, servingUnit: 'g',
    perServing: { kcal: 320, proteinG: 6, carbsG: 44, fatG: 14, fiberG: 3 },
    source: 'seeded', verified: false, verification: 'estimate', basis: 'USDA generic equivalent',
    categoryId: 'cat-breads', categoryName: 'Breads',
  },
];

async function mockApis(page) {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: ME }));
  await page.route('**/api/profile', (r) => r.fulfill({ json: { profile: ME.profile } }));
  await page.route('**/api/foods*', (r) => {
    const url = new URL(r.request().url());
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const cat = url.searchParams.get('category');
    let foods = FOODS;
    if (cat) foods = FOODS.filter((f) => f.categoryId === cat);
    else if (q) {
      foods = FOODS.filter((f) =>
        q.split(/\s+/).every((w) => f.name.toLowerCase().includes(w)),
      );
      if (foods.length === 0) foods = FOODS;
    }
    r.fulfill({ json: { foods } });
  });
  await page.route('**/api/diary*', (r) =>
    r.fulfill({ json: { date: '2026-10-12', entries: [], totals: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 } } }),
  );
  await page.route('**/api/diary/recent*', (r) =>
    r.fulfill({ json: { foods: [{ foodId: 'food-roti', name: 'Whole wheat roti', servingUnit: 'g' }] } }),
  );
  await page.route('**/api/favorites', (r) => r.fulfill({ json: { favorites: [] } }));
  await page.route('**/api/water*', (r) => r.fulfill({ json: { date: '2026-10-12', ml: 750 } }));
  await page.route('**/api/measurements*', (r) => r.fulfill({ json: { measurements: [] } }));
}

async function shot(page, path, out, actions) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  if (actions) await actions(page);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${out}`, fullPage: true });
  console.log('saved', out);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await mockApis(page);

// 1. Voice screen — with a parsed review state (type into transcript + parse)
await shot(page, '/log/voice', 'voice.png', async (p) => {
  await p.fill('#voice-transcript', 'two rotis and one katori of daal');
  await p.click('text=Parse & review');
  await p.waitForTimeout(1500);
});

// 2. Ramadan page — with a saved fasting window
await shot(page, '/ramadan', 'ramadan.png', async (p) => {
  await p.evaluate(() => {
    localStorage.setItem('ff-ramadan-window', JSON.stringify({ start: '04:45', end: '18:05' }));
  });
  await p.reload({ waitUntil: 'networkidle' });
});

// 3. Swaps UI — nutrition diary, add-food modal, search, expand lighter options
await shot(page, '/nutrition', 'swaps.png', async (p) => {
  await p.locator('button:has-text("Add food")').first().click();
  await p.waitForTimeout(800);
  await p.fill('input[placeholder="Search foods (e.g. oatmeal)"]', 'paratha');
  await p.waitForTimeout(2500);
  const toggle = p.locator('text=Lighter options').first();
  if (await toggle.count()) {
    await toggle.click();
    await p.waitForTimeout(2000);
  }
});

await browser.close();
console.log('done');
