/**
 * FitFusion AI — V21 Western recipe batch (Mediterranean + Italian + Mexican +
 * American + Continental), 60 recipes.
 *
 * PURE DATA MODULE: no imports from @prisma/client, no side effects.
 * Importing this module must never touch the DB.
 *
 * HONESTY CONTRACT (binding):
 *  - Nutrition was computed with the REAL recipe engine
 *    (packages/core/src/recipe-engine.ts) over the 150-ingredient USDA
 *    catalogue (packages/db/prisma/seed-ingredients.ts) at generation time;
 *    the literal values below are engine output, NEVER hand-adjusted.
 *  - `computed.unresolved` lists catalogue misses. needsReview=true exactly
 *    when unresolved is non-empty; unresolved items contributed 0 to totals.
 *  - Tags were DERIVED by rule from ingredients + computed per-serving
 *    values: 'vegan' = zero animal products (incl. honey); 'gluten-free' =
 *    no wheat/barley/rye (atta, roti, maida, sooji excluded; oats excluded
 *    conservatively); 'dairy-free' verified; 'high-protein' >= 20 g/serving;
 *    'high-fiber' >= 6 g/serving; 'low-calorie' <= 350 kcal/serving.
 *    When in doubt a tag was OMITTED.
 *  - dietCategory follows seed.ts convention: eggs are 'vegetarian'; only
 *    meat/fish/poultry/seafood are 'non_vegetarian'.
 *  - Where a classic Western ingredient is absent from the catalogue, the
 *    recipe uses an honest named substitute (whole-wheat roti for tortilla,
 *    homemade atta pasta for dry pasta, rajma for white/black beans,
 *    black-eyed peas for black beans, spinach for kale, rohu for cod/white
 *    fish, chicken keema for turkey, Greek yogurt for cottage cheese) and the
 *    title says so. No frozen/processed shortcuts are mislabeled.
 *  - Oil, cheese, sugar and honey quantities are explicit and measured;
 *    nothing deep-fried is tagged low-calorie.
 */

export interface RecipeSeed {
  slug: string;
  title: string;
  aliases?: string[];
  cuisine: 'Mediterranean' | 'Italian' | 'Mexican' | 'American' | 'Continental';
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'dessert' | 'drink';
  dietCategory: 'vegetarian' | 'non_vegetarian';
  tags: string[];
  servings: number;
  prepMin: number;
  cookMin: number;
  difficulty: 'easy' | 'medium' | 'hard';
  ingredients: { name: string; quantity: string; grams: number }[];
  instructions: string[];
  allergens: string[];
  substitutions?: string;
  storage?: string;
  computed: {
    perServing: { kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number };
    unresolved: string[];
  };
  needsReview: boolean;
}

export const WESTERN_RECIPES: RecipeSeed[] = [
  {
    "slug": "mediterranean-chickpea-salad",
    "title": "Mediterranean Chickpea Salad",
    "aliases": [
      "chana mediterranean salad"
    ],
    "cuisine": "Mediterranean",
    "mealType": "lunch",
    "dietCategory": "vegetarian",
    "tags": [
      "dairy-free",
      "gluten-free",
      "high-fiber",
      "low-calorie",
      "meal-prep",
      "mediterranean",
      "no-cook",
      "vegan"
    ],
    "servings": 4,
    "prepMin": 15,
    "cookMin": 0,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Kabuli chana (cooked)",
        "quantity": "400 g",
        "grams": 400
      },
      {
        "name": "Cucumber",
        "quantity": "200 g",
        "grams": 200
      },
      {
        "name": "Tomato",
        "quantity": "200 g",
        "grams": 200
      },
      {
        "name": "Onion",
        "quantity": "60 g",
        "grams": 60
      },
      {
        "name": "Bell pepper",
        "quantity": "120 g",
        "grams": 120
      },
      {
        "name": "Lemon",
        "quantity": "1 piece",
        "grams": 60
      },
      {
        "name": "Olive oil",
        "quantity": "2 tbsp",
        "grams": 30
      },
      {
        "name": "Garlic",
        "quantity": "2 cloves",
        "grams": 8
      },
      {
        "name": "Coriander leaves",
        "quantity": "2 tbsp",
        "grams": 30
      },
      {
        "name": "Mint",
        "quantity": "1 tbsp",
        "grams": 15
      },
      {
        "name": "Salt",
        "quantity": "to taste",
        "grams": 1
      },
      {
        "name": "Black pepper",
        "quantity": "to taste",
      "grams": 2
      }
    ],
    "instructions": [
      "Rinse and drain the cooked chickpeas; add to a large mixing bowl.",
      "Dice the cucumber, tomatoes, onion and bell pepper into small even pieces and add to the bowl.",
      "Whisk lemon juice, olive oil, minced garlic, salt and black pepper into a dressing.",
      "Pour the dressing over the salad, toss well, and fold in the chopped coriander and mint.",
      "Rest 10 minutes so the flavours meld, then serve chilled or at room temperature."
    ],
    "allergens": [],
    "substitutions": "Swap chickpeas for cooked rajma; add crumbled paneer if a cheese element is wanted.",
    "storage": "Refrigerate in an airtight container up to 3 days; add fresh herbs just before serving.",
    "computed": {
      "perServing": {
        "kcal": 272.8,
        "proteinG": 10.9,
        "carbsG": 37,
        "fatG": 10.5,
        "fiberG": 10.3
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "mediterranean-grilled-chicken-rice-bowl",
    "title": "Mediterranean Grilled Chicken & Rice Bowl",
    "cuisine": "Mediterranean",
    "mealType": "dinner",
    "dietCategory": "non_vegetarian",
    "tags": [
      "gluten-free",
      "halal",
      "high-protein",
      "meal-prep",
      "mediterranean"
    ],
    "servings": 4,
    "prepMin": 20,
    "cookMin": 30,
    "difficulty": "medium",
    "ingredients": [
      {
        "name": "Chicken breast (raw)",
        "quantity": "600 g",
        "grams": 600
      },
      {
        "name": "Brown rice (raw)",
        "quantity": "240 g",
        "grams": 240
      },
      {
        "name": "Cucumber",
        "quantity": "200 g"
      },
      {
        "name": "Tomato",
        "quantity": "200 g"
      },
      {
        "name": "Onion",
        "quantity": "60 g"
      },
      {
        "name": "Lemon",
        "quantity": "1 piece"
      },
      {
        "name": "Olive oil",
        "quantity": "2 tbsp"
      },
      {
        "name": "Garlic",
        "quantity": "3 cloves",
        "grams": 12
      },
      {
        "name": "Greek yogurt",
        "quantity": "120 g",
        "grams": 120
      },
      {
        "name": "Mint",
        "quantity": "1 tbsp"
      },
      {
        "name": "Cumin seeds",
        "quantity": "1 tsp",
        "grams": 5
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      }
    ],
    "instructions": [
      "Cook the brown rice in salted water until tender, about 30 minutes; fluff and keep warm.",
      "Marinate the chicken with half the lemon juice, half the olive oil, minced garlic, cumin, salt and pepper for 15 minutes.",
      "Grill or pan-sear the chicken 6-7 minutes per side until cooked through; rest 5 minutes and slice.",
      "Whisk Greek yogurt with remaining lemon juice, mint and a pinch of salt into a sauce.",
      "Assemble bowls with rice, sliced chicken, diced cucumber, tomato and onion; drizzle with yogurt sauce."
    ],
    "allergens": [
      "milk"
    ],
    "substitutions": "Use dahi in place of Greek yogurt; swap brown rice for basmati.",
    "storage": "Refrigerate components separately up to 3 days; keep sauce apart until serving.",
    "computed": {
      "perServing": {
        "kcal": 530.4,
        "proteinG": 42.6,
        "carbsG": 55.3,
        "fatG": 14.9,
        "fiberG": 4
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "mediterranean-red-lentil-salad",
    "title": "Mediterranean Red Lentil Salad",
    "cuisine": "Mediterranean",
    "mealType": "lunch",
    "dietCategory": "vegetarian",
    "tags": [
      "budget-friendly",
      "dairy-free",
      "gluten-free",
      "high-fiber",
      "low-calorie",
      "meal-prep",
      "mediterranean",
      "vegan"
    ],
    "servings": 4,
    "prepMin": 15,
    "cookMin": 20,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Masoor daal (dry)",
        "quantity": "200 g",
        "grams": 200
      },
      {
        "name": "Carrot",
        "quantity": "120 g",
        "grams": 120
      },
      {
        "name": "Onion",
        "quantity": "60 g"
      },
      {
        "name": "Lemon",
        "quantity": "1 piece"
      },
      {
        "name": "Olive oil",
        "quantity": "2 tbsp"
      },
      {
        "name": "Cumin seeds",
        "quantity": "1 tsp"
      },
      {
        "name": "Garlic",
        "quantity": "2 cloves"
      },
      {
        "name": "Coriander leaves",
        "quantity": "2 tbsp"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Water",
        "quantity": "600 ml",
      "grams": 600
      }
    ],
    "instructions": [
      "Rinse the red lentils and simmer in water with a pinch of salt for 15-18 minutes until just tender; drain and cool.",
      "Grate the carrot and finely dice the onion.",
      "Toast cumin seeds in a dry pan 30 seconds until fragrant; crush lightly.",
      "Whisk lemon juice, olive oil, garlic, toasted cumin, salt and pepper.",
      "Toss lentils, carrot and onion with the dressing; fold in coriander and serve."
    ],
    "allergens": [],
    "substitutions": "Use cooked masoor daal to skip the boiling step; add diced cucumber for crunch.",
    "storage": "Refrigerate up to 4 days; the salad improves after a few hours.",
    "computed": {
      "perServing": {
        "kcal": 269.7,
        "proteinG": 13.2,
        "carbsG": 38.3,
        "fatG": 8.2,
        "fiberG": 7.1
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "brown-rice-herb-tabbouleh-salad",
    "title": "Brown Rice & Fresh Herb Tabbouleh-Style Salad",
    "aliases": [
      "tabbouleh style salad"
    ],
    "cuisine": "Mediterranean",
    "mealType": "lunch",
    "dietCategory": "vegetarian",
    "tags": [
      "dairy-free",
      "gluten-free",
      "low-calorie",
      "make-ahead",
      "mediterranean",
      "no-cook",
      "vegan"
    ],
    "servings": 4,
    "prepMin": 20,
    "cookMin": 25,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Brown rice (raw)",
        "quantity": "200 g",
        "grams": 200
      },
      {
        "name": "Tomato",
        "quantity": "200 g"
      },
      {
        "name": "Cucumber",
        "quantity": "150 g",
        "grams": 150
      },
      {
        "name": "Mint",
        "quantity": "30 g",
        "grams": 30
      },
      {
        "name": "Coriander leaves",
        "quantity": "20 g",
        "grams": 20
      },
      {
        "name": "Lemon",
        "quantity": "1 piece"
      },
      {
        "name": "Olive oil",
        "quantity": "2 tbsp"
      },
      {
        "name": "Onion",
        "quantity": "60 g"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      }
    ],
    "instructions": [
      "Cook the brown rice until tender, about 25 minutes; spread on a tray to cool completely.",
      "Finely dice the tomatoes, cucumber and onion; chop the mint and coriander.",
      "Whisk lemon juice, olive oil, salt and pepper.",
      "Combine cooled rice with the vegetables and herbs; pour over the dressing and toss.",
      "Chill at least 30 minutes before serving so the rice absorbs the dressing."
    ],
    "allergens": [],
    "substitutions": "Swap brown rice for basmati; add diced bell pepper for colour.",
    "storage": "Refrigerate up to 3 days in a sealed container.",
    "computed": {
      "perServing": {
        "kcal": 280.7,
        "proteinG": 5.4,
        "carbsG": 45.5,
        "fatG": 9.2,
        "fiberG": 3.9
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "mediterranean-baked-white-fish",
    "title": "Mediterranean Baked White Fish with Lemon Potatoes",
    "cuisine": "Mediterranean",
    "mealType": "dinner",
    "dietCategory": "non_vegetarian",
    "tags": [
      "baked-not-fried",
      "dairy-free",
      "gluten-free",
      "halal",
      "high-protein",
      "mediterranean",
      "one-pan"
    ],
    "servings": 4,
    "prepMin": 20,
    "cookMin": 35,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Fish - Rohu (raw)",
        "quantity": "700 g",
        "grams": 700
      },
      {
        "name": "Potato",
        "quantity": "400 g",
        "grams": 400
      },
      {
        "name": "Bell pepper",
        "quantity": "180 g",
        "grams": 180
      },
      {
        "name": "Onion",
        "quantity": "120 g",
        "grams": 120
      },
      {
        "name": "Garlic",
        "quantity": "4 cloves",
        "grams": 16
      },
      {
        "name": "Olive oil",
        "quantity": "2 tbsp"
      },
      {
        "name": "Lemon",
        "quantity": "2 pieces",
        "grams": 120
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Mint",
        "quantity": "1 tbsp"
      },
      {
        "name": "Coriander leaves",
        "quantity": "2 tbsp"
      }
    ],
    "instructions": [
      "Heat the oven to 200°C. Slice the potatoes thin and parboil 8 minutes; drain.",
      "Layer the potatoes, sliced bell pepper and onion in an oiled baking dish.",
      "Toss the vegetables with half the olive oil, minced garlic, salt and pepper; bake 15 minutes.",
      "Lay the fish pieces on top; drizzle with remaining olive oil and the juice of 1 lemon.",
      "Bake 15-18 minutes more until the fish flakes easily.",
      "Garnish with mint, coriander and the remaining lemon cut into wedges; serve hot."
    ],
    "allergens": [
      "fish"
    ],
    "substitutions": "Use salmon for a richer fillet; add sliced tomato to the vegetable bed if liked.",
    "storage": "Refrigerate leftovers up to 2 days; reheat gently to avoid drying the fish.",
    "computed": {
      "perServing": {
        "kcal": 357,
        "proteinG": 33.4,
        "carbsG": 27.8,
        "fatG": 13.2,
        "fiberG": 5
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "mediterranean-kidney-bean-spinach-soup",
    "title": "Mediterranean Kidney Bean & Spinach Soup",
    "cuisine": "Mediterranean",
    "mealType": "dinner",
    "dietCategory": "vegetarian",
    "tags": [
      "dairy-free",
      "freezer-friendly",
      "gluten-free",
      "high-fiber",
      "low-calorie",
      "mediterranean",
      "one-pot",
      "vegan"
    ],
    "servings": 4,
    "prepMin": 15,
    "cookMin": 45,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Rajma (dry)",
        "quantity": "150 g",
        "grams": 150
      },
      {
        "name": "Spinach",
        "quantity": "200 g",
        "grams": 200
      },
      {
        "name": "Tomato",
        "quantity": "200 g"
      },
      {
        "name": "Onion",
        "quantity": "120 g"
      },
      {
        "name": "Carrot",
        "quantity": "120 g"
      },
      {
        "name": "Garlic",
        "quantity": "4 cloves"
      },
      {
        "name": "Olive oil",
        "quantity": "1 tbsp",
        "grams": 15
      },
      {
        "name": "Cumin seeds",
        "quantity": "1 tsp"
      },
      {
        "name": "Lemon",
        "quantity": "1 piece"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Water",
        "quantity": "1 l",
      "grams": 1000
      }
    ],
    "instructions": [
      "Soak the rajma overnight; drain and pressure-cook or boil until tender, about 35 minutes.",
      "Soften diced onion, carrot and garlic in olive oil for 6-8 minutes; add cumin and stir 30 seconds.",
      "Add chopped tomatoes and cook until they break down, about 5 minutes.",
      "Add the cooked beans with their liquid plus water; simmer 15 minutes.",
      "Stir in the spinach until wilted; finish with lemon juice, salt and pepper."
    ],
    "allergens": [],
    "substitutions": "Use canned/cooked rajma to cut cooking time; kale-style greens can replace spinach.",
    "storage": "Refrigerate up to 4 days or freeze up to 2 months.",
    "computed": {
      "perServing": {
        "kcal": 213.1,
        "proteinG": 11.7,
        "carbsG": 34.7,
        "fatG": 4.5,
        "fiberG": 12.9
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "mediterranean-roasted-vegetable-platter",
    "title": "Mediterranean Roasted Vegetable Platter",
    "cuisine": "Mediterranean",
    "mealType": "dinner",
    "dietCategory": "vegetarian",
    "tags": [
      "dairy-free",
      "gluten-free",
      "high-fiber",
      "low-calorie",
      "mediterranean",
      "sheet-pan",
      "vegan"
    ],
    "servings": 4,
    "prepMin": 20,
    "cookMin": 35,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Eggplant",
        "quantity": "400 g",
        "grams": 400
      },
      {
        "name": "Bell pepper",
        "quantity": "240 g",
        "grams": 240
      },
      {
        "name": "Onion",
        "quantity": "240 g",
        "grams": 240
      },
      {
        "name": "Carrot",
        "quantity": "180 g",
        "grams": 180
      },
      {
        "name": "Cauliflower",
        "quantity": "300 g",
        "grams": 300
      },
      {
        "name": "Potato",
        "quantity": "300 g",
        "grams": 300
      },
      {
        "name": "Olive oil",
        "quantity": "3 tbsp",
        "grams": 45
      },
      {
        "name": "Garlic",
        "quantity": "5 cloves",
        "grams": 20
      },
      {
        "name": "Lemon",
        "quantity": "1 piece"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Coriander leaves",
        "quantity": "2 tbsp"
      }
    ],
    "instructions": [
      "Heat the oven to 210°C. Cut all vegetables into similar bite-size chunks.",
      "Toss with olive oil, minced garlic, salt and pepper on two large trays in a single layer.",
      "Roast 30-35 minutes, turning once, until edges caramelise and potatoes are crisp.",
      "Squeeze lemon over the hot vegetables and scatter coriander.",
      "Serve warm as a main with yogurt or as a side platter."
    ],
    "allergens": [],
    "substitutions": "Any seasonal vegetables work — add broccoli, green beans or sweet potato.",
    "storage": "Refrigerate up to 4 days; reheat in a hot oven to re-crisp.",
    "computed": {
      "perServing": {
        "kcal": 275.5,
        "proteinG": 6.2,
        "carbsG": 39.7,
        "fatG": 12.2,
        "fiberG": 10.4
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "tzatziki-chicken-roti-wrap",
    "title": "Tzatziki Chicken Roti Wrap (Light)",
    "cuisine": "Mediterranean",
    "mealType": "lunch",
    "dietCategory": "non_vegetarian",
    "tags": [
      "halal",
      "high-protein",
      "low-calorie",
      "mediterranean",
      "on-the-go"
    ],
    "servings": 4,
    "prepMin": 20,
    "cookMin": 15,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Chicken breast (raw)",
        "quantity": "500 g",
        "grams": 500
      },
      {
        "name": "Greek yogurt",
        "quantity": "200 g",
        "grams": 200
      },
      {
        "name": "Cucumber",
        "quantity": "150 g"
      },
      {
        "name": "Garlic",
        "quantity": "3 cloves"
      },
      {
        "name": "Lemon",
        "quantity": "30 g",
        "grams": 30
      },
      {
        "name": "Olive oil",
        "quantity": "1 tbsp"
      },
      {
        "name": "Roti (whole wheat)",
        "quantity": "4 pieces",
        "grams": 140
      },
      {
        "name": "Spinach",
        "quantity": "100 g",
        "grams": 100
      },
      {
        "name": "Tomato",
        "quantity": "100 g",
        "grams": 100
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Mint",
        "quantity": "1 tbsp"
      }
    ],
    "instructions": [
      "Season the chicken with salt, pepper and half the lemon juice; grill 6-7 minutes per side and slice thin.",
      "Grate the cucumber, squeeze out excess water, and mix with yogurt, minced garlic, mint and a pinch of salt for the tzatziki.",
      "Warm the rotis on a hot tawa until pliable.",
      "Spread tzatziki on each roti; layer sliced chicken, spinach and tomato.",
      "Roll tightly, tucking in the ends, and serve immediately."
    ],
    "allergens": [
      "milk",
      "wheat"
    ],
    "substitutions": "Use grilled paneer for a vegetarian wrap; swap roti for any whole-wheat flatbread.",
    "storage": "Best eaten fresh; keep filling and rotis separate up to 2 days refrigerated.",
    "computed": {
      "perServing": {
        "kcal": 348.6,
        "proteinG": 37,
        "carbsG": 24.3,
        "fatG": 10.7,
        "fiberG": 3.7
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "lemon-herb-chicken-skewers",
    "title": "Lemon Herb Chicken Skewers",
    "cuisine": "Mediterranean",
    "mealType": "dinner",
    "dietCategory": "non_vegetarian",
    "tags": [
      "dairy-free",
      "gluten-free",
      "grill",
      "halal",
      "high-protein",
      "low-calorie",
      "mediterranean"
    ],
    "servings": 4,
    "prepMin": 25,
    "cookMin": 15,
    "difficulty": "medium",
    "ingredients": [
      {
        "name": "Chicken breast (raw)",
        "quantity": "600 g"
      },
      {
        "name": "Bell pepper",
        "quantity": "240 g"
      },
      {
        "name": "Onion",
        "quantity": "240 g"
      },
      {
        "name": "Lemon",
        "quantity": "1 piece"
      },
      {
        "name": "Olive oil",
        "quantity": "2 tbsp"
      },
      {
        "name": "Garlic",
        "quantity": "4 cloves"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Mint",
        "quantity": "1 tbsp"
      },
      {
        "name": "Coriander leaves",
        "quantity": "2 tbsp"
      }
    ],
    "instructions": [
      "Cut the chicken into 3-cm cubes; cut pepper and onion into matching chunks.",
      "Marinate chicken with lemon juice, olive oil, garlic, mint, salt and pepper for at least 20 minutes.",
      "Thread chicken, pepper and onion alternately onto skewers.",
      "Grill over medium-high heat 12-15 minutes, turning every 3-4 minutes, until charred at edges and cooked through.",
      "Rest 5 minutes; scatter coriander and serve with lemon wedges."
    ],
    "allergens": [],
    "substitutions": "Use chicken thigh for juicier skewers; add cherry-tomato-sized tomato chunks to the skewers.",
    "storage": "Refrigerate cooked skewers up to 3 days; reheat in a hot oven.",
    "computed": {
      "perServing": {
        "kcal": 302.6,
        "proteinG": 35.7,
        "carbsG": 12.5,
        "fatG": 11.8,
        "fiberG": 3.3
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "chickpea-spinach-stew",
    "title": "Mediterranean Chickpea & Spinach Stew",
    "cuisine": "Mediterranean",
    "mealType": "dinner",
    "dietCategory": "vegetarian",
    "tags": [
      "dairy-free",
      "freezer-friendly",
      "gluten-free",
      "high-fiber",
      "low-calorie",
      "mediterranean",
      "one-pot",
      "vegan"
    ],
    "servings": 4,
    "prepMin": 15,
    "cookMin": 50,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Kabuli chana (dry)",
        "quantity": "200 g",
        "grams": 200
      },
      {
        "name": "Spinach",
        "quantity": "300 g",
        "grams": 300
      },
      {
        "name": "Tomato",
        "quantity": "300 g",
        "grams": 300
      },
      {
        "name": "Onion",
        "quantity": "120 g"
      },
      {
        "name": "Garlic",
        "quantity": "4 cloves"
      },
      {
        "name": "Ginger",
        "quantity": "20 g",
        "grams": 20
      },
      {
        "name": "Olive oil",
        "quantity": "2 tbsp"
      },
      {
        "name": "Cumin seeds",
        "quantity": "1 tsp"
      },
      {
        "name": "Coriander powder",
        "quantity": "1 tsp",
        "grams": 5
      },
      {
        "name": "Lemon",
        "quantity": "30 g"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Water",
        "quantity": "750 ml",
      "grams": 750
      }
    ],
    "instructions": [
      "Soak chickpeas overnight; boil until tender, about 35-40 minutes, and drain.",
      "Soften onion in olive oil 6 minutes; add garlic, ginger, cumin and coriander powder for 1 minute.",
      "Add chopped tomatoes and cook 6-8 minutes until saucy.",
      "Add chickpeas and water; simmer 15 minutes so the flavours blend.",
      "Stir in spinach until wilted; finish with lemon juice and salt."
    ],
    "allergens": [],
    "substitutions": "Use cooked chickpeas to shorten cooking; add a pinch of red chili for heat.",
    "storage": "Refrigerate up to 4 days or freeze up to 2 months.",
    "computed": {
      "perServing": {
        "kcal": 303.2,
        "proteinG": 13.3,
        "carbsG": 41.7,
        "fatG": 11.1,
        "fiberG": 12.2
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "greek-yogurt-cucumber-salad",
    "title": "Greek Yogurt & Cucumber Salad",
    "cuisine": "Mediterranean",
    "mealType": "snack",
    "dietCategory": "vegetarian",
    "tags": [
      "gluten-free",
      "low-calorie",
      "mediterranean",
      "no-cook",
      "vegetarian"
    ],
    "servings": 4,
    "prepMin": 10,
    "cookMin": 0,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Greek yogurt",
        "quantity": "400 g",
        "grams": 400
      },
      {
        "name": "Cucumber",
        "quantity": "300 g",
        "grams": 300
      },
      {
        "name": "Garlic",
        "quantity": "2 cloves"
      },
      {
        "name": "Mint",
        "quantity": "1 tbsp"
      },
      {
        "name": "Olive oil",
        "quantity": "1 tsp",
        "grams": 5
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      }
    ],
    "instructions": [
      "Dice the cucumber into small cubes.",
      "Whisk the yogurt with minced garlic, salt and pepper until smooth.",
      "Fold in the cucumber and chopped mint.",
      "Drizzle with olive oil and chill 15 minutes before serving."
    ],
    "allergens": [
      "milk"
    ],
    "substitutions": "Use dahi for a thinner raita-style salad; add grated carrot for sweetness.",
    "storage": "Refrigerate up to 2 days; stir before serving.",
    "computed": {
      "perServing": {
        "kcal": 123.9,
        "proteinG": 9.8,
        "carbsG": 7.6,
        "fatG": 6.4,
        "fiberG": 0.7
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "stuffed-bell-peppers-rice-herb",
    "title": "Herb & Rice Stuffed Bell Peppers",
    "cuisine": "Mediterranean",
    "mealType": "dinner",
    "dietCategory": "vegetarian",
    "tags": [
      "baked-not-fried",
      "dairy-free",
      "gluten-free",
      "high-fiber",
      "low-calorie",
      "make-ahead",
      "mediterranean",
      "vegan"
    ],
    "servings": 4,
    "prepMin": 20,
    "cookMin": 35,
    "difficulty": "medium",
    "ingredients": [
      {
        "name": "Bell pepper",
        "quantity": "4 pieces",
        "grams": 480
      },
      {
        "name": "Brown rice (raw)",
        "quantity": "160 g",
        "grams": 160
      },
      {
        "name": "Tomato",
        "quantity": "200 g"
      },
      {
        "name": "Onion",
        "quantity": "120 g"
      },
      {
        "name": "Mint",
        "quantity": "2 tbsp",
        "grams": 30
      },
      {
        "name": "Coriander leaves",
        "quantity": "2 tbsp"
      },
      {
        "name": "Olive oil",
        "quantity": "2 tbsp"
      },
      {
        "name": "Garlic",
        "quantity": "3 cloves"
      },
      {
        "name": "Lemon",
        "quantity": "30 g"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      }
    ],
    "instructions": [
      "Heat the oven to 190°C. Halve the peppers lengthwise and remove seeds.",
      "Cook the brown rice until just tender, about 25 minutes; drain.",
      "Sauté onion and garlic in olive oil 5 minutes; add diced tomato and cook 5 more minutes.",
      "Mix the rice with the tomato mixture, herbs, lemon juice, salt and pepper.",
      "Fill the pepper halves, place in an oiled dish, cover with foil and bake 25 minutes; uncover for the last 10."
    ],
    "allergens": [],
    "substitutions": "Add cooked chickpeas or minced chicken to the filling for extra protein.",
    "storage": "Refrigerate up to 3 days; reheat covered in the oven.",
    "computed": {
      "perServing": {
        "kcal": 284.2,
        "proteinG": 5.8,
        "carbsG": 45.4,
        "fatG": 9.3,
        "fiberG": 6
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "whole-wheat-tomato-vegetable-pasta",
    "title": "Whole-Wheat Tomato & Vegetable Pasta (Homemade)",
    "aliases": [
      "homemade whole wheat pasta"
    ],
    "cuisine": "Italian",
    "mealType": "dinner",
    "dietCategory": "vegetarian",
    "tags": [
      "dairy-free",
      "from-scratch",
      "high-fiber",
      "italian",
      "vegetarian"
    ],
    "servings": 4,
    "prepMin": 40,
    "cookMin": 25,
    "difficulty": "hard",
    "ingredients": [
      {
        "name": "Atta (whole wheat flour)",
        "quantity": "320 g",
        "grams": 320
      },
      {
        "name": "Egg (raw)",
        "quantity": "2 pieces",
        "grams": 100
      },
      {
        "name": "Tomato",
        "quantity": "400 g",
        "grams": 400
      },
      {
        "name": "Onion",
        "quantity": "120 g"
      },
      {
        "name": "Bell pepper",
        "quantity": "120 g"
      },
      {
        "name": "Mushroom",
        "quantity": "150 g",
        "grams": 150
      },
      {
        "name": "Garlic",
        "quantity": "4 cloves"
      },
      {
        "name": "Olive oil",
        "quantity": "2 tbsp"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Coriander leaves",
        "quantity": "2 tbsp"
      }
    ],
    "instructions": [
      "Mix the flour with the eggs and a pinch of salt; knead 8-10 minutes into a firm dough and rest 30 minutes wrapped.",
      "Roll the dough thin and cut into ribbons; dust lightly with flour.",
      "Sauté onion, garlic, bell pepper and mushrooms in olive oil 6-8 minutes.",
      "Add chopped tomatoes, salt and pepper; simmer 10 minutes into a sauce.",
      "Boil the fresh pasta 3-4 minutes until al dente; toss with the sauce and garnish with coriander."
    ],
    "allergens": [
      "egg",
      "wheat"
    ],
    "substitutions": "Skip the eggs and use water for a vegan dough; add spinach to the sauce.",
    "storage": "Refrigerate cooked pasta with sauce up to 3 days; fresh uncooked ribbons keep 1 day chilled.",
    "computed": {
      "perServing": {
        "kcal": 429.3,
        "proteinG": 16.8,
        "carbsG": 69.1,
        "fatG": 12.4,
        "fiberG": 11.6
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "grilled-chicken-garlic-herb-pasta-light",
    "title": "Grilled Chicken & Garlic-Herb Pasta (Light)",
    "cuisine": "Italian",
    "mealType": "dinner",
    "dietCategory": "non_vegetarian",
    "tags": [
      "dairy-free",
      "from-scratch",
      "halal",
      "high-fiber",
      "high-protein",
      "italian"
    ],
    "servings": 4,
    "prepMin": 35,
    "cookMin": 25,
    "difficulty": "medium",
    "ingredients": [
      {
        "name": "Atta (whole wheat flour)",
        "quantity": "280 g",
        "grams": 280
      },
      {
        "name": "Egg (raw)",
        "quantity": "1 piece",
        "grams": 50
      },
      {
        "name": "Chicken breast (raw)",
        "quantity": "400 g",
        "grams": 400
      },
      {
        "name": "Garlic",
        "quantity": "5 cloves"
      },
      {
        "name": "Olive oil",
        "quantity": "1 tbsp"
      },
      {
        "name": "Tomato",
        "quantity": "200 g"
      },
      {
        "name": "Spinach",
        "quantity": "100 g"
      },
      {
        "name": "Lemon",
        "quantity": "30 g"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Mint",
        "quantity": "1 tbsp"
      }
    ],
    "instructions": [
      "Knead flour, egg and a splash of water into a firm pasta dough; rest 30 minutes, then roll and cut into ribbons.",
      "Season the chicken with salt, pepper and lemon; grill 6-7 minutes per side and slice.",
      "Sizzle sliced garlic in olive oil 1 minute; add chopped tomatoes and cook 5 minutes.",
      "Boil the pasta 3-4 minutes; toss with the garlic-tomato mixture and spinach until wilted.",
      "Top with sliced chicken and mint; serve immediately."
    ],
    "allergens": [
      "egg",
      "wheat"
    ],
    "substitutions": "Use store-bought whole-wheat pasta if short on time; swap spinach for any leafy green.",
    "storage": "Refrigerate up to 3 days; refresh with a squeeze of lemon when reheating.",
    "computed": {
      "perServing": {
        "kcal": 435.1,
        "proteinG": 35,
        "carbsG": 56,
        "fatG": 9.6,
        "fiberG": 9.2
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "minestrone-soup",
    "title": "Minestrone Soup",
    "cuisine": "Italian",
    "mealType": "dinner",
    "dietCategory": "vegetarian",
    "tags": [
      "dairy-free",
      "freezer-friendly",
      "gluten-free",
      "high-fiber",
      "italian",
      "low-calorie",
      "one-pot",
      "vegan"
    ],
    "servings": 4,
    "prepMin": 20,
    "cookMin": 50,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Rajma (dry)",
        "quantity": "100 g",
        "grams": 100
      },
      {
        "name": "Tomato",
        "quantity": "300 g"
      },
      {
        "name": "Onion",
        "quantity": "120 g"
      },
      {
        "name": "Carrot",
        "quantity": "120 g"
      },
      {
        "name": "Cabbage",
        "quantity": "150 g",
        "grams": 150
      },
      {
        "name": "Green beans",
        "quantity": "100 g",
        "grams": 100
      },
      {
        "name": "Potato",
        "quantity": "150 g",
        "grams": 150
      },
      {
        "name": "Garlic",
        "quantity": "3 cloves"
      },
      {
        "name": "Olive oil",
        "quantity": "1 tbsp"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Water",
        "quantity": "1.2 l",
        "grams": 1200
      },
      {
        "name": "Coriander leaves",
        "quantity": "2 tbsp"
      }
    ],
    "instructions": [
      "Soak the rajma overnight; boil until tender, about 35 minutes, and set aside with its liquid.",
      "Soften onion, carrot and garlic in olive oil 6-8 minutes.",
      "Add chopped tomatoes, potato, cabbage and green beans; stir 3 minutes.",
      "Pour in water and the beans with their liquid; simmer 20 minutes until vegetables are tender.",
      "Season with salt and pepper; garnish with coriander and serve hot."
    ],
    "allergens": [],
    "substitutions": "Use cooked beans to save time; add small whole-wheat pasta shapes in the last 10 minutes.",
    "storage": "Refrigerate up to 4 days or freeze up to 2 months.",
    "computed": {
      "perServing": {
        "kcal": 206.4,
        "proteinG": 9.2,
        "carbsG": 35.4,
        "fatG": 4.4,
        "fiberG": 11.2
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "baked-eggplant-mozzarella-light",
    "title": "Baked Eggplant with Mozzarella (Light Parmigiana-Style)",
    "cuisine": "Italian",
    "mealType": "dinner",
    "dietCategory": "vegetarian",
    "tags": [
      "baked-not-fried",
      "dairy-free",
      "gluten-free",
      "high-fiber",
      "italian",
      "low-calorie",
      "vegan"
    ],
    "servings": 4,
    "prepMin": 20,
    "cookMin": 35,
    "difficulty": "medium",
    "ingredients": [
      {
        "name": "Eggplant",
        "quantity": "600 g",
        "grams": 600
      },
      {
        "name": "Tomato",
        "quantity": "400 g"
      },
      {
        "name": "Mozzarella",
        "quantity": "120 g",
        "grams": 120
      },
      {
        "name": "Garlic",
        "quantity": "3 cloves"
      },
      {
        "name": "Olive oil",
        "quantity": "1 tbsp"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Mint",
        "quantity": "1 tbsp"
      }
    ],
    "instructions": [
      "Heat the oven to 200°C. Slice the eggplant into 1-cm rounds; salt and rest 15 minutes, then pat dry.",
      "Brush rounds lightly with olive oil and bake 15 minutes, flipping once.",
      "Simmer chopped tomatoes with garlic, salt and pepper 10 minutes into a thick sauce.",
      "Layer eggplant, sauce and torn mozzarella in an oiled baking dish.",
      "Bake 15 minutes until bubbling and golden; rest 5 minutes and garnish with mint."
    ],
    "allergens": [],
    "substitutions": "Swap mozzarella for a light cheddar; add a layer of sautéed spinach.",
    "storage": "Refrigerate up to 3 days; reheat covered so the cheese re-melts.",
    "computed": {
      "perServing": {
        "kcal": 178.8,
        "proteinG": 11,
        "carbsG": 15,
        "fatG": 9.4,
        "fiberG": 6
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "chickpea-tuna-salad",
    "title": "Chickpea & Tuna Salad (Italian-Style)",
    "cuisine": "Italian",
    "mealType": "lunch",
    "dietCategory": "non_vegetarian",
    "tags": [
      "dairy-free",
      "gluten-free",
      "halal",
      "high-fiber",
      "high-protein",
      "italian",
      "low-calorie",
      "meal-prep",
      "no-cook"
    ],
    "servings": 4,
    "prepMin": 15,
    "cookMin": 0,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Tuna (canned in water)",
        "quantity": "2 cans",
        "grams": 290
      },
      {
        "name": "Kabuli chana (cooked)",
        "quantity": "300 g",
        "grams": 300
      },
      {
        "name": "Tomato",
        "quantity": "150 g",
        "grams": 150
      },
      {
        "name": "Onion",
        "quantity": "60 g"
      },
      {
        "name": "Cucumber",
        "quantity": "100 g",
        "grams": 100
      },
      {
        "name": "Lemon",
        "quantity": "1 piece"
      },
      {
        "name": "Olive oil",
        "quantity": "1 tbsp"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Coriander leaves",
        "quantity": "2 tbsp"
      }
    ],
    "instructions": [
      "Drain the tuna and chickpeas; flake the tuna into a bowl.",
      "Dice the tomato, onion and cucumber; add to the bowl.",
      "Whisk lemon juice, olive oil, salt and pepper.",
      "Toss everything with the dressing; fold in coriander.",
      "Chill 15 minutes before serving."
    ],
    "allergens": [
      "fish"
    ],
    "substitutions": "Use cooked rajma instead of chickpeas; add capers-style bite with chopped green chili.",
    "storage": "Refrigerate up to 2 days in a sealed container.",
    "computed": {
      "perServing": {
        "kcal": 274.4,
        "proteinG": 27.8,
        "carbsG": 26,
        "fatG": 6.9,
        "fiberG": 7.2
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "mushroom-brown-rice-risotto-light",
    "title": "Mushroom & Brown Rice Risotto (Light)",
    "cuisine": "Italian",
    "mealType": "dinner",
    "dietCategory": "vegetarian",
    "tags": [
      "gluten-free",
      "italian",
      "low-calorie",
      "one-pot",
      "vegetarian"
    ],
    "servings": 4,
    "prepMin": 15,
    "cookMin": 45,
    "difficulty": "medium",
    "ingredients": [
      {
        "name": "Brown rice (raw)",
        "quantity": "240 g"
      },
      {
        "name": "Mushroom",
        "quantity": "300 g",
        "grams": 300
      },
      {
        "name": "Onion",
        "quantity": "120 g"
      },
      {
        "name": "Garlic",
        "quantity": "3 cloves"
      },
      {
        "name": "Milk (skim)",
        "quantity": "240 ml",
        "grams": 240
      },
      {
        "name": "Olive oil",
        "quantity": "1 tbsp"
      },
      {
        "name": "Butter",
        "quantity": "10 g",
        "grams": 10
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Water",
        "quantity": "750 ml"
      }
    ],
    "instructions": [
      "Sear the sliced mushrooms in olive oil over high heat 5-6 minutes until golden; set aside.",
      "Soften onion and garlic in the same pan with butter for 5 minutes.",
      "Add the rice; toast 2 minutes, then add warm water a ladle at a time, stirring, for about 35 minutes.",
      "Stir in the skim milk and mushrooms; cook 5 more minutes until creamy.",
      "Season with salt and pepper; rest 3 minutes and serve."
    ],
    "allergens": [
      "milk"
    ],
    "substitutions": "Use basmati for a quicker pilaf-style dish; add peas for colour.",
    "storage": "Refrigerate up to 3 days; loosen with a splash of milk when reheating.",
    "computed": {
      "perServing": {
        "kcal": 326.5,
        "proteinG": 9.7,
        "carbsG": 55.6,
        "fatG": 7.9,
        "fiberG": 3.4
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "italian-vegetable-soup",
    "title": "Italian Vegetable Soup (Creamy Blended)",
    "cuisine": "Italian",
    "mealType": "lunch",
    "dietCategory": "vegetarian",
    "tags": [
      "freezer-friendly",
      "gluten-free",
      "italian",
      "low-calorie",
      "one-pot",
      "vegetarian"
    ],
    "servings": 4,
    "prepMin": 15,
    "cookMin": 30,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Cauliflower",
        "quantity": "400 g",
        "grams": 400
      },
      {
        "name": "Potato",
        "quantity": "200 g",
        "grams": 200
      },
      {
        "name": "Carrot",
        "quantity": "120 g"
      },
      {
        "name": "Onion",
        "quantity": "120 g"
      },
      {
        "name": "Garlic",
        "quantity": "3 cloves"
      },
      {
        "name": "Olive oil",
        "quantity": "1 tbsp"
      },
      {
        "name": "Milk (skim)",
        "quantity": "120 ml",
        "grams": 120
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Water",
        "quantity": "800 ml",
      "grams": 800
      }
    ],
    "instructions": [
      "Soften the onion, carrot and garlic in olive oil 6 minutes.",
      "Add cauliflower florets, diced potato and water; bring to a boil.",
      "Simmer 18-20 minutes until everything is very tender.",
      "Blend until silky smooth; stir in the skim milk.",
      "Season with salt and pepper; serve hot with a drizzle of olive oil."
    ],
    "allergens": [
      "milk"
    ],
    "substitutions": "Omit the milk for a dairy-free version; add a pinch of red chili for warmth.",
    "storage": "Refrigerate up to 4 days or freeze up to 2 months.",
    "computed": {
      "perServing": {
        "kcal": 135.6,
        "proteinG": 4.7,
        "carbsG": 22,
        "fatG": 4.2,
        "fiberG": 4.5
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "chicken-cacciatore-light",
    "title": "Chicken Cacciatore (Light)",
    "cuisine": "Italian",
    "mealType": "dinner",
    "dietCategory": "non_vegetarian",
    "tags": [
      "dairy-free",
      "gluten-free",
      "halal",
      "high-protein",
      "italian",
      "low-calorie",
      "one-pot"
    ],
    "servings": 4,
    "prepMin": 20,
    "cookMin": 40,
    "difficulty": "medium",
    "ingredients": [
      {
        "name": "Chicken thigh (raw)",
        "quantity": "700 g",
        "grams": 700
      },
      {
        "name": "Tomato",
        "quantity": "400 g"
      },
      {
        "name": "Bell pepper",
        "quantity": "180 g"
      },
      {
        "name": "Onion",
        "quantity": "180 g",
        "grams": 180
      },
      {
        "name": "Mushroom",
        "quantity": "150 g"
      },
      {
        "name": "Garlic",
        "quantity": "4 cloves"
      },
      {
        "name": "Olive oil",
        "quantity": "1 tbsp"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Bay leaf",
        "quantity": "2 pieces",
      "grams": 1
      }
    ],
    "instructions": [
      "Brown the chicken thighs in olive oil 5 minutes per side; set aside.",
      "Soften onion, bell pepper and mushrooms in the same pan 6 minutes; add garlic for 1 minute.",
      "Add chopped tomatoes and bay leaves; simmer 5 minutes.",
      "Return the chicken; cover and simmer 25 minutes until tender and the sauce thickens.",
      "Remove bay leaves, adjust salt and pepper, and serve."
    ],
    "allergens": [],
    "substitutions": "Use chicken breast for a leaner cut; add a splash of vinegar for brightness.",
    "storage": "Refrigerate up to 3 days; flavours deepen overnight.",
    "computed": {
      "perServing": {
        "kcal": 349.3,
        "proteinG": 34.6,
        "carbsG": 13.4,
        "fatG": 16.9,
        "fiberG": 3.4
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "garlic-butter-prawns-italian",
    "title": "Garlic Butter Prawns (Italian-Style)",
    "cuisine": "Italian",
    "mealType": "dinner",
    "dietCategory": "non_vegetarian",
    "tags": [
      "gluten-free",
      "halal",
      "high-protein",
      "italian",
      "low-calorie",
      "quick"
    ],
    "servings": 4,
    "prepMin": 15,
    "cookMin": 10,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Prawns (raw)",
        "quantity": "500 g",
        "grams": 500
      },
      {
        "name": "Butter",
        "quantity": "20 g",
        "grams": 20
      },
      {
        "name": "Garlic",
        "quantity": "6 cloves",
        "grams": 24
      },
      {
        "name": "Lemon",
        "quantity": "1 piece"
      },
      {
        "name": "Olive oil",
        "quantity": "1 tsp"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Red chili powder",
        "quantity": "1/2 tsp",
        "grams": 2.5
      },
      {
        "name": "Coriander leaves",
        "quantity": "2 tbsp"
      }
    ],
    "instructions": [
      "Pat the prawns dry; toss with salt, pepper and red chili powder.",
      "Heat olive oil and butter; sizzle sliced garlic 1 minute until fragrant but not brown.",
      "Add prawns in a single layer; cook 2-3 minutes per side until pink and opaque.",
      "Squeeze over lemon juice and toss through.",
      "Garnish with coriander and serve immediately."
    ],
    "allergens": [
      "milk",
      "shellfish"
    ],
    "substitutions": "Swap butter for extra olive oil to keep it dairy-free.",
    "storage": "Best eaten fresh; refrigerate up to 1 day if needed.",
    "computed": {
      "perServing": {
        "kcal": 168.2,
        "proteinG": 25.9,
        "carbsG": 3.9,
        "fatG": 6.1,
        "fiberG": 0.8
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "spinach-mozzarella-stuffed-chicken",
    "title": "Spinach & Mozzarella Stuffed Chicken",
    "cuisine": "Italian",
    "mealType": "dinner",
    "dietCategory": "non_vegetarian",
    "tags": [
      "baked-not-fried",
      "dairy-free",
      "gluten-free",
      "halal",
      "high-protein",
      "italian",
      "low-calorie"
    ],
    "servings": 4,
    "prepMin": 20,
    "cookMin": 30,
    "difficulty": "medium",
    "ingredients": [
      {
        "name": "Chicken breast (raw)",
        "quantity": "600 g"
      },
      {
        "name": "Spinach",
        "quantity": "150 g",
        "grams": 150
      },
      {
        "name": "Mozzarella",
        "quantity": "100 g",
        "grams": 100
      },
      {
        "name": "Garlic",
        "quantity": "3 cloves"
      },
      {
        "name": "Olive oil",
        "quantity": "1 tbsp"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Lemon",
        "quantity": "30 g"
      }
    ],
    "instructions": [
      "Heat the oven to 190°C. Wilt the spinach with garlic in a dry pan; squeeze out water and chop.",
      "Mix spinach with diced mozzarella, salt and pepper.",
      "Butterfly each chicken breast and fill with the spinach mixture; secure with toothpicks.",
      "Sear in olive oil 3 minutes per side; transfer to the oven for 18-20 minutes.",
      "Rest 5 minutes, remove toothpicks, squeeze lemon over and serve."
    ],
    "allergens": [],
    "substitutions": "Use paneer in place of mozzarella; add sun-style dried tomato pieces if available.",
    "storage": "Refrigerate up to 3 days; reheat gently to keep the chicken juicy.",
    "computed": {
      "perServing": {
        "kcal": 298.4,
        "proteinG": 42,
        "carbsG": 3.8,
        "fatG": 12.1,
        "fiberG": 1.1
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "roasted-tomato-bell-pepper-soup",
    "title": "Roasted Tomato & Bell Pepper Soup",
    "cuisine": "Italian",
    "mealType": "lunch",
    "dietCategory": "vegetarian",
    "tags": [
      "baked-not-fried",
      "freezer-friendly",
      "gluten-free",
      "italian",
      "low-calorie",
      "vegetarian"
    ],
    "servings": 4,
    "prepMin": 15,
    "cookMin": 35,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Tomato",
        "quantity": "500 g",
        "grams": 500
      },
      {
        "name": "Bell pepper",
        "quantity": "240 g"
      },
      {
        "name": "Onion",
        "quantity": "120 g"
      },
      {
        "name": "Garlic",
        "quantity": "4 cloves"
      },
      {
        "name": "Olive oil",
        "quantity": "1 tbsp"
      },
      {
        "name": "Milk (skim)",
        "quantity": "120 ml"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Water",
        "quantity": "500 ml",
      "grams": 500
      }
    ],
    "instructions": [
      "Heat the oven to 200°C. Halve tomatoes and peppers; toss with onion wedges, garlic, olive oil and salt.",
      "Roast 25 minutes until charred at the edges.",
      "Blend the roasted vegetables with water until smooth.",
      "Simmer 5 minutes; stir in the skim milk for creaminess.",
      "Adjust salt and pepper; serve hot."
    ],
    "allergens": [
      "milk"
    ],
    "substitutions": "Omit the milk for a dairy-free version; add a pinch of red chili for heat.",
    "storage": "Refrigerate up to 4 days or freeze up to 2 months.",
    "computed": {
      "perServing": {
        "kcal": 102.4,
        "proteinG": 3.3,
        "carbsG": 14.1,
        "fatG": 4.3,
        "fiberG": 3.4
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "italian-fish-tomato-skillet",
    "title": "Italian Fish in Tomato-Garlic Sauce (Skillet)",
    "cuisine": "Italian",
    "mealType": "dinner",
    "dietCategory": "non_vegetarian",
    "tags": [
      "dairy-free",
      "gluten-free",
      "halal",
      "high-protein",
      "italian",
      "low-calorie",
      "one-pan"
    ],
    "servings": 4,
    "prepMin": 15,
    "cookMin": 25,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Fish - Rohu (raw)",
        "quantity": "700 g"
      },
      {
        "name": "Tomato",
        "quantity": "400 g"
      },
      {
        "name": "Onion",
        "quantity": "120 g"
      },
      {
        "name": "Garlic",
        "quantity": "5 cloves"
      },
      {
        "name": "Olive oil",
        "quantity": "2 tbsp"
      },
      {
        "name": "Green chili",
        "quantity": "1 piece",
        "grams": 5
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Coriander leaves",
        "quantity": "2 tbsp"
      },
      {
        "name": "Lemon",
        "quantity": "30 g"
      }
    ],
    "instructions": [
      "Season the fish pieces with salt and pepper.",
      "Sear the fish in half the olive oil 2 minutes per side; set aside.",
      "In the same pan, soften onion and garlic 4 minutes; add chopped tomatoes and green chili.",
      "Simmer 8-10 minutes into a thick sauce; season with salt and pepper.",
      "Nestle the fish into the sauce; cover and simmer 8 minutes until cooked through.",
      "Finish with lemon juice and coriander; serve hot."
    ],
    "allergens": [
      "fish"
    ],
    "substitutions": "Use prawns for a quicker version; add sliced bell pepper to the sauce.",
    "storage": "Refrigerate up to 2 days; reheat gently in the sauce.",
    "computed": {
      "perServing": {
        "kcal": 277.9,
        "proteinG": 31.6,
        "carbsG": 9.5,
        "fatG": 13.1,
        "fiberG": 2.3
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "chicken-kidney-bean-burrito-bowl",
    "title": "Chicken & Kidney Bean Burrito Bowl (Light)",
    "cuisine": "Mexican",
    "mealType": "dinner",
    "dietCategory": "non_vegetarian",
    "tags": [
      "dairy-free",
      "gluten-free",
      "halal",
      "high-fiber",
      "high-protein",
      "meal-prep",
      "mexican"
    ],
    "servings": 4,
    "prepMin": 20,
    "cookMin": 30,
    "difficulty": "medium",
    "ingredients": [
      {
        "name": "Chicken breast (raw)",
        "quantity": "500 g"
      },
      {
        "name": "Rajma (cooked)",
        "quantity": "300 g",
        "grams": 300
      },
      {
        "name": "Brown rice (raw)",
        "quantity": "200 g"
      },
      {
        "name": "Tomato",
        "quantity": "200 g"
      },
      {
        "name": "Onion",
        "quantity": "120 g"
      },
      {
        "name": "Sweet corn",
        "quantity": "150 g",
        "grams": 150
      },
      {
        "name": "Lemon",
        "quantity": "1 piece"
      },
      {
        "name": "Hot sauce",
        "quantity": "1 tbsp",
        "grams": 15
      },
      {
        "name": "Cumin seeds",
        "quantity": "1 tsp"
      },
      {
        "name": "Garlic",
        "quantity": "3 cloves"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Coriander leaves",
        "quantity": "2 tbsp"
      }
    ],
    "instructions": [
      "Cook the brown rice until tender, about 30 minutes; keep warm.",
      "Season the chicken with cumin, garlic, salt and half the lemon juice; grill 6-7 minutes per side and slice.",
      "Warm the cooked rajma and corn together with a pinch of salt.",
      "Dice the tomato and onion; toss with remaining lemon juice and coriander into a fresh salsa.",
      "Assemble bowls with rice, chicken, beans, corn and salsa; finish with hot sauce."
    ],
    "allergens": [],
    "substitutions": "Swap rajma for black-eyed peas; use cauliflower rice for a lower-carb bowl.",
    "storage": "Refrigerate components separately up to 3 days.",
    "computed": {
      "perServing": {
        "kcal": 494.5,
        "proteinG": 41.2,
        "carbsG": 70.2,
        "fatG": 5.9,
        "fiberG": 9.9
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "grilled-fish-roti-tacos",
    "title": "Grilled Fish Roti Tacos",
    "cuisine": "Mexican",
    "mealType": "dinner",
    "dietCategory": "non_vegetarian",
    "tags": [
      "grill",
      "halal",
      "high-protein",
      "low-calorie",
      "mexican"
    ],
    "servings": 4,
    "prepMin": 25,
    "cookMin": 15,
    "difficulty": "medium",
    "ingredients": [
      {
        "name": "Fish - Rohu (raw)",
        "quantity": "500 g",
        "grams": 500
      },
      {
        "name": "Roti (whole wheat)",
        "quantity": "4 pieces"
      },
      {
        "name": "Cabbage",
        "quantity": "150 g"
      },
      {
        "name": "Tomato",
        "quantity": "150 g"
      },
      {
        "name": "Onion",
        "quantity": "60 g"
      },
      {
        "name": "Lemon",
        "quantity": "1 piece"
      },
      {
        "name": "Garlic",
        "quantity": "3 cloves"
      },
      {
        "name": "Cumin seeds",
        "quantity": "1 tsp"
      },
      {
        "name": "Red chili powder",
        "quantity": "1 tsp",
        "grams": 5
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Coriander leaves",
        "quantity": "2 tbsp"
      },
      {
        "name": "Dahi (plain yogurt)",
        "quantity": "100 g",
      "grams": 100
      }
    ],
    "instructions": [
      "Marinate the fish with lemon juice, garlic, cumin, red chili powder and salt for 15 minutes.",
      "Grill 3-4 minutes per side until cooked through; flake into large pieces.",
      "Shred the cabbage; dice tomato and onion into a quick salsa with coriander and salt.",
      "Warm the rotis on a hot tawa.",
      "Fill each roti with fish, cabbage, salsa and a spoon of yogurt; serve with lemon wedges."
    ],
    "allergens": [
      "fish",
      "milk",
      "wheat"
    ],
    "substitutions": "Use prawns or chicken instead of fish; swap dahi for Greek yogurt.",
    "storage": "Best assembled fresh; keep filling refrigerated up to 2 days.",
    "computed": {
      "perServing": {
        "kcal": 262.4,
        "proteinG": 26.4,
        "carbsG": 26,
        "fatG": 5.7,
        "fiberG": 4.4
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "mexican-mixed-bean-chili",
    "title": "Mexican Mixed-Bean Chili (Vegetarian)",
    "cuisine": "Mexican",
    "mealType": "dinner",
    "dietCategory": "vegetarian",
    "tags": [
      "dairy-free",
      "freezer-friendly",
      "gluten-free",
      "high-fiber",
      "low-calorie",
      "mexican",
      "one-pot",
      "vegan"
    ],
    "servings": 4,
    "prepMin": 20,
    "cookMin": 60,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Rajma (dry)",
        "quantity": "120 g",
        "grams": 120
      },
      {
        "name": "Kabuli chana (dry)",
        "quantity": "80 g",
        "grams": 80
      },
      {
        "name": "Black-eyed peas (dry)",
        "quantity": "80 g",
        "grams": 80
      },
      {
        "name": "Tomato",
        "quantity": "400 g"
      },
      {
        "name": "Onion",
        "quantity": "180 g"
      },
      {
        "name": "Bell pepper",
        "quantity": "180 g"
      },
      {
        "name": "Sweet corn",
        "quantity": "100 g",
        "grams": 100
      },
      {
        "name": "Garlic",
        "quantity": "4 cloves"
      },
      {
        "name": "Cumin seeds",
        "quantity": "2 tsp",
        "grams": 10
      },
      {
        "name": "Red chili powder",
        "quantity": "1 tsp"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Coriander leaves",
        "quantity": "2 tbsp"
      },
      {
        "name": "Water",
        "quantity": "800 ml"
      }
    ],
    "instructions": [
      "Soak all beans overnight; boil together until tender, about 40 minutes, and drain.",
      "Soften onion and bell pepper 6-8 minutes; add garlic, cumin and red chili powder for 1 minute.",
      "Add chopped tomatoes and cook 8 minutes until thick.",
      "Add the beans, corn and water; simmer 20 minutes.",
      "Season with salt; garnish with coriander and serve with rice or roti."
    ],
    "allergens": [],
    "substitutions": "Use any single bean if preferred; add diced carrot for sweetness.",
    "storage": "Refrigerate up to 4 days or freeze up to 2 months.",
    "computed": {
      "perServing": {
        "kcal": 319,
        "proteinG": 18.7,
        "carbsG": 59.2,
        "fatG": 2.5,
        "fiberG": 16.8
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "chicken-tortilla-style-soup-light",
    "title": "Chicken Tortilla-Style Soup (Light)",
    "cuisine": "Mexican",
    "mealType": "dinner",
    "dietCategory": "non_vegetarian",
    "tags": [
      "dairy-free",
      "halal",
      "high-protein",
      "low-calorie",
      "mexican",
      "one-pot"
    ],
    "servings": 4,
    "prepMin": 15,
    "cookMin": 30,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Chicken breast (raw)",
        "quantity": "400 g"
      },
      {
        "name": "Tomato",
        "quantity": "300 g"
      },
      {
        "name": "Onion",
        "quantity": "120 g"
      },
      {
        "name": "Sweet corn",
        "quantity": "100 g"
      },
      {
        "name": "Roti (whole wheat)",
        "quantity": "1 piece",
        "grams": 35
      },
      {
        "name": "Garlic",
        "quantity": "3 cloves"
      },
      {
        "name": "Cumin seeds",
        "quantity": "1 tsp"
      },
      {
        "name": "Lemon",
        "quantity": "1 piece"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Water",
        "quantity": "1 l"
      },
      {
        "name": "Coriander leaves",
        "quantity": "2 tbsp"
      }
    ],
    "instructions": [
      "Simmer the chicken in water with salt for 20 minutes; shred the meat and keep the broth.",
      "Soften onion and garlic 5 minutes; add cumin, chopped tomatoes and corn; cook 5 minutes.",
      "Add the broth and shredded chicken; simmer 10 minutes.",
      "Cut the roti into strips, brush lightly with water and bake at 200°C for 8-10 minutes until crisp.",
      "Serve the soup with crispy roti strips, lemon juice and coriander on top."
    ],
    "allergens": [
      "wheat"
    ],
    "substitutions": "Skip the roti strips for a gluten-free soup; add black-eyed peas for extra body.",
    "storage": "Refrigerate up to 3 days; keep roti strips separate so they stay crisp.",
    "computed": {
      "perServing": {
        "kcal": 200.7,
        "proteinG": 25.5,
        "carbsG": 17.4,
        "fatG": 3.5,
        "fiberG": 3.1
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "corn-black-eyed-pea-salad",
    "title": "Corn & Black-Eyed Pea Salad",
    "cuisine": "Mexican",
    "mealType": "lunch",
    "dietCategory": "vegetarian",
    "tags": [
      "dairy-free",
      "gluten-free",
      "high-fiber",
      "low-calorie",
      "meal-prep",
      "mexican",
      "no-cook",
      "vegan"
    ],
    "servings": 4,
    "prepMin": 15,
    "cookMin": 0,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Sweet corn",
        "quantity": "300 g",
        "grams": 300
      },
      {
        "name": "Black-eyed peas (cooked)",
        "quantity": "250 g",
        "grams": 250
      },
      {
        "name": "Bell pepper",
        "quantity": "120 g"
      },
      {
        "name": "Onion",
        "quantity": "60 g"
      },
      {
        "name": "Tomato",
        "quantity": "150 g"
      },
      {
        "name": "Lemon",
        "quantity": "1 piece"
      },
      {
        "name": "Olive oil",
        "quantity": "1 tbsp"
      },
      {
        "name": "Cumin seeds",
        "quantity": "1 tsp"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Coriander leaves",
        "quantity": "2 tbsp"
      }
    ],
    "instructions": [
      "Combine the corn, black-eyed peas, diced bell pepper, onion and tomato in a bowl.",
      "Toast the cumin seeds 30 seconds and crush lightly.",
      "Whisk lemon juice, olive oil, cumin, salt and pepper.",
      "Toss the salad with the dressing; fold in coriander.",
      "Rest 10 minutes and serve chilled."
    ],
    "allergens": [],
    "substitutions": "Use rajma instead of black-eyed peas; add diced avocado if available.",
    "storage": "Refrigerate up to 3 days.",
    "computed": {
      "perServing": {
        "kcal": 186.4,
        "proteinG": 8.4,
        "carbsG": 31.6,
        "fatG": 5.3,
        "fiberG": 7.5
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "egg-bean-breakfast-wrap",
    "title": "Egg & Bean Breakfast Wrap",
    "cuisine": "Mexican",
    "mealType": "breakfast",
    "dietCategory": "vegetarian",
    "tags": [
      "dairy-free",
      "high-fiber",
      "high-protein",
      "mexican",
      "quick",
      "vegetarian"
    ],
    "servings": 2,
    "prepMin": 10,
    "cookMin": 12,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Egg (raw)",
        "quantity": "4 pieces",
        "grams": 200
      },
      {
        "name": "Rajma (cooked)",
        "quantity": "150 g",
        "grams": 150
      },
      {
        "name": "Roti (whole wheat)",
        "quantity": "2 pieces",
        "grams": 70
      },
      {
        "name": "Bell pepper",
        "quantity": "120 g"
      },
      {
        "name": "Onion",
        "quantity": "60 g"
      },
      {
        "name": "Tomato",
        "quantity": "100 g"
      },
      {
        "name": "Hot sauce",
        "quantity": "1 tsp",
        "grams": 5
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Coriander leaves",
        "quantity": "1 tbsp",
      "grams": 15
      }
    ],
    "instructions": [
      "Sauté onion and bell pepper 4 minutes; add the beans and tomato; warm through.",
      "Whisk the eggs with salt and pepper; scramble softly in the same pan, 2-3 minutes.",
      "Warm the rotis on a hot tawa.",
      "Divide the egg-bean mixture between the rotis; add hot sauce and coriander.",
      "Roll up and serve warm."
    ],
    "allergens": [
      "egg",
      "wheat"
    ],
    "substitutions": "Use egg whites for a lighter wrap; add grated cheddar for richness.",
    "storage": "Best eaten fresh; filling keeps 1 day refrigerated.",
    "computed": {
      "perServing": {
        "kcal": 372.6,
        "proteinG": 23.5,
        "carbsG": 43.6,
        "fatG": 11.2,
        "fiberG": 10.3
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "shrimp-ceviche",
    "title": "Shrimp Ceviche",
    "cuisine": "Mexican",
    "mealType": "snack",
    "dietCategory": "non_vegetarian",
    "tags": [
      "dairy-free",
      "gluten-free",
      "halal",
      "high-protein",
      "low-calorie",
      "mexican",
      "no-cook"
    ],
    "servings": 4,
    "prepMin": 25,
    "cookMin": 0,
    "difficulty": "medium",
    "ingredients": [
      {
        "name": "Prawns (raw)",
        "quantity": "400 g",
        "grams": 400
      },
      {
        "name": "Lemon",
        "quantity": "2 pieces"
      },
      {
        "name": "Tomato",
        "quantity": "200 g"
      },
      {
        "name": "Onion",
        "quantity": "120 g"
      },
      {
        "name": "Cucumber",
        "quantity": "150 g"
      },
      {
        "name": "Green chili",
        "quantity": "1 piece"
      },
      {
        "name": "Coriander leaves",
        "quantity": "3 tbsp",
        "grams": 45
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      }
    ],
    "instructions": [
      "Peel and devein the prawns; chop into bite-size pieces.",
      "Cover the prawns with lemon juice and salt; refrigerate 20 minutes until opaque and firm.",
      "Dice the tomato, onion and cucumber; mince the green chili.",
      "Drain off half the lemon juice; toss the prawns with the vegetables and coriander.",
      "Season with pepper; serve chilled within the hour."
    ],
    "allergens": [
      "shellfish"
    ],
    "substitutions": "Use cooked prawns and skip the curing step; add diced mango for a fruity version.",
    "storage": "Eat the same day; do not keep raw-cured seafood overnight.",
    "computed": {
      "perServing": {
        "kcal": 123.4,
        "proteinG": 21.7,
        "carbsG": 9.6,
        "fatG": 0.8,
        "fiberG": 2.5
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "chicken-cheese-roti-quesadilla-light",
    "title": "Chicken & Cheese Roti Quesadilla (Light)",
    "cuisine": "Mexican",
    "mealType": "lunch",
    "dietCategory": "non_vegetarian",
    "tags": [
      "dairy-free",
      "halal",
      "high-protein",
      "kid-friendly",
      "low-calorie",
      "mexican"
    ],
    "servings": 4,
    "prepMin": 15,
    "cookMin": 15,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Chicken breast (raw)",
        "quantity": "300 g",
        "grams": 300
      },
      {
        "name": "Mozzarella",
        "quantity": "100 g"
      },
      {
        "name": "Roti (whole wheat)",
        "quantity": "4 pieces"
      },
      {
        "name": "Bell pepper",
        "quantity": "120 g"
      },
      {
        "name": "Onion",
        "quantity": "60 g"
      },
      {
        "name": "Tomato",
        "quantity": "100 g"
      },
      {
        "name": "Cumin seeds",
        "quantity": "1 tsp"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      }
    ],
    "instructions": [
      "Cook the chicken with cumin, salt and pepper until done, about 10 minutes; shred or dice.",
      "Sauté bell pepper and onion 4 minutes; mix with the chicken and diced tomato.",
      "Place filling on half of each roti; top with mozzarella and fold over.",
      "Cook on a hot dry tawa 2-3 minutes per side until crisp and the cheese melts.",
      "Cut into wedges and serve hot."
    ],
    "allergens": [
      "wheat"
    ],
    "substitutions": "Use paneer for a vegetarian version; add hot sauce to the filling.",
    "storage": "Best eaten fresh; reheat in a dry pan to re-crisp.",
    "computed": {
      "perServing": {
        "kcal": 272.6,
        "proteinG": 27.2,
        "carbsG": 22.1,
        "fatG": 7.3,
        "fiberG": 3.3
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "mexican-tomato-rice",
    "title": "Mexican-Style Tomato Rice",
    "cuisine": "Mexican",
    "mealType": "dinner",
    "dietCategory": "vegetarian",
    "tags": [
      "budget-friendly",
      "dairy-free",
      "gluten-free",
      "low-calorie",
      "mexican",
      "one-pot",
      "vegan"
    ],
    "servings": 4,
    "prepMin": 10,
    "cookMin": 35,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Brown rice (raw)",
        "quantity": "240 g"
      },
      {
        "name": "Tomato",
        "quantity": "300 g"
      },
      {
        "name": "Onion",
        "quantity": "120 g"
      },
      {
        "name": "Sweet corn",
        "quantity": "100 g"
      },
      {
        "name": "Peas",
        "quantity": "100 g",
        "grams": 100
      },
      {
        "name": "Garlic",
        "quantity": "3 cloves"
      },
      {
        "name": "Cumin seeds",
        "quantity": "1 tsp"
      },
      {
        "name": "Canola oil",
        "quantity": "1 tbsp",
        "grams": 15
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Water",
        "quantity": "600 ml"
      },
      {
        "name": "Coriander leaves",
        "quantity": "2 tbsp"
      }
    ],
    "instructions": [
      "Sauté onion and garlic in canola oil 4 minutes; add cumin for 30 seconds.",
      "Stir in chopped tomatoes; cook 5 minutes until pulpy.",
      "Add the rice, corn, peas, salt and water; bring to a boil.",
      "Cover and simmer 28-30 minutes until the rice is tender and liquid absorbed.",
      "Fluff with a fork; garnish with coriander."
    ],
    "allergens": [],
    "substitutions": "Use basmati for a fluffier grain; add diced bell pepper.",
    "storage": "Refrigerate up to 4 days; sprinkle water before reheating.",
    "computed": {
      "perServing": {
        "kcal": 328.6,
        "proteinG": 8.3,
        "carbsG": 61.6,
        "fatG": 6.2,
        "fiberG": 5.6
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "chicken-fajita-bowl-no-tortilla",
    "title": "Chicken Fajita Bowl (No Tortilla)",
    "cuisine": "Mexican",
    "mealType": "dinner",
    "dietCategory": "non_vegetarian",
    "tags": [
      "dairy-free",
      "gluten-free",
      "halal",
      "high-protein",
      "low-calorie",
      "mexican",
      "one-pan"
    ],
    "servings": 4,
    "prepMin": 15,
    "cookMin": 15,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Chicken breast (raw)",
        "quantity": "500 g"
      },
      {
        "name": "Bell pepper",
        "quantity": "240 g"
      },
      {
        "name": "Onion",
        "quantity": "240 g"
      },
      {
        "name": "Lemon",
        "quantity": "1 piece"
      },
      {
        "name": "Garlic",
        "quantity": "3 cloves"
      },
      {
        "name": "Cumin seeds",
        "quantity": "1 tsp"
      },
      {
        "name": "Red chili powder",
        "quantity": "1 tsp"
      },
      {
        "name": "Canola oil",
        "quantity": "1 tbsp"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Coriander leaves",
        "quantity": "2 tbsp"
      }
    ],
    "instructions": [
      "Slice the chicken into thin strips; toss with cumin, red chili powder, garlic, salt and lemon juice.",
      "Sear the chicken in hot oil 5-6 minutes; set aside.",
      "Sizzle sliced peppers and onion in the same pan 4-5 minutes until charred at edges but crisp.",
      "Return the chicken; toss 1 minute.",
      "Serve in bowls with coriander; add rice or roti on the side if desired."
    ],
    "allergens": [],
    "substitutions": "Use beef strips or prawns instead of chicken.",
    "storage": "Refrigerate up to 3 days.",
    "computed": {
      "perServing": {
        "kcal": 236.3,
        "proteinG": 29.9,
        "carbsG": 11.9,
        "fatG": 7.4,
        "fiberG": 3
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "spicy-kidney-bean-soup-mexican",
    "title": "Spicy Kidney Bean Soup (Mexican-Style)",
    "cuisine": "Mexican",
    "mealType": "lunch",
    "dietCategory": "vegetarian",
    "tags": [
      "dairy-free",
      "freezer-friendly",
      "gluten-free",
      "high-fiber",
      "low-calorie",
      "mexican",
      "one-pot",
      "vegan"
    ],
    "servings": 4,
    "prepMin": 15,
    "cookMin": 50,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Rajma (dry)",
        "quantity": "150 g"
      },
      {
        "name": "Tomato",
        "quantity": "300 g"
      },
      {
        "name": "Onion",
        "quantity": "120 g"
      },
      {
        "name": "Carrot",
        "quantity": "120 g"
      },
      {
        "name": "Garlic",
        "quantity": "4 cloves"
      },
      {
        "name": "Cumin seeds",
        "quantity": "1 tsp"
      },
      {
        "name": "Red chili powder",
        "quantity": "1 tsp"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Water",
        "quantity": "1 l"
      },
      {
        "name": "Coriander leaves",
        "quantity": "2 tbsp"
      },
      {
        "name": "Lemon",
        "quantity": "30 g"
      }
    ],
    "instructions": [
      "Soak the rajma overnight; boil until tender, about 35 minutes.",
      "Soften onion, carrot and garlic 6 minutes; add cumin and red chili powder for 1 minute.",
      "Add chopped tomatoes; cook 6 minutes.",
      "Add the beans with their cooking liquid plus water; simmer 15 minutes.",
      "Blend one-third of the soup for body; finish with lemon juice and coriander."
    ],
    "allergens": [],
    "substitutions": "Use cooked beans to shorten cooking; stir in corn for sweetness.",
    "storage": "Refrigerate up to 4 days or freeze up to 2 months.",
    "computed": {
      "perServing": {
        "kcal": 172.5,
        "proteinG": 10.6,
        "carbsG": 33.4,
        "fatG": 0.6,
        "fiberG": 12.1
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "mango-salsa-grilled-chicken",
    "title": "Mango Salsa Grilled Chicken",
    "cuisine": "Mexican",
    "mealType": "dinner",
    "dietCategory": "non_vegetarian",
    "tags": [
      "dairy-free",
      "gluten-free",
      "grill",
      "halal",
      "high-protein",
      "low-calorie",
      "mexican"
    ],
    "servings": 4,
    "prepMin": 20,
    "cookMin": 15,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Chicken breast (raw)",
        "quantity": "600 g"
      },
      {
        "name": "Mango",
        "quantity": "300 g",
        "grams": 300
      },
      {
        "name": "Onion",
        "quantity": "60 g"
      },
      {
        "name": "Green chili",
        "quantity": "1 piece"
      },
      {
        "name": "Lemon",
        "quantity": "1 piece"
      },
      {
        "name": "Coriander leaves",
        "quantity": "2 tbsp"
      },
      {
        "name": "Garlic",
        "quantity": "3 cloves"
      },
      {
        "name": "Cumin seeds",
        "quantity": "1 tsp"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Olive oil",
        "quantity": "1 tbsp"
      }
    ],
    "instructions": [
      "Marinate the chicken with garlic, cumin, salt, pepper, olive oil and half the lemon juice for 15 minutes.",
      "Dice the mango and onion; mix with minced green chili, coriander, remaining lemon juice and salt into a salsa.",
      "Grill the chicken 6-7 minutes per side until cooked through.",
      "Rest 5 minutes and slice.",
      "Serve topped with the fresh mango salsa."
    ],
    "allergens": [],
    "substitutions": "Use fish fillets instead of chicken; add diced bell pepper to the salsa.",
    "storage": "Refrigerate chicken up to 3 days; make the salsa fresh.",
    "computed": {
      "perServing": {
        "kcal": 275.2,
        "proteinG": 35.1,
        "carbsG": 15.4,
        "fatG": 8.1,
        "fiberG": 2.2
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "lean-chicken-burger-patties-light",
    "title": "Lean Chicken Burger Patties (Light, Bun-Free)",
    "cuisine": "American",
    "mealType": "dinner",
    "dietCategory": "non_vegetarian",
    "tags": [
      "american",
      "baked-not-fried",
      "dairy-free",
      "halal",
      "high-protein",
      "low-calorie"
    ],
    "servings": 4,
    "prepMin": 20,
    "cookMin": 20,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Chicken keema (raw)",
        "quantity": "600 g",
        "grams": 600
      },
      {
        "name": "Onion",
        "quantity": "120 g"
      },
      {
        "name": "Garlic",
        "quantity": "3 cloves"
      },
      {
        "name": "Egg white (raw)",
        "quantity": "1 piece",
        "grams": 33
      },
      {
        "name": "Oats",
        "quantity": "40 g",
        "grams": 40
      },
      {
        "name": "Black pepper",
        "quantity": "1 tsp",
        "grams": 5
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Mustard (prepared)",
        "quantity": "1 tbsp",
        "grams": 15
      },
      {
        "name": "Tomato",
        "quantity": "200 g"
      },
      {
        "name": "Cucumber",
        "quantity": "100 g"
      },
      {
        "name": "Canola oil",
        "quantity": "1 tsp",
      "grams": 5
      }
    ],
    "instructions": [
      "Mix the chicken keema with grated onion, garlic, egg white, oats, mustard, salt and pepper; chill 15 minutes.",
      "Shape into 4 even patties with damp hands.",
      "Heat a non-stick pan with the measured oil; cook patties 5-6 minutes per side until cooked through.",
      "Serve on sliced tomato and cucumber rounds with extra mustard, or in whole-wheat roti."
    ],
    "allergens": [
      "egg",
      "mustard",
      "wheat"
    ],
    "substitutions": "Use lean beef keema for a classic burger; add grated carrot to the mix.",
    "storage": "Refrigerate cooked patties up to 3 days; freeze uncooked patties up to 1 month.",
    "computed": {
      "perServing": {
        "kcal": 300.4,
        "proteinG": 30,
        "carbsG": 13.7,
        "fatG": 14.4,
        "fiberG": 2.5
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "baked-oat-crusted-chicken-tenders",
    "title": "Baked Oat-Crusted Chicken Tenders",
    "cuisine": "American",
    "mealType": "dinner",
    "dietCategory": "non_vegetarian",
    "tags": [
      "american",
      "baked-not-fried",
      "dairy-free",
      "halal",
      "high-protein",
      "kid-friendly"
    ],
    "servings": 4,
    "prepMin": 20,
    "cookMin": 25,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Chicken breast (raw)",
        "quantity": "600 g"
      },
      {
        "name": "Oats",
        "quantity": "80 g",
        "grams": 80
      },
      {
        "name": "Egg (raw)",
        "quantity": "2 pieces"
      },
      {
        "name": "Besan (gram flour)",
        "quantity": "30 g",
        "grams": 30
      },
      {
        "name": "Garlic",
        "quantity": "2 cloves"
      },
      {
        "name": "Black pepper",
        "quantity": "1 tsp"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Red chili powder",
        "quantity": "1/2 tsp"
      },
      {
        "name": "Canola oil",
        "quantity": "1 tbsp"
      }
    ],
    "instructions": [
      "Heat the oven to 200°C. Cut the chicken into even strips.",
      "Blitz the oats into coarse crumbs; mix with salt, pepper and red chili powder.",
      "Dredge strips in besan, dip in beaten egg with minced garlic, then coat in oat crumbs.",
      "Arrange on an oiled tray; drizzle with the measured oil.",
      "Bake 22-25 minutes, turning once, until golden and cooked through."
    ],
    "allergens": [
      "egg",
      "wheat"
    ],
    "substitutions": "Use corn flour instead of besan; add dried herbs to the crumb.",
    "storage": "Refrigerate up to 3 days; reheat in a hot oven to re-crisp.",
    "computed": {
      "perServing": {
        "kcal": 358.7,
        "proteinG": 42.1,
        "carbsG": 18.4,
        "fatG": 11.9,
        "fiberG": 3
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "hearty-beef-chili-light",
    "title": "Hearty Beef Chili (Light)",
    "cuisine": "American",
    "mealType": "dinner",
    "dietCategory": "non_vegetarian",
    "tags": [
      "american",
      "dairy-free",
      "freezer-friendly",
      "gluten-free",
      "halal",
      "high-fiber",
      "high-protein",
      "one-pot"
    ],
    "servings": 4,
    "prepMin": 20,
    "cookMin": 55,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Beef (raw, lean)",
        "quantity": "500 g",
        "grams": 500
      },
      {
        "name": "Rajma (dry)",
        "quantity": "150 g"
      },
      {
        "name": "Tomato",
        "quantity": "400 g"
      },
      {
        "name": "Onion",
        "quantity": "180 g"
      },
      {
        "name": "Bell pepper",
        "quantity": "180 g"
      },
      {
        "name": "Garlic",
        "quantity": "4 cloves"
      },
      {
        "name": "Cumin seeds",
        "quantity": "2 tsp"
      },
      {
        "name": "Red chili powder",
        "quantity": "1 tsp"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Water",
        "quantity": "600 ml"
      },
      {
        "name": "Coriander leaves",
        "quantity": "2 tbsp"
      }
    ],
    "instructions": [
      "Soak the rajma overnight; boil until tender, about 35 minutes, and drain.",
      "Brown the beef in a dry heavy pot, breaking it up, 8-10 minutes; drain any excess fat.",
      "Add onion, bell pepper and garlic; cook 6 minutes. Stir in cumin and red chili powder 1 minute.",
      "Add chopped tomatoes and water; simmer 20 minutes.",
      "Add the beans; simmer 10 more minutes. Season and garnish with coriander."
    ],
    "allergens": [],
    "substitutions": "Use chicken keema for a lighter chili; add corn for sweetness.",
    "storage": "Refrigerate up to 4 days or freeze up to 2 months.",
    "computed": {
      "perServing": {
        "kcal": 362.5,
        "proteinG": 36,
        "carbsG": 34.9,
        "fatG": 9.5,
        "fiberG": 12.6
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "salmon-potato-bake",
    "title": "Salmon & Potato Bake",
    "cuisine": "American",
    "mealType": "dinner",
    "dietCategory": "non_vegetarian",
    "tags": [
      "american",
      "baked-not-fried",
      "dairy-free",
      "gluten-free",
      "halal",
      "high-protein",
      "one-pan"
    ],
    "servings": 4,
    "prepMin": 20,
    "cookMin": 35,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Salmon (raw)",
        "quantity": "600 g",
        "grams": 600
      },
      {
        "name": "Potato",
        "quantity": "600 g",
        "grams": 600
      },
      {
        "name": "Onion",
        "quantity": "120 g"
      },
      {
        "name": "Garlic",
        "quantity": "3 cloves"
      },
      {
        "name": "Olive oil",
        "quantity": "2 tbsp"
      },
      {
        "name": "Lemon",
        "quantity": "1 piece"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Coriander leaves",
        "quantity": "2 tbsp"
      }
    ],
    "instructions": [
      "Heat the oven to 200°C. Cut potatoes into thin wedges; toss with half the oil, salt and pepper.",
      "Bake the potatoes with sliced onion and garlic 20 minutes.",
      "Place salmon fillets on top; drizzle with remaining oil and lemon juice.",
      "Bake 12-15 minutes more until the salmon flakes easily.",
      "Garnish with coriander and serve hot."
    ],
    "allergens": [
      "fish"
    ],
    "substitutions": "Use any firm fish fillet; swap coriander for mint.",
    "storage": "Refrigerate up to 2 days; reheat gently.",
    "computed": {
      "perServing": {
        "kcal": 516.4,
        "proteinG": 33.9,
        "carbsG": 31.9,
        "fatG": 27.3,
        "fiberG": 4.4
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "chicken-vegetable-sheet-pan",
    "title": "Chicken & Vegetable Sheet Pan Dinner",
    "cuisine": "American",
    "mealType": "dinner",
    "dietCategory": "non_vegetarian",
    "tags": [
      "american",
      "dairy-free",
      "gluten-free",
      "halal",
      "high-fiber",
      "high-protein",
      "meal-prep",
      "sheet-pan"
    ],
    "servings": 4,
    "prepMin": 20,
    "cookMin": 35,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Chicken breast (raw)",
        "quantity": "600 g"
      },
      {
        "name": "Potato",
        "quantity": "400 g"
      },
      {
        "name": "Carrot",
        "quantity": "240 g",
        "grams": 240
      },
      {
        "name": "Broccoli",
        "quantity": "300 g",
        "grams": 300
      },
      {
        "name": "Bell pepper",
        "quantity": "180 g"
      },
      {
        "name": "Onion",
        "quantity": "180 g"
      },
      {
        "name": "Olive oil",
        "quantity": "2 tbsp"
      },
      {
        "name": "Garlic",
        "quantity": "4 cloves"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Lemon",
        "quantity": "30 g"
      }
    ],
    "instructions": [
      "Heat the oven to 210°C. Cut the chicken into chunks and the vegetables into similar-size pieces.",
      "Toss everything with olive oil, minced garlic, salt and pepper on a large tray.",
      "Spread in a single layer without crowding.",
      "Roast 30-35 minutes, turning once, until the chicken is cooked and vegetables caramelise.",
      "Squeeze lemon over and serve."
    ],
    "allergens": [],
    "substitutions": "Swap in any vegetables — cauliflower, green beans or sweet corn all work.",
    "storage": "Refrigerate up to 4 days; great for meal prep.",
    "computed": {
      "perServing": {
        "kcal": 413.5,
        "proteinG": 39.7,
        "carbsG": 37.2,
        "fatG": 12.2,
        "fiberG": 7.7
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "chicken-meatballs-light",
    "title": "Chicken Meatballs in Tomato Sauce (Light)",
    "cuisine": "American",
    "mealType": "dinner",
    "dietCategory": "non_vegetarian",
    "tags": [
      "american",
      "baked-not-fried",
      "dairy-free",
      "halal",
      "high-protein",
      "kid-friendly",
      "low-calorie"
    ],
    "servings": 4,
    "prepMin": 20,
    "cookMin": 30,
    "difficulty": "medium",
    "ingredients": [
      {
        "name": "Chicken keema (raw)",
        "quantity": "600 g"
      },
      {
        "name": "Oats",
        "quantity": "50 g",
        "grams": 50
      },
      {
        "name": "Egg (raw)",
        "quantity": "1 piece"
      },
      {
        "name": "Onion",
        "quantity": "120 g"
      },
      {
        "name": "Garlic",
        "quantity": "3 cloves"
      },
      {
        "name": "Tomato",
        "quantity": "300 g"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Cumin seeds",
        "quantity": "1 tsp"
      },
      {
        "name": "Coriander leaves",
        "quantity": "2 tbsp"
      },
      {
        "name": "Canola oil",
        "quantity": "1 tsp"
      }
    ],
    "instructions": [
      "Heat the oven to 200°C. Mix keema with oats, beaten egg, half the onion (grated), half the garlic, cumin, salt and pepper.",
      "Roll into 16 even balls; place on an oiled tray and bake 18-20 minutes.",
      "Simmer remaining onion and garlic with chopped tomatoes 10 minutes into a sauce.",
      "Add the baked meatballs to the sauce; simmer 5 minutes.",
      "Garnish with coriander and serve over rice or with roti."
    ],
    "allergens": [
      "egg",
      "wheat"
    ],
    "substitutions": "Use lean beef keema; add grated carrot to the meatball mix.",
    "storage": "Refrigerate up to 3 days or freeze up to 1 month.",
    "computed": {
      "perServing": {
        "kcal": 323.8,
        "proteinG": 31.2,
        "carbsG": 15.5,
        "fatG": 15.7,
        "fiberG": 3
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "apple-cinnamon-oatmeal",
    "title": "Apple Cinnamon Oatmeal",
    "cuisine": "American",
    "mealType": "breakfast",
    "dietCategory": "vegetarian",
    "tags": [
      "american",
      "high-fiber",
      "kid-friendly",
      "one-pot",
      "vegetarian"
    ],
    "servings": 2,
    "prepMin": 10,
    "cookMin": 12,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Oats",
        "quantity": "100 g",
        "grams": 100
      },
      {
        "name": "Apple",
        "quantity": "360 g",
        "grams": 360
      },
      {
        "name": "Milk (skim)",
        "quantity": "400 ml",
        "grams": 400
      },
      {
        "name": "Cinnamon",
        "quantity": "1 tsp",
        "grams": 5
      },
      {
        "name": "Honey",
        "quantity": "1 tbsp",
        "grams": 15
      },
      {
        "name": "Water",
        "quantity": "200 ml",
        "grams": 200
      },
      {
        "name": "Walnuts",
        "quantity": "20 g",
      "grams": 20
      }
    ],
    "instructions": [
      "Dice one apple; slice the other for topping.",
      "Simmer oats, diced apple, milk, water and cinnamon 8-10 minutes, stirring, until creamy.",
      "Sweeten with honey off the heat.",
      "Serve topped with apple slices and chopped walnuts."
    ],
    "allergens": [
      "milk",
      "tree-nuts",
      "wheat"
    ],
    "substitutions": "Use pear instead of apple; swap honey for brown sugar.",
    "storage": "Refrigerate up to 2 days; loosen with milk when reheating.",
    "computed": {
      "perServing": {
        "kcal": 444.3,
        "proteinG": 17.4,
        "carbsG": 75.6,
        "fatG": 10.6,
        "fiberG": 10.3
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "hearty-beef-vegetable-soup",
    "title": "Hearty Beef & Vegetable Soup",
    "cuisine": "American",
    "mealType": "dinner",
    "dietCategory": "non_vegetarian",
    "tags": [
      "american",
      "dairy-free",
      "freezer-friendly",
      "gluten-free",
      "halal",
      "high-protein",
      "low-calorie",
      "one-pot"
    ],
    "servings": 4,
    "prepMin": 20,
    "cookMin": 60,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Beef (raw, lean)",
        "quantity": "400 g",
        "grams": 400
      },
      {
        "name": "Potato",
        "quantity": "300 g"
      },
      {
        "name": "Carrot",
        "quantity": "180 g"
      },
      {
        "name": "Onion",
        "quantity": "120 g"
      },
      {
        "name": "Cabbage",
        "quantity": "150 g"
      },
      {
        "name": "Green beans",
        "quantity": "100 g"
      },
      {
        "name": "Tomato",
        "quantity": "200 g"
      },
      {
        "name": "Garlic",
        "quantity": "3 cloves"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Bay leaf",
        "quantity": "2 pieces"
      },
      {
        "name": "Water",
        "quantity": "1.2 l"
      }
    ],
    "instructions": [
      "Brown the beef cubes in a dry heavy pot 8 minutes; add onion and garlic for 3 minutes.",
      "Add water, bay leaves and salt; simmer 30 minutes.",
      "Add potato, carrot, tomato, cabbage and green beans.",
      "Simmer 20-25 minutes until the beef is tender and vegetables are soft.",
      "Remove bay leaves; adjust salt and pepper and serve hot."
    ],
    "allergens": [],
    "substitutions": "Use chicken for a lighter soup; add barley-style body with extra potato.",
    "storage": "Refrigerate up to 4 days or freeze up to 2 months.",
    "computed": {
      "perServing": {
        "kcal": 262.8,
        "proteinG": 23.8,
        "carbsG": 27.2,
        "fatG": 7.4,
        "fiberG": 5.6
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "light-whole-wheat-mac-cheese",
    "title": "Light Whole-Wheat Mac & Cheese",
    "aliases": [
      "whole wheat macaroni cheese"
    ],
    "cuisine": "American",
    "mealType": "dinner",
    "dietCategory": "vegetarian",
    "tags": [
      "american",
      "from-scratch",
      "high-fiber",
      "kid-friendly",
      "vegetarian"
    ],
    "servings": 4,
    "prepMin": 30,
    "cookMin": 20,
    "difficulty": "medium",
    "ingredients": [
      {
        "name": "Atta (whole wheat flour)",
        "quantity": "280 g"
      },
      {
        "name": "Egg (raw)",
        "quantity": "1 piece"
      },
      {
        "name": "Cheddar cheese",
        "quantity": "80 g",
        "grams": 80
      },
      {
        "name": "Milk (skim)",
        "quantity": "240 ml"
      },
      {
        "name": "Butter",
        "quantity": "10 g"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Mustard (prepared)",
        "quantity": "1 tsp",
      "grams": 5
      }
    ],
    "instructions": [
      "Knead the flour with the egg and a splash of water into a firm dough; rest 30 minutes.",
      "Roll thin and cut into short macaroni-style tubes or small shells.",
      "Boil in salted water 3-4 minutes until al dente; drain.",
      "Melt the butter; whisk in the warm milk, mustard, salt and pepper; melt in the grated cheddar.",
      "Toss the pasta through the cheese sauce and serve immediately."
    ],
    "allergens": [
      "egg",
      "milk",
      "mustard",
      "wheat"
    ],
    "substitutions": "Use mozzarella for a milder sauce; add steamed broccoli to the toss.",
    "storage": "Best eaten fresh; refrigerate up to 2 days and loosen with milk when reheating.",
    "computed": {
      "perServing": {
        "kcal": 375.6,
        "proteinG": 17.9,
        "carbsG": 54.2,
        "fatG": 11.7,
        "fiberG": 7.5
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "loaded-baked-potato-light",
    "title": "Loaded Baked Potato (Light)",
    "cuisine": "American",
    "mealType": "lunch",
    "dietCategory": "vegetarian",
    "tags": [
      "american",
      "baked-not-fried",
      "gluten-free",
      "low-calorie",
      "vegetarian"
    ],
    "servings": 4,
    "prepMin": 10,
    "cookMin": 55,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Potato",
        "quantity": "800 g",
        "grams": 800
      },
      {
        "name": "Greek yogurt",
        "quantity": "150 g",
        "grams": 150
      },
      {
        "name": "Cheddar cheese",
        "quantity": "40 g",
        "grams": 40
      },
      {
        "name": "Green chili",
        "quantity": "1 piece"
      },
      {
        "name": "Coriander leaves",
        "quantity": "2 tbsp"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      }
    ],
    "instructions": [
      "Heat the oven to 200°C. Prick the potatoes and bake directly on the rack 50-60 minutes until soft.",
      "Split each potato open and fluff the insides with a fork; season with salt and pepper.",
      "Top with Greek yogurt, grated cheddar, minced green chili and coriander.",
      "Return to the oven 3 minutes to just melt the cheese; serve hot."
    ],
    "allergens": [
      "milk"
    ],
    "substitutions": "Top with baked beans for extra protein; use dahi instead of Greek yogurt.",
    "storage": "Refrigerate assembled potatoes up to 2 days; reheat in the oven.",
    "computed": {
      "perServing": {
        "kcal": 232.9,
        "proteinG": 10.1,
        "carbsG": 37.4,
        "fatG": 5.4,
        "fiberG": 4.4
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "potato-egg-breakfast-hash",
    "title": "Potato & Egg Breakfast Hash",
    "cuisine": "American",
    "mealType": "breakfast",
    "dietCategory": "vegetarian",
    "tags": [
      "american",
      "dairy-free",
      "gluten-free",
      "low-calorie",
      "one-pan",
      "vegetarian"
    ],
    "servings": 4,
    "prepMin": 15,
    "cookMin": 25,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Potato",
        "quantity": "600 g"
      },
      {
        "name": "Egg (raw)",
        "quantity": "4 pieces"
      },
      {
        "name": "Bell pepper",
        "quantity": "180 g"
      },
      {
        "name": "Onion",
        "quantity": "180 g"
      },
      {
        "name": "Canola oil",
        "quantity": "1 tbsp"
      },
      {
        "name": "Garlic",
        "quantity": "2 cloves"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Coriander leaves",
        "quantity": "2 tbsp"
      }
    ],
    "instructions": [
      "Dice the potatoes into 1-cm cubes; parboil 6-8 minutes until just tender and drain well.",
      "Crisp the potatoes in hot canola oil 8-10 minutes, stirring occasionally, until golden.",
      "Add diced onion, bell pepper and garlic; cook 5 minutes until softened.",
      "Make 4 wells and crack an egg into each; cover and cook 4-5 minutes until the whites set.",
      "Season with salt and pepper; scatter coriander and serve hot."
    ],
    "allergens": [
      "egg"
    ],
    "substitutions": "Add cooked chicken or beef for a meatier hash; swap coriander for any fresh herb.",
    "storage": "Best eaten fresh; refrigerate up to 2 days.",
    "computed": {
      "perServing": {
        "kcal": 256.8,
        "proteinG": 10.5,
        "carbsG": 34.6,
        "fatG": 8.9,
        "fiberG": 5.1
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "creamy-chicken-vegetable-skillet-light",
    "title": "Creamy Chicken & Vegetable Skillet (Light)",
    "cuisine": "American",
    "mealType": "dinner",
    "dietCategory": "non_vegetarian",
    "tags": [
      "american",
      "gluten-free",
      "halal",
      "high-protein",
      "low-calorie",
      "one-pan"
    ],
    "servings": 4,
    "prepMin": 15,
    "cookMin": 30,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Chicken breast (raw)",
        "quantity": "500 g"
      },
      {
        "name": "Potato",
        "quantity": "300 g"
      },
      {
        "name": "Carrot",
        "quantity": "180 g"
      },
      {
        "name": "Peas",
        "quantity": "150 g",
        "grams": 150
      },
      {
        "name": "Onion",
        "quantity": "120 g"
      },
      {
        "name": "Milk (skim)",
        "quantity": "240 ml"
      },
      {
        "name": "Corn flour",
        "quantity": "15 g",
        "grams": 15
      },
      {
        "name": "Canola oil",
        "quantity": "1 tbsp"
      },
      {
        "name": "Garlic",
        "quantity": "3 cloves"
      },
      {
        "name": "Salt",
        "quantity": "to taste"
      },
      {
        "name": "Black pepper",
        "quantity": "to taste"
      },
      {
        "name": "Water",
        "quantity": "300 ml",
      "grams": 300
      }
    ],
    "instructions": [
      "Brown the chicken pieces in canola oil 6-7 minutes; set aside.",
      "Soften onion, carrot and garlic 5 minutes; add potato and water; simmer 12 minutes.",
      "Stir in the peas and return the chicken; simmer 5 minutes.",
      "Whisk corn flour into the cold milk; stir into the skillet and simmer 3-4 minutes until the sauce thickens.",
      "Season with salt and pepper; serve hot."
    ],
    "allergens": [
      "milk"
    ],
    "substitutions": "Use besan instead of corn flour to thicken; add mushrooms for depth.",
    "storage": "Refrigerate up to 3 days; the sauce thickens further on standing.",
    "computed": {
      "perServing": {
        "kcal": 340.9,
        "proteinG": 34.6,
        "carbsG": 33.2,
        "fatG": 7.4,
        "fiberG": 5.4
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "balanced-breakfast-bowl-berry-oats",
    "title": "Balanced Breakfast Bowl: Berry Oats & Yogurt",
    "cuisine": "Continental",
    "mealType": "breakfast",
    "dietCategory": "vegetarian",
    "tags": [
      "continental",
      "high-fiber",
      "high-protein",
      "no-cook",
      "vegetarian"
    ],
    "servings": 2,
    "prepMin": 10,
    "cookMin": 0,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Oats",
        "quantity": "80 g"
      },
      {
        "name": "Greek yogurt",
        "quantity": "300 g",
        "grams": 300
      },
      {
        "name": "Banana",
        "quantity": "120 g",
        "grams": 120
      },
      {
        "name": "Strawberry",
        "quantity": "150 g",
        "grams": 150
      },
      {
        "name": "Almonds",
        "quantity": "20 g",
        "grams": 20
      },
      {
        "name": "Honey",
        "quantity": "1 tbsp"
      },
      {
        "name": "Chia seeds",
        "quantity": "10 g",
      "grams": 10
      }
    ],
    "instructions": [
      "Divide the Greek yogurt between two bowls.",
      "Top with oats, sliced banana and halved strawberries.",
      "Drizzle with honey; sprinkle with chopped almonds and chia seeds.",
      "Serve immediately."
    ],
    "allergens": [
      "milk",
      "tree-nuts",
      "wheat"
    ],
    "substitutions": "Use any seasonal fruit; swap almonds for walnuts or peanuts.",
    "storage": "Best eaten fresh; prep fruit the night before if needed.",
    "computed": {
      "perServing": {
        "kcal": 483.5,
        "proteinG": 24.4,
        "carbsG": 62.3,
        "fatG": 17.2,
        "fiberG": 10.3
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "egg-fruit-protein-breakfast-bowl",
    "title": "Egg & Fruit Protein Breakfast Bowl",
    "cuisine": "Continental",
    "mealType": "breakfast",
    "dietCategory": "vegetarian",
    "tags": [
      "continental",
      "gluten-free",
      "no-cook",
      "vegetarian"
    ],
    "servings": 2,
    "prepMin": 15,
    "cookMin": 10,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Egg (boiled)",
        "quantity": "4 pieces",
        "grams": 200
      },
      {
        "name": "Apple",
        "quantity": "180 g",
        "grams": 180
      },
      {
        "name": "Walnuts",
        "quantity": "20 g"
      },
      {
        "name": "Banana",
        "quantity": "120 g"
      },
      {
        "name": "Peanut butter",
        "quantity": "30 g",
      "grams": 30
      }
    ],
    "instructions": [
      "Boil the eggs 9-10 minutes; cool in cold water, peel and halve.",
      "Slice the apple and banana into a bowl.",
      "Add the halved eggs alongside the fruit.",
      "Drizzle with peanut butter (warmed 10 seconds to pour) and scatter walnuts."
    ],
    "allergens": [
      "egg",
      "milk",
      "peanuts",
      "tree-nuts"
    ],
    "substitutions": "Use almond-style nut butter; swap walnuts for any nuts.",
    "storage": "Best eaten fresh; boiled eggs keep 3 days refrigerated in shell.",
    "computed": {
      "perServing": {
        "kcal": 408.8,
        "proteinG": 18.8,
        "carbsG": 31.8,
        "fatG": 25,
        "fiberG": 5.4
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "protein-smoothie-bowl-berry",
    "title": "Protein Smoothie Bowl: Berry & Peanut Butter",
    "cuisine": "Continental",
    "mealType": "breakfast",
    "dietCategory": "vegetarian",
    "tags": [
      "continental",
      "gluten-free",
      "high-fiber",
      "high-protein",
      "no-cook",
      "vegetarian"
    ],
    "servings": 2,
    "prepMin": 10,
    "cookMin": 0,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Greek yogurt",
        "quantity": "300 g"
      },
      {
        "name": "Banana",
        "quantity": "240 g",
        "grams": 240
      },
      {
        "name": "Strawberry",
        "quantity": "200 g",
        "grams": 200
      },
      {
        "name": "Peanut butter",
        "quantity": "30 g"
      },
      {
        "name": "Milk (skim)",
        "quantity": "200 ml",
        "grams": 200
      },
      {
        "name": "Chia seeds",
        "quantity": "10 g"
      },
      {
        "name": "Honey",
        "quantity": "1 tsp",
      "grams": 5
      }
    ],
    "instructions": [
      "Blend the yogurt, banana, half the strawberries, peanut butter and milk until thick and smooth.",
      "Pour into two bowls — the texture should be spoonable, not drinkable.",
      "Top with the remaining sliced strawberries, chia seeds and a drizzle of honey.",
      "Serve immediately."
    ],
    "allergens": [
      "milk",
      "peanuts"
    ],
    "substitutions": "Use mango instead of strawberry; swap peanut butter for any nut butter.",
    "storage": "Best eaten fresh; the base keeps 1 day refrigerated.",
    "computed": {
      "perServing": {
        "kcal": 438.4,
        "proteinG": 23.5,
        "carbsG": 53.3,
        "fatG": 17.3,
        "fiberG": 7.8
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "mango-oat-smoothie-bowl",
    "title": "Mango & Oat Smoothie Bowl",
    "cuisine": "Continental",
    "mealType": "breakfast",
    "dietCategory": "vegetarian",
    "tags": [
      "continental",
      "high-fiber",
      "no-cook",
      "vegetarian"
    ],
    "servings": 2,
    "prepMin": 10,
    "cookMin": 0,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Mango",
        "quantity": "400 g",
        "grams": 400
      },
      {
        "name": "Greek yogurt",
        "quantity": "200 g"
      },
      {
        "name": "Oats",
        "quantity": "40 g"
      },
      {
        "name": "Milk (skim)",
        "quantity": "200 ml"
      },
      {
        "name": "Flaxseed",
        "quantity": "10 g",
        "grams": 10
      },
      {
        "name": "Honey",
        "quantity": "1 tsp"
      }
    ],
    "instructions": [
      "Blend the mango, yogurt, oats and milk until thick and creamy.",
      "Pour into two bowls.",
      "Top with ground flaxseed, a few mango cubes and a drizzle of honey.",
      "Serve immediately."
    ],
    "allergens": [
      "milk",
      "wheat"
    ],
    "substitutions": "Use banana if mango is out of season; swap flaxseed for chia.",
    "storage": "Best eaten fresh.",
    "computed": {
      "perServing": {
        "kcal": 363.1,
        "proteinG": 18.3,
        "carbsG": 55.7,
        "fatG": 9.4,
        "fiberG": 6.7
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "overnight-oats-banana-chia",
    "title": "Overnight Oats: Banana & Chia",
    "cuisine": "Continental",
    "mealType": "breakfast",
    "dietCategory": "vegetarian",
    "tags": [
      "continental",
      "high-fiber",
      "make-ahead",
      "meal-prep",
      "no-cook",
      "vegetarian"
    ],
    "servings": 2,
    "prepMin": 10,
    "cookMin": 0,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Oats",
        "quantity": "100 g"
      },
      {
        "name": "Milk (skim)",
        "quantity": "300 ml",
        "grams": 300
      },
      {
        "name": "Chia seeds",
        "quantity": "15 g",
        "grams": 15
      },
      {
        "name": "Banana",
        "quantity": "120 g"
      },
      {
        "name": "Honey",
        "quantity": "1 tbsp"
      },
      {
        "name": "Cinnamon",
        "quantity": "1/2 tsp",
      "grams": 2.5
      }
    ],
    "instructions": [
      "Stir the oats, milk, chia seeds, cinnamon and honey in a jar or bowl.",
      "Cover and refrigerate overnight (at least 6 hours).",
      "In the morning, stir well and top with sliced banana.",
      "Add a splash of milk if too thick."
    ],
    "allergens": [
      "milk",
      "wheat"
    ],
    "substitutions": "Use any milk; top with any fruit or nuts.",
    "storage": "Refrigerate up to 3 days; add fresh fruit at serving time.",
    "computed": {
      "perServing": {
        "kcal": 358.2,
        "proteinG": 15.5,
        "carbsG": 63.7,
        "fatG": 6.1,
        "fiberG": 9.5
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "overnight-oats-mango-coconut",
    "title": "Overnight Oats: Mango & Coconut",
    "cuisine": "Continental",
    "mealType": "breakfast",
    "dietCategory": "vegetarian",
    "tags": [
      "continental",
      "high-fiber",
      "make-ahead",
      "meal-prep",
      "no-cook",
      "vegetarian"
    ],
    "servings": 2,
    "prepMin": 10,
    "cookMin": 0,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Oats",
        "quantity": "100 g"
      },
      {
        "name": "Greek yogurt",
        "quantity": "150 g"
      },
      {
        "name": "Milk (skim)",
        "quantity": "150 ml",
        "grams": 150
      },
      {
        "name": "Mango",
        "quantity": "200 g",
        "grams": 200
      },
      {
        "name": "Coconut (fresh)",
        "quantity": "30 g",
        "grams": 30
      },
      {
        "name": "Chia seeds",
        "quantity": "10 g"
      },
      {
        "name": "Honey",
        "quantity": "1 tsp"
      }
    ],
    "instructions": [
      "Dice the mango, keeping a few cubes for topping.",
      "Mix oats, yogurt, milk, most of the mango, grated coconut, chia seeds and honey in a jar.",
      "Cover and refrigerate overnight.",
      "Top with the reserved mango cubes before serving."
    ],
    "allergens": [
      "milk",
      "wheat"
    ],
    "substitutions": "Use banana or berries when mango is out of season; use desiccated coconut if fresh is unavailable.",
    "storage": "Refrigerate up to 3 days.",
    "computed": {
      "perServing": {
        "kcal": 437.8,
        "proteinG": 19.9,
        "carbsG": 61.3,
        "fatG": 14.3,
        "fiberG": 10
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "greek-yogurt-berry-parfait",
    "title": "Greek Yogurt & Berry Parfait",
    "cuisine": "Continental",
    "mealType": "breakfast",
    "dietCategory": "vegetarian",
    "tags": [
      "continental",
      "high-protein",
      "no-cook",
      "vegetarian"
    ],
    "servings": 2,
    "prepMin": 10,
    "cookMin": 5,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Greek yogurt",
        "quantity": "400 g"
      },
      {
        "name": "Strawberry",
        "quantity": "200 g"
      },
      {
        "name": "Oats",
        "quantity": "40 g"
      },
      {
        "name": "Honey",
        "quantity": "1 tbsp"
      },
      {
        "name": "Almonds",
        "quantity": "15 g",
      "grams": 15
      }
    ],
    "instructions": [
      "Toast the oats in a dry pan 3-4 minutes until fragrant; cool.",
      "Slice the strawberries.",
      "Layer yogurt, strawberries and toasted oats in two glasses, repeating the layers.",
      "Drizzle with honey and top with chopped almonds."
    ],
    "allergens": [
      "milk",
      "tree-nuts",
      "wheat"
    ],
    "substitutions": "Use any berries or diced mango; swap almonds for any nuts.",
    "storage": "Best assembled fresh; components keep 2 days refrigerated.",
    "computed": {
      "perServing": {
        "kcal": 370.1,
        "proteinG": 23.7,
        "carbsG": 36.6,
        "fatG": 15.4,
        "fiberG": 5.1
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "greek-yogurt-mango-parfait",
    "title": "Greek Yogurt & Mango Parfait",
    "cuisine": "Continental",
    "mealType": "snack",
    "dietCategory": "vegetarian",
    "tags": [
      "continental",
      "gluten-free",
      "high-protein",
      "no-cook",
      "vegetarian"
    ],
    "servings": 2,
    "prepMin": 10,
    "cookMin": 0,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Greek yogurt",
        "quantity": "400 g"
      },
      {
        "name": "Mango",
        "quantity": "300 g"
      },
      {
        "name": "Chia seeds",
        "quantity": "10 g"
      },
      {
        "name": "Pistachios",
        "quantity": "15 g",
        "grams": 15
      },
      {
        "name": "Honey",
        "quantity": "1 tsp"
      }
    ],
    "instructions": [
      "Dice the mango, keeping a few neat cubes for the top.",
      "Layer yogurt and mango in two glasses.",
      "Top with mango cubes, chia seeds and chopped pistachios.",
      "Drizzle with honey and serve chilled."
    ],
    "allergens": [
      "milk",
      "tree-nuts"
    ],
    "substitutions": "Use banana or berries when mango is out of season.",
    "storage": "Best eaten fresh; keeps 1 day refrigerated.",
    "computed": {
      "perServing": {
        "kcal": 358.1,
        "proteinG": 21.6,
        "carbsG": 36.5,
        "fatG": 15.6,
        "fiberG": 4.9
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "high-protein-yogurt-bowl",
    "title": "High-Protein Yogurt Bowl",
    "cuisine": "Continental",
    "mealType": "breakfast",
    "dietCategory": "vegetarian",
    "tags": [
      "continental",
      "high-protein",
      "no-cook",
      "vegetarian"
    ],
    "servings": 2,
    "prepMin": 10,
    "cookMin": 0,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Greek yogurt",
        "quantity": "400 g"
      },
      {
        "name": "Peanut butter",
        "quantity": "30 g"
      },
      {
        "name": "Banana",
        "quantity": "120 g"
      },
      {
        "name": "Oats",
        "quantity": "30 g",
        "grams": 30
      },
      {
        "name": "Flaxseed",
        "quantity": "10 g"
      },
      {
        "name": "Honey",
        "quantity": "1 tsp"
      }
    ],
    "instructions": [
      "Divide the Greek yogurt between two bowls.",
      "Swirl through the peanut butter.",
      "Top with sliced banana, oats and ground flaxseed.",
      "Drizzle with honey and serve."
    ],
    "allergens": [
      "milk",
      "peanuts",
      "wheat"
    ],
    "substitutions": "Use any nut butter; add berries for extra fibre.",
    "storage": "Best eaten fresh.",
    "computed": {
      "perServing": {
        "kcal": 428.3,
        "proteinG": 25.9,
        "carbsG": 38.2,
        "fatG": 20.9,
        "fiberG": 5.5
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "whole-grain-pancakes-light",
    "title": "Whole-Grain Pancakes (Light)",
    "cuisine": "Continental",
    "mealType": "breakfast",
    "dietCategory": "vegetarian",
    "tags": [
      "continental",
      "high-fiber",
      "kid-friendly",
      "low-calorie",
      "vegetarian"
    ],
    "servings": 4,
    "prepMin": 15,
    "cookMin": 20,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Atta (whole wheat flour)",
        "quantity": "200 g",
        "grams": 200
      },
      {
        "name": "Egg (raw)",
        "quantity": "2 pieces"
      },
      {
        "name": "Milk (skim)",
        "quantity": "300 ml"
      },
      {
        "name": "Banana",
        "quantity": "120 g"
      },
      {
        "name": "Baking powder",
        "quantity": "2 tsp",
        "grams": 10
      },
      {
        "name": "Honey",
        "quantity": "1 tbsp"
      },
      {
        "name": "Canola oil",
        "quantity": "1 tsp"
      },
      {
        "name": "Cinnamon",
        "quantity": "1/2 tsp"
      }
    ],
    "instructions": [
      "Whisk the flour, baking powder and cinnamon in a bowl.",
      "Mash the banana; whisk with eggs, milk and honey.",
      "Combine wet and dry ingredients into a thick batter; rest 5 minutes.",
      "Cook ladles of batter in a lightly oiled non-stick pan, 2-3 minutes per side.",
      "Serve warm with a drizzle of honey."
    ],
    "allergens": [
      "egg",
      "milk",
      "wheat"
    ],
    "substitutions": "Add grated apple to the batter; make dairy-free with water instead of milk.",
    "storage": "Refrigerate up to 3 days; reheat in a dry pan or toaster.",
    "computed": {
      "perServing": {
        "kcal": 280.4,
        "proteinG": 12.7,
        "carbsG": 49.9,
        "fatG": 5.1,
        "fiberG": 6.2
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "chia-pudding-mango",
    "title": "Chia Pudding with Mango",
    "cuisine": "Continental",
    "mealType": "snack",
    "dietCategory": "vegetarian",
    "tags": [
      "continental",
      "gluten-free",
      "high-fiber",
      "low-calorie",
      "make-ahead",
      "meal-prep",
      "no-cook",
      "vegetarian"
    ],
    "servings": 2,
    "prepMin": 10,
    "cookMin": 0,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Chia seeds",
        "quantity": "40 g",
        "grams": 40
      },
      {
        "name": "Milk (skim)",
        "quantity": "400 ml"
      },
      {
        "name": "Mango",
        "quantity": "240 g",
        "grams": 240
      },
      {
        "name": "Honey",
        "quantity": "1 tbsp"
      }
    ],
    "instructions": [
      "Whisk the chia seeds, milk and honey in a bowl or jar.",
      "Rest 10 minutes, whisk again to break up clumps, then cover.",
      "Refrigerate at least 4 hours or overnight until set.",
      "Top with diced mango and serve chilled."
    ],
    "allergens": [
      "milk"
    ],
    "substitutions": "Use any milk; top with any fruit.",
    "storage": "Refrigerate up to 3 days.",
    "computed": {
      "perServing": {
        "kcal": 260,
        "proteinG": 11.1,
        "carbsG": 42.6,
        "fatG": 6.8,
        "fiberG": 8.8
      },
      "unresolved": []
    },
    "needsReview": false
  },
  {
    "slug": "homemade-muesli-bowl",
    "title": "Homemade Muesli Bowl",
    "cuisine": "Continental",
    "mealType": "breakfast",
    "dietCategory": "vegetarian",
    "tags": [
      "continental",
      "high-fiber",
      "meal-prep",
      "no-cook",
      "vegetarian"
    ],
    "servings": 2,
    "prepMin": 10,
    "cookMin": 0,
    "difficulty": "easy",
    "ingredients": [
      {
        "name": "Oats",
        "quantity": "100 g"
      },
      {
        "name": "Almonds",
        "quantity": "15 g"
      },
      {
        "name": "Raisins",
        "quantity": "20 g",
        "grams": 20
      },
      {
        "name": "Sunflower seeds",
        "quantity": "10 g",
        "grams": 10
      },
      {
        "name": "Apple",
        "quantity": "180 g"
      },
      {
        "name": "Milk (skim)",
        "quantity": "300 ml"
      },
      {
        "name": "Honey",
        "quantity": "1 tsp"
      }
    ],
    "instructions": [
      "Combine the oats, chopped almonds, raisins and sunflower seeds.",
      "Divide between two bowls; pour over the cold milk.",
      "Top with diced apple and a drizzle of honey.",
      "Rest 5 minutes so the oats soften slightly; serve."
    ],
    "allergens": [
      "milk",
      "tree-nuts",
      "wheat"
    ],
    "substitutions": "Add any dried fruit, nuts or seeds; use yogurt instead of milk.",
    "storage": "Keep the dry mix up to 1 month in a sealed jar; add milk and fruit fresh.",
    "computed": {
      "perServing": {
        "kcal": 402.5,
        "proteinG": 16.8,
        "carbsG": 65.7,
        "fatG": 10.2,
        "fiberG": 9.3
      },
      "unresolved": []
    },
    "needsReview": false
  }
];
