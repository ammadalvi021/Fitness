/**
 * FitFusion AI — V18 seed data (Pakistani home-food catalogue).
 *
 * PURE DATA MODULE: no imports from @prisma/client, no side effects.
 * `packages/db/prisma/seed.ts` imports these arrays and performs the upserts.
 * Tests may import this module safely (importing must never touch the DB).
 *
 * HONESTY CONTRACT (binding):
 *  - Every food is verification='estimate' with a `basis` string.
 *  - Raw vs cooked are separate records (dry vs cooked).
 *  - Nutrients are derived from per-100-g bases × serving grams, rounded
 *    sensibly (kcal to 1 decimal via round1-style rounding in seed.ts;
 *    values shown here are the per-100-g bases).
 */

export interface V18CategorySeed {
  name: string;
  nameUrdu: string;
  sortOrder: number;
}

export const V18_CATEGORIES: V18CategorySeed[] = [
  { name: 'Rice & Grains', nameUrdu: 'چاول اور اناج', sortOrder: 1 },
  { name: 'Flour, Atta & Cereals', nameUrdu: 'آٹا، میدہ اور اناج', sortOrder: 2 },
  { name: 'Bread & Bakery', nameUrdu: 'روٹی، نان اور بیکری', sortOrder: 3 },
  { name: 'Dairy', nameUrdu: 'دودھ اور ڈیری', sortOrder: 4 },
  { name: 'Eggs', nameUrdu: 'انڈے', sortOrder: 5 },
  { name: 'Chicken, Meat & Fish', nameUrdu: 'مرغی، گوشت اور مچھلی', sortOrder: 6 },
  { name: 'Lentils & Beans (Daal)', nameUrdu: 'دالیں اور پھلیاں', sortOrder: 7 },
  { name: 'Vegetables', nameUrdu: 'سبزیاں', sortOrder: 8 },
  { name: 'Fruits', nameUrdu: 'پھل', sortOrder: 9 },
  { name: 'Oils & Ghee', nameUrdu: 'تیل اور گھی', sortOrder: 10 },
  { name: 'Nuts & Seeds', nameUrdu: 'خشک میوے اور بیج', sortOrder: 11 },
  { name: 'Sauces & Condiments', nameUrdu: 'چٹنیاں اور اچار', sortOrder: 12 },
  { name: 'Tea, Coffee & Drinks', nameUrdu: 'چائے، کافی اور مشروبات', sortOrder: 13 },
  { name: 'Sweets & Desserts', nameUrdu: 'میٹھے اور ڈیزرٹ', sortOrder: 14 },
  { name: 'Breakfast', nameUrdu: 'ناشتہ', sortOrder: 15 },
  { name: 'Snacks & Street Food', nameUrdu: 'اسنیکس اور اسٹریٹ فوڈ', sortOrder: 16 },
];

export type AliasLang = 'en' | 'ur' | 'roman-ur';

export interface V18PortionSeed {
  label: string;
  labelUrdu?: string;
  grams?: number;
  ml?: number;
}

export interface V18FoodSeed {
  name: string;
  /** Must match a V18_CATEGORIES name (or an existing seeded category name). */
  category: string;
  servingSize: number;
  servingUnit: string;
  /** Per-100-g (or per-100-ml) base: [kcal, proteinG, carbsG, fatG, fiberG]. */
  per100: [number, number, number, number, number];
  basis: string;
  aliases: [string, AliasLang][];
  portions: V18PortionSeed[];
}

const HOME = 'Standard Pakistani home-recipe assumption';
const HOME_COOKED = 'Standard Pakistani home-recipe assumption (cooked weight)';
const USDA = 'USDA FoodData Central generic equivalent';
const USDA_DRY = 'USDA FoodData Central generic equivalent (dry weight)';

export const V18_FOODS: V18FoodSeed[] = [
  // ------------------------------------------------- Bread & Bakery ----
  {
    name: 'Aloo Paratha',
    category: 'Bread & Bakery',
    servingSize: 100, servingUnit: '1 piece (100g)',
    per100: [280, 6, 40, 11, 4],
    basis: HOME,
    aliases: [['aloo paratha', 'en'], ['potato paratha', 'en'], ['آلو پراٹھا', 'ur'], ['aloo paratha', 'roman-ur']],
    portions: [
      { label: '1 paratha', labelUrdu: '1 پراٹھا', grams: 100 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Roghni Naan',
    category: 'Bread & Bakery',
    servingSize: 100, servingUnit: '1 piece (100g)',
    per100: [290, 8, 52, 6, 2],
    basis: HOME,
    aliases: [['roghni naan', 'en'], ['روغنی نان', 'ur'], ['roghni naan', 'roman-ur']],
    portions: [
      { label: '1 naan', labelUrdu: '1 نان', grams: 100 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Puri',
    category: 'Bread & Bakery',
    servingSize: 60, servingUnit: '2 pieces (60g)',
    per100: [340, 7, 45, 15, 3],
    basis: HOME,
    aliases: [['puri', 'en'], ['poori', 'en'], ['پوری', 'ur'], ['puri', 'roman-ur'], ['poori', 'roman-ur']],
    portions: [
      { label: '2 puris', labelUrdu: '2 پوری', grams: 60 },
      { label: '1 puri', labelUrdu: '1 پوری', grams: 30 },
    ],
  },
  {
    name: 'Garlic Naan',
    category: 'Bread & Bakery',
    servingSize: 100, servingUnit: '1 piece (100g)',
    per100: [300, 8, 53, 7, 2],
    basis: HOME,
    aliases: [['garlic naan', 'en'], ['لہسن نان', 'ur'], ['garlic naan', 'roman-ur'], ['lehsan naan', 'roman-ur']],
    portions: [
      { label: '1 naan', labelUrdu: '1 نان', grams: 100 },
      { label: '100 g', grams: 100 },
    ],
  },

  // -------------------------------------------------- Rice & Grains ----
  {
    name: 'Zeera Rice (cooked)',
    category: 'Rice & Grains',
    servingSize: 150, servingUnit: '1 cup (150g)',
    per100: [150, 3, 32, 2, 1],
    basis: HOME_COOKED,
    aliases: [['zeera rice', 'en'], ['cumin rice', 'en'], ['زیرہ چاول', 'ur'], ['zeera chawal', 'roman-ur']],
    portions: [
      { label: '1 cup', labelUrdu: '1 کپ', grams: 150 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Chicken Pulao (home style)',
    category: 'Rice & Grains',
    servingSize: 300, servingUnit: '1 plate (300g)',
    per100: [170, 8, 28, 3, 1.5],
    basis: HOME_COOKED,
    aliases: [['chicken pulao', 'en'], ['murgh pulao', 'en'], ['چکن پلاؤ', 'ur'], ['chicken pulao', 'roman-ur']],
    portions: [
      { label: '1 plate', labelUrdu: '1 پلیٹ', grams: 300 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Chicken Biryani (home style)',
    category: 'Rice & Grains',
    servingSize: 350, servingUnit: '1 plate (350g)',
    per100: [165, 9, 26, 4, 1.5],
    basis: HOME_COOKED,
    aliases: [['chicken biryani', 'en'], ['چکن بریانی', 'ur'], ['chicken biryani', 'roman-ur']],
    portions: [
      { label: '1 plate', labelUrdu: '1 پلیٹ', grams: 350 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Vegetable Biryani',
    category: 'Rice & Grains',
    servingSize: 350, servingUnit: '1 plate (350g)',
    per100: [150, 4, 28, 3, 2.5],
    basis: HOME_COOKED,
    aliases: [['vegetable biryani', 'en'], ['veg biryani', 'en'], ['سبزی بریانی', 'ur'], ['vegetable biryani', 'roman-ur']],
    portions: [
      { label: '1 plate', labelUrdu: '1 پلیٹ', grams: 350 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Yakhni Pulao',
    category: 'Rice & Grains',
    servingSize: 300, servingUnit: '1 plate (300g)',
    per100: [165, 8, 27, 3.5, 1.5],
    basis: HOME_COOKED,
    aliases: [['yakhni pulao', 'en'], ['یخنی پلاؤ', 'ur'], ['yakhni pulao', 'roman-ur']],
    portions: [
      { label: '1 plate', labelUrdu: '1 پلیٹ', grams: 300 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Basmati Rice (dry, uncooked)',
    category: 'Rice & Grains',
    servingSize: 100, servingUnit: '100 g (dry)',
    per100: [360, 7, 78, 0.6, 1],
    basis: USDA_DRY,
    aliases: [['basmati rice (dry)', 'en'], ['uncooked basmati', 'en'], ['باسمتی چاول (خشک)', 'ur'], ['basmati chawal', 'roman-ur']],
    portions: [
      { label: '100 g dry', labelUrdu: '100 گرام خشک', grams: 100 },
      { label: '1/2 cup dry (~90 g)', grams: 90 },
    ],
  },

  // ------------------------------------------ Flour, Atta & Cereals ----
  {
    name: 'Atta (whole wheat flour, dry)',
    category: 'Flour, Atta & Cereals',
    servingSize: 100, servingUnit: '100 g (dry)',
    per100: [340, 13, 72, 2, 11],
    basis: USDA_DRY,
    aliases: [['atta', 'en'], ['whole wheat flour', 'en'], ['آٹا', 'ur'], ['atta', 'roman-ur']],
    portions: [
      { label: '100 g', grams: 100 },
      { label: '1 cup (~120 g)', grams: 120 },
    ],
  },
  {
    name: 'Rice Flour (dry)',
    category: 'Flour, Atta & Cereals',
    servingSize: 100, servingUnit: '100 g (dry)',
    per100: [360, 6, 80, 1, 2],
    basis: USDA_DRY,
    aliases: [['rice flour', 'en'], ['چاول کا آٹا', 'ur'], ['chawal ka atta', 'roman-ur']],
    portions: [{ label: '100 g', grams: 100 }],
  },
  {
    name: 'Besan (chickpea flour, dry)',
    category: 'Flour, Atta & Cereals',
    servingSize: 100, servingUnit: '100 g (dry)',
    per100: [360, 22, 58, 7, 11],
    basis: USDA_DRY,
    aliases: [['besan', 'en'], ['chickpea flour', 'en'], ['gram flour', 'en'], ['بیسن', 'ur'], ['besan', 'roman-ur']],
    portions: [
      { label: '100 g', grams: 100 },
      { label: '1 cup (~110 g)', grams: 110 },
    ],
  },
  {
    name: 'Sooji (semolina, dry)',
    category: 'Flour, Atta & Cereals',
    servingSize: 100, servingUnit: '100 g (dry)',
    per100: [360, 10, 73, 1, 3],
    basis: USDA_DRY,
    aliases: [['sooji', 'en'], ['semolina', 'en'], ['rava', 'en'], ['سوجی', 'ur'], ['sooji', 'roman-ur']],
    portions: [{ label: '100 g', grams: 100 }],
  },
  {
    name: 'Kala Chana (dry, uncooked)',
    category: 'Flour, Atta & Cereals',
    servingSize: 100, servingUnit: '100 g (dry)',
    per100: [360, 19, 61, 6, 17],
    basis: USDA_DRY,
    aliases: [['kala chana (dry)', 'en'], ['black chickpeas (dry)', 'en'], ['کالا چنا (خشک)', 'ur'], ['kala chana', 'roman-ur']],
    portions: [{ label: '100 g dry', labelUrdu: '100 گرام خشک', grams: 100 }],
  },
];

// ---------------------------------------------------------------------------
// V18 foods, continued: daal, curries, kebabs, vegetables
// ---------------------------------------------------------------------------
V18_FOODS.push(
  // ------------------------------------------------------------ Daal ----
  {
    name: 'Moong Daal (tarka)',
    category: 'Lentils & Beans (Daal)',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [120, 7, 18, 3, 4],
    basis: HOME_COOKED,
    aliases: [['moong daal', 'en'], ['mung dal', 'en'], ['مونگ دال', 'ur'], ['moong daal', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Chana Daal (cooked)',
    category: 'Lentils & Beans (Daal)',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [130, 8, 20, 3, 5],
    basis: HOME_COOKED,
    aliases: [['chana daal', 'en'], ['chana dal', 'en'], ['چنا دال', 'ur'], ['chana daal', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Maash Daal (cooked)',
    category: 'Lentils & Beans (Daal)',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [135, 8, 20, 4, 4],
    basis: HOME_COOKED,
    aliases: [['maash daal', 'en'], ['urad dal', 'en'], ['mash daal', 'en'], ['ماش دال', 'ur'], ['maash daal', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Mixed Daal Fry',
    category: 'Lentils & Beans (Daal)',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [125, 7, 19, 3.5, 4.5],
    basis: HOME_COOKED,
    aliases: [['mixed daal', 'en'], ['daal fry', 'en'], ['مکس دال', 'ur'], ['mixed daal', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Safed Chana (white chickpea curry)',
    category: 'Lentils & Beans (Daal)',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [140, 8, 22, 3, 6],
    basis: HOME_COOKED,
    aliases: [['safed chana', 'en'], ['white chickpea curry', 'en'], ['سفید چنے', 'ur'], ['safed chana', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Kala Chana (curry)',
    category: 'Lentils & Beans (Daal)',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [135, 8, 21, 3, 7],
    basis: HOME_COOKED,
    aliases: [['kala chana curry', 'en'], ['black chickpea curry', 'en'], ['کالے چنے', 'ur'], ['kala chana', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Lobia (black-eyed pea curry)',
    category: 'Lentils & Beans (Daal)',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [125, 8, 20, 2.5, 5],
    basis: HOME_COOKED,
    aliases: [['lobia', 'en'], ['black-eyed peas curry', 'en'], ['لوبیا', 'ur'], ['lobia', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Rajma (kidney bean curry)',
    category: 'Lentils & Beans (Daal)',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [130, 8, 21, 2.5, 6],
    basis: HOME_COOKED,
    aliases: [['rajma', 'en'], ['kidney bean curry', 'en'], ['راجما', 'ur'], ['rajma', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },

  // ------------------------------------------- Chicken, Meat & Fish ----
  {
    name: 'Chicken Karahi (home style)',
    category: 'Chicken, Meat & Fish',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [150, 14, 4, 9, 1],
    basis: HOME,
    aliases: [['chicken karahi', 'en'], ['chicken kadhai', 'en'], ['چکن کڑاہی', 'ur'], ['chicken karahi', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Chicken Korma',
    category: 'Chicken, Meat & Fish',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [180, 12, 6, 13, 1],
    basis: HOME,
    aliases: [['chicken korma', 'en'], ['murgh korma', 'en'], ['چکن قورمہ', 'ur'], ['chicken korma', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Chicken Jalfrezi',
    category: 'Chicken, Meat & Fish',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [130, 14, 6, 6, 2],
    basis: HOME,
    aliases: [['chicken jalfrezi', 'en'], ['چکن جلفریزی', 'ur'], ['chicken jalfrezi', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Chicken Handi',
    category: 'Chicken, Meat & Fish',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [170, 13, 5, 12, 1],
    basis: HOME,
    aliases: [['chicken handi', 'en'], ['murgh handi', 'en'], ['چکن ہانڈی', 'ur'], ['chicken handi', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Beef Korma',
    category: 'Chicken, Meat & Fish',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [200, 13, 5, 15, 1],
    basis: HOME,
    aliases: [['beef korma', 'en'], ['بیف قورمہ', 'ur'], ['beef korma', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Mutton Karahi',
    category: 'Chicken, Meat & Fish',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [220, 15, 3, 17, 1],
    basis: HOME,
    aliases: [['mutton karahi', 'en'], ['gosht karahi', 'en'], ['مٹن کڑاہی', 'ur'], ['mutton karahi', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Beef Keema',
    category: 'Chicken, Meat & Fish',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [230, 16, 3, 18, 1],
    basis: HOME,
    aliases: [['beef keema', 'en'], ['keema', 'en'], ['qima', 'en'], ['قیمہ', 'ur'], ['keema', 'roman-ur'], ['qeema', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Keema Aloo',
    category: 'Chicken, Meat & Fish',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [180, 12, 10, 10, 2],
    basis: HOME,
    aliases: [['keema aloo', 'en'], ['qeema aloo', 'en'], ['قیمہ آلو', 'ur'], ['keema aloo', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Aloo Gosht',
    category: 'Chicken, Meat & Fish',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [170, 12, 10, 9, 2],
    basis: HOME,
    aliases: [['aloo gosht', 'en'], ['potato beef curry', 'en'], ['آلو گوشت', 'ur'], ['aloo gosht', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Daal Gosht',
    category: 'Chicken, Meat & Fish',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [160, 12, 10, 8, 3],
    basis: HOME,
    aliases: [['daal gosht', 'en'], ['dal gosht', 'en'], ['دال گوشت', 'ur'], ['daal gosht', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Mutton Paya',
    category: 'Chicken, Meat & Fish',
    servingSize: 250, servingUnit: '1 bowl (250g)',
    per100: [150, 14, 2, 10, 0.5],
    basis: HOME,
    aliases: [['mutton paya', 'en'], ['paya', 'en'], ['پائے', 'ur'], ['paya', 'roman-ur']],
    portions: [
      { label: '1 bowl', labelUrdu: '1 پیالہ', grams: 250 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Beef Nihari (home style)',
    category: 'Chicken, Meat & Fish',
    servingSize: 300, servingUnit: '1 plate (300g)',
    per100: [190, 14, 6, 13, 1],
    basis: HOME,
    aliases: [['beef nihari', 'en'], ['nihari', 'en'], ['نہاری', 'ur'], ['nihari', 'roman-ur']],
    portions: [
      { label: '1 plate', labelUrdu: '1 پلیٹ', grams: 300 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Haleem',
    category: 'Chicken, Meat & Fish',
    servingSize: 300, servingUnit: '1 bowl (300g)',
    per100: [140, 10, 14, 4, 3],
    basis: HOME,
    aliases: [['haleem', 'en'], ['daleem', 'en'], ['حلیم', 'ur'], ['haleem', 'roman-ur']],
    portions: [
      { label: '1 bowl', labelUrdu: '1 پیالہ', grams: 300 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Seekh Kebab',
    category: 'Chicken, Meat & Fish',
    servingSize: 50, servingUnit: '1 piece (50g)',
    per100: [250, 18, 4, 18, 1],
    basis: HOME,
    aliases: [['seekh kebab', 'en'], ['seekh kabab', 'en'], ['سیخ کباب', 'ur'], ['seekh kebab', 'roman-ur']],
    portions: [
      { label: '1 kebab', labelUrdu: '1 کباب', grams: 50 },
      { label: '2 kebabs', grams: 100 },
    ],
  },
  {
    name: 'Shami Kebab',
    category: 'Chicken, Meat & Fish',
    servingSize: 50, servingUnit: '1 piece (50g)',
    per100: [220, 16, 8, 14, 2],
    basis: HOME,
    aliases: [['shami kebab', 'en'], ['shami kabab', 'en'], ['شامی کباب', 'ur'], ['shami kebab', 'roman-ur']],
    portions: [
      { label: '1 kebab', labelUrdu: '1 کباب', grams: 50 },
      { label: '2 kebabs', grams: 100 },
    ],
  },
  {
    name: 'Chapli Kebab',
    category: 'Chicken, Meat & Fish',
    servingSize: 80, servingUnit: '1 piece (80g)',
    per100: [280, 14, 10, 20, 2],
    basis: HOME,
    aliases: [['chapli kebab', 'en'], ['chapli kabab', 'en'], ['چپلی کباب', 'ur'], ['chapli kebab', 'roman-ur']],
    portions: [
      { label: '1 kebab', labelUrdu: '1 کباب', grams: 80 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Chicken Tikka (leg piece)',
    category: 'Chicken, Meat & Fish',
    servingSize: 150, servingUnit: '1 piece (150g)',
    per100: [160, 24, 2, 6, 0.5],
    basis: HOME,
    aliases: [['chicken tikka', 'en'], ['چکن ٹکا', 'ur'], ['chicken tikka', 'roman-ur']],
    portions: [
      { label: '1 leg piece', labelUrdu: '1 لیگ پیس', grams: 150 },
      { label: '100 g', grams: 100 },
    ],
  },

  // --------------------------------------------------------- Vegetables ----
  {
    name: 'Aloo Gobi',
    category: 'Vegetables',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [90, 2.5, 14, 3, 3],
    basis: HOME,
    aliases: [['aloo gobi', 'en'], ['potato cauliflower', 'en'], ['آلو گوبھی', 'ur'], ['aloo gobi', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Aloo Palak',
    category: 'Vegetables',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [80, 3, 12, 3, 3.5],
    basis: HOME,
    aliases: [['aloo palak', 'en'], ['potato spinach', 'en'], ['آلو پالک', 'ur'], ['aloo palak', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Bhindi Fry',
    category: 'Vegetables',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [90, 2.5, 10, 5, 4],
    basis: HOME,
    aliases: [['bhindi', 'en'], ['bhindi fry', 'en'], ['okra fry', 'en'], ['بھنڈی', 'ur'], ['bhindi', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Karela Fry',
    category: 'Vegetables',
    servingSize: 150, servingUnit: '1 katori (150g)',
    per100: [70, 2.5, 10, 3, 4],
    basis: HOME,
    aliases: [['karela', 'en'], ['karela fry', 'en'], ['bitter gourd fry', 'en'], ['کریلا', 'ur'], ['karela', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 150 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Palak Saag',
    category: 'Vegetables',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [70, 4, 8, 3, 4],
    basis: HOME,
    aliases: [['palak saag', 'en'], ['spinach curry', 'en'], ['پالک ساگ', 'ur'], ['palak saag', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Sarson ka Saag',
    category: 'Vegetables',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [90, 4, 9, 5, 4],
    basis: HOME,
    aliases: [['sarson ka saag', 'en'], ['sarson saag', 'en'], ['سرسوں کا ساگ', 'ur'], ['sarson ka saag', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Mixed Sabzi',
    category: 'Vegetables',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [75, 2.5, 11, 3, 3.5],
    basis: HOME,
    aliases: [['mixed sabzi', 'en'], ['mix sabzi', 'en'], ['مکس سبزی', 'ur'], ['mixed sabzi', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Aloo Methi',
    category: 'Vegetables',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [85, 3, 13, 3, 4],
    basis: HOME,
    aliases: [['aloo methi', 'en'], ['آلو میتھی', 'ur'], ['aloo methi', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
);

// ---------------------------------------------------------------------------
// V18 foods, continued: dairy, oils, drinks, sweets, breakfast, snacks,
// condiments, fruits, nuts
// ---------------------------------------------------------------------------
V18_FOODS.push(
  // -------------------------------------------------- Dairy & Oils ----
  {
    name: 'Desi Ghee',
    category: 'Oils & Ghee',
    servingSize: 5, servingUnit: '1 tsp (5g)',
    per100: [900, 0, 0, 100, 0],
    basis: USDA,
    aliases: [['desi ghee', 'en'], ['clarified butter', 'en'], ['دیسی گھی', 'ur'], ['desi ghee', 'roman-ur']],
    portions: [
      { label: '1 tsp', labelUrdu: '1 چائے کا چمچ', grams: 5 },
      { label: '1 tbsp', labelUrdu: '1 کھانے کا چمچ', grams: 14 },
    ],
  },
  {
    name: 'Makhan (white butter)',
    category: 'Dairy',
    servingSize: 14, servingUnit: '1 tbsp (14g)',
    per100: [720, 0.5, 0.5, 80, 0],
    basis: HOME,
    aliases: [['makhan', 'en'], ['white butter', 'en'], ['مکھن', 'ur'], ['makhan', 'roman-ur']],
    portions: [
      { label: '1 tbsp', labelUrdu: '1 کھانے کا چمچ', grams: 14 },
      { label: '1 tsp', grams: 5 },
    ],
  },
  {
    name: 'Cooking Oil',
    category: 'Oils & Ghee',
    servingSize: 14, servingUnit: '1 tbsp (14g)',
    per100: [884, 0, 0, 100, 0],
    basis: USDA,
    aliases: [['cooking oil', 'en'], ['vegetable oil', 'en'], ['کوکنگ آئل', 'ur'], ['cooking oil', 'roman-ur']],
    portions: [
      { label: '1 tbsp', labelUrdu: '1 کھانے کا چمچ', grams: 14 },
      { label: '1 tsp', grams: 5 },
    ],
  },
  {
    name: 'Mustard Oil',
    category: 'Oils & Ghee',
    servingSize: 14, servingUnit: '1 tbsp (14g)',
    per100: [884, 0, 0, 100, 0],
    basis: USDA,
    aliases: [['mustard oil', 'en'], ['سرسوں کا تیل', 'ur'], ['sarson ka tail', 'roman-ur']],
    portions: [
      { label: '1 tbsp', labelUrdu: '1 کھانے کا چمچ', grams: 14 },
      { label: '1 tsp', grams: 5 },
    ],
  },
  {
    name: 'Sweet Lassi',
    category: 'Dairy',
    servingSize: 250, servingUnit: '1 glass (250ml)',
    per100: [90, 3, 16, 1.5, 0],
    basis: HOME,
    aliases: [['sweet lassi', 'en'], ['meethi lassi', 'en'], ['میٹھی لسی', 'ur'], ['meethi lassi', 'roman-ur']],
    portions: [
      { label: '1 glass', labelUrdu: '1 گلاس', ml: 250 },
      { label: '1/2 glass', ml: 125 },
    ],
  },
  {
    name: 'Namkeen Lassi',
    category: 'Dairy',
    servingSize: 250, servingUnit: '1 glass (250ml)',
    per100: [55, 3.5, 5, 2, 0],
    basis: HOME,
    aliases: [['namkeen lassi', 'en'], ['salted lassi', 'en'], ['نمکین لسی', 'ur'], ['namkeen lassi', 'roman-ur']],
    portions: [
      { label: '1 glass', labelUrdu: '1 گلاس', ml: 250 },
      { label: '1/2 glass', ml: 125 },
    ],
  },
  {
    name: 'Mango Lassi',
    category: 'Dairy',
    servingSize: 250, servingUnit: '1 glass (250ml)',
    per100: [110, 3, 22, 1.5, 0.5],
    basis: HOME,
    aliases: [['mango lassi', 'en'], ['مینگو لسی', 'ur'], ['mango lassi', 'roman-ur']],
    portions: [
      { label: '1 glass', labelUrdu: '1 گلاس', ml: 250 },
      { label: '1/2 glass', ml: 125 },
    ],
  },

  // ------------------------------------------- Tea, Coffee & Drinks ----
  {
    name: 'Doodh Patti',
    category: 'Tea, Coffee & Drinks',
    servingSize: 150, servingUnit: '1 cup (150ml)',
    per100: [75, 3.5, 9, 3, 0],
    basis: HOME,
    aliases: [['doodh patti', 'en'], ['doodh pati', 'en'], ['milky chai', 'en'], ['دودھ پتی', 'ur'], ['doodh patti', 'roman-ur']],
    portions: [
      { label: '1 cup', labelUrdu: '1 کپ', ml: 150 },
      { label: '1 large mug (250ml)', ml: 250 },
    ],
  },
  {
    name: 'Kadak Chai',
    category: 'Tea, Coffee & Drinks',
    servingSize: 150, servingUnit: '1 cup (150ml)',
    per100: [60, 2.5, 10, 1.5, 0],
    basis: HOME,
    aliases: [['kadak chai', 'en'], ['karak chai', 'en'], ['strong tea', 'en'], ['کڑک چائے', 'ur'], ['kadak chai', 'roman-ur']],
    portions: [
      { label: '1 cup', labelUrdu: '1 کپ', ml: 150 },
      { label: '1 large mug (250ml)', ml: 250 },
    ],
  },
  {
    name: 'Elaichi Chai',
    category: 'Tea, Coffee & Drinks',
    servingSize: 150, servingUnit: '1 cup (150ml)',
    per100: [62, 2.5, 10.5, 1.5, 0],
    basis: HOME,
    aliases: [['elaichi chai', 'en'], ['cardamom tea', 'en'], ['الائچی چائے', 'ur'], ['elaichi chai', 'roman-ur']],
    portions: [{ label: '1 cup', labelUrdu: '1 کپ', ml: 150 }],
  },
  {
    name: 'Kashmiri Chai',
    category: 'Tea, Coffee & Drinks',
    servingSize: 150, servingUnit: '1 cup (150ml)',
    per100: [80, 3, 11, 3.5, 0],
    basis: HOME,
    aliases: [['kashmiri chai', 'en'], ['pink tea', 'en'], ['کشمیری چائے', 'ur'], ['kashmiri chai', 'roman-ur']],
    portions: [{ label: '1 cup', labelUrdu: '1 کپ', ml: 150 }],
  },
  {
    name: 'Qehwa (green tea)',
    category: 'Tea, Coffee & Drinks',
    servingSize: 150, servingUnit: '1 cup (150ml)',
    per100: [2, 0, 0.5, 0, 0],
    basis: 'USDA FoodData Central generic equivalent (unsweetened)',
    aliases: [['qehwa', 'en'], ['kehwa', 'en'], ['green tea', 'en'], ['قہوہ', 'ur'], ['qehwa', 'roman-ur']],
    portions: [{ label: '1 cup', labelUrdu: '1 کپ', ml: 150 }],
  },
  {
    name: 'Rooh Afza (diluted)',
    category: 'Tea, Coffee & Drinks',
    servingSize: 250, servingUnit: '1 glass (250ml)',
    per100: [50, 0, 13, 0, 0],
    basis: HOME,
    aliases: [['rooh afza', 'en'], ['روح افزا', 'ur'], ['rooh afza', 'roman-ur']],
    portions: [{ label: '1 glass', labelUrdu: '1 گلاس', ml: 250 }],
  },
  {
    name: 'Fresh Orange Juice',
    category: 'Tea, Coffee & Drinks',
    servingSize: 250, servingUnit: '1 glass (250ml)',
    per100: [45, 0.7, 11, 0.2, 0.2],
    basis: USDA,
    aliases: [['orange juice', 'en'], ['fresh orange juice', 'en'], ['اورنج جوس', 'ur'], ['orange juice', 'roman-ur']],
    portions: [{ label: '1 glass', labelUrdu: '1 گلاس', ml: 250 }],
  },
  {
    name: 'Sugarcane Juice',
    category: 'Tea, Coffee & Drinks',
    servingSize: 250, servingUnit: '1 glass (250ml)',
    per100: [65, 0.3, 16, 0, 0.3],
    basis: HOME,
    aliases: [['sugarcane juice', 'en'], ['ganne ka ras', 'en'], ['گنے کا رس', 'ur'], ['ganne ka ras', 'roman-ur']],
    portions: [{ label: '1 glass', labelUrdu: '1 گلاس', ml: 250 }],
  },
  {
    name: 'Mango Shake',
    category: 'Tea, Coffee & Drinks',
    servingSize: 250, servingUnit: '1 glass (250ml)',
    per100: [95, 3, 19, 1.5, 0.5],
    basis: HOME,
    aliases: [['mango shake', 'en'], ['mango milkshake', 'en'], ['مینگو شیک', 'ur'], ['mango shake', 'roman-ur']],
    portions: [{ label: '1 glass', labelUrdu: '1 گلاس', ml: 250 }],
  },
  {
    name: 'Banana Shake',
    category: 'Tea, Coffee & Drinks',
    servingSize: 250, servingUnit: '1 glass (250ml)',
    per100: [90, 3.5, 18, 2, 1],
    basis: HOME,
    aliases: [['banana shake', 'en'], ['کیلے کا شیک', 'ur'], ['banana shake', 'roman-ur']],
    portions: [{ label: '1 glass', labelUrdu: '1 گلاس', ml: 250 }],
  },

  // ---------------------------------------------- Sweets & Desserts ----
  {
    name: 'Kheer',
    category: 'Sweets & Desserts',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [130, 4, 22, 3, 0.3],
    basis: HOME,
    aliases: [['kheer', 'en'], ['rice pudding', 'en'], ['کھیر', 'ur'], ['kheer', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Rasmalai',
    category: 'Sweets & Desserts',
    servingSize: 100, servingUnit: '2 pieces (100g)',
    per100: [180, 6, 25, 6, 0],
    basis: HOME,
    aliases: [['rasmalai', 'en'], ['ras malai', 'en'], ['رس ملائی', 'ur'], ['rasmalai', 'roman-ur']],
    portions: [
      { label: '2 pieces', labelUrdu: '2 پیس', grams: 100 },
      { label: '1 piece', grams: 50 },
    ],
  },
  {
    name: 'Gulab Jamun',
    category: 'Sweets & Desserts',
    servingSize: 80, servingUnit: '2 pieces (80g)',
    per100: [380, 4, 55, 16, 0.5],
    basis: HOME,
    aliases: [['gulab jamun', 'en'], ['گلاب جامن', 'ur'], ['gulab jamun', 'roman-ur']],
    portions: [
      { label: '2 pieces', labelUrdu: '2 پیس', grams: 80 },
      { label: '1 piece', grams: 40 },
    ],
  },
  {
    name: 'Jalebi',
    category: 'Sweets & Desserts',
    servingSize: 60, servingUnit: '3 pieces (60g)',
    per100: [400, 3, 80, 10, 0.5],
    basis: HOME,
    aliases: [['jalebi', 'en'], ['جلیبی', 'ur'], ['jalebi', 'roman-ur']],
    portions: [
      { label: '3 pieces', labelUrdu: '3 پیس', grams: 60 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Milk Barfi',
    category: 'Sweets & Desserts',
    servingSize: 50, servingUnit: '2 pieces (50g)',
    per100: [420, 8, 60, 17, 0.5],
    basis: HOME,
    aliases: [['milk barfi', 'en'], ['barfi', 'en'], ['برفی', 'ur'], ['barfi', 'roman-ur']],
    portions: [
      { label: '2 pieces', labelUrdu: '2 پیس', grams: 50 },
      { label: '1 piece', grams: 25 },
    ],
  },
  {
    name: 'Gajar ka Halwa',
    category: 'Sweets & Desserts',
    servingSize: 150, servingUnit: '1 katori (150g)',
    per100: [220, 4, 38, 7, 2],
    basis: HOME,
    aliases: [['gajar ka halwa', 'en'], ['carrot halwa', 'en'], ['گاجر کا حلوہ', 'ur'], ['gajar ka halwa', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 150 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Shahi Tukra',
    category: 'Sweets & Desserts',
    servingSize: 120, servingUnit: '1 piece (120g)',
    per100: [280, 5, 40, 11, 1],
    basis: HOME,
    aliases: [['shahi tukra', 'en'], ['shahi tukray', 'en'], ['شاہی ٹکڑا', 'ur'], ['shahi tukra', 'roman-ur']],
    portions: [
      { label: '1 piece', labelUrdu: '1 پیس', grams: 120 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Kulfi',
    category: 'Sweets & Desserts',
    servingSize: 80, servingUnit: '1 stick (80g)',
    per100: [200, 5, 28, 8, 0.3],
    basis: HOME,
    aliases: [['kulfi', 'en'], ['قلفی', 'ur'], ['kulfi', 'roman-ur']],
    portions: [
      { label: '1 stick', labelUrdu: '1 قلفی', grams: 80 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Falooda',
    category: 'Sweets & Desserts',
    servingSize: 350, servingUnit: '1 glass (350ml)',
    per100: [150, 4, 28, 2.5, 0.5],
    basis: HOME,
    aliases: [['falooda', 'en'], ['فالودہ', 'ur'], ['falooda', 'roman-ur']],
    portions: [{ label: '1 glass', labelUrdu: '1 گلاس', ml: 350 }],
  },
  {
    name: 'Seviyan (sweet vermicelli)',
    category: 'Sweets & Desserts',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [160, 4, 28, 4, 0.5],
    basis: HOME,
    aliases: [['seviyan', 'en'], ['sweet vermicelli', 'en'], ['sewaiyan', 'en'], ['سویاں', 'ur'], ['seviyan', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Panjiri',
    category: 'Sweets & Desserts',
    servingSize: 50, servingUnit: '1 serving (50g)',
    per100: [450, 8, 55, 22, 4],
    basis: HOME,
    aliases: [['panjiri', 'en'], ['panjeeri', 'en'], ['پنجیری', 'ur'], ['panjiri', 'roman-ur']],
    portions: [{ label: '1 serving', labelUrdu: '1 خوراک', grams: 50 }],
  },
  {
    name: 'Zarda (sweet rice)',
    category: 'Sweets & Desserts',
    servingSize: 200, servingUnit: '1 katori (200g)',
    per100: [200, 2, 45, 2, 1],
    basis: HOME,
    aliases: [['zarda', 'en'], ['sweet rice', 'en'], ['زردہ', 'ur'], ['zarda', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },

  // ------------------------------------------------------- Breakfast ----
  {
    name: 'Anda Paratha',
    category: 'Breakfast',
    servingSize: 100, servingUnit: '1 piece (100g)',
    per100: [260, 9, 32, 10, 3],
    basis: HOME,
    aliases: [['anda paratha', 'en'], ['egg paratha', 'en'], ['انڈا پراٹھا', 'ur'], ['anda paratha', 'roman-ur']],
    portions: [
      { label: '1 paratha', labelUrdu: '1 پراٹھا', grams: 100 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Desi Omelette (2 eggs)',
    category: 'Breakfast',
    servingSize: 100, servingUnit: '1 plate (100g)',
    per100: [200, 12, 3, 15, 0.5],
    basis: HOME,
    aliases: [['omelette', 'en'], ['desi omelette', 'en'], ['anda omelette', 'en'], ['آملٹ', 'ur'], ['omelette', 'roman-ur']],
    portions: [
      { label: '1 plate (2 eggs)', labelUrdu: '1 پلیٹ', grams: 100 },
      { label: '1 egg omelette', grams: 50 },
    ],
  },
  {
    name: 'Fried Egg',
    category: 'Breakfast',
    servingSize: 50, servingUnit: '1 egg (50g)',
    per100: [200, 13, 1, 16, 0],
    basis: HOME,
    aliases: [['fried egg', 'en'], ['فرائی انڈا', 'ur'], ['fried egg', 'roman-ur']],
    portions: [
      { label: '1 egg', labelUrdu: '1 انڈا', grams: 50 },
      { label: '2 eggs', grams: 100 },
    ],
  },
  {
    name: 'Daliya (wheat porridge)',
    category: 'Breakfast',
    servingSize: 250, servingUnit: '1 bowl (250g)',
    per100: [90, 3.5, 15, 1.5, 1.5],
    basis: HOME,
    aliases: [['daliya', 'en'], ['wheat porridge', 'en'], ['dhalia', 'en'], ['دلیہ', 'ur'], ['daliya', 'roman-ur']],
    portions: [
      { label: '1 bowl', labelUrdu: '1 پیالہ', grams: 250 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Halwa Puri Nashta',
    category: 'Breakfast',
    servingSize: 350, servingUnit: '1 plate (350g)',
    per100: [280, 7, 40, 11, 2],
    basis: HOME,
    aliases: [['halwa puri', 'en'], ['halwa poori nashta', 'en'], ['حلوہ پوری', 'ur'], ['halwa puri', 'roman-ur']],
    portions: [{ label: '1 plate', labelUrdu: '1 پلیٹ', grams: 350 }],
  },

  // ---------------------------------------------- Snacks & Street Food ----
  {
    name: 'Bun Kebab',
    category: 'Snacks & Street Food',
    servingSize: 150, servingUnit: '1 piece (150g)',
    per100: [300, 12, 30, 15, 3],
    basis: HOME,
    aliases: [['bun kebab', 'en'], ['bun kabab', 'en'], ['بن کباب', 'ur'], ['bun kebab', 'roman-ur']],
    portions: [{ label: '1 bun kebab', labelUrdu: '1 بن کباب', grams: 150 }],
  },
  {
    name: 'Chicken Roll Paratha',
    category: 'Snacks & Street Food',
    servingSize: 200, servingUnit: '1 roll (200g)',
    per100: [240, 10, 28, 10, 3],
    basis: HOME,
    aliases: [['chicken roll paratha', 'en'], ['chicken paratha roll', 'en'], ['چکن رول پراٹھا', 'ur'], ['chicken roll paratha', 'roman-ur']],
    portions: [{ label: '1 roll', labelUrdu: '1 رول', grams: 200 }],
  },
  {
    name: 'Chicken Shawarma',
    category: 'Snacks & Street Food',
    servingSize: 200, servingUnit: '1 roll (200g)',
    per100: [220, 11, 24, 9, 2],
    basis: HOME,
    aliases: [['chicken shawarma', 'en'], ['shawarma', 'en'], ['شاورما', 'ur'], ['shawarma', 'roman-ur']],
    portions: [{ label: '1 roll', labelUrdu: '1 رول', grams: 200 }],
  },
  {
    name: 'Samosa (aloo)',
    category: 'Snacks & Street Food',
    servingSize: 100, servingUnit: '1 piece (100g)',
    per100: [300, 6, 32, 17, 3],
    basis: HOME,
    aliases: [['samosa', 'en'], ['aloo samosa', 'en'], ['سموسہ', 'ur'], ['samosa', 'roman-ur']],
    portions: [
      { label: '1 samosa', labelUrdu: '1 سموسہ', grams: 100 },
      { label: '2 samosas', grams: 200 },
    ],
  },
  {
    name: 'Mixed Vegetable Pakora',
    category: 'Snacks & Street Food',
    servingSize: 100, servingUnit: '5 pieces (100g)',
    per100: [280, 8, 25, 17, 4],
    basis: HOME,
    aliases: [['pakora', 'en'], ['pakoray', 'en'], ['vegetable pakora', 'en'], ['پکوڑے', 'ur'], ['pakoray', 'roman-ur']],
    portions: [
      { label: '5 pieces', labelUrdu: '5 پکوڑے', grams: 100 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Chicken Pakora',
    category: 'Snacks & Street Food',
    servingSize: 100, servingUnit: '5 pieces (100g)',
    per100: [260, 16, 15, 15, 2],
    basis: HOME,
    aliases: [['chicken pakora', 'en'], ['چکن پکوڑے', 'ur'], ['chicken pakoray', 'roman-ur']],
    portions: [
      { label: '5 pieces', labelUrdu: '5 پکوڑے', grams: 100 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Dahi Bhalla Chaat',
    category: 'Snacks & Street Food',
    servingSize: 250, servingUnit: '1 plate (250g)',
    per100: [120, 5, 18, 3, 2],
    basis: HOME,
    aliases: [['dahi bhalla', 'en'], ['dahi bhalla chaat', 'en'], ['دہی بھلے', 'ur'], ['dahi bhalla', 'roman-ur']],
    portions: [{ label: '1 plate', labelUrdu: '1 پلیٹ', grams: 250 }],
  },
  {
    name: 'Papri Chaat',
    category: 'Snacks & Street Food',
    servingSize: 200, servingUnit: '1 plate (200g)',
    per100: [160, 4, 24, 5, 2],
    basis: HOME,
    aliases: [['papri chaat', 'en'], ['papdi chaat', 'en'], ['پاپڑی چاٹ', 'ur'], ['papri chaat', 'roman-ur']],
    portions: [{ label: '1 plate', labelUrdu: '1 پلیٹ', grams: 200 }],
  },
  {
    name: 'Aloo Chaat',
    category: 'Snacks & Street Food',
    servingSize: 200, servingUnit: '1 plate (200g)',
    per100: [130, 2.5, 25, 3, 3],
    basis: HOME,
    aliases: [['aloo chaat', 'en'], ['آلو چاٹ', 'ur'], ['aloo chaat', 'roman-ur']],
    portions: [{ label: '1 plate', labelUrdu: '1 پلیٹ', grams: 200 }],
  },
  {
    name: 'Fruit Chaat',
    category: 'Snacks & Street Food',
    servingSize: 200, servingUnit: '1 bowl (200g)',
    per100: [70, 1, 17, 0.5, 2.5],
    basis: HOME,
    aliases: [['fruit chaat', 'en'], ['فروٹ چاٹ', 'ur'], ['fruit chaat', 'roman-ur']],
    portions: [{ label: '1 bowl', labelUrdu: '1 پیالہ', grams: 200 }],
  },
  {
    name: 'Gol Gappe (6 pcs)',
    category: 'Snacks & Street Food',
    servingSize: 150, servingUnit: '1 plate / 6 pcs (150g)',
    per100: [180, 3, 30, 5, 2],
    basis: HOME,
    aliases: [['gol gappe', 'en'], ['pani puri', 'en'], ['گول گپے', 'ur'], ['gol gappe', 'roman-ur']],
    portions: [{ label: '6 pieces', labelUrdu: '6 گول گپے', grams: 150 }],
  },
  {
    name: 'Chana Chaat',
    category: 'Snacks & Street Food',
    servingSize: 200, servingUnit: '1 plate (200g)',
    per100: [120, 6, 20, 2.5, 5],
    basis: HOME,
    aliases: [['chana chaat', 'en'], ['چنا چاٹ', 'ur'], ['chana chaat', 'roman-ur']],
    portions: [{ label: '1 plate', labelUrdu: '1 پلیٹ', grams: 200 }],
  },
  {
    name: 'Dahi Baray',
    category: 'Snacks & Street Food',
    servingSize: 200, servingUnit: '1 plate (200g)',
    per100: [130, 5.5, 19, 3.5, 2],
    basis: HOME,
    aliases: [['dahi baray', 'en'], ['dahi vada', 'en'], ['دہی بڑے', 'ur'], ['dahi baray', 'roman-ur']],
    portions: [{ label: '1 plate', labelUrdu: '1 پلیٹ', grams: 200 }],
  },
  {
    name: 'French Fries (homemade)',
    category: 'Snacks & Street Food',
    servingSize: 100, servingUnit: '1 plate (100g)',
    per100: [320, 3.5, 38, 17, 3.5],
    basis: HOME,
    aliases: [['french fries', 'en'], ['chips', 'en'], ['فرنچ فرائز', 'ur'], ['french fries', 'roman-ur']],
    portions: [{ label: '1 plate', labelUrdu: '1 پلیٹ', grams: 100 }],
  },

  // --------------------------------------------- Sauces & Condiments ----
  {
    name: 'Imli Chutney',
    category: 'Sauces & Condiments',
    servingSize: 20, servingUnit: '1 tbsp (20g)',
    per100: [150, 1, 38, 0.3, 2],
    basis: HOME,
    aliases: [['imli chutney', 'en'], ['tamarind chutney', 'en'], ['املی کی چٹنی', 'ur'], ['imli chutney', 'roman-ur']],
    portions: [{ label: '1 tbsp', labelUrdu: '1 کھانے کا چمچ', grams: 20 }],
  },
  {
    name: 'Mint Chutney',
    category: 'Sauces & Condiments',
    servingSize: 20, servingUnit: '1 tbsp (20g)',
    per100: [40, 2, 7, 1, 2.5],
    basis: HOME,
    aliases: [['mint chutney', 'en'], ['pudina chutney', 'en'], ['پودینے کی چٹنی', 'ur'], ['pudina chutney', 'roman-ur']],
    portions: [{ label: '1 tbsp', labelUrdu: '1 کھانے کا چمچ', grams: 20 }],
  },
  {
    name: 'Dahi Raita',
    category: 'Sauces & Condiments',
    servingSize: 100, servingUnit: '1 katori (100g)',
    per100: [60, 3.5, 7, 2, 0.3],
    basis: HOME,
    aliases: [['raita', 'en'], ['dahi raita', 'en'], ['رائتہ', 'ur'], ['raita', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 100 },
      { label: '1/2 katori', grams: 50 },
    ],
  },
  {
    name: 'Achar (mango pickle)',
    category: 'Sauces & Condiments',
    servingSize: 20, servingUnit: '1 tbsp (20g)',
    per100: [120, 1.5, 8, 11, 3],
    basis: HOME,
    aliases: [['achar', 'en'], ['mango pickle', 'en'], ['اچار', 'ur'], ['achar', 'roman-ur']],
    portions: [{ label: '1 tbsp', labelUrdu: '1 کھانے کا چمچ', grams: 20 }],
  },
  {
    name: 'Kachumber Salad',
    category: 'Sauces & Condiments',
    servingSize: 150, servingUnit: '1 bowl (150g)',
    per100: [25, 1, 5, 0.2, 1.5],
    basis: HOME,
    aliases: [['kachumber', 'en'], ['kachumber salad', 'en'], ['کچومبر', 'ur'], ['kachumber', 'roman-ur']],
    portions: [{ label: '1 bowl', labelUrdu: '1 پیالہ', grams: 150 }],
  },

  // ----------------------------------------------------------- Fruits ----
  {
    name: 'Guava',
    category: 'Fruits',
    servingSize: 150, servingUnit: '1 medium (150g)',
    per100: [68, 2.6, 14, 1, 5.4],
    basis: USDA,
    aliases: [['guava', 'en'], ['amrood', 'en'], ['امرود', 'ur'], ['amrood', 'roman-ur']],
    portions: [
      { label: '1 medium', labelUrdu: '1 درمیانہ', grams: 150 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Papaya',
    category: 'Fruits',
    servingSize: 150, servingUnit: '1 cup (150g)',
    per100: [43, 0.5, 11, 0.3, 1.7],
    basis: USDA,
    aliases: [['papaya', 'en'], ['papita', 'en'], ['پپیتا', 'ur'], ['papita', 'roman-ur']],
    portions: [{ label: '1 cup', labelUrdu: '1 کپ', grams: 150 }],
  },
  {
    name: 'Watermelon',
    category: 'Fruits',
    servingSize: 150, servingUnit: '1 cup (150g)',
    per100: [30, 0.6, 8, 0.2, 0.4],
    basis: USDA,
    aliases: [['watermelon', 'en'], ['tarbooz', 'en'], ['تربوز', 'ur'], ['tarbooz', 'roman-ur']],
    portions: [{ label: '1 cup', labelUrdu: '1 کپ', grams: 150 }],
  },
  {
    name: 'Grapes',
    category: 'Fruits',
    servingSize: 150, servingUnit: '1 cup (150g)',
    per100: [69, 0.7, 18, 0.2, 0.9],
    basis: USDA,
    aliases: [['grapes', 'en'], ['angoor', 'en'], ['انگور', 'ur'], ['angoor', 'roman-ur']],
    portions: [{ label: '1 cup', labelUrdu: '1 کپ', grams: 150 }],
  },
  {
    name: 'Pomegranate',
    category: 'Fruits',
    servingSize: 200, servingUnit: '1 medium (200g)',
    per100: [83, 1.7, 19, 1.2, 4],
    basis: USDA,
    aliases: [['pomegranate', 'en'], ['anar', 'en'], ['انار', 'ur'], ['anar', 'roman-ur']],
    portions: [
      { label: '1 medium', labelUrdu: '1 درمیانہ', grams: 200 },
      { label: '100 g', grams: 100 },
    ],
  },

  // ------------------------------------------------------- Nuts & Seeds ----
  {
    name: 'Walnuts (akhrot)',
    category: 'Nuts & Seeds',
    servingSize: 30, servingUnit: '1 small bowl (30g)',
    per100: [654, 15, 14, 65, 7],
    basis: USDA,
    aliases: [['walnuts', 'en'], ['akhrot', 'en'], ['اخروٹ', 'ur'], ['akhrot', 'roman-ur']],
    portions: [{ label: '1 small bowl', labelUrdu: '1 چھوٹا پیالہ', grams: 30 }],
  },
  {
    name: 'Pistachios',
    category: 'Nuts & Seeds',
    servingSize: 30, servingUnit: '1 small bowl (30g)',
    per100: [562, 20, 28, 45, 10],
    basis: USDA,
    aliases: [['pistachios', 'en'], ['pista', 'en'], ['پستہ', 'ur'], ['pista', 'roman-ur']],
    portions: [{ label: '1 small bowl', labelUrdu: '1 چھوٹا پیالہ', grams: 30 }],
  },
  {
    name: 'Cashews',
    category: 'Nuts & Seeds',
    servingSize: 30, servingUnit: '1 small bowl (30g)',
    per100: [553, 18, 30, 44, 3.3],
    basis: USDA,
    aliases: [['cashews', 'en'], ['kaju', 'en'], ['کاجو', 'ur'], ['kaju', 'roman-ur']],
    portions: [{ label: '1 small bowl', labelUrdu: '1 چھوٹا پیالہ', grams: 30 }],
  },
);

// ---------------------------------------------------------------------------
// Extensions for the 43 pre-existing starter foods: category, aliases,
// household portions, country codes. Never changes their nutrition values.
// ---------------------------------------------------------------------------

export interface V18ExistingFoodExtension {
  name: string;
  category?: string;
  countryCodes: string[];
  aliases: [string, AliasLang][];
  portions: V18PortionSeed[];
}

export const V18_EXISTING_FOOD_EXTENSIONS: V18ExistingFoodExtension[] = [
  {
    name: 'Chapati (Whole Wheat Roti)',
    category: 'Bread & Bakery',
    countryCodes: ['PK', 'IN'],
    aliases: [['roti', 'en'], ['chapati', 'en'], ['روٹی', 'ur'], ['چپاتی', 'ur'], ['roti', 'roman-ur'], ['chapati', 'roman-ur'], ['phulka', 'roman-ur']],
    portions: [
      { label: '1 roti', labelUrdu: '1 روٹی', grams: 30 },
      { label: '2 rotis', grams: 60 },
    ],
  },
  {
    name: 'Basmati Rice (cooked)',
    category: 'Rice & Grains',
    countryCodes: ['PK', 'IN'],
    aliases: [['cooked basmati', 'en'], ['white rice', 'en'], ['چاول', 'ur'], ['chawal', 'roman-ur']],
    portions: [
      { label: '1 cup', labelUrdu: '1 کپ', grams: 150 },
      { label: '100 g', grams: 100 },
    ],
  },
  {
    name: 'Masoor Daal (cooked)',
    category: 'Lentils & Beans (Daal)',
    countryCodes: ['PK', 'IN'],
    aliases: [['masoor daal', 'en'], ['red lentil daal', 'en'], ['مسور دال', 'ur'], ['masoor daal', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 },
      { label: '1 cup', grams: 200 },
    ],
  },
  {
    name: 'Chicken Breast (grilled)',
    category: 'Chicken, Meat & Fish',
    countryCodes: [],
    aliases: [['grilled chicken breast', 'en']],
    portions: [{ label: '100 g', grams: 100 }],
  },
  {
    name: 'Tandoori Chicken',
    category: 'Chicken, Meat & Fish',
    countryCodes: ['PK', 'IN'],
    aliases: [['tandoori chicken', 'en'], ['تندوری چکن', 'ur'], ['tandoori chicken', 'roman-ur']],
    portions: [{ label: '1 piece (100g)', grams: 100 }],
  },
  {
    name: 'Naan',
    category: 'Bread & Bakery',
    countryCodes: ['PK', 'IN'],
    aliases: [['naan', 'en'], ['tandoori naan', 'en'], ['نان', 'ur'], ['naan', 'roman-ur']],
    portions: [{ label: '1 naan', labelUrdu: '1 نان', grams: 90 }],
  },
  {
    name: 'Paratha (whole wheat)',
    category: 'Bread & Bakery',
    countryCodes: ['PK', 'IN'],
    aliases: [['paratha', 'en'], ['parantha', 'en'], ['پراٹھا', 'ur'], ['paratha', 'roman-ur']],
    portions: [{ label: '1 paratha', labelUrdu: '1 پراٹھا', grams: 60 }],
  },
  {
    name: 'Chana Masala (homemade)',
    category: 'Lentils & Beans (Daal)',
    countryCodes: ['PK', 'IN'],
    aliases: [['chana masala', 'en'], ['chole', 'en'], ['چنا مسالہ', 'ur'], ['chana masala', 'roman-ur']],
    portions: [{ label: '1 katori', labelUrdu: '1 کٹوری', grams: 200 }],
  },
  {
    name: 'Dahi - Plain Low-Fat Yogurt',
    category: 'Dairy',
    countryCodes: ['PK', 'IN'],
    aliases: [['dahi', 'en'], ['yogurt', 'en'], ['curd', 'en'], ['دہی', 'ur'], ['dahi', 'roman-ur']],
    portions: [
      { label: '1 katori', labelUrdu: '1 کٹوری', grams: 100 },
      { label: '1/2 cup', grams: 120 },
    ],
  },
  {
    name: 'Paneer',
    category: 'Dairy',
    countryCodes: ['PK', 'IN'],
    aliases: [['paneer', 'en'], ['cottage cheese', 'en'], ['پنیر', 'ur'], ['paneer', 'roman-ur']],
    portions: [{ label: '100 g', grams: 100 }],
  },
  {
    name: 'Boiled Eggs',
    category: 'Eggs',
    countryCodes: [],
    aliases: [['boiled eggs', 'en'], ['anda', 'en'], ['ابلے انڈے', 'ur'], ['uble ande', 'roman-ur']],
    portions: [
      { label: '2 eggs', labelUrdu: '2 انڈے', grams: 100 },
      { label: '1 egg', grams: 50 },
    ],
  },
  {
    name: 'Greek Yogurt (plain)',
    category: 'Dairy',
    countryCodes: [],
    aliases: [['greek yogurt', 'en']],
    portions: [{ label: '170 g', grams: 170 }],
  },
  {
    name: 'Salmon (baked)',
    category: 'Chicken, Meat & Fish',
    countryCodes: [],
    aliases: [['baked salmon', 'en']],
    portions: [{ label: '100 g', grams: 100 }],
  },
  {
    name: 'Tuna (canned in water)',
    category: 'Chicken, Meat & Fish',
    countryCodes: [],
    aliases: [['canned tuna', 'en']],
    portions: [{ label: '100 g', grams: 100 }],
  },
  {
    name: 'Beef (lean, cooked)',
    category: 'Chicken, Meat & Fish',
    countryCodes: [],
    aliases: [['lean beef', 'en']],
    portions: [{ label: '100 g', grams: 100 }],
  },
  {
    name: 'Tofu (firm)',
    countryCodes: [],
    aliases: [['tofu', 'en']],
    portions: [{ label: '100 g', grams: 100 }],
  },
  {
    name: 'Whey Protein Shake',
    countryCodes: [],
    aliases: [['whey protein', 'en'], ['protein shake', 'en']],
    portions: [{ label: '1 scoop', grams: 30 }],
  },
  {
    name: 'Oatmeal (cooked)',
    category: 'Flour, Atta & Cereals',
    countryCodes: [],
    aliases: [['oatmeal', 'en'], ['porridge', 'en']],
    portions: [{ label: '1 cup', grams: 240 }],
  },
  {
    name: 'Whole Wheat Bread',
    category: 'Bread & Bakery',
    countryCodes: [],
    aliases: [['whole wheat bread', 'en']],
    portions: [{ label: '1 slice', grams: 30 }],
  },
  {
    name: 'Pasta (cooked)',
    countryCodes: [],
    aliases: [['pasta', 'en']],
    portions: [{ label: '1 cup', grams: 140 }],
  },
  {
    name: 'Brown Rice (cooked)',
    category: 'Rice & Grains',
    countryCodes: [],
    aliases: [['brown rice', 'en']],
    portions: [{ label: '1 cup', grams: 150 }],
  },
  {
    name: 'Quinoa (cooked)',
    category: 'Rice & Grains',
    countryCodes: [],
    aliases: [['quinoa', 'en']],
    portions: [{ label: '1 cup', grams: 185 }],
  },
  {
    name: 'Potato (boiled)',
    category: 'Vegetables',
    countryCodes: [],
    aliases: [['boiled potato', 'en'], ['aloo', 'en'], ['آلو', 'ur'], ['aloo', 'roman-ur']],
    portions: [{ label: '1 medium', grams: 150 }],
  },
  {
    name: 'Sweet Potato (baked)',
    category: 'Vegetables',
    countryCodes: [],
    aliases: [['sweet potato', 'en'], ['shakarkandi', 'en'], ['شکرقندی', 'ur'], ['shakarkandi', 'roman-ur']],
    portions: [{ label: '1 medium', grams: 130 }],
  },
  {
    name: 'Chickpeas (cooked)',
    category: 'Lentils & Beans (Daal)',
    countryCodes: [],
    aliases: [['chickpeas', 'en'], ['kabuli chana', 'en'], ['کابلی چنے', 'ur'], ['kabuli chana', 'roman-ur']],
    portions: [{ label: '1 cup', grams: 164 }],
  },
  {
    name: 'Black Beans (cooked)',
    category: 'Lentils & Beans (Daal)',
    countryCodes: [],
    aliases: [['black beans', 'en']],
    portions: [{ label: '1 cup', grams: 172 }],
  },
  {
    name: 'Banana',
    category: 'Fruits',
    countryCodes: [],
    aliases: [['banana', 'en'], ['kela', 'en'], ['کیلا', 'ur'], ['kela', 'roman-ur']],
    portions: [{ label: '1 medium', labelUrdu: '1 درمیانہ', grams: 120 }],
  },
  {
    name: 'Apple',
    category: 'Fruits',
    countryCodes: [],
    aliases: [['apple', 'en'], ['seb', 'en'], ['سیب', 'ur'], ['seb', 'roman-ur']],
    portions: [{ label: '1 medium', grams: 180 }],
  },
  {
    name: 'Mango',
    category: 'Fruits',
    countryCodes: ['PK'],
    aliases: [['mango', 'en'], ['aam', 'en'], ['آم', 'ur'], ['aam', 'roman-ur']],
    portions: [{ label: '1 cup', grams: 165 }],
  },
  {
    name: 'Orange',
    category: 'Fruits',
    countryCodes: [],
    aliases: [['orange', 'en'], ['santara', 'en'], ['سنترا', 'ur'], ['santara', 'roman-ur']],
    portions: [{ label: '1 medium', grams: 140 }],
  },
  {
    name: 'Dates (Medjool)',
    category: 'Fruits',
    countryCodes: ['PK'],
    aliases: [['dates', 'en'], ['khajoor', 'en'], ['کھجور', 'ur'], ['khajoor', 'roman-ur']],
    portions: [{ label: '3 pieces', grams: 72 }],
  },
  {
    name: 'Avocado',
    category: 'Fruits',
    countryCodes: [],
    aliases: [['avocado', 'en']],
    portions: [{ label: '1/2', grams: 75 }],
  },
  {
    name: 'Broccoli (steamed)',
    category: 'Vegetables',
    countryCodes: [],
    aliases: [['broccoli', 'en']],
    portions: [{ label: '1 cup', grams: 156 }],
  },
  {
    name: 'Spinach (cooked)',
    category: 'Vegetables',
    countryCodes: [],
    aliases: [['cooked spinach', 'en'], ['palak', 'en'], ['پالک', 'ur'], ['palak', 'roman-ur']],
    portions: [{ label: '1 cup', grams: 180 }],
  },
  {
    name: 'Mixed Salad Greens',
    category: 'Vegetables',
    countryCodes: [],
    aliases: [['salad greens', 'en']],
    portions: [{ label: '2 cups', grams: 60 }],
  },
  {
    name: 'Almonds',
    category: 'Nuts & Seeds',
    countryCodes: ['PK'],
    aliases: [['almonds', 'en'], ['badam', 'en'], ['بادام', 'ur'], ['badam', 'roman-ur']],
    portions: [{ label: '28 g', grams: 28 }],
  },
  {
    name: 'Peanuts (roasted)',
    category: 'Nuts & Seeds',
    countryCodes: ['PK'],
    aliases: [['peanuts', 'en'], ['moong phali', 'en'], ['مونگ پھلی', 'ur'], ['moong phali', 'roman-ur']],
    portions: [{ label: '30 g', grams: 30 }],
  },
  {
    name: 'Peanut Butter',
    category: 'Nuts & Seeds',
    countryCodes: [],
    aliases: [['peanut butter', 'en']],
    portions: [{ label: '2 tbsp', grams: 32 }],
  },
  {
    name: 'Olive Oil',
    category: 'Oils & Ghee',
    countryCodes: [],
    aliases: [['olive oil', 'en'], ['zaitoon oil', 'en'], ['زیتون کا تیل', 'ur'], ['zaitoon oil', 'roman-ur']],
    portions: [
      { label: '1 tbsp', grams: 14 },
      { label: '1 tsp', grams: 5 },
    ],
  },
  {
    name: 'Whole Milk',
    category: 'Dairy',
    countryCodes: ['PK'],
    aliases: [['whole milk', 'en'], ['doodh', 'en'], ['دودھ', 'ur'], ['doodh', 'roman-ur']],
    portions: [
      { label: '1 glass', labelUrdu: '1 گلاس', ml: 250 },
      { label: '1 cup', ml: 240 },
    ],
  },
];
