// FitFusion AI — database seed (packages/db/prisma/seed.ts).
// IDEMPOTENT: re-running the seed against an unchanged DB performs no writes.
//  - Recipes: create-vs-update is planned per record (see
//    packages/db/src/seed-safety.ts). Private user-created recipes are never
//    touched (skipped). Unchanged content leaves verified/review evidence
//    alone; a material change recomputes contentHash, bumps revision
//    atomically (conditional on the read revision), invalidates stale
//    evidence, and re-screens allergens. A per-record report
//    (created/updated/unchanged/skipped/failed) prints at the end.
//  - Exercises: mediaType/mediaUrl are only written on create (or when the
//    seed explicitly carries media) — imported exercise media survives.
// Run from packages/db:  DATABASE_URL=... npx tsx prisma/seed.ts
// Seeds: 13 cuisines, ~30 curated recipes, ~50 text-first exercises, ~40 starter foods.

// --- tiny .env loader (no new dependencies) --------------------------------
// Loads ../../.env (repo root) for keys not already present in process.env.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

{
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = join(here, '..', '..', '..', '.env');
  if (existsSync(envPath)) {
    for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key && !(key in process.env)) process.env[key] = val;
    }
  }
}

import { PrismaClient } from '@prisma/client';
// V21.8: seed-safety planning + write application (pure decision logic in
// src/seed-safety.ts — unit-testable without PostgreSQL).
import {
  SeedStats,
  applyExerciseSeed,
  applyRecipeSeed,
  type NormalizedRecipeSeed,
} from '../src/seed-safety.js';
import {
  V18_CATEGORIES,
  V18_EXISTING_FOOD_EXTENSIONS,
  V18_FOODS,
  type V18FoodSeed,
} from './seed-v18-data.js';
import { PAKISTANI_RECIPES } from './seed-recipes-pakistani.js';
import { INDIAN_MET_RECIPES } from './seed-recipes-indian-met.js';
import { ASIAN_RECIPES } from './seed-recipes-asian.js';
import { WESTERN_RECIPES } from './seed-recipes-western.js';
// V21.2: alias persistence helpers (pure — no DB I/O at import time).
import { buildRecipeAliasRows } from '../src/alias-normalize.js';

const prisma = new PrismaClient();

/** Round to 1 decimal — same convention as @fitfusion/core roundNutrients. */
function r1(x: number): number {
  return Math.round(x * 10) / 10;
}

// ---------------------------------------------------------------------------
// Cuisines
// ---------------------------------------------------------------------------
const CUISINES: { name: string; region: string }[] = [
  { name: 'Pakistani', region: 'South Asia' },
  { name: 'Indian', region: 'South Asia' },
  { name: 'Chinese', region: 'East Asia' },
  { name: 'Japanese', region: 'East Asia' },
  { name: 'Korean', region: 'East Asia' },
  { name: 'Thai', region: 'Southeast Asia' },
  { name: 'Italian', region: 'Southern Europe' },
  { name: 'Mediterranean', region: 'Mediterranean' },
  { name: 'Middle Eastern', region: 'Middle East' },
  { name: 'Turkish', region: 'Anatolia' },
  { name: 'American', region: 'North America' },
  { name: 'Mexican', region: 'Latin America' },
  { name: 'Continental', region: 'Western / Global' },
];

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------
type Ingredient = { name: string; quantity: string; grams: number };
type Step = { step: number; text: string };
type RecipeSeed = {
  slug: string;
  title: string;
  cuisine: string;
  dietCategory: 'vegetarian' | 'non_vegetarian';
  tags: string[];
  servings: number;
  prepMin: number;
  cookMin: number;
  difficulty: string;
  ingredients: Ingredient[];
  instructions: Step[];
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  allergens: string[];
  /**
   * v21.2 P8 claims policy: 'halal-friendly' tag requires a recorded human
   * review — pork-absence alone never grants it. No original recipe has one.
   */
  halalReview?: { reviewer: string; reviewedAt: string };
  /**
   * v21.2 P8: how `allergens` was produced. Absent =
   * 'declared-from-ingredient-names' (name-based screening, not a certified
   * analysis). None of the original recipes has a human-reviewed list.
   */
  allergenBasis?: 'declared-from-ingredient-names' | 'human-reviewed';
};

const RECIPES: RecipeSeed[] = [
  {
    slug: 'light-chicken-karahi',
    title: 'Light Chicken Karahi',
    cuisine: 'Pakistani',
    dietCategory: 'non_vegetarian',
    tags: ['high-protein', 'dairy-free'],
    servings: 4, prepMin: 15, cookMin: 25, difficulty: 'medium',
    ingredients: [
      { name: 'Chicken breast, cubed', quantity: '600 g', grams: 600 },
      { name: 'Tomatoes, chopped', quantity: '4 medium', grams: 400 },
      { name: 'Onion, sliced', quantity: '1 medium', grams: 120 },
      { name: 'Ginger-garlic paste', quantity: '2 tbsp', grams: 30 },
      { name: 'Green chilies, slit', quantity: '3', grams: 15 },
      { name: 'Olive oil', quantity: '2 tbsp', grams: 28 },
      { name: 'Karahi masala + salt + turmeric', quantity: 'to taste', grams: 15 },
      { name: 'Fresh coriander, chopped', quantity: '2 tbsp', grams: 8 },
    ],
    instructions: [
      { step: 1, text: 'Heat oil in a karahi or deep pan over medium-high heat. Add onion and sauté 3 minutes.' },
      { step: 2, text: 'Add ginger-garlic paste and chicken; sear until lightly browned, about 6 minutes.' },
      { step: 3, text: 'Add tomatoes, chilies, salt, turmeric and karahi masala. Stir well.' },
      { step: 4, text: 'Cover and cook 15 minutes until chicken is cooked through and oil separates at the edges.' },
      { step: 5, text: 'Uncover, cook on high 3 minutes to thicken the masala. Garnish with coriander and serve hot.' },
    ],
    kcal: 320, proteinG: 38, carbsG: 8, fatG: 14, fiberG: 2, allergens: [],
  },
  {
    slug: 'masoor-daal',
    title: 'Masoor Daal (Red Lentil Curry)',
    cuisine: 'Pakistani',
    dietCategory: 'vegetarian',
    tags: ['vegan', 'high-fiber', 'budget-friendly', 'gluten-free', 'dairy-free'],
    servings: 4, prepMin: 10, cookMin: 30, difficulty: 'easy',
    ingredients: [
      { name: 'Red lentils (masoor daal), rinsed', quantity: '1 cup', grams: 190 },
      { name: 'Onion, chopped', quantity: '1 medium', grams: 120 },
      { name: 'Tomato, chopped', quantity: '1 medium', grams: 100 },
      { name: 'Turmeric + cumin + salt', quantity: 'to taste', grams: 12 },
      { name: 'Garlic cloves, sliced', quantity: '4', grams: 16 },
      { name: 'Oil', quantity: '1 tbsp', grams: 14 },
      { name: 'Water', quantity: '4 cups', grams: 950 },
    ],
    instructions: [
      { step: 1, text: 'Combine lentils, onion, tomato, turmeric and water in a pot. Bring to a boil.' },
      { step: 2, text: 'Reduce heat and simmer 25 minutes until lentils dissolve into a thick soup.' },
      { step: 3, text: 'Heat oil in a small pan; fry garlic and cumin until golden. Pour the tempering over the daal.' },
      { step: 4, text: 'Season with salt, simmer 5 more minutes and serve with roti or rice.' },
    ],
    kcal: 210, proteinG: 12, carbsG: 32, fatG: 3, fiberG: 8, allergens: [],
  },
  {
    slug: 'chicken-tikka',
    title: 'Chicken Tikka (Oven-Grilled)',
    cuisine: 'Pakistani',
    dietCategory: 'non_vegetarian',
    tags: ['high-protein', 'gluten-free', 'dairy-free'],
    servings: 4, prepMin: 15, cookMin: 20, difficulty: 'medium',
    ingredients: [
      { name: 'Chicken breast, 1-inch cubes', quantity: '700 g', grams: 700 },
      { name: 'Lemon juice', quantity: '2 tbsp', grams: 30 },
      { name: 'Tikka masala + salt + chili', quantity: '2 tbsp', grams: 20 },
      { name: 'Mustard oil', quantity: '1 tbsp', grams: 14 },
      { name: 'Onion rings + lemon wedges', quantity: 'for serving', grams: 60 },
    ],
    instructions: [
      { step: 1, text: 'Toss chicken with lemon juice, spices and oil. Marinate 30 minutes (or up to 4 hours refrigerated).' },
      { step: 2, text: 'Thread onto skewers. Preheat oven to 230°C (450°F) with a rack near the top.' },
      { step: 3, text: 'Grill 18–20 minutes, turning once, until charred at the edges and cooked through.' },
      { step: 4, text: 'Rest 3 minutes and serve with onion rings and lemon wedges.' },
    ],
    kcal: 240, proteinG: 34, carbsG: 4, fatG: 9, fiberG: 1, allergens: [],
  },
  {
    slug: 'vegetable-biryani',
    title: 'Vegetable Biryani',
    cuisine: 'Indian',
    dietCategory: 'vegetarian',
    tags: ['vegan', 'high-fiber', 'budget-friendly'],
    servings: 6, prepMin: 25, cookMin: 40, difficulty: 'medium',
    ingredients: [
      { name: 'Basmati rice, soaked 20 min', quantity: '2 cups', grams: 370 },
      { name: 'Mixed vegetables (carrot, peas, beans, potato)', quantity: '4 cups', grams: 500 },
      { name: 'Onion, thinly sliced', quantity: '2 large', grams: 240 },
      { name: 'Yogurt (plant or dairy)', quantity: '1/2 cup', grams: 120 },
      { name: 'Biryani masala + whole spices', quantity: 'to taste', grams: 20 },
      { name: 'Oil', quantity: '3 tbsp', grams: 42 },
      { name: 'Mint + coriander', quantity: '1/2 cup', grams: 20 },
    ],
    instructions: [
      { step: 1, text: 'Parboil the soaked rice 5 minutes; drain when 70% cooked. Set aside.' },
      { step: 2, text: 'Fry onions until deep golden. Remove half for garnish.' },
      { step: 3, text: 'Sauté vegetables with biryani masala and yogurt 5 minutes.' },
      { step: 4, text: 'Layer rice over vegetables, top with fried onions and herbs. Cover tightly and steam on low 20 minutes.' },
      { step: 5, text: 'Rest 10 minutes, fluff gently and serve.' },
    ],
    kcal: 380, proteinG: 9, carbsG: 68, fatG: 8, fiberG: 7, allergens: [],
  },
  {
    slug: 'palak-paneer',
    title: 'Palak Paneer',
    cuisine: 'Indian',
    dietCategory: 'vegetarian',
    tags: ['high-protein', 'gluten-free'],
    servings: 4, prepMin: 15, cookMin: 20, difficulty: 'medium',
    ingredients: [
      { name: 'Paneer, cubed', quantity: '250 g', grams: 250 },
      { name: 'Spinach, blanched', quantity: '500 g', grams: 500 },
      { name: 'Onion + tomato', quantity: '1 each', grams: 220 },
      { name: 'Ginger-garlic paste', quantity: '1 tbsp', grams: 15 },
      { name: 'Cream', quantity: '2 tbsp', grams: 30 },
      { name: 'Garam masala + salt + cumin', quantity: 'to taste', grams: 12 },
      { name: 'Oil', quantity: '1 tbsp', grams: 14 },
    ],
    instructions: [
      { step: 1, text: 'Blend blanched spinach into a smooth puree.' },
      { step: 2, text: 'Sauté onion, ginger-garlic and tomato until soft. Add spices.' },
      { step: 3, text: 'Add spinach puree and simmer 8 minutes.' },
      { step: 4, text: 'Stir in paneer cubes and cream; simmer 5 minutes and serve.' },
    ],
    kcal: 290, proteinG: 14, carbsG: 12, fatG: 20, fiberG: 4, allergens: ['milk'],
  },
  {
    slug: 'chana-masala',
    title: 'Chana Masala',
    cuisine: 'Indian',
    dietCategory: 'vegetarian',
    tags: ['vegan', 'high-fiber', 'budget-friendly', 'gluten-free', 'dairy-free'],
    servings: 4, prepMin: 10, cookMin: 25, difficulty: 'easy',
    ingredients: [
      { name: 'Chickpeas, cooked', quantity: '3 cups', grams: 500 },
      { name: 'Onion, chopped', quantity: '1 large', grams: 150 },
      { name: 'Tomatoes, pureed', quantity: '2', grams: 200 },
      { name: 'Ginger-garlic paste', quantity: '1 tbsp', grams: 15 },
      { name: 'Chana masala + turmeric + salt', quantity: 'to taste', grams: 15 },
      { name: 'Oil', quantity: '1 tbsp', grams: 14 },
    ],
    instructions: [
      { step: 1, text: 'Sauté onion until golden; add ginger-garlic paste and cook 1 minute.' },
      { step: 2, text: 'Add tomato puree and spices; cook until oil separates, about 8 minutes.' },
      { step: 3, text: 'Add chickpeas and 1 cup water. Simmer 12 minutes, mashing a few chickpeas to thicken.' },
      { step: 4, text: 'Garnish with coriander and serve with rice or roti.' },
    ],
    kcal: 260, proteinG: 12, carbsG: 40, fatG: 6, fiberG: 10, allergens: [],
  },
  {
    slug: 'chicken-chow-mein',
    title: 'Chicken Chow Mein',
    cuisine: 'Chinese',
    dietCategory: 'non_vegetarian',
    tags: ['high-protein', 'dairy-free'],
    servings: 4, prepMin: 15, cookMin: 15, difficulty: 'easy',
    ingredients: [
      { name: 'Chicken breast, thin strips', quantity: '400 g', grams: 400 },
      { name: 'Egg noodles', quantity: '250 g dry', grams: 250 },
      { name: 'Cabbage + carrots + bell pepper, julienned', quantity: '3 cups', grams: 350 },
      { name: 'Soy sauce + oyster sauce', quantity: '3 tbsp', grams: 54 },
      { name: 'Garlic + ginger, minced', quantity: '1 tbsp', grams: 15 },
      { name: 'Sesame oil', quantity: '1 tbsp', grams: 14 },
    ],
    instructions: [
      { step: 1, text: 'Cook noodles per package; drain and toss with half the sesame oil.' },
      { step: 2, text: 'Stir-fry chicken over high heat 4 minutes; remove.' },
      { step: 3, text: 'Stir-fry garlic, ginger and vegetables 3 minutes until crisp-tender.' },
      { step: 4, text: 'Return chicken and noodles; add sauces and toss 2 minutes. Serve hot.' },
    ],
    kcal: 420, proteinG: 30, carbsG: 48, fatG: 12, fiberG: 4, allergens: ['wheat', 'soy'],
  },
  {
    slug: 'vegetable-fried-rice',
    title: 'Vegetable Fried Rice',
    cuisine: 'Chinese',
    dietCategory: 'vegetarian',
    tags: ['vegan', 'budget-friendly', 'dairy-free'],
    servings: 4, prepMin: 10, cookMin: 12, difficulty: 'easy',
    ingredients: [
      { name: 'Cooked jasmine rice, day-old', quantity: '4 cups', grams: 600 },
      { name: 'Frozen peas + diced carrots', quantity: '2 cups', grams: 280 },
      { name: 'Spring onions, chopped', quantity: '4', grams: 40 },
      { name: 'Soy sauce', quantity: '2 tbsp', grams: 36 },
      { name: 'Garlic, minced', quantity: '3 cloves', grams: 12 },
      { name: 'Oil', quantity: '1 tbsp', grams: 14 },
    ],
    instructions: [
      { step: 1, text: 'Heat oil in a wok over high heat. Sauté garlic 30 seconds.' },
      { step: 2, text: 'Add vegetables; stir-fry 3 minutes.' },
      { step: 3, text: 'Add rice, breaking up clumps. Stir-fry 4 minutes until lightly crisped.' },
      { step: 4, text: 'Stir in soy sauce and spring onions; toss 1 minute and serve.' },
    ],
    kcal: 350, proteinG: 8, carbsG: 62, fatG: 8, fiberG: 5, allergens: ['soy'],
  },
  {
    slug: 'hot-and-sour-soup',
    title: 'Hot and Sour Soup (Tofu)',
    cuisine: 'Chinese',
    dietCategory: 'vegetarian',
    tags: ['vegan', 'dairy-free', 'low-sodium'],
    servings: 4, prepMin: 10, cookMin: 15, difficulty: 'easy',
    ingredients: [
      { name: 'Firm tofu, thin strips', quantity: '200 g', grams: 200 },
      { name: 'Shiitake mushrooms, sliced', quantity: '1 cup', grams: 70 },
      { name: 'Bamboo shoots', quantity: '1/2 cup', grams: 60 },
      { name: 'Vegetable broth (low-sodium)', quantity: '4 cups', grams: 950 },
      { name: 'Rice vinegar + white pepper', quantity: 'to taste', grams: 30 },
      { name: 'Cornstarch slurry', quantity: '2 tbsp', grams: 16 },
      { name: 'Soy sauce', quantity: '1 tbsp', grams: 18 },
    ],
    instructions: [
      { step: 1, text: 'Bring broth to a boil; add mushrooms and bamboo shoots. Simmer 5 minutes.' },
      { step: 2, text: 'Stir in tofu, vinegar, white pepper and soy sauce.' },
      { step: 3, text: 'Thicken with cornstarch slurry, stirring until the soup turns glossy.' },
      { step: 4, text: 'Adjust sour-heat balance and serve hot.' },
    ],
    kcal: 90, proteinG: 6, carbsG: 12, fatG: 2, fiberG: 2, allergens: ['soy'],
  },
  {
    slug: 'teriyaki-chicken-bowl',
    title: 'Teriyaki Chicken Rice Bowl',
    cuisine: 'Japanese',
    dietCategory: 'non_vegetarian',
    tags: ['high-protein', 'dairy-free'],
    servings: 2, prepMin: 10, cookMin: 20, difficulty: 'easy',
    ingredients: [
      { name: 'Chicken thighs, boneless', quantity: '400 g', grams: 400 },
      { name: 'Cooked short-grain rice', quantity: '2 cups', grams: 300 },
      { name: 'Teriyaki sauce (low-sugar)', quantity: '4 tbsp', grams: 64 },
      { name: 'Steamed broccoli', quantity: '2 cups', grams: 180 },
      { name: 'Sesame seeds', quantity: '1 tsp', grams: 3 },
    ],
    instructions: [
      { step: 1, text: 'Sear chicken in a hot pan 5 minutes per side until cooked through.' },
      { step: 2, text: 'Add teriyaki sauce; simmer 3 minutes until glazed and sticky.' },
      { step: 3, text: 'Slice chicken and serve over rice with broccoli. Sprinkle sesame seeds.' },
    ],
    kcal: 480, proteinG: 36, carbsG: 52, fatG: 12, fiberG: 4, allergens: ['soy', 'sesame'],
  },
  {
    slug: 'vegetable-sushi-rolls',
    title: 'Vegetable Sushi Rolls',
    cuisine: 'Japanese',
    dietCategory: 'vegetarian',
    tags: ['vegan', 'low-sodium', 'dairy-free'],
    servings: 2, prepMin: 30, cookMin: 15, difficulty: 'medium',
    ingredients: [
      { name: 'Sushi rice, cooked', quantity: '2 cups', grams: 300 },
      { name: 'Rice vinegar + sugar + salt', quantity: '2 tbsp', grams: 30 },
      { name: 'Nori sheets', quantity: '4', grams: 12 },
      { name: 'Cucumber + avocado + carrot, matchsticks', quantity: '2 cups', grams: 250 },
      { name: 'Soy sauce + pickled ginger', quantity: 'for serving', grams: 40 },
    ],
    instructions: [
      { step: 1, text: 'Season warm rice with vinegar mixture; cool to room temperature.' },
      { step: 2, text: 'Lay nori on a mat, spread a thin rice layer, arrange vegetable strips.' },
      { step: 3, text: 'Roll tightly, moistening the edge to seal.' },
      { step: 4, text: 'Slice with a wet knife into 8 pieces per roll. Serve with soy sauce and ginger.' },
    ],
    kcal: 300, proteinG: 6, carbsG: 58, fatG: 4, fiberG: 6, allergens: ['soy'],
  },
  {
    slug: 'bibimbap',
    title: 'Vegetable Bibimbap',
    cuisine: 'Korean',
    dietCategory: 'vegetarian',
    tags: ['high-fiber'],
    servings: 2, prepMin: 20, cookMin: 20, difficulty: 'medium',
    ingredients: [
      { name: 'Cooked short-grain rice', quantity: '2 cups', grams: 300 },
      { name: 'Spinach, carrots, bean sprouts, mushrooms', quantity: '4 cups', grams: 400 },
      { name: 'Eggs', quantity: '2', grams: 100 },
      { name: 'Gochujang', quantity: '2 tbsp', grams: 36 },
      { name: 'Sesame oil + sesame seeds', quantity: '1 tbsp', grams: 17 },
      { name: 'Soy sauce + garlic', quantity: 'to taste', grams: 20 },
    ],
    instructions: [
      { step: 1, text: 'Sauté each vegetable separately with a little sesame oil, garlic and salt.' },
      { step: 2, text: 'Fry eggs sunny-side up.' },
      { step: 3, text: 'Arrange rice in bowls; top with vegetables in sections and the egg.' },
      { step: 4, text: 'Add gochujang, drizzle sesame oil, mix well at the table.' },
    ],
    kcal: 450, proteinG: 16, carbsG: 64, fatG: 14, fiberG: 8, allergens: ['egg', 'sesame', 'soy'],
  },
  {
    slug: 'kimchi-tofu-stew',
    title: 'Kimchi Tofu Stew (Soondubu)',
    cuisine: 'Korean',
    dietCategory: 'vegetarian',
    tags: ['vegan', 'dairy-free', 'low-sodium'],
    servings: 3, prepMin: 10, cookMin: 20, difficulty: 'easy',
    ingredients: [
      { name: 'Soft tofu', quantity: '400 g', grams: 400 },
      { name: 'Kimchi, chopped', quantity: '1.5 cups', grams: 220 },
      { name: 'Vegetable broth (low-sodium)', quantity: '3 cups', grams: 700 },
      { name: 'Gochugaru (chili flakes)', quantity: '1 tbsp', grams: 8 },
      { name: 'Garlic + ginger', quantity: '1 tbsp', grams: 15 },
      { name: 'Sesame oil', quantity: '1 tsp', grams: 5 },
    ],
    instructions: [
      { step: 1, text: 'Sauté kimchi, garlic, ginger and chili flakes 4 minutes.' },
      { step: 2, text: 'Add broth; simmer 12 minutes.' },
      { step: 3, text: 'Spoon in soft tofu in large chunks; simmer 3 minutes.' },
      { step: 4, text: 'Drizzle sesame oil and serve bubbling hot with rice.' },
    ],
    kcal: 180, proteinG: 12, carbsG: 14, fatG: 8, fiberG: 4, allergens: ['soy', 'sesame'],
  },
  {
    slug: 'green-curry-chicken',
    title: 'Thai Green Curry with Chicken',
    cuisine: 'Thai',
    dietCategory: 'non_vegetarian',
    tags: ['high-protein', 'dairy-free', 'gluten-free'],
    servings: 4, prepMin: 15, cookMin: 20, difficulty: 'medium',
    ingredients: [
      { name: 'Chicken breast, sliced', quantity: '500 g', grams: 500 },
      { name: 'Green curry paste', quantity: '3 tbsp', grams: 45 },
      { name: 'Light coconut milk', quantity: '400 ml', grams: 400 },
      { name: 'Zucchini + bell pepper + bamboo', quantity: '3 cups', grams: 350 },
      { name: 'Fish sauce + lime', quantity: 'to taste', grams: 30 },
      { name: 'Thai basil', quantity: '1/2 cup', grams: 12 },
    ],
    instructions: [
      { step: 1, text: 'Fry curry paste in a splash of coconut milk until fragrant, 2 minutes.' },
      { step: 2, text: 'Add chicken; cook 5 minutes until opaque.' },
      { step: 3, text: 'Add remaining coconut milk and vegetables; simmer 10 minutes.' },
      { step: 4, text: 'Season with fish sauce and lime; stir in basil and serve with rice.' },
    ],
    kcal: 390, proteinG: 32, carbsG: 16, fatG: 22, fiberG: 4, allergens: ['fish'],
  },
  {
    slug: 'shrimp-pad-thai',
    title: 'Shrimp Pad Thai',
    cuisine: 'Thai',
    dietCategory: 'non_vegetarian',
    tags: ['dairy-free', 'high-protein'],
    servings: 3, prepMin: 15, cookMin: 12, difficulty: 'medium',
    ingredients: [
      { name: 'Rice noodles, soaked', quantity: '200 g dry', grams: 200 },
      { name: 'Shrimp, peeled', quantity: '300 g', grams: 300 },
      { name: 'Eggs, beaten', quantity: '2', grams: 100 },
      { name: 'Bean sprouts + chives', quantity: '2 cups', grams: 180 },
      { name: 'Tamarind + fish sauce + palm sugar', quantity: 'to taste', grams: 60 },
      { name: 'Crushed peanuts + lime', quantity: 'for serving', grams: 40 },
    ],
    instructions: [
      { step: 1, text: 'Stir-fry shrimp 2 minutes; push aside.' },
      { step: 2, text: 'Scramble eggs in the pan; add drained noodles and sauce.' },
      { step: 3, text: 'Toss 3 minutes until noodles absorb the sauce; add sprouts and chives.' },
      { step: 4, text: 'Serve with peanuts and lime wedges.' },
    ],
    kcal: 430, proteinG: 28, carbsG: 52, fatG: 12, fiberG: 3, allergens: ['peanut', 'egg', 'fish', 'soy'],
  },
  {
    slug: 'margherita-pizza',
    title: 'Homemade Margherita Pizza',
    cuisine: 'Italian',
    dietCategory: 'vegetarian',
    tags: [],
    servings: 4, prepMin: 20, cookMin: 12, difficulty: 'medium',
    ingredients: [
      { name: 'Pizza dough', quantity: '500 g', grams: 500 },
      { name: 'Crushed tomatoes', quantity: '1 cup', grams: 240 },
      { name: 'Fresh mozzarella', quantity: '200 g', grams: 200 },
      { name: 'Fresh basil', quantity: '1/2 cup', grams: 12 },
      { name: 'Olive oil + salt + garlic', quantity: 'to taste', grams: 20 },
    ],
    instructions: [
      { step: 1, text: 'Preheat oven to its maximum (250°C+) with a pizza stone or tray inside.' },
      { step: 2, text: 'Stretch dough thin; spread tomato sauce, leaving a border.' },
      { step: 3, text: 'Tear mozzarella over the top; drizzle olive oil.' },
      { step: 4, text: 'Bake 10–12 minutes until crust is puffed and charred in spots.' },
      { step: 5, text: 'Top with fresh basil, slice and serve.' },
    ],
    kcal: 520, proteinG: 20, carbsG: 84, fatG: 12, fiberG: 4, allergens: ['wheat', 'milk'],
  },
  {
    slug: 'pasta-primavera',
    title: 'Pasta Primavera',
    cuisine: 'Italian',
    dietCategory: 'vegetarian',
    tags: ['high-fiber'],
    servings: 4, prepMin: 15, cookMin: 15, difficulty: 'easy',
    ingredients: [
      { name: 'Penne', quantity: '320 g dry', grams: 320 },
      { name: 'Zucchini, broccoli, peas, cherry tomatoes', quantity: '5 cups', grams: 600 },
      { name: 'Garlic', quantity: '3 cloves', grams: 12 },
      { name: 'Parmesan, grated', quantity: '40 g', grams: 40 },
      { name: 'Olive oil', quantity: '2 tbsp', grams: 28 },
      { name: 'Lemon zest + basil', quantity: 'to taste', grams: 15 },
    ],
    instructions: [
      { step: 1, text: 'Cook penne until al dente; reserve 1 cup pasta water.' },
      { step: 2, text: 'Sauté garlic and vegetables 5 minutes until bright and crisp-tender.' },
      { step: 3, text: 'Toss pasta with vegetables, pasta water and parmesan until glossy.' },
      { step: 4, text: 'Finish with lemon zest and basil.' },
    ],
    kcal: 420, proteinG: 14, carbsG: 70, fatG: 10, fiberG: 8, allergens: ['wheat', 'milk'],
  },
  {
    slug: 'caprese-grilled-chicken',
    title: 'Caprese Grilled Chicken',
    cuisine: 'Italian',
    dietCategory: 'non_vegetarian',
    tags: ['high-protein', 'gluten-free'],
    servings: 2, prepMin: 10, cookMin: 15, difficulty: 'easy',
    ingredients: [
      { name: 'Chicken breast', quantity: '2 (400 g)', grams: 400 },
      { name: 'Tomato, sliced', quantity: '1 large', grams: 150 },
      { name: 'Fresh mozzarella', quantity: '100 g', grams: 100 },
      { name: 'Basil leaves', quantity: '8', grams: 4 },
      { name: 'Balsamic glaze + olive oil', quantity: 'to taste', grams: 25 },
    ],
    instructions: [
      { step: 1, text: 'Season chicken with salt, pepper and olive oil; grill 6 minutes per side.' },
      { step: 2, text: 'Top each breast with tomato and mozzarella; cover 2 minutes to melt.' },
      { step: 3, text: 'Finish with basil and a drizzle of balsamic glaze.' },
    ],
    kcal: 380, proteinG: 42, carbsG: 6, fatG: 20, fiberG: 1, allergens: ['milk'],
  },
  {
    slug: 'greek-chicken-salad',
    title: 'Greek Chicken Salad',
    cuisine: 'Mediterranean',
    dietCategory: 'non_vegetarian',
    tags: ['high-protein', 'gluten-free'],
    servings: 2, prepMin: 15, cookMin: 12, difficulty: 'easy',
    ingredients: [
      { name: 'Chicken breast, grilled and sliced', quantity: '300 g', grams: 300 },
      { name: 'Cucumber + tomatoes + red onion', quantity: '3 cups', grams: 400 },
      { name: 'Feta cheese', quantity: '60 g', grams: 60 },
      { name: 'Kalamata olives', quantity: '1/4 cup', grams: 40 },
      { name: 'Olive oil + lemon + oregano', quantity: 'to taste', grams: 35 },
    ],
    instructions: [
      { step: 1, text: 'Whisk olive oil, lemon juice, oregano, salt and pepper into a dressing.' },
      { step: 2, text: 'Combine vegetables, olives and sliced chicken in a large bowl.' },
      { step: 3, text: 'Toss with dressing, crumble feta on top and serve.' },
    ],
    kcal: 320, proteinG: 34, carbsG: 10, fatG: 16, fiberG: 4, allergens: ['milk'],
  },
  {
    slug: 'falafel-wrap',
    title: 'Falafel Wrap',
    cuisine: 'Mediterranean',
    dietCategory: 'vegetarian',
    tags: ['vegan', 'high-fiber', 'budget-friendly'],
    servings: 4, prepMin: 15, cookMin: 20, difficulty: 'medium',
    ingredients: [
      { name: 'Dried chickpeas, soaked overnight', quantity: '1.5 cups', grams: 290 },
      { name: 'Onion + garlic + parsley + cumin', quantity: 'to taste', grams: 80 },
      { name: 'Whole wheat wraps', quantity: '4 large', grams: 240 },
      { name: 'Tahini + lemon', quantity: '1/3 cup', grams: 80 },
      { name: 'Shredded lettuce + tomato', quantity: '2 cups', grams: 200 },
      { name: 'Oil for shallow frying', quantity: '1/4 cup', grams: 55 },
    ],
    instructions: [
      { step: 1, text: 'Blend soaked chickpeas with onion, garlic, parsley and spices into a coarse paste.' },
      { step: 2, text: 'Form into small patties; rest 10 minutes.' },
      { step: 3, text: 'Shallow-fry 3–4 minutes per side until deep golden and crisp.' },
      { step: 4, text: 'Warm wraps; fill with falafel, vegetables and tahini sauce. Roll and serve.' },
    ],
    kcal: 480, proteinG: 14, carbsG: 68, fatG: 16, fiberG: 10, allergens: ['wheat', 'sesame'],
  },
  {
    slug: 'baked-salmon-olive-tomato',
    title: 'Baked Salmon with Olives and Tomato',
    cuisine: 'Mediterranean',
    dietCategory: 'non_vegetarian',
    tags: ['high-protein', 'dairy-free', 'gluten-free'],
    servings: 2, prepMin: 10, cookMin: 18, difficulty: 'easy',
    ingredients: [
      { name: 'Salmon fillets', quantity: '2 (300 g)', grams: 300 },
      { name: 'Cherry tomatoes, halved', quantity: '1.5 cups', grams: 220 },
      { name: 'Kalamata olives', quantity: '1/3 cup', grams: 50 },
      { name: 'Garlic + oregano + lemon', quantity: 'to taste', grams: 25 },
      { name: 'Olive oil', quantity: '1 tbsp', grams: 14 },
    ],
    instructions: [
      { step: 1, text: 'Preheat oven to 200°C (400°F).' },
      { step: 2, text: 'Arrange salmon in a baking dish with tomatoes, olives, garlic and lemon.' },
      { step: 3, text: 'Drizzle olive oil, season, and bake 15–18 minutes until salmon flakes easily.' },
    ],
    kcal: 380, proteinG: 34, carbsG: 6, fatG: 24, fiberG: 2, allergens: ['fish'],
  },
  {
    slug: 'hummus-grilled-chicken-plate',
    title: 'Hummus Grilled Chicken Plate',
    cuisine: 'Middle Eastern',
    dietCategory: 'non_vegetarian',
    tags: ['high-protein', 'gluten-free'],
    servings: 2, prepMin: 15, cookMin: 15, difficulty: 'easy',
    ingredients: [
      { name: 'Chicken breast', quantity: '2 (350 g)', grams: 350 },
      { name: 'Hummus', quantity: '1 cup', grams: 240 },
      { name: 'Cucumber + tomato salad', quantity: '2 cups', grams: 250 },
      { name: 'Shawarma spice + lemon', quantity: 'to taste', grams: 20 },
      { name: 'Olive oil', quantity: '1 tbsp', grams: 14 },
    ],
    instructions: [
      { step: 1, text: 'Rub chicken with shawarma spice, lemon and oil; grill 6–7 minutes per side.' },
      { step: 2, text: 'Spread hummus on plates; slice chicken over it.' },
      { step: 3, text: 'Add salad, drizzle olive oil and serve with warm pita if desired.' },
    ],
    kcal: 420, proteinG: 40, carbsG: 22, fatG: 18, fiberG: 7, allergens: ['sesame'],
  },
  {
    slug: 'lentil-soup-shorbat-adas',
    title: 'Red Lentil Soup (Shorbat Adas)',
    cuisine: 'Middle Eastern',
    dietCategory: 'vegetarian',
    tags: ['vegan', 'high-fiber', 'budget-friendly', 'gluten-free', 'dairy-free'],
    servings: 4, prepMin: 10, cookMin: 30, difficulty: 'easy',
    ingredients: [
      { name: 'Red lentils, rinsed', quantity: '1.5 cups', grams: 285 },
      { name: 'Onion + carrot, chopped', quantity: '2 cups', grams: 260 },
      { name: 'Garlic', quantity: '3 cloves', grams: 12 },
      { name: 'Cumin + turmeric + salt', quantity: 'to taste', grams: 12 },
      { name: 'Vegetable broth', quantity: '5 cups', grams: 1180 },
      { name: 'Lemon wedges', quantity: 'for serving', grams: 40 },
    ],
    instructions: [
      { step: 1, text: 'Sauté onion, carrot and garlic 5 minutes.' },
      { step: 2, text: 'Add lentils, spices and broth; simmer 25 minutes until lentils break down.' },
      { step: 3, text: 'Blend until smooth; adjust salt and thickness.' },
      { step: 4, text: 'Serve with a squeeze of lemon.' },
    ],
    kcal: 230, proteinG: 14, carbsG: 34, fatG: 4, fiberG: 9, allergens: [],
  },
  {
    slug: 'chicken-shish-kebab',
    title: 'Chicken Shish Kebab',
    cuisine: 'Turkish',
    dietCategory: 'non_vegetarian',
    tags: ['high-protein', 'gluten-free', 'dairy-free'],
    servings: 4, prepMin: 20, cookMin: 15, difficulty: 'medium',
    ingredients: [
      { name: 'Chicken thigh, cubed', quantity: '700 g', grams: 700 },
      { name: 'Bell peppers + red onion, chunks', quantity: '3 cups', grams: 350 },
      { name: 'Tomato paste + paprika + cumin', quantity: '2 tbsp', grams: 40 },
      { name: 'Olive oil + lemon', quantity: 'to taste', grams: 40 },
      { name: 'Flatbread', quantity: 'for serving', grams: 200 },
    ],
    instructions: [
      { step: 1, text: 'Marinate chicken with tomato paste, spices, oil and lemon 30 minutes.' },
      { step: 2, text: 'Thread chicken and vegetables alternately onto skewers.' },
      { step: 3, text: 'Grill over medium-high heat 12–15 minutes, turning, until charred and cooked through.' },
      { step: 4, text: 'Serve with flatbread and salad.' },
    ],
    kcal: 350, proteinG: 36, carbsG: 12, fatG: 16, fiberG: 3, allergens: ['wheat'],
  },
  {
    slug: 'bulgur-pilaf',
    title: 'Turkish Bulgur Pilaf',
    cuisine: 'Turkish',
    dietCategory: 'vegetarian',
    tags: ['vegan', 'high-fiber', 'budget-friendly'],
    servings: 4, prepMin: 10, cookMin: 20, difficulty: 'easy',
    ingredients: [
      { name: 'Coarse bulgur', quantity: '1.5 cups', grams: 240 },
      { name: 'Onion, diced', quantity: '1 large', grams: 150 },
      { name: 'Tomato paste', quantity: '2 tbsp', grams: 32 },
      { name: 'Vegetable broth', quantity: '3 cups', grams: 700 },
      { name: 'Olive oil', quantity: '2 tbsp', grams: 28 },
      { name: 'Paprika + mint', quantity: 'to taste', grams: 10 },
    ],
    instructions: [
      { step: 1, text: 'Sauté onion in olive oil until soft; stir in tomato paste and paprika.' },
      { step: 2, text: 'Add bulgur; toast 2 minutes.' },
      { step: 3, text: 'Add broth; simmer covered 15 minutes. Rest 5 minutes, fluff and serve.' },
    ],
    kcal: 280, proteinG: 8, carbsG: 52, fatG: 5, fiberG: 8, allergens: ['wheat'],
  },
  {
    slug: 'lean-beef-burger',
    title: 'Lean Beef Burger',
    cuisine: 'American',
    dietCategory: 'non_vegetarian',
    tags: ['high-protein'],
    servings: 4, prepMin: 10, cookMin: 12, difficulty: 'easy',
    ingredients: [
      { name: 'Lean ground beef (90%)', quantity: '600 g', grams: 600 },
      { name: 'Whole wheat burger buns', quantity: '4', grams: 240 },
      { name: 'Cheddar slices', quantity: '4', grams: 80 },
      { name: 'Lettuce, tomato, onion, pickles', quantity: '2 cups', grams: 220 },
      { name: 'Salt, pepper, garlic powder', quantity: 'to taste', grams: 10 },
    ],
    instructions: [
      { step: 1, text: 'Season beef and form 4 patties; press a thumbprint in the center of each.' },
      { step: 2, text: 'Grill or pan-sear 4–5 minutes per side to desired doneness.' },
      { step: 3, text: 'Melt cheese on patties in the last minute; toast buns.' },
      { step: 4, text: 'Assemble with vegetables and condiments of choice.' },
    ],
    kcal: 540, proteinG: 36, carbsG: 40, fatG: 24, fiberG: 3, allergens: ['wheat', 'milk', 'sesame'],
  },
  {
    slug: 'grilled-chicken-caesar',
    title: 'Grilled Chicken Caesar Salad',
    cuisine: 'American',
    dietCategory: 'non_vegetarian',
    tags: ['high-protein'],
    servings: 2, prepMin: 15, cookMin: 12, difficulty: 'easy',
    ingredients: [
      { name: 'Chicken breast', quantity: '2 (350 g)', grams: 350 },
      { name: 'Romaine lettuce, chopped', quantity: '6 cups', grams: 280 },
      { name: 'Caesar dressing (light)', quantity: '1/3 cup', grams: 80 },
      { name: 'Parmesan shavings', quantity: '20 g', grams: 20 },
      { name: 'Whole wheat croutons', quantity: '1/2 cup', grams: 30 },
    ],
    instructions: [
      { step: 1, text: 'Season and grill chicken 6 minutes per side; rest and slice.' },
      { step: 2, text: 'Toss romaine with dressing.' },
      { step: 3, text: 'Top with chicken, parmesan and croutons.' },
    ],
    kcal: 380, proteinG: 38, carbsG: 12, fatG: 20, fiberG: 3, allergens: ['milk', 'egg', 'fish', 'wheat'],
  },
  {
    slug: 'chicken-fajitas',
    title: 'Chicken Fajitas',
    cuisine: 'Mexican',
    dietCategory: 'non_vegetarian',
    tags: ['high-protein', 'dairy-free', 'gluten-free'],
    servings: 4, prepMin: 15, cookMin: 15, difficulty: 'easy',
    ingredients: [
      { name: 'Chicken breast, strips', quantity: '600 g', grams: 600 },
      { name: 'Bell peppers + onion, sliced', quantity: '4 cups', grams: 450 },
      { name: 'Fajita seasoning', quantity: '2 tbsp', grams: 20 },
      { name: 'Corn tortillas', quantity: '8', grams: 240 },
      { name: 'Lime + oil', quantity: 'to taste', grams: 30 },
    ],
    instructions: [
      { step: 1, text: 'Toss chicken and vegetables with fajita seasoning and oil.' },
      { step: 2, text: 'Sear in a hot skillet 8–10 minutes until charred at the edges.' },
      { step: 3, text: 'Warm tortillas; fill with the chicken-vegetable mix and a squeeze of lime.' },
    ],
    kcal: 410, proteinG: 34, carbsG: 32, fatG: 14, fiberG: 6, allergens: [],
  },
  {
    slug: 'black-bean-tacos',
    title: 'Black Bean Tacos',
    cuisine: 'Mexican',
    dietCategory: 'vegetarian',
    tags: ['vegan', 'high-fiber', 'budget-friendly', 'dairy-free'],
    servings: 4, prepMin: 10, cookMin: 15, difficulty: 'easy',
    ingredients: [
      { name: 'Black beans, cooked', quantity: '3 cups', grams: 520 },
      { name: 'Corn tortillas', quantity: '8', grams: 240 },
      { name: 'Red onion + cilantro + lime', quantity: '1 cup', grams: 120 },
      { name: 'Cumin + smoked paprika + garlic', quantity: 'to taste', grams: 12 },
      { name: 'Avocado, sliced', quantity: '1', grams: 150 },
    ],
    instructions: [
      { step: 1, text: 'Warm beans with spices and a splash of water; mash lightly.' },
      { step: 2, text: 'Char tortillas directly over a flame or in a dry skillet.' },
      { step: 3, text: 'Fill with beans, onion, cilantro and avocado; finish with lime.' },
    ],
    kcal: 330, proteinG: 12, carbsG: 56, fatG: 8, fiberG: 12, allergens: [],
  },
  {
    slug: 'herb-baked-chicken-vegetables',
    title: 'Herb-Baked Chicken with Vegetables',
    cuisine: 'Continental',
    dietCategory: 'non_vegetarian',
    tags: ['high-protein', 'gluten-free', 'dairy-free'],
    servings: 4, prepMin: 15, cookMin: 35, difficulty: 'easy',
    ingredients: [
      { name: 'Chicken breast', quantity: '4 (700 g)', grams: 700 },
      { name: 'Baby potatoes, halved', quantity: '500 g', grams: 500 },
      { name: 'Carrots + green beans', quantity: '3 cups', grams: 350 },
      { name: 'Rosemary, thyme, garlic', quantity: 'to taste', grams: 20 },
      { name: 'Olive oil + lemon', quantity: 'to taste', grams: 40 },
    ],
    instructions: [
      { step: 1, text: 'Preheat oven to 200°C (400°F).' },
      { step: 2, text: 'Toss chicken and vegetables with oil, herbs, garlic, salt and pepper on a sheet pan.' },
      { step: 3, text: 'Roast 30–35 minutes until chicken reaches 74°C (165°F) and vegetables are tender.' },
      { step: 4, text: 'Rest 5 minutes; squeeze lemon over and serve.' },
    ],
    kcal: 360, proteinG: 38, carbsG: 18, fatG: 14, fiberG: 5, allergens: [],
  },
  {
    slug: 'quinoa-veggie-bowl',
    title: 'Quinoa Veggie Power Bowl',
    cuisine: 'Continental',
    dietCategory: 'vegetarian',
    tags: ['vegan', 'high-fiber', 'gluten-free', 'dairy-free'],
    servings: 2, prepMin: 15, cookMin: 20, difficulty: 'easy',
    ingredients: [
      { name: 'Quinoa, rinsed', quantity: '1 cup dry', grams: 170 },
      { name: 'Roasted sweet potato + kale', quantity: '3 cups', grams: 350 },
      { name: 'Chickpeas, roasted', quantity: '1 cup', grams: 165 },
      { name: 'Tahini-lemon dressing', quantity: '1/3 cup', grams: 80 },
      { name: 'Pumpkin seeds', quantity: '2 tbsp', grams: 16 },
    ],
    instructions: [
      { step: 1, text: 'Cook quinoa in salted water 15 minutes; fluff.' },
      { step: 2, text: 'Roast sweet potato and chickpeas at 200°C (400°F) for 20 minutes.' },
      { step: 3, text: 'Massage kale with a pinch of salt.' },
      { step: 4, text: 'Assemble bowls; drizzle with tahini-lemon dressing and top with pumpkin seeds.' },
    ],
    kcal: 390, proteinG: 14, carbsG: 58, fatG: 12, fiberG: 10, allergens: ['sesame'],
  },
];

// ---------------------------------------------------------------------------
// Exercises (text-first technique data; seed entries carry no media, so
// mediaType/mediaUrl are only ever written on create — see the runner)
// ---------------------------------------------------------------------------
type ExerciseSeed = {
  slug: string;
  name: string;
  description: string;
  muscleGroups: string[];
  equipment: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  exerciseType: string;
  trainingStyles: string[];
  homeSuitable: boolean;
  gymSuitable: boolean;
  steps: string[];
  breathing: string;
  commonMistakes: string[];
  easierVariation: string;
  harderVariation: string;
  safetyNotes: string;
  /**
   * V21.8: optional explicit media. When set to a real media value (not
   * 'none'/null), the seed intentionally sets media on update as well.
   * Absent = the seed carries no media → existing media (e.g. imported
   * from an authorized source) is never downgraded on re-runs.
   */
  mediaType?: string;
  mediaUrl?: string | null;
};


const EXERCISES: ExerciseSeed[] = [
  {
    slug: 'push-up',
    name: 'Push-Up',
    description: 'The foundational bodyweight chest exercise. Builds the chest, shoulders and triceps while teaching full-body tension.',
    muscleGroups: ['chest', 'shoulders', 'triceps', 'core'],
    equipment: ['bodyweight'],
    difficulty: 'beginner',
    exerciseType: 'strength',
    trainingStyles: ['general-fitness', 'endurance'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Start in a high plank: hands under shoulders, body in a straight line from head to heels.',
      'Brace your core and squeeze your glutes to lock the torso rigid.',
      'Lower your chest toward the floor by bending the elbows to about 45 degrees from your torso.',
      'Touch your chest lightly to the floor (or as low as control allows).',
      'Push the floor away to return to the start without letting hips sag or pike.',
    ],
    breathing: 'Inhale as you lower; exhale forcefully as you push up.',
    commonMistakes: ['Hips sagging or piking up', 'Elbows flaring to 90 degrees', 'Partial range of motion'],
    easierVariation: 'Do incline push-ups with hands on a bench or wall.',
    harderVariation: 'Elevate feet on a bench or add a weighted vest.',
    safetyNotes: 'Stop if you feel sharp wrist or shoulder pain; distribute weight across the whole palm.',
  },
  {
    slug: 'incline-push-up',
    name: 'Incline Push-Up',
    description: 'A regression of the push-up with hands elevated, reducing load so beginners can build pressing strength safely.',
    muscleGroups: ['chest', 'shoulders', 'triceps'],
    equipment: ['bodyweight', 'bench'],
    difficulty: 'beginner',
    exerciseType: 'strength',
    trainingStyles: ['general-fitness', 'rehab'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Place hands on a sturdy bench, box or wall at about chest height.',
      'Walk feet back into a straight-line plank position.',
      'Lower your chest toward the surface with elbows at 45 degrees.',
      'Push back up without losing the straight body line.',
    ],
    breathing: 'Inhale lowering; exhale pressing.',
    commonMistakes: ['Choosing a surface that is too low too soon', 'Letting the head drop forward'],
    easierVariation: 'Use a wall or higher surface.',
    harderVariation: 'Lower the surface height progressively toward a floor push-up.',
    safetyNotes: 'Ensure the surface is stable and will not slide.',
  },
  {
    slug: 'dumbbell-bench-press',
    name: 'Dumbbell Bench Press',
    description: 'A dumbbell chest press allowing a natural range of motion and independent arm work; great for home gyms.',
    muscleGroups: ['chest', 'shoulders', 'triceps'],
    equipment: ['dumbbell', 'bench'],
    difficulty: 'intermediate',
    exerciseType: 'strength',
    trainingStyles: ['hypertrophy', 'strength', 'general-fitness'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Sit on the bench, rest dumbbells on thighs, then lie back kicking the weights up.',
      'Set feet flat on the floor, shoulder blades pinched together, slight arch in the back.',
      'Lower the dumbbells to chest level with elbows at about 45 degrees.',
      'Press up until arms are extended without locking elbows hard.',
    ],
    breathing: 'Inhale lowering; exhale pressing.',
    commonMistakes: ['Bouncing dumbbells off the chest', 'Feet dancing on the floor', 'Uneven pressing between arms'],
    easierVariation: 'Use lighter dumbbells or a floor press.',
    harderVariation: 'Slow the lowering phase to 3–4 seconds or add a pause at the bottom.',
    safetyNotes: 'Have a spotter or learn the "drop to thighs and sit up" bail; never press to failure alone with heavy weights.',
  },
  {
    slug: 'barbell-bench-press',
    name: 'Barbell Bench Press',
    description: 'The classic barbell chest builder. Demands shoulder stability and a tight setup; best learned with a spotter.',
    muscleGroups: ['chest', 'shoulders', 'triceps'],
    equipment: ['barbell', 'bench'],
    difficulty: 'intermediate',
    exerciseType: 'strength',
    trainingStyles: ['strength', 'hypertrophy'],
    homeSuitable: false, gymSuitable: true,
    steps: [
      'Lie on the bench with eyes under the bar; grip slightly wider than shoulders.',
      'Unrack with straight arms; set shoulder blades back and feet planted.',
      'Lower the bar to mid-chest with control, elbows at 45–60 degrees.',
      'Press the bar up in a slight arc back toward the rack position.',
    ],
    breathing: 'Big inhale and brace before lowering; exhale past the sticking point on the way up.',
    commonMistakes: ['Bouncing the bar off the chest', 'Lifting the butt off the bench', 'Flaring elbows to 90 degrees'],
    easierVariation: 'Use the dumbbell bench press or an empty bar to learn the groove.',
    harderVariation: 'Add pause reps or increase load in small increments.',
    safetyNotes: 'Always use a spotter or safety arms when pressing heavy; use collars so plates cannot slide.',
  },
  {
    slug: 'chest-fly-machine',
    name: 'Machine Chest Fly',
    description: 'A guided chest isolation that teaches the squeeze across the pecs with a fixed, safe path.',
    muscleGroups: ['chest', 'shoulders'],
    equipment: ['machine'],
    difficulty: 'beginner',
    exerciseType: 'strength',
    trainingStyles: ['hypertrophy', 'general-fitness'],
    homeSuitable: false, gymSuitable: true,
    steps: [
      'Adjust the seat so handles align with mid-chest; select a light weight.',
      'Sit tall with back flat against the pad, slight bend in elbows.',
      'Bring the handles together in front of your chest, squeezing the pecs.',
      'Return slowly until you feel a stretch, without letting shoulders roll forward.',
    ],
    breathing: 'Exhale as handles come together; inhale returning.',
    commonMistakes: ['Straightening the arms fully and stressing the elbow', 'Shrugging shoulders up'],
    easierVariation: 'Reduce the weight and shorten the range.',
    harderVariation: 'Pause 2 seconds at peak contraction.',
    safetyNotes: 'Do not force the stretch past shoulder comfort; keep the movement pain-free.',
  },
  {
    slug: 'pull-up',
    name: 'Pull-Up',
    description: 'The benchmark upper-body pulling exercise: full back, biceps and grip from a dead hang.',
    muscleGroups: ['back', 'biceps', 'shoulders'],
    equipment: ['bodyweight', 'pullup-bar'],
    difficulty: 'intermediate',
    exerciseType: 'strength',
    trainingStyles: ['strength', 'hypertrophy', 'general-fitness'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Hang from the bar with an overhand grip, hands just outside shoulders, body still.',
      'Pull your shoulder blades down first, then drive elbows to your ribs.',
      'Lift until your chin clears the bar.',
      'Lower slowly to a full dead hang without swinging.',
    ],
    breathing: 'Exhale pulling up; inhale lowering.',
    commonMistakes: ['Kipping or swinging for momentum', 'Half reps that skip the dead hang', 'Craning the neck to "reach" the bar'],
    easierVariation: 'Use band-assisted pull-ups or negatives (jump up, lower slowly).',
    harderVariation: 'Add weight with a dip belt or slow the lowering to 5 seconds.',
    safetyNotes: 'Avoid if you have acute shoulder impingement; build up with assisted versions first.',
  },
  {
    slug: 'lat-pulldown',
    name: 'Lat Pulldown',
    description: 'A machine alternative to pull-ups that lets you scale the load and learn the pulling pattern.',
    muscleGroups: ['back', 'biceps'],
    equipment: ['machine', 'cable'],
    difficulty: 'beginner',
    exerciseType: 'strength',
    trainingStyles: ['hypertrophy', 'general-fitness'],
    homeSuitable: false, gymSuitable: true,
    steps: [
      'Grip the bar slightly wider than shoulders; sit with thighs secured under the pads.',
      'Lean back very slightly and pull the bar to your upper chest.',
      'Squeeze shoulder blades together at the bottom.',
      'Control the bar back up to full arm extension.',
    ],
    breathing: 'Exhale pulling down; inhale returning.',
    commonMistakes: ['Pulling the bar behind the neck', 'Using bodyweight momentum to yank the bar', 'Shrugging at the bottom'],
    easierVariation: 'Use a lighter stack and a neutral grip.',
    harderVariation: 'Pause 2 seconds at the bottom of each rep.',
    safetyNotes: 'Keep the pull in front of the body to protect the shoulders.',
  },
  {
    slug: 'bent-over-barbell-row',
    name: 'Bent-Over Barbell Row',
    description: 'A heavy compound row for total back thickness; hinges at the hips while the bar tracks to the torso.',
    muscleGroups: ['back', 'biceps', 'shoulders'],
    equipment: ['barbell'],
    difficulty: 'intermediate',
    exerciseType: 'strength',
    trainingStyles: ['strength', 'hypertrophy'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Hinge at the hips to about 45 degrees with a flat back, knees soft, bar hanging below knees.',
      'Brace the core; pull the bar to your lower ribs, driving elbows behind you.',
      'Squeeze the shoulder blades together at the top.',
      'Lower with control to a full stretch.',
    ],
    breathing: 'Exhale pulling; inhale lowering.',
    commonMistakes: ['Rounding the lower back', 'Standing up straighter as the set gets hard', 'Jerking the weight up'],
    easierVariation: 'Do chest-supported dumbbell rows or a lighter bar.',
    harderVariation: 'Use a slower 3-second lowering phase.',
    safetyNotes: 'Keep the spine neutral throughout; drop the weight if your back rounds.',
  },
  {
    slug: 'one-arm-dumbbell-row',
    name: 'One-Arm Dumbbell Row',
    description: 'A single-arm row that builds back width and fixes left-right imbalances; the bench supports the torso.',
    muscleGroups: ['back', 'biceps'],
    equipment: ['dumbbell', 'bench'],
    difficulty: 'beginner',
    exerciseType: 'strength',
    trainingStyles: ['hypertrophy', 'general-fitness'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Place one knee and same-side hand on the bench; other foot on the floor, back flat.',
      'Let the dumbbell hang straight down.',
      'Pull the dumbbell to your hip, elbow driving back and up.',
      'Lower slowly to full extension; finish all reps, then switch sides.',
    ],
    breathing: 'Exhale pulling; inhale lowering.',
    commonMistakes: ['Rotating the torso to heave the weight', 'Pulling toward the chest instead of the hip'],
    easierVariation: 'Use a lighter dumbbell and higher reps.',
    harderVariation: 'Pause 1 second at the top of each rep.',
    safetyNotes: 'Keep the supporting knee and hand stable; avoid twisting the lower back.',
  },
  {
    slug: 'seated-cable-row',
    name: 'Seated Cable Row',
    description: 'A seated rowing movement for mid-back thickness with constant cable tension.',
    muscleGroups: ['back', 'biceps'],
    equipment: ['cable', 'machine'],
    difficulty: 'beginner',
    exerciseType: 'strength',
    trainingStyles: ['hypertrophy', 'general-fitness'],
    homeSuitable: false, gymSuitable: true,
    steps: [
      'Sit tall with knees slightly bent, feet braced; grip the handle with straight arms.',
      'Pull the handle to your navel, driving elbows back.',
      'Squeeze shoulder blades together.',
      'Extend arms fully forward with control.',
    ],
    breathing: 'Exhale pulling; inhale extending.',
    commonMistakes: ['Rocking the torso excessively', 'Shrugging the shoulders', 'Shortening the range'],
    easierVariation: 'Reduce the stack weight.',
    harderVariation: 'Use a wide grip or pause at peak contraction.',
    safetyNotes: 'Keep the torso mostly still; the movement comes from the arms and shoulder blades.',
  },
  {
    slug: 'superman',
    name: 'Superman',
    description: 'A floor-based posterior-chain exercise that strengthens the lower back, glutes and rear shoulders.',
    muscleGroups: ['back', 'glutes', 'shoulders'],
    equipment: ['bodyweight', 'mat'],
    difficulty: 'beginner',
    exerciseType: 'strength',
    trainingStyles: ['general-fitness', 'rehab'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Lie face down with arms extended overhead and legs straight.',
      'Simultaneously lift arms, chest and legs a few inches off the floor.',
      'Hold 2–3 seconds, squeezing glutes and mid-back.',
      'Lower slowly back to the floor.',
    ],
    breathing: 'Exhale lifting; inhale lowering.',
    commonMistakes: ['Hyperextending the neck by looking up', 'Holding the breath', 'Jerking up fast'],
    easierVariation: 'Lift just the arms or just the legs (alternating superman).',
    harderVariation: 'Hold the top position for 5–10 seconds.',
    safetyNotes: 'Keep the movement small and controlled; stop if the lower back pinches.',
  },
  {
    slug: 'bodyweight-squat',
    name: 'Bodyweight Squat',
    description: 'The fundamental lower-body pattern: hips, knees and ankles working together through a full range.',
    muscleGroups: ['legs', 'glutes', 'core'],
    equipment: ['bodyweight'],
    difficulty: 'beginner',
    exerciseType: 'strength',
    trainingStyles: ['general-fitness', 'endurance'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Stand with feet shoulder-width apart, toes slightly out.',
      'Push hips back and bend knees, keeping the chest up and weight over mid-foot.',
      'Descend until thighs are at least parallel to the floor (or as deep as mobility allows).',
      'Drive through the whole foot to stand, squeezing glutes at the top.',
    ],
    breathing: 'Inhale descending; exhale standing.',
    commonMistakes: ['Knees collapsing inward', 'Heels lifting off the floor', 'Rounding the lower back at the bottom'],
    easierVariation: 'Squat to a chair or box to learn depth.',
    harderVariation: 'Add a 3-second pause at the bottom or hold a weight (goblet squat).',
    safetyNotes: 'Keep knees tracking over toes; depth should never come at the cost of a rounded back.',
  },
  {
    slug: 'goblet-squat',
    name: 'Goblet Squat',
    description: 'A front-loaded squat holding one dumbbell or kettlebell at the chest; self-corrects torso posture.',
    muscleGroups: ['legs', 'glutes', 'core'],
    equipment: ['dumbbell', 'kettlebell'],
    difficulty: 'beginner',
    exerciseType: 'strength',
    trainingStyles: ['hypertrophy', 'general-fitness'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Hold the weight vertically at chest height, elbows tucked under it.',
      'Stand feet shoulder-width apart, toes slightly out.',
      'Squat down keeping the torso upright and elbows between the knees.',
      'Drive up through the mid-foot.',
    ],
    breathing: 'Inhale descending; exhale standing.',
    commonMistakes: ['Letting the weight pull you forward', 'Knees caving in'],
    easierVariation: 'Use a lighter weight or bodyweight squats.',
    harderVariation: 'Pause 2 seconds at the bottom or increase the load.',
    safetyNotes: 'Choose a weight you can hold securely at the chest for the whole set.',
  },
  {
    slug: 'barbell-back-squat',
    name: 'Barbell Back Squat',
    description: 'The king of lower-body lifts: a loaded squat with the bar on the upper back for maximal leg strength.',
    muscleGroups: ['legs', 'glutes', 'core', 'back'],
    equipment: ['barbell'],
    difficulty: 'advanced',
    exerciseType: 'strength',
    trainingStyles: ['strength', 'hypertrophy'],
    homeSuitable: false, gymSuitable: true,
    steps: [
      'Set the bar at mid-chest height; duck under and rest it on the upper back (not the neck).',
      'Unrack, step back, feet shoulder-width apart, toes slightly out.',
      'Brace hard, then squat by pushing hips back and knees out.',
      'Descend to at least parallel; drive up keeping the chest proud.',
    ],
    breathing: 'Big inhale and brace at the top; hold through the rep (Valsalva); exhale at the top.',
    commonMistakes: ['Knees collapsing in', 'Good-morning the weight up (hips shoot first)', 'Shallow depth'],
    easierVariation: 'Learn with goblet squats or an empty bar in a rack.',
    harderVariation: 'Add pause reps or work up in load with a spotter/safety arms.',
    safetyNotes: 'Always squat inside a rack with safety arms set correctly; never max out without safeties.',
  },
  {
    slug: 'romanian-deadlift',
    name: 'Romanian Deadlift',
    description: 'A hip-hinge pattern that loads the hamstrings and glutes through a deep stretch.',
    muscleGroups: ['legs', 'glutes', 'back'],
    equipment: ['dumbbell', 'barbell'],
    difficulty: 'intermediate',
    exerciseType: 'strength',
    trainingStyles: ['hypertrophy', 'strength', 'general-fitness'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Stand tall holding the weight(s) in front of thighs, feet hip-width apart.',
      'Push hips straight back with a soft knee bend, sliding the weight down your legs.',
      'Lower until you feel a strong hamstring stretch (around mid-shin), back flat.',
      'Drive hips forward to stand, squeezing glutes.',
    ],
    breathing: 'Inhale hinging down; exhale driving hips forward.',
    commonMistakes: ['Rounding the back to go lower', 'Bending the knees too much (turning it into a squat)', 'Letting the weight drift away from the legs'],
    easierVariation: 'Use light dumbbells and a shorter range.',
    harderVariation: 'Try single-leg Romanian deadlifts.',
    safetyNotes: 'The lower back must stay flat; depth comes from the hips, not spinal flexion.',
  },
  {
    slug: 'walking-lunge',
    name: 'Walking Lunge',
    description: 'A dynamic single-leg exercise building quads, glutes and balance with every step.',
    muscleGroups: ['legs', 'glutes', 'core'],
    equipment: ['bodyweight', 'dumbbell'],
    difficulty: 'beginner',
    exerciseType: 'strength',
    trainingStyles: ['general-fitness', 'hypertrophy', 'endurance'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Stand tall; step forward into a long stride.',
      'Lower until both knees are near 90 degrees, torso upright.',
      'Push through the front heel to bring the back foot forward into the next lunge.',
      'Alternate legs with each step.',
    ],
    breathing: 'Inhale stepping down; exhale driving up.',
    commonMistakes: ['Front knee shooting past the toes excessively', 'Short choppy steps', 'Leaning the torso forward'],
    easierVariation: 'Do stationary split squats holding a wall.',
    harderVariation: 'Hold dumbbells at your sides.',
    safetyNotes: 'Keep the front knee tracking over the ankle; stop if the knee aches sharply.',
  },
  {
    slug: 'bulgarian-split-squat',
    name: 'Bulgarian Split Squat',
    description: 'A rear-foot-elevated single-leg squat that hammers the quads and glutes while challenging balance.',
    muscleGroups: ['legs', 'glutes'],
    equipment: ['bodyweight', 'dumbbell', 'bench'],
    difficulty: 'intermediate',
    exerciseType: 'strength',
    trainingStyles: ['hypertrophy', 'strength', 'general-fitness'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Stand a stride in front of a bench; rest the top of your rear foot on it.',
      'Lower straight down until the front thigh is parallel to the floor.',
      'Keep the torso tall and the front knee over the ankle.',
      'Drive through the front foot to stand; complete all reps, then switch.',
    ],
    breathing: 'Inhale lowering; exhale driving up.',
    commonMistakes: ['Stance too narrow front-to-back', 'Pushing off the rear foot', 'Knee caving inward'],
    easierVariation: 'Do regular split squats with the rear foot on the floor.',
    harderVariation: 'Hold dumbbells or elevate the front foot.',
    safetyNotes: 'Use a wall for balance when learning; progress load only when form is stable.',
  },
  {
    slug: 'glute-bridge',
    name: 'Glute Bridge',
    description: 'A floor exercise that isolates the glutes and teaches hip extension without spinal loading.',
    muscleGroups: ['glutes', 'legs', 'core'],
    equipment: ['bodyweight', 'mat'],
    difficulty: 'beginner',
    exerciseType: 'strength',
    trainingStyles: ['general-fitness', 'rehab'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Lie on your back, knees bent, feet flat hip-width apart, arms at sides.',
      'Press through your heels to lift hips until knees, hips and shoulders form a line.',
      'Squeeze glutes hard at the top for 2 seconds.',
      'Lower slowly without fully relaxing at the bottom.',
    ],
    breathing: 'Exhale lifting hips; inhale lowering.',
    commonMistakes: ['Overarching the lower back at the top', 'Feet too far from the body', 'Rushing the reps'],
    easierVariation: 'Reduce the range of motion.',
    harderVariation: 'Do single-leg glute bridges or add a barbell hip thrust.',
    safetyNotes: 'Stop the lift when the body forms a straight line; do not hyperextend the back.',
  },
  {
    slug: 'standing-calf-raise',
    name: 'Standing Calf Raise',
    description: 'Direct calf work through a full stretch and contraction; easy to do anywhere.',
    muscleGroups: ['calves', 'legs'],
    equipment: ['bodyweight', 'dumbbell'],
    difficulty: 'beginner',
    exerciseType: 'strength',
    trainingStyles: ['hypertrophy', 'general-fitness'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Stand with the balls of your feet on a step edge, heels hanging off.',
      'Lower heels below the step for a deep stretch.',
      'Rise as high as possible onto your toes, pausing at the top.',
      'Lower slowly; use a wall for balance.',
    ],
    breathing: 'Exhale rising; inhale lowering.',
    commonMistakes: ['Bouncing through reps', 'Skipping the bottom stretch', 'Bending the knees'],
    easierVariation: 'Do them on flat ground.',
    harderVariation: 'Hold a dumbbell in one hand and do single-leg raises.',
    safetyNotes: 'Move slowly; avoid sudden bouncing at the bottom stretch.',
  },
  {
    slug: 'leg-press',
    name: 'Leg Press',
    description: 'A machine-based leg builder that lets you load the quads and glutes heavily with back support.',
    muscleGroups: ['legs', 'glutes'],
    equipment: ['machine'],
    difficulty: 'beginner',
    exerciseType: 'strength',
    trainingStyles: ['hypertrophy', 'strength'],
    homeSuitable: false, gymSuitable: true,
    steps: [
      'Sit with your back flat and feet shoulder-width on the platform.',
      'Release the safeties; lower the platform until knees reach about 90 degrees.',
      'Press through the whole foot without locking knees hard at the top.',
      'Re-engage safeties at the end of the set.',
    ],
    breathing: 'Inhale lowering; exhale pressing.',
    commonMistakes: ['Letting knees cave inward', 'Lifting the lower back off the seat at depth', 'Locking knees violently'],
    easierVariation: 'Use a lighter load and shorter range.',
    harderVariation: 'Do single-leg presses or pause at the bottom.',
    safetyNotes: 'Never place hands between your knees and the platform; keep safeties engaged between sets.',
  },
  {
    slug: 'dumbbell-overhead-press',
    name: 'Dumbbell Overhead Press',
    description: 'A standing or seated press building all three delt heads with independent arm paths.',
    muscleGroups: ['shoulders', 'triceps'],
    equipment: ['dumbbell'],
    difficulty: 'intermediate',
    exerciseType: 'strength',
    trainingStyles: ['hypertrophy', 'strength', 'general-fitness'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Hold dumbbells at shoulder height, palms facing forward, core braced.',
      'Press straight overhead until arms are extended, without shrugging.',
      'Keep the ribs down; avoid leaning back.',
      'Lower with control to the start.',
    ],
    breathing: 'Exhale pressing; inhale lowering.',
    commonMistakes: ['Arching the lower back to lift more', 'Flaring elbows wide', 'Half range of motion'],
    easierVariation: 'Press seated with back support or use lighter weights.',
    harderVariation: 'Do a single-arm press or add a slow 3-second lowering.',
    safetyNotes: 'Stop if the shoulder clicks painfully; keep the movement in a pain-free arc.',
  },
  {
    slug: 'barbell-overhead-press',
    name: 'Barbell Overhead Press',
    description: 'The classic standing military press: total-shoulder and trunk strength from a strict press.',
    muscleGroups: ['shoulders', 'triceps', 'core'],
    equipment: ['barbell'],
    difficulty: 'advanced',
    exerciseType: 'strength',
    trainingStyles: ['strength', 'hypertrophy'],
    homeSuitable: false, gymSuitable: true,
    steps: [
      'Clean or unrack the bar to shoulder height, grip just outside shoulders.',
      'Brace the core and squeeze glutes; tuck the chin slightly.',
      'Press the bar overhead, moving your head slightly through at the top.',
      'Lower to the shoulders with control.',
    ],
    breathing: 'Inhale and brace at the bottom; exhale past the sticking point.',
    commonMistakes: ['Excessive layback turning it into an incline press', 'Pressing in front of the face instead of over the mid-foot'],
    easierVariation: 'Use dumbbells or press seated.',
    harderVariation: 'Add pause reps at the bottom.',
    safetyNotes: 'Use a rack with safeties when going heavy; keep the bar path over the mid-foot.',
  },
  {
    slug: 'lateral-raise',
    name: 'Lateral Raise',
    description: 'An isolation for the side delts that builds shoulder width; light weights, strict form.',
    muscleGroups: ['shoulders'],
    equipment: ['dumbbell'],
    difficulty: 'beginner',
    exerciseType: 'strength',
    trainingStyles: ['hypertrophy', 'general-fitness'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Stand with dumbbells at your sides, slight bend in elbows.',
      'Raise arms out to the sides until they reach shoulder height.',
      'Lead with the elbows, not the hands.',
      'Lower slowly to the start.',
    ],
    breathing: 'Exhale lifting; inhale lowering.',
    commonMistakes: ['Swinging the weights up with momentum', 'Shrugging the traps', 'Raising above shoulder height'],
    easierVariation: 'Use very light weights or do one arm at a time.',
    harderVariation: 'Pause 1 second at the top or do a drop set.',
    safetyNotes: 'Keep the movement pain-free; reduce range if the shoulder pinches at the top.',
  },
  {
    slug: 'front-raise',
    name: 'Front Raise',
    description: 'A front-delt isolation raising the arms straight ahead; complements pressing work.',
    muscleGroups: ['shoulders'],
    equipment: ['dumbbell'],
    difficulty: 'beginner',
    exerciseType: 'strength',
    trainingStyles: ['hypertrophy', 'general-fitness'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Stand tall, dumbbells resting on thighs, palms facing back.',
      'Raise one or both arms straight ahead to shoulder height.',
      'Pause briefly at the top.',
      'Lower with control.',
    ],
    breathing: 'Exhale lifting; inhale lowering.',
    commonMistakes: ['Swinging the torso for momentum', 'Raising past shoulder height'],
    easierVariation: 'Alternate arms or use lighter weights.',
    harderVariation: 'Hold the top position for 3 seconds.',
    safetyNotes: 'Keep the lower back neutral; do not lean back to lift heavier.',
  },
  {
    slug: 'face-pull',
    name: 'Face Pull',
    description: 'A cable or band pull to the face that strengthens the rear delts and rotator cuff; great posture work.',
    muscleGroups: ['shoulders', 'back'],
    equipment: ['cable', 'band'],
    difficulty: 'beginner',
    exerciseType: 'strength',
    trainingStyles: ['hypertrophy', 'general-fitness', 'rehab'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Set the cable at eye height; grip the rope with thumbs toward you.',
      'Pull the rope toward your face, elbows high and wide.',
      'Externally rotate so knuckles finish near your temples.',
      'Return slowly with arms extended.',
    ],
    breathing: 'Exhale pulling; inhale returning.',
    commonMistakes: ['Pulling to the chest instead of the face', 'Dropping the elbows', 'Using too much weight'],
    easierVariation: 'Use a resistance band anchored at head height.',
    harderVariation: 'Pause 2 seconds at peak contraction.',
    safetyNotes: 'Use light loads; this is a shoulder-health movement, not a max lift.',
  },
  {
    slug: 'dumbbell-shrug',
    name: 'Dumbbell Shrug',
    description: 'Direct trap work: elevate the shoulders against dumbbells for upper-back thickness.',
    muscleGroups: ['shoulders', 'back'],
    equipment: ['dumbbell'],
    difficulty: 'beginner',
    exerciseType: 'strength',
    trainingStyles: ['hypertrophy', 'general-fitness'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Stand tall holding dumbbells at your sides, arms straight.',
      'Shrug shoulders straight up toward your ears.',
      'Hold 1–2 seconds at the top.',
      'Lower fully with control.',
    ],
    breathing: 'Exhale shrugging up; inhale lowering.',
    commonMistakes: ['Rolling the shoulders in circles', 'Bending the elbows to "help"', 'Rushing the reps'],
    easierVariation: 'Use lighter dumbbells.',
    harderVariation: 'Pause 3 seconds at the top of each rep.',
    safetyNotes: 'Move the shoulders vertically only; no neck craning.',
  },
  {
    slug: 'dumbbell-bicep-curl',
    name: 'Dumbbell Bicep Curl',
    description: 'The classic biceps builder with a supinated grip; strict form beats heavy swinging.',
    muscleGroups: ['biceps'],
    equipment: ['dumbbell'],
    difficulty: 'beginner',
    exerciseType: 'strength',
    trainingStyles: ['hypertrophy', 'general-fitness'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Stand tall, dumbbells at sides, palms facing forward.',
      'Curl the weights toward your shoulders, keeping elbows pinned at your sides.',
      'Squeeze at the top.',
      'Lower slowly to full extension.',
    ],
    breathing: 'Exhale curling; inhale lowering.',
    commonMistakes: ['Swinging the torso for momentum', 'Letting elbows drift forward', 'Half reps'],
    easierVariation: 'Curl one arm at a time or use lighter weights.',
    harderVariation: 'Do incline curls for a deeper stretch.',
    safetyNotes: 'Keep elbows stationary; stop if the front of the shoulder aches.',
  },
  {
    slug: 'hammer-curl',
    name: 'Hammer Curl',
    description: 'A neutral-grip curl targeting the brachialis and forearms for thicker-looking arms.',
    muscleGroups: ['biceps', 'shoulders'],
    equipment: ['dumbbell'],
    difficulty: 'beginner',
    exerciseType: 'strength',
    trainingStyles: ['hypertrophy', 'general-fitness'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Hold dumbbells with a neutral grip (palms facing each other).',
      'Curl up keeping elbows tight to the torso.',
      'Squeeze at the top.',
      'Lower with control.',
    ],
    breathing: 'Exhale curling; inhale lowering.',
    commonMistakes: ['Swinging the weights', 'Elbows flaring out'],
    easierVariation: 'Use lighter dumbbells.',
    harderVariation: 'Curl across the body for extra brachialis emphasis.',
    safetyNotes: 'Keep wrists straight throughout the movement.',
  },
  {
    slug: 'barbell-curl',
    name: 'Barbell Curl',
    description: 'A heavy bilateral biceps movement for overall arm mass; the bar enforces a fixed path.',
    muscleGroups: ['biceps'],
    equipment: ['barbell'],
    difficulty: 'intermediate',
    exerciseType: 'strength',
    trainingStyles: ['hypertrophy', 'strength'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Grip the barbell underhand, hands shoulder-width apart.',
      'Stand tall with elbows pinned at your sides.',
      'Curl the bar to shoulder height without leaning back.',
      'Lower slowly to full extension.',
    ],
    breathing: 'Exhale curling; inhale lowering.',
    commonMistakes: ['Leaning back to heave the weight', 'Elbows drifting forward at the top', 'Bouncing at the bottom'],
    easierVariation: 'Use an EZ-bar or dumbbells with lighter load.',
    harderVariation: 'Add a 2-second pause at the top.',
    safetyNotes: 'Avoid excessive weight that forces lower-back arching.',
  },
  {
    slug: 'tricep-pushdown',
    name: 'Tricep Pushdown',
    description: 'A cable isolation for the triceps; elbows stay pinned while the rope or bar travels down.',
    muscleGroups: ['triceps'],
    equipment: ['cable', 'machine'],
    difficulty: 'beginner',
    exerciseType: 'strength',
    trainingStyles: ['hypertrophy', 'general-fitness'],
    homeSuitable: false, gymSuitable: true,
    steps: [
      'Stand facing the cable, grip the attachment at chest height.',
      'Tuck elbows tight to your sides.',
      'Push down until arms are fully extended.',
      'Let the attachment rise with control to the start.',
    ],
    breathing: 'Exhale pushing down; inhale returning.',
    commonMistakes: ['Letting elbows drift forward', 'Using bodyweight to push down', 'Shortening the range'],
    easierVariation: 'Use a band anchored overhead.',
    harderVariation: 'Pause 2 seconds at full extension.',
    safetyNotes: 'Keep elbows stationary; the movement is only at the elbow joint.',
  },
  {
    slug: 'overhead-tricep-extension',
    name: 'Overhead Tricep Extension',
    description: 'An overhead stretch-position triceps builder, done with one dumbbell held in both hands.',
    muscleGroups: ['triceps'],
    equipment: ['dumbbell'],
    difficulty: 'intermediate',
    exerciseType: 'strength',
    trainingStyles: ['hypertrophy', 'general-fitness'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Hold one dumbbell with both hands overhead, arms extended.',
      'Lower the weight behind your head by bending the elbows.',
      'Keep upper arms still and close to your head.',
      'Extend back overhead, squeezing the triceps.',
    ],
    breathing: 'Inhale lowering; exhale extending.',
    commonMistakes: ['Flaring the elbows wide', 'Arching the lower back', 'Rushing the stretch'],
    easierVariation: 'Do the movement seated with back support and a light weight.',
    harderVariation: 'Do single-arm overhead extensions.',
    safetyNotes: 'Choose a weight you can control behind your head; stop if the elbows ache sharply.',
  },
  {
    slug: 'bench-dip',
    name: 'Bench Dip',
    description: 'A bodyweight triceps dip using a bench; an accessible pressing movement for the back of the arms.',
    muscleGroups: ['triceps', 'shoulders', 'chest'],
    equipment: ['bodyweight', 'bench'],
    difficulty: 'intermediate',
    exerciseType: 'strength',
    trainingStyles: ['general-fitness', 'hypertrophy'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Sit on the bench edge, hands beside hips, fingers forward.',
      'Walk feet out and lift hips off the bench.',
      'Lower your body by bending elbows to about 90 degrees.',
      'Push back up to straight arms without shrugging.',
    ],
    breathing: 'Inhale lowering; exhale pushing up.',
    commonMistakes: ['Shrugging shoulders to ears', 'Going too deep and straining the shoulder', 'Feet too close reducing range'],
    easierVariation: 'Bend the knees with feet flat on the floor.',
    harderVariation: 'Straighten the legs or place weight on the lap.',
    safetyNotes: 'Keep the dip shallow and pain-free; stop if the front of the shoulder pinches.',
  },
  {
    slug: 'plank',
    name: 'Plank',
    description: 'The foundational anti-extension core hold; trains the entire trunk to resist movement.',
    muscleGroups: ['core', 'shoulders'],
    equipment: ['bodyweight', 'mat'],
    difficulty: 'beginner',
    exerciseType: 'strength',
    trainingStyles: ['general-fitness', 'endurance', 'rehab'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Start on forearms and toes, elbows under shoulders.',
      'Form a straight line from head to heels; squeeze glutes and brace the core.',
      'Keep the neck neutral by looking at the floor.',
      'Hold for the target time without letting hips sag or pike.',
    ],
    breathing: 'Breathe steadily behind the brace; never hold your breath.',
    commonMistakes: ['Hips sagging toward the floor', 'Butt piked in the air', 'Holding the breath'],
    easierVariation: 'Drop to your knees.',
    harderVariation: 'Add shoulder taps or extend the hold time.',
    safetyNotes: 'Stop if the lower back starts aching; quality beats duration.',
  },
  {
    slug: 'dead-bug',
    name: 'Dead Bug',
    description: 'A beginner core drill teaching you to move limbs while the trunk stays perfectly still.',
    muscleGroups: ['core'],
    equipment: ['bodyweight', 'mat'],
    difficulty: 'beginner',
    exerciseType: 'strength',
    trainingStyles: ['general-fitness', 'rehab'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Lie on your back, arms pointing up, knees bent at 90 degrees over hips.',
      'Press your lower back into the floor.',
      'Slowly extend the right arm overhead and left leg toward the floor.',
      'Return and repeat on the opposite side; keep the back pinned down throughout.',
    ],
    breathing: 'Exhale as limbs extend; inhale returning.',
    commonMistakes: ['Lower back arching off the floor', 'Moving too fast', 'Holding the breath'],
    easierVariation: 'Move only the arms or only the legs.',
    harderVariation: 'Hold a light weight or slow each rep to 5 seconds.',
    safetyNotes: 'If the back lifts off the floor, shorten the range.',
  },
  {
    slug: 'bicycle-crunch',
    name: 'Bicycle Crunch',
    description: 'A dynamic ab exercise pairing trunk rotation with leg movement for the obliques and rectus abdominis.',
    muscleGroups: ['core'],
    equipment: ['bodyweight', 'mat'],
    difficulty: 'beginner',
    exerciseType: 'strength',
    trainingStyles: ['general-fitness', 'endurance'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Lie on your back, hands lightly behind your head, legs in tabletop.',
      'Lift shoulder blades off the floor.',
      'Bring the right elbow toward the left knee while extending the right leg.',
      'Alternate sides in a smooth pedaling motion.',
    ],
    breathing: 'Exhale on each twist; keep breathing rhythmic.',
    commonMistakes: ['Pulling on the neck', 'Rushing through reps', 'Legs dropping too low and arching the back'],
    easierVariation: 'Keep both feet on the floor and do small crunches with rotation.',
    harderVariation: 'Slow each rep to 3 seconds per side.',
    safetyNotes: 'Hands support the head lightly; the neck should not do the work.',
  },
  {
    slug: 'russian-twist',
    name: 'Russian Twist',
    description: 'A seated rotational core exercise; add weight only once the bodyweight version is clean.',
    muscleGroups: ['core'],
    equipment: ['bodyweight', 'dumbbell'],
    difficulty: 'intermediate',
    exerciseType: 'strength',
    trainingStyles: ['general-fitness', 'hypertrophy'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Sit with knees bent, heels lightly on the floor, torso leaned back at 45 degrees.',
      'Clasp hands (or a weight) at chest height.',
      'Rotate the torso to touch the floor beside your hip.',
      'Rotate to the other side with control; keep hips still.',
    ],
    breathing: 'Exhale on each rotation; inhale returning to center.',
    commonMistakes: ['Rounding the lower back', 'Moving only the arms, not the torso', 'Going too fast'],
    easierVariation: 'Keep feet flat on the floor and use no weight.',
    harderVariation: 'Lift feet off the floor or hold a dumbbell.',
    safetyNotes: 'Skip if you have disc issues; rotation under load is not for sensitive backs.',
  },
  {
    slug: 'mountain-climber',
    name: 'Mountain Climber',
    description: 'A high-intensity plank variation driving knees to the chest; core plus cardio in one move.',
    muscleGroups: ['core', 'shoulders', 'legs'],
    equipment: ['bodyweight'],
    difficulty: 'intermediate',
    exerciseType: 'strength',
    trainingStyles: ['hiit', 'circuit', 'endurance'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Start in a high plank with hands under shoulders.',
      'Drive the right knee toward your chest without letting hips rise.',
      'Quickly switch legs, keeping the core braced.',
      'Continue alternating at a controlled fast pace.',
    ],
    breathing: 'Maintain steady breathing; do not hold your breath as pace rises.',
    commonMistakes: ['Hips bouncing up and down', 'Hands drifting forward', 'Losing the plank position'],
    easierVariation: 'Slow the pace right down or do it from an incline.',
    harderVariation: 'Drive knees toward opposite elbows (cross-body).',
    safetyNotes: 'Keep the lower back flat; stop if form breaks down from fatigue.',
  },
  {
    slug: 'hanging-knee-raise',
    name: 'Hanging Knee Raise',
    description: 'A hanging ab exercise that builds lower-ab strength and grip; a stepping stone to toes-to-bar.',
    muscleGroups: ['core', 'back'],
    equipment: ['bodyweight', 'pullup-bar'],
    difficulty: 'advanced',
    exerciseType: 'strength',
    trainingStyles: ['hypertrophy', 'general-fitness'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Hang from the bar with an overhand grip, body still.',
      'Tuck knees and raise them toward your chest, curling the pelvis up.',
      'Pause briefly at the top.',
      'Lower slowly without swinging.',
    ],
    breathing: 'Exhale lifting knees; inhale lowering.',
    commonMistakes: ['Swinging the body for momentum', 'Only lifting to 90 degrees without curling the pelvis', 'Dropping fast'],
    easierVariation: 'Do lying reverse crunches or use ab straps.',
    harderVariation: 'Straighten the legs (hanging leg raise).',
    safetyNotes: 'Control the swing; avoid if you have shoulder instability.',
  },
  {
    slug: 'ab-wheel-rollout',
    name: 'Ab Wheel Rollout',
    description: 'An advanced anti-extension core exercise; the wheel magnifies every inch of the rollout.',
    muscleGroups: ['core', 'shoulders', 'back'],
    equipment: ['bodyweight'],
    difficulty: 'advanced',
    exerciseType: 'strength',
    trainingStyles: ['hypertrophy', 'strength'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Kneel with the ab wheel under your shoulders.',
      'Brace hard and roll forward, keeping hips tucked and back flat.',
      'Go only as far as you can without the lower back arching.',
      'Pull back to the start using your abs, not your arms.',
    ],
    breathing: 'Inhale rolling out; exhale powerfully rolling back.',
    commonMistakes: ['Letting the lower back sag', 'Rolling too far too soon', 'Bending at the hips instead of extending'],
    easierVariation: 'Roll out to a wall so the wheel stops at a safe distance.',
    harderVariation: 'Start from standing (advanced) or pause at full extension.',
    safetyNotes: 'This is demanding on the lower back; master planks first and progress range gradually.',
  },
  {
    slug: 'jumping-jacks',
    name: 'Jumping Jacks',
    description: 'A classic full-body warm-up move that raises the heart rate and loosens the joints.',
    muscleGroups: ['cardio', 'legs', 'shoulders'],
    equipment: ['bodyweight'],
    difficulty: 'beginner',
    exerciseType: 'cardio',
    trainingStyles: ['hiit', 'circuit', 'general-fitness'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Stand with feet together, arms at sides.',
      'Jump feet out while raising arms overhead.',
      'Jump back to the start position.',
      'Land softly on the balls of your feet with knees soft.',
    ],
    breathing: 'Breathe rhythmically; inhale arms up, exhale arms down.',
    commonMistakes: ['Landing stiff-legged', 'Half range of motion when tired'],
    easierVariation: 'Step side to side instead of jumping (low-impact).',
    harderVariation: 'Add a squat at the bottom or speed up the pace.',
    safetyNotes: 'Land softly to protect knees and ankles; low-impact version if joints are sensitive.',
  },
  {
    slug: 'burpee',
    name: 'Burpee',
    description: 'The full-body conditioning benchmark: squat, plank, push-up and jump in one demanding sequence.',
    muscleGroups: ['full-body', 'cardio'],
    equipment: ['bodyweight'],
    difficulty: 'advanced',
    exerciseType: 'cardio',
    trainingStyles: ['hiit', 'circuit'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'From standing, squat down and place hands on the floor.',
      'Jump feet back into a plank.',
      'Do a push-up (optional for beginners to skip).',
      'Jump feet back to hands, then explode upward with arms overhead.',
    ],
    breathing: 'Breathe continuously; exhale on the jump.',
    commonMistakes: ['Sagging hips in the plank phase', 'Skipping the push-up depth', 'Landing with locked knees'],
    easierVariation: 'Step back instead of jumping, and skip the push-up.',
    harderVariation: 'Add a tuck jump at the top.',
    safetyNotes: 'High intensity: warm up first; stop if dizzy or form collapses.',
  },
  {
    slug: 'high-knees',
    name: 'High Knees',
    description: 'Running in place with knees driven high; builds cardio fitness and hip-flexor power.',
    muscleGroups: ['cardio', 'legs', 'core'],
    equipment: ['bodyweight'],
    difficulty: 'intermediate',
    exerciseType: 'cardio',
    trainingStyles: ['hiit', 'circuit'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Stand tall with feet hip-width apart.',
      'Drive one knee up to hip height while pumping the opposite arm.',
      'Switch legs quickly, landing on the balls of your feet.',
      'Stay tall; do not lean back.',
    ],
    breathing: 'Breathe fast and rhythmic with the steps.',
    commonMistakes: ['Leaning back', 'Shuffling with low knees', 'Landing flat-footed'],
    easierVariation: 'March in place with high knees at walking pace.',
    harderVariation: 'Sprint intervals: 20 seconds on, 10 seconds off.',
    safetyNotes: 'Land softly; reduce impact by staying on a mat.',
  },
  {
    slug: 'jump-rope',
    name: 'Jump Rope',
    description: 'Efficient cardio and coordination training; a few minutes rivals much longer steady cardio.',
    muscleGroups: ['cardio', 'legs', 'shoulders'],
    equipment: ['bodyweight'],
    difficulty: 'intermediate',
    exerciseType: 'cardio',
    trainingStyles: ['hiit', 'circuit', 'endurance'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Hold handles at hip height, rope behind your heels.',
      'Turn the rope with your wrists, not big arm circles.',
      'Jump just high enough to clear the rope, landing on the balls of your feet.',
      'Keep elbows tucked and bounce lightly.',
    ],
    breathing: 'Breathe steadily; find a rhythm.',
    commonMistakes: ['Jumping too high', 'Turning the rope with the whole arm', 'Looking down'],
    easierVariation: 'Do imaginary jump rope (no rope) or single bounces with pauses.',
    harderVariation: 'Try double-unders or alternating-foot steps.',
    safetyNotes: 'Use a forgiving surface; stop if calves or shins become painful.',
  },
  {
    slug: 'treadmill-run',
    name: 'Treadmill Run',
    description: 'Controlled indoor running with adjustable speed and incline for steady cardio or intervals.',
    muscleGroups: ['cardio', 'legs'],
    equipment: ['machine'],
    difficulty: 'beginner',
    exerciseType: 'cardio',
    trainingStyles: ['endurance', 'hiit'],
    homeSuitable: false, gymSuitable: true,
    steps: [
      'Start with a 5-minute walking warm-up.',
      'Increase to a comfortable running pace with a slight forward lean.',
      'Land mid-foot under your body, not overstriding.',
      'Cool down with 5 minutes of easy walking.',
    ],
    breathing: 'Breathe in a steady rhythm; you should be able to speak in short sentences at moderate effort.',
    commonMistakes: ['Holding the handrails', 'Overstriding with heel strikes', 'Skipping the warm-up'],
    easierVariation: 'Walk on an incline instead of running.',
    harderVariation: 'Add incline intervals or tempo segments.',
    safetyNotes: 'Use the safety clip; increase speed and incline gradually.',
  },
  {
    slug: 'stationary-bike',
    name: 'Stationary Bike',
    description: 'Low-impact cardio that is kind to the knees; ideal for beginners and recovery days.',
    muscleGroups: ['cardio', 'legs'],
    equipment: ['machine'],
    difficulty: 'beginner',
    exerciseType: 'cardio',
    trainingStyles: ['endurance', 'hiit', 'rehab'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Adjust the seat so your knee has a slight bend at the bottom of the pedal stroke.',
      'Warm up 5 minutes at easy resistance.',
      'Pedal at a steady cadence (70–90 rpm) at your target effort.',
      'Cool down 5 minutes at low resistance.',
    ],
    breathing: 'Breathe steadily; match effort to a conversational pace for endurance rides.',
    commonMistakes: ['Seat too low causing knee strain', 'Gripping handlebars too tightly', 'Pedaling with toes pointed down excessively'],
    easierVariation: 'Keep resistance minimal and duration short.',
    harderVariation: 'Add hill intervals or sprint segments.',
    safetyNotes: 'Set seat height before riding; stop if the front of the knee hurts.',
  },
  {
    slug: 'cat-cow',
    name: 'Cat-Cow',
    description: 'A gentle spinal mobility flow alternating between flexion and extension; a perfect warm-up.',
    muscleGroups: ['back', 'core'],
    equipment: ['bodyweight', 'mat'],
    difficulty: 'beginner',
    exerciseType: 'mobility',
    trainingStyles: ['mobility', 'rehab'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Start on all fours, hands under shoulders, knees under hips.',
      'Inhale: drop the belly, lift the tailbone and chest (cow).',
      'Exhale: round the back, tuck the chin and tailbone (cat).',
      'Flow slowly between the two for 8–10 breaths.',
    ],
    breathing: 'Inhale into cow; exhale into cat — breath drives the movement.',
    commonMistakes: ['Rushing through the flow', 'Forcing end ranges'],
    easierVariation: 'Do it seated in a chair.',
    harderVariation: 'Add thoracic rotations between rounds.',
    safetyNotes: 'Move within a comfortable range; never force spinal positions.',
  },
  {
    slug: 'thoracic-rotation',
    name: 'Thoracic Rotation (Open Book)',
    description: 'A side-lying rotation drill that restores mid-back mobility lost to desk sitting.',
    muscleGroups: ['back', 'core'],
    equipment: ['bodyweight', 'mat'],
    difficulty: 'beginner',
    exerciseType: 'mobility',
    trainingStyles: ['mobility', 'rehab'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Lie on your side, knees bent and stacked, arms extended in front.',
      'Keeping lower body still, open the top arm across your body.',
      'Follow your hand with your eyes, rotating through the mid-back.',
      'Return slowly; repeat 8–10 times per side.',
    ],
    breathing: 'Inhale to prepare; exhale as you open.',
    commonMistakes: ['Letting the hips rotate with the torso', 'Forcing the range'],
    easierVariation: 'Place a pillow between the knees.',
    harderVariation: 'Hold the open position for 5 breaths.',
    safetyNotes: 'Keep it gentle; rotation should feel like a stretch, not a crack.',
  },
  {
    slug: 'hip-flexor-stretch',
    name: 'Half-Kneeling Hip Flexor Stretch',
    description: 'Targets the tight hip flexors from prolonged sitting; key for healthy hips and lower backs.',
    muscleGroups: ['legs'],
    equipment: ['bodyweight', 'mat'],
    difficulty: 'beginner',
    exerciseType: 'mobility',
    trainingStyles: ['mobility', 'rehab'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Kneel on one knee with the other foot flat in front (half-kneeling).',
      'Tuck the pelvis slightly under and squeeze the glute of the kneeling leg.',
      'Shift your weight gently forward until you feel a stretch at the front of the hip.',
      'Hold 30 seconds per side; keep the torso tall.',
    ],
    breathing: 'Breathe deeply; exhale to ease slightly deeper.',
    commonMistakes: ['Arching the lower back instead of tucking the pelvis', 'Leaning the torso forward'],
    easierVariation: 'Place a cushion under the knee.',
    harderVariation: 'Raise the same-side arm overhead and lean slightly away.',
    safetyNotes: 'The stretch should be mild; back off if you feel pinching at the front of the hip.',
  },
  {
    slug: 'hamstring-stretch',
    name: 'Standing Hamstring Stretch',
    description: 'A simple standing stretch for the back of the thigh; maintains hip-hinge range.',
    muscleGroups: ['legs'],
    equipment: ['bodyweight'],
    difficulty: 'beginner',
    exerciseType: 'mobility',
    trainingStyles: ['mobility', 'rehab'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Place one heel on a low step or bench, leg straight, toes up.',
      'Keep the back flat and hinge forward at the hips.',
      'Stop when you feel a gentle pull behind the thigh.',
      'Hold 30 seconds per side.',
    ],
    breathing: 'Breathe deeply; relax into the stretch on each exhale.',
    commonMistakes: ['Rounding the back to "reach further"', 'Bouncing the stretch'],
    easierVariation: 'Do it seated with the leg extended.',
    harderVariation: 'Increase the step height slightly.',
    safetyNotes: 'Never bounce; a gentle pull is enough — sharp pain means back off.',
  },
  {
    slug: 'childs-pose',
    name: "Child's Pose",
    description: 'A restful kneeling stretch for the back, shoulders and hips; the go-to reset between sets.',
    muscleGroups: ['back', 'shoulders'],
    equipment: ['bodyweight', 'mat'],
    difficulty: 'beginner',
    exerciseType: 'mobility',
    trainingStyles: ['mobility', 'rehab'],
    homeSuitable: true, gymSuitable: true,
    steps: [
      'Kneel with big toes together and knees wide.',
      'Sit hips back toward heels.',
      'Walk hands forward, lowering the chest toward the floor.',
      'Rest the forehead down and breathe deeply for 30–60 seconds.',
    ],
    breathing: 'Slow deep breaths; let the back expand with each inhale.',
    commonMistakes: ['Holding tension in the shoulders', 'Forcing knees together uncomfortably'],
    easierVariation: 'Place a pillow between thighs and calves.',
    harderVariation: 'Walk hands to one side for a lateral stretch.',
    safetyNotes: 'Come out slowly if you feel dizzy; keep it comfortable for the knees.',
  },
];

// ---------------------------------------------------------------------------
// Starter foods (source 'seeded', verified)
// ---------------------------------------------------------------------------
type FoodSeed = {
  name: string;
  brand?: string;
  servingSize: number;
  servingUnit: string;
  /** Canonical grams per serving (v21.2). Documented basis, never guessed. */
  servingWeightG?: number;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
};

const FOODS: FoodSeed[] = [
  // South Asian staples
  { name: 'Chapati (Whole Wheat Roti)', servingSize: 1, servingUnit: 'piece (30g)', servingWeightG: 30, kcal: 90, proteinG: 3, carbsG: 18, fatG: 1, fiberG: 3 },
  { name: 'Basmati Rice (cooked)', servingSize: 150, servingUnit: 'g (1 cup)', kcal: 190, proteinG: 4, carbsG: 42, fatG: 0.5, fiberG: 1 },
  { name: 'Masoor Daal (cooked)', servingSize: 200, servingUnit: 'g (1 cup)', kcal: 230, proteinG: 12, carbsG: 35, fatG: 3, fiberG: 8 },
  { name: 'Chicken Breast (grilled)', servingSize: 100, servingUnit: 'g', kcal: 165, proteinG: 31, carbsG: 0, fatG: 3.5, fiberG: 0 },
  { name: 'Tandoori Chicken', servingSize: 100, servingUnit: 'g', kcal: 150, proteinG: 28, carbsG: 2, fatG: 4, fiberG: 0 },
  { name: 'Naan', servingSize: 1, servingUnit: 'piece (90g)', servingWeightG: 90, kcal: 310, proteinG: 8, carbsG: 56, fatG: 6, fiberG: 2 },
  { name: 'Paratha (whole wheat)', servingSize: 1, servingUnit: 'piece (60g)', servingWeightG: 60, kcal: 200, proteinG: 5, carbsG: 32, fatG: 7, fiberG: 4 },
  { name: 'Chana Masala (homemade)', servingSize: 200, servingUnit: 'g (1 cup)', kcal: 260, proteinG: 12, carbsG: 40, fatG: 6, fiberG: 10 },
  { name: 'Dahi - Plain Low-Fat Yogurt', servingSize: 100, servingUnit: 'g', kcal: 60, proteinG: 5, carbsG: 7, fatG: 2, fiberG: 0 },
  { name: 'Paneer', servingSize: 100, servingUnit: 'g', kcal: 265, proteinG: 18, carbsG: 3.5, fatG: 20, fiberG: 0 },
  // Proteins
  { name: 'Boiled Eggs', servingSize: 2, servingUnit: 'large eggs (100g)', servingWeightG: 100, kcal: 140, proteinG: 13, carbsG: 1, fatG: 10, fiberG: 0 },
  { name: 'Greek Yogurt (plain)', servingSize: 170, servingUnit: 'g', kcal: 100, proteinG: 17, carbsG: 6, fatG: 0.7, fiberG: 0 },
  { name: 'Salmon (baked)', servingSize: 100, servingUnit: 'g', kcal: 208, proteinG: 20, carbsG: 0, fatG: 13, fiberG: 0 },
  { name: 'Tuna (canned in water)', servingSize: 100, servingUnit: 'g', kcal: 132, proteinG: 28, carbsG: 0, fatG: 1, fiberG: 0 },
  { name: 'Beef (lean, cooked)', servingSize: 100, servingUnit: 'g', kcal: 250, proteinG: 26, carbsG: 0, fatG: 15, fiberG: 0 },
  { name: 'Tofu (firm)', servingSize: 100, servingUnit: 'g', kcal: 76, proteinG: 8, carbsG: 1.9, fatG: 4.8, fiberG: 0.3 },
  { name: 'Whey Protein Shake', servingSize: 30, servingUnit: 'g (1 scoop)', kcal: 120, proteinG: 24, carbsG: 3, fatG: 1, fiberG: 0.5 },
  // Grains & carbs
  { name: 'Oatmeal (cooked)', servingSize: 240, servingUnit: 'g (1 cup)', kcal: 165, proteinG: 6, carbsG: 28, fatG: 3.5, fiberG: 4 },
  { name: 'Whole Wheat Bread', servingSize: 1, servingUnit: 'slice (30g)', servingWeightG: 30, kcal: 80, proteinG: 4, carbsG: 15, fatG: 1, fiberG: 2.5 },
  { name: 'Pasta (cooked)', servingSize: 140, servingUnit: 'g (1 cup)', kcal: 220, proteinG: 8, carbsG: 43, fatG: 1.3, fiberG: 2.5 },
  { name: 'Brown Rice (cooked)', servingSize: 150, servingUnit: 'g (1 cup)', kcal: 215, proteinG: 5, carbsG: 45, fatG: 1.8, fiberG: 3.5 },
  { name: 'Quinoa (cooked)', servingSize: 185, servingUnit: 'g (1 cup)', kcal: 222, proteinG: 8, carbsG: 39, fatG: 3.6, fiberG: 5 },
  { name: 'Potato (boiled)', servingSize: 150, servingUnit: 'g (1 medium)', kcal: 130, proteinG: 3, carbsG: 30, fatG: 0.2, fiberG: 2.5 },
  { name: 'Sweet Potato (baked)', servingSize: 130, servingUnit: 'g (1 medium)', kcal: 103, proteinG: 2, carbsG: 24, fatG: 0.2, fiberG: 3.8 },
  // Legumes
  { name: 'Chickpeas (cooked)', servingSize: 164, servingUnit: 'g (1 cup)', kcal: 270, proteinG: 15, carbsG: 45, fatG: 4, fiberG: 12.5 },
  { name: 'Black Beans (cooked)', servingSize: 172, servingUnit: 'g (1 cup)', kcal: 227, proteinG: 15, carbsG: 41, fatG: 1, fiberG: 15 },
  // Fruits
  { name: 'Banana', servingSize: 1, servingUnit: 'medium (120g)', servingWeightG: 120, kcal: 105, proteinG: 1.3, carbsG: 27, fatG: 0.4, fiberG: 3 },
  { name: 'Apple', servingSize: 1, servingUnit: 'medium (180g)', servingWeightG: 180, kcal: 95, proteinG: 0.5, carbsG: 25, fatG: 0.3, fiberG: 4.5 },
  { name: 'Mango', servingSize: 165, servingUnit: 'g (1 cup)', kcal: 99, proteinG: 1.4, carbsG: 25, fatG: 0.6, fiberG: 2.6 },
  { name: 'Orange', servingSize: 1, servingUnit: 'medium (140g)', servingWeightG: 140, kcal: 62, proteinG: 1.2, carbsG: 15.5, fatG: 0.2, fiberG: 3 },
  { name: 'Dates (Medjool)', servingSize: 3, servingUnit: 'pieces (72g)', servingWeightG: 72, kcal: 200, proteinG: 1.3, carbsG: 54, fatG: 0, fiberG: 5 },
  { name: 'Avocado', servingSize: 75, servingUnit: 'g (1/2)', kcal: 120, proteinG: 1.5, carbsG: 6.4, fatG: 11, fiberG: 5 },
  // Vegetables
  { name: 'Broccoli (steamed)', servingSize: 156, servingUnit: 'g (1 cup)', kcal: 55, proteinG: 3.7, carbsG: 11, fatG: 0.6, fiberG: 5 },
  { name: 'Spinach (cooked)', servingSize: 180, servingUnit: 'g (1 cup)', kcal: 41, proteinG: 5.4, carbsG: 7, fatG: 0.5, fiberG: 4.3 },
  { name: 'Mixed Salad Greens', servingSize: 60, servingUnit: 'g (2 cups)', kcal: 20, proteinG: 1.5, carbsG: 4, fatG: 0.3, fiberG: 2 },
  // Nuts, fats & dairy
  { name: 'Almonds', servingSize: 28, servingUnit: 'g', kcal: 164, proteinG: 6, carbsG: 6, fatG: 14, fiberG: 3.5 },
  { name: 'Peanuts (roasted)', servingSize: 30, servingUnit: 'g', kcal: 170, proteinG: 8, carbsG: 5, fatG: 14, fiberG: 2.5 },
  { name: 'Peanut Butter', servingSize: 32, servingUnit: 'g (2 tbsp)', kcal: 190, proteinG: 8, carbsG: 7, fatG: 16, fiberG: 2.5 },
  { name: 'Olive Oil', servingSize: 14, servingUnit: 'g (1 tbsp)', servingWeightG: 14, kcal: 120, proteinG: 0, carbsG: 0, fatG: 14, fiberG: 0 },
  // 250 ml x 1.03 g/ml (USDA whole-milk density)
  { name: 'Whole Milk', servingSize: 250, servingUnit: 'ml (1 cup)', servingWeightG: 257.5, kcal: 150, proteinG: 8, carbsG: 12, fatG: 8, fiberG: 0 },
];

// ---------------------------------------------------------------------------
// Runner (idempotent: re-runs against an unchanged DB perform no writes;
// per-record create/update/unchanged/skip/failed is reported at the end)
// ---------------------------------------------------------------------------
async function main() {
  const stats = new SeedStats();
  const cuisineIds = new Map<string, string>();
  for (const c of CUISINES) {
    const prev = await prisma.cuisine.findUnique({ where: { name: c.name } });
    let row;
    if (!prev) {
      row = await prisma.cuisine.create({ data: { name: c.name, region: c.region } });
      stats.note('cuisine', 'created');
    } else if (prev.region !== c.region) {
      row = await prisma.cuisine.update({
        where: { id: prev.id },
        data: { region: c.region },
      });
      stats.note('cuisine', 'updated');
    } else {
      row = prev;
      stats.note('cuisine', 'unchanged');
    }
    cuisineIds.set(c.name, row.id);
  }

  for (const r of RECIPES) {
    const cuisineId = cuisineIds.get(r.cuisine);
    if (!cuisineId) throw new Error(`Unknown cuisine referenced by recipe ${r.slug}: ${r.cuisine}`);
    // V21.8: the seed no longer blind-upserts material fields. The plan
    // (create / skip-private / unchanged / metadata-only / material change)
    // is computed per record in src/seed-safety.ts: unchanged content keeps
    // verified + review/verification evidence; a material change recomputes
    // contentHash, bumps revision atomically, invalidates stale evidence,
    // and re-screens allergens.
    const seed: NormalizedRecipeSeed = {
      slug: r.slug,
      title: r.title,
      cuisineId,
      dietCategory: r.dietCategory,
      tags: r.tags,
      servings: r.servings,
      prepMin: r.prepMin,
      cookMin: r.cookMin,
      difficulty: r.difficulty,
      mealType: null,
      needsReview: false,
      ingredients: r.ingredients.map((i) => ({ name: i.name, quantity: i.quantity, grams: i.grams })),
      instructions: r.instructions.map((s) => ({ step: s.step, text: s.text })),
      kcalPerServing: r.kcal,
      proteinPerServing: r.proteinG,
      carbsPerServing: r.carbsG,
      fatPerServing: r.fatG,
      fiberPerServing: r.fiberG,
      declaredAllergens: r.allergens,
    };
    try {
      await applyRecipeSeed(prisma, seed, stats);
    } catch (e) {
      stats.note('recipe', 'failed');
      console.error(`[seed] FAILED recipe ${r.slug}:`, e);
    }
  }

  // V21: batch recipe modules (engine-computed nutrition, pure data).
  // New recipes are source='curated', verified=false (engine-calculated,
  // not yet human-reviewed). needsReview comes from each batch entry:
  // true when the engine hit an UNKNOWN quantity/unit (v21.2 policy —
  // unknown beats guessing), so 92 recipes are honestly flagged
  // (reconciled 2026-10-14; see packages/db/prisma/recipe-quality-report.ts).
  const V21_BATCHES = [PAKISTANI_RECIPES, INDIAN_MET_RECIPES, ASIAN_RECIPES, WESTERN_RECIPES];
  let v21Count = 0;
  let v21AliasCount = 0;
  for (const batch of V21_BATCHES) {
    for (const r of batch) {
      const cuisineId = cuisineIds.get(r.cuisine);
      if (!cuisineId) throw new Error(`Unknown cuisine referenced by recipe ${r.slug}: ${r.cuisine}`);
      // V21.8: same safe write path as the originals (see above). New
      // recipes are source='curated', verified=false (engine-calculated,
      // not yet human-reviewed). needsReview comes from each batch entry:
      // true when the engine hit an UNKNOWN quantity/unit (v21.2 policy —
      // unknown beats guessing), so 92 recipes are honestly flagged
      // (reconciled 2026-10-14; see packages/db/prisma/recipe-quality-report.ts).
      const seed: NormalizedRecipeSeed = {
        slug: r.slug,
        title: r.title,
        cuisineId,
        dietCategory: r.dietCategory,
        tags: r.tags,
        servings: r.servings,
        prepMin: r.prepMin,
        cookMin: r.cookMin,
        difficulty: r.difficulty,
        mealType: r.mealType ?? null,
        needsReview: r.needsReview,
        ingredients: r.ingredients.map((i: { name: string; quantity: string; grams?: number }) => ({
          name: i.name, quantity: i.quantity, grams: i.grams ?? null,
        })),
        instructions: r.instructions.map((text: string, idx: number) => ({ step: idx + 1, text })),
        kcalPerServing: r1(r.computed.perServing.kcal),
        proteinPerServing: r1(r.computed.perServing.proteinG),
        carbsPerServing: r1(r.computed.perServing.carbsG),
        fatPerServing: r1(r.computed.perServing.fatG),
        fiberPerServing: r1(r.computed.perServing.fiberG),
        declaredAllergens: r.allergens,
      };
      let recipeId: string | null = null;
      try {
        const result = await applyRecipeSeed(prisma, seed, stats);
        recipeId = result.id;
        // Never touch aliases for a failed write — and never for a skipped
        // (private) recipe either.
        if (result.status === 'failed' || result.status === 'skipped') recipeId = null;
      } catch (e) {
        stats.note('recipe', 'failed');
        console.error(`[seed] FAILED recipe ${r.slug}:`, e);
      }
      if (!recipeId) continue;
      // V21.2: persist seed aliases. Idempotent upsert on the
      // @@unique([recipeId, normalizedAlias]) key — re-running the seed never
      // duplicates aliases. Alias strings come ONLY from the batch modules;
      // nothing is invented here, and identities are never merged across recipes.
      const aliasRows = buildRecipeAliasRows(recipeId, r.aliases);
      for (const row of aliasRows) {
        await prisma.recipeAlias.upsert({
          where: {
            recipeId_normalizedAlias: {
              recipeId: row.recipeId,
              normalizedAlias: row.normalizedAlias,
            },
          },
          update: { alias: row.alias, language: row.language },
          create: row,
        });
      }
      v21AliasCount += aliasRows.length;
      v21Count++;
    }
  }
  console.log(`Seeded ${v21Count} v21 batch recipes (${v21AliasCount} aliases)`);

  for (const e of EXERCISES) {
    // V21.8: the update never includes mediaType/mediaUrl unless the seed
    // entry explicitly carries media — exercise media imported from an
    // authorized source survives repeated seed runs (see
    // src/seed-safety.ts).
    try {
      await applyExerciseSeed(prisma, e, stats);
    } catch (err) {
      stats.note('exercise', 'failed');
      console.error(`[seed] FAILED exercise ${e.slug}:`, err);
    }
  }

  for (const f of FOODS) {
    // V21.8: find-first so the report distinguishes created/updated/
    // unchanged — a re-run against an unchanged DB performs no writes.
    try {
      const prev = await prisma.food.findUnique({ where: { name: f.name } });
      const updateData = {
        brand: f.brand ?? null,
        servingSize: f.servingSize,
        servingUnit: f.servingUnit,
        // V21.2: backfill canonical serving weight; explicit undefined
        // leaves existing values untouched (never nulls a known weight).
        ...(f.servingWeightG !== undefined ? { servingWeightG: f.servingWeightG } : {}),
        kcal: f.kcal,
        proteinG: f.proteinG,
        carbsG: f.carbsG,
        fatG: f.fatG,
        fiberG: f.fiberG,
        source: 'seeded',
        verified: true,
      };
      if (!prev) {
        await prisma.food.create({
          data: {
            name: f.name,
            ...updateData,
            servingWeightG: f.servingWeightG ?? null,
          },
        });
        stats.note('food', 'created');
      } else {
        const changed = Object.entries(updateData).some(
          ([k, v]) =>
            JSON.stringify((prev as unknown as Record<string, unknown>)[k]) !== JSON.stringify(v),
        );
        if (!changed) {
          stats.note('food', 'unchanged');
        } else {
          await prisma.food.update({ where: { id: prev.id }, data: updateData });
          stats.note('food', 'updated');
        }
      }
    } catch (e) {
      stats.note('food', 'failed');
      console.error(`[seed] FAILED food ${f.name}:`, e);
    }
  }

  // -----------------------------------------------------------------------
  // V18 — Pakistani home-food catalogue (categories, foods, aliases, portions)
  // -----------------------------------------------------------------------
  const existingFoodNames = new Set(FOODS.map((f) => f.name));
  const categoryIds = new Map<string, string>();
  for (const c of V18_CATEGORIES) {
    // V21.8: find-first so the report distinguishes created/updated/unchanged.
    const prevCat = await prisma.foodCategory.findUnique({ where: { name: c.name } });
    let row;
    if (!prevCat) {
      row = await prisma.foodCategory.create({
        data: { name: c.name, nameUrdu: c.nameUrdu, sortOrder: c.sortOrder },
      });
      stats.note('foodCategory', 'created');
    } else if (prevCat.nameUrdu !== c.nameUrdu || prevCat.sortOrder !== c.sortOrder) {
      row = await prisma.foodCategory.update({
        where: { id: prevCat.id },
        data: { nameUrdu: c.nameUrdu, sortOrder: c.sortOrder },
      });
      stats.note('foodCategory', 'updated');
    } else {
      row = prevCat;
      stats.note('foodCategory', 'unchanged');
    }
    categoryIds.set(c.name, row.id);
  }

  // Sanity: every V18 food must reference a known category.
  const unknownCats = V18_FOODS.filter((f) => !categoryIds.has(f.category)).map((f) => f.name);
  if (unknownCats.length) {
    throw new Error(`V18 foods with unknown category: ${unknownCats.join(', ')}`);
  }
  // Sanity: no V18 food may duplicate an existing starter-food name.
  const dupes = V18_FOODS.filter((f) => existingFoodNames.has(f.name)).map((f) => f.name);
  if (dupes.length) {
    throw new Error(`V18 foods duplicating existing names: ${dupes.join(', ')}`);
  }
  // Sanity: V18 food names must be unique within the batch.
  const seenNames = new Set<string>();
  for (const f of V18_FOODS) {
    if (seenNames.has(f.name)) throw new Error(`Duplicate V18 food name: ${f.name}`);
    seenNames.add(f.name);
  }

  let v18Foods = 0;
  let v18Aliases = 0;
  let v18Portions = 0;

  async function seedV18Food(f: V18FoodSeed) {
    const factor = f.servingSize / 100;
    const data = {
      brand: null,
      servingSize: f.servingSize,
      servingUnit: f.servingUnit,
      kcal: r1(f.per100[0] * factor),
      proteinG: r1(f.per100[1] * factor),
      carbsG: r1(f.per100[2] * factor),
      fatG: r1(f.per100[3] * factor),
      fiberG: r1(f.per100[4] * factor),
      source: 'seeded',
      verified: false,
      verification: 'estimate',
      basis: f.basis,
      categoryId: categoryIds.get(f.category) ?? null,
      countryCodes: ['PK'],
    };
    // V21.8: report created vs updated.
    const prev = await prisma.food.findUnique({ where: { name: f.name } });
    const food = await prisma.food.upsert({
      where: { name: f.name },
      update: data,
      create: { name: f.name, ...data },
    });
    stats.note('food', prev ? 'updated' : 'created');
    // Replace aliases + portions wholesale so re-runs stay idempotent.
    await prisma.foodAlias.deleteMany({ where: { foodId: food.id } });
    await prisma.householdPortion.deleteMany({ where: { foodId: food.id } });
    if (f.aliases.length) {
      await prisma.foodAlias.createMany({
        data: f.aliases.map(([alias, language], i) => ({ foodId: food.id, alias, language })),
      });
      v18Aliases += f.aliases.length;
    }
    if (f.portions.length) {
      await prisma.householdPortion.createMany({
        data: f.portions.map((p, i) => ({
          foodId: food.id,
          label: p.label,
          labelUrdu: p.labelUrdu ?? null,
          grams: p.grams ?? null,
          ml: p.ml ?? null,
          sortOrder: i,
        })),
      });
      v18Portions += f.portions.length;
    }
    v18Foods++;
  }

  for (const f of V18_FOODS) {
    try {
      await seedV18Food(f);
    } catch (e) {
      stats.note('food', 'failed');
      console.error(`[seed] FAILED v18 food ${f.name}:`, e);
    }
  }

  // Extend the 43 pre-existing starter foods (aliases + portions + category),
  // never touching their nutrition values.
  let extendedFoods = 0;
  for (const ext of V18_EXISTING_FOOD_EXTENSIONS) {
    try {
      const food = await prisma.food.findUnique({ where: { name: ext.name } });
      if (!food) {
        console.warn(`V18 extension skipped — food not found: ${ext.name}`);
        stats.note('food', 'skipped');
        continue;
      }
      await prisma.food.update({
        where: { id: food.id },
        data: {
          categoryId: ext.category ? (categoryIds.get(ext.category) ?? null) : food.categoryId,
          countryCodes: ext.countryCodes,
          basis: food.basis ?? 'Previously seeded starter food — values retained from original seed',
        },
      });
      await prisma.foodAlias.deleteMany({ where: { foodId: food.id } });
      await prisma.householdPortion.deleteMany({ where: { foodId: food.id } });
      if (ext.aliases.length) {
        await prisma.foodAlias.createMany({
          data: ext.aliases.map(([alias, language]) => ({ foodId: food.id, alias, language })),
        });
        v18Aliases += ext.aliases.length;
      }
      if (ext.portions.length) {
        await prisma.householdPortion.createMany({
          data: ext.portions.map((p, i) => ({
            foodId: food.id,
            label: p.label,
            labelUrdu: p.labelUrdu ?? null,
            grams: p.grams ?? null,
            ml: p.ml ?? null,
            sortOrder: i,
          })),
        });
        v18Portions += ext.portions.length;
      }
      extendedFoods++;
      stats.note('food', 'updated');
    } catch (e) {
      stats.note('food', 'failed');
      console.error(`[seed] FAILED v18 extension ${ext.name}:`, e);
    }
  }

  const [cuisines, recipes, exercises, foods, categories, aliases, portions] = await Promise.all([
    prisma.cuisine.count(),
    prisma.recipe.count(),
    prisma.exercise.count(),
    prisma.food.count(),
    prisma.foodCategory.count(),
    prisma.foodAlias.count(),
    prisma.householdPortion.count(),
  ]);
  console.log(
    `Seed complete: cuisines=${cuisines} recipes=${recipes} exercises=${exercises} foods=${foods} ` +
      `categories=${categories} aliases=${aliases} portions=${portions} ` +
      `(v18 new foods=${v18Foods}, extended existing=${extendedFoods}, v18 aliases=${v18Aliases}, v18 portions=${v18Portions})`,
  );
  // V21.8: per-record-type report (created / updated / unchanged / skipped / failed).
  console.log(stats.summary());
  if (stats.failedTotal() > 0) {
    // Fail loudly (same contract as before: a failed seed exits non-zero),
    // but only after every other record was attempted and reported.
    throw new Error(`Seed finished with ${stats.failedTotal()} failed record(s) — see report above.`);
  }
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

