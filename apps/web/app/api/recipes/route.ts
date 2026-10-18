import { NextRequest, NextResponse } from 'next/server';
import { prisma, type Prisma, buildAliasSearchClause } from '@fitfusion/db';
import { CustomRecipeSchema, buildContentSnapshot, computeRecipeContentHash, screenIngredientAllergens } from '@fitfusion/core';
import {
  checkRecipeDiet,
  dietAmbiguityWarning,
  dietConflictMessage,
} from '@fitfusion/core';
import { getSessionUser, requireUser } from '@/lib/auth';
import { isAdmin } from '@/lib/admin';
import { apiError, apiOk, clampInt, readJson, zodMessage } from '@/lib/server-api';
import { serializeRecipePublic } from '@/lib/recipe-evidence';
import { buildRecipeTagWhere, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, paginate } from '@/lib/recipe-tags';
import { buildAllergenExclusionWhere } from '@/lib/recipe-allergen-filter';
import { recipeNutrition, resolveIngredientRows, toInstructionSteps, toDietScreenRows, ingredientAllergenScreenNames } from './custom-recipe';

export const dynamic = 'force-dynamic';

/**
 * Serving contract (v21.2) — the response fields mean exactly this:
 * - kcalPerServing / proteinPerServing / carbsPerServing / fatPerServing /
 *   fiberPerServing are nutrients for ONE serving. Nutrition for N servings =
 *   per-serving × N (clients must never multiply/divide these by the yield
 *   factor again).
 * - `servings` is the recipe's original yield; `ingredients[].grams` are
 *   quantities for that original yield — displayed quantities scale by
 *   (selectedYield / servings).
 *
 * Recipe browsing.
 * - Public curated browsing with filters: q, cuisine, diet, tag (repeatable
 *   and/or comma-separated; AND semantics; `halal` also matches
 *   `halal-friendly`), mealType, difficulty, minKcal/maxKcal,
 *   minProtein/maxProtein, maxTime (prep+cook), excludeAllergen
 *   (comma-separated; conservative — also excludes recipes that were never
 *   allergen-screened, and resolves allergy synonyms/canonical family
 *   names: 'dairy'→'milk', 'gluten'→'wheat', 'peanut'→'peanuts',
 *   'tree nut'→'tree nuts'), sort, page, pageSize (alias: limit).
 *   Private user recipes are excluded here.
 * - `q` matches recipe titles (case-insensitive substring, legacy) AND
 *   persisted recipe aliases (normalized substring; v21.2). A recipe with
 *   no aliases behaves exactly as before.
 * - `mine=1` (authenticated): lists the caller's private custom recipes.
 *   The `excludeAllergen` conservative screen applies here too (v21.8 P6):
 *   unscreened private recipes are excluded from filtered results — the
 *   exclusion request is never silently dropped for private rows.
 * - Response: { recipes, page, pageSize, limit (=pageSize, legacy),
 *   pageCount, total }.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mine = sp.get('mine') === '1';

  // v21.8 (P6): parse the allergen exclusion BEFORE the mine=1 branch so
  // the SAME conservative screen (apps/web/lib/recipe-allergen-filter.ts)
  // applies to private recipes too — a private recipe must never be
  // presented as though it satisfied an exclusion request when the public
  // branch would have excluded it.
  const excludeAllergen = (sp.get('excludeAllergen') ?? '')
    .split(',').map((a) => a.trim().toLowerCase()).filter(Boolean);

  if (mine) {
    const s = await requireUser(req);
    if (s instanceof NextResponse) return s;
    const and: Prisma.RecipeWhereInput[] = [{ userId: s.user.id, isPrivate: true }];
    const allergenExclusion = buildAllergenExclusionWhere(excludeAllergen);
    if (allergenExclusion) and.push(allergenExclusion);
    const recipes = await prisma.recipe.findMany({
      where: { AND: and },
      orderBy: { updatedAt: 'desc' },
    });
    // v21.3: shape governance fields for the owner's own list too.
    // v21.4: serializeRecipePublic strips the raw evidence columns — the
    // owner is an ordinary user, so full evidence stays admin-only.
    const admin = isAdmin(s);
    return apiOk({ recipes: recipes.map((r) => serializeRecipePublic(r, admin)) });
  }

  const q = (sp.get('q') ?? '').trim();
  const cuisine = (sp.get('cuisine') ?? '').trim();
  const diet = (sp.get('diet') ?? '').trim().toLowerCase();
  const mealType = (sp.get('mealType') ?? '').trim().toLowerCase();
  const difficulty = (sp.get('difficulty') ?? '').trim().toLowerCase();
  const minKcal = sp.get('minKcal') ? Number(sp.get('minKcal')) : undefined;
  const maxKcal = sp.get('maxKcal') ? Number(sp.get('maxKcal')) : undefined;
  const minProtein = sp.get('minProtein') ? Number(sp.get('minProtein')) : undefined;
  const maxProtein = sp.get('maxProtein') ? Number(sp.get('maxProtein')) : undefined;
  const maxTime = sp.get('maxTime') ? Number(sp.get('maxTime')) : undefined;
  // v21.8 (P6): excludeAllergen is parsed before the mine=1 branch so both
  // branches share the same conservative screen.
  const tagParams = sp.getAll('tag')
    .flatMap((v) => v.split(','))
    .map((t) => t.trim())
    .filter(Boolean);
  const sort = (sp.get('sort') ?? 'name').trim().toLowerCase();
  // V21.2 (P5): `pageSize` is the documented param; `limit` is kept as a
  // backward-compatible alias (same value). Capped at 48 — no silent
  // 500-row in-memory pattern.
  const pageSize = clampInt(sp.get('pageSize') ?? sp.get('limit'), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const page = clampInt(sp.get('page'), 1, 1, 1000);

  if (diet && diet !== 'vegetarian' && diet !== 'non_vegetarian') {
    return apiError('validation_error', 'diet must be vegetarian or non_vegetarian', 400);
  }
  if (difficulty && !['easy', 'medium', 'hard'].includes(difficulty)) {
    return apiError('validation_error', 'difficulty must be easy, medium or hard', 400);
  }
  const SORTS = ['name', 'time', 'kcal', 'protein'] as const;
  if (!SORTS.includes(sort as (typeof SORTS)[number])) {
    return apiError('validation_error', `sort must be one of ${SORTS.join(', ')}`, 400);
  }

  const and: Prisma.RecipeWhereInput[] = [];
  // V21.2: `q` matches titles AND persisted aliases (normalized).
  const qClause = buildAliasSearchClause(q);
  if (qClause) and.push(qClause);
  if (diet) and.push({ dietCategory: diet });
  // V21.2 (P5): tag filter is DB-side (exact stored spellings, AND
  // semantics) — `halal` also matches `halal-friendly`.
  const tagWhere = buildRecipeTagWhere(tagParams);
  if (tagWhere) and.push(tagWhere);
  // v21.8 (P3): CONSERVATIVE allergen exclusion, built by
  // buildAllergenExclusionWhere (apps/web/lib/recipe-allergen-filter.ts).
  // The clause excludes recipes whose stored allergen list contains any
  // resolved exclusion term AND excludes recipes that were never
  // allergen-screened (allergenScreened=false) — an unscreened recipe can
  // never be presented as though it satisfied the exclusion request
  // (fail closed: unknown is never treated as safe). Exclusion terms
  // resolve synonyms/canonical family names ('dairy'→'milk',
  // 'gluten'→'wheat', 'peanut'→'peanuts', 'tree nut'→'tree nuts', …).
  // Screening stays name-based only — never an allergy-safety guarantee
  // (ALLERGEN_CAVEAT is shown on the recipe detail page).
  const allergenExclusion = buildAllergenExclusionWhere(excludeAllergen);
  if (allergenExclusion) and.push(allergenExclusion);
  if (mealType) and.push({ mealType: { equals: mealType, mode: 'insensitive' } });
  if (difficulty) and.push({ difficulty: { equals: difficulty, mode: 'insensitive' } });
  if (minKcal !== undefined && Number.isFinite(minKcal)) and.push({ kcalPerServing: { gte: minKcal } });
  if (maxKcal !== undefined && Number.isFinite(maxKcal)) and.push({ kcalPerServing: { lte: maxKcal } });
  if (minProtein !== undefined && Number.isFinite(minProtein)) and.push({ proteinPerServing: { gte: minProtein } });
  if (maxProtein !== undefined && Number.isFinite(maxProtein)) and.push({ proteinPerServing: { lte: maxProtein } });
  if (cuisine) and.push({ cuisine: { name: { equals: cuisine, mode: 'insensitive' } } });
  // Private user recipes never leak into public browsing.
  and.push({ isPrivate: false });

  const orderBy: Prisma.RecipeOrderByWithRelationInput =
    sort === 'kcal' ? { kcalPerServing: 'asc' }
    : sort === 'protein' ? { proteinPerServing: 'desc' }
    : sort === 'time' ? { cookMin: 'asc' }
    : { title: 'asc' };

  // V21.2 (P5): real DB pagination. `maxTime` bounds prepMin+cookMin, a
  // computed value the schema has no column for (migrations out of scope),
  // so it is enforced server-side on the FULL DB-filtered id set — never on
  // a partial page, never behind an in-memory row cap.
  const candidates = await prisma.recipe.findMany({
    where: and.length ? { AND: and } : undefined,
    select: { id: true, prepMin: true, cookMin: true },
    orderBy,
  });
  const inTime = maxTime !== undefined && Number.isFinite(maxTime)
    ? candidates.filter((r) => r.prepMin + r.cookMin <= (maxTime as number))
    : candidates;
  const total = inTime.length;
  const info = paginate(total, page, pageSize);
  const pageIds = inTime.slice(info.skip, info.skip + info.take).map((r) => r.id);

  const recipes = pageIds.length
    ? await prisma.recipe.findMany({
        where: { id: { in: pageIds } },
        include: { cuisine: { select: { id: true, name: true } } },
      })
    : [];
  const rank = new Map(pageIds.map((id, i) => [id, i]));
  recipes.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));

  // v21.3: the server is the tier authority — tier is computed canonically
  // from full evidence; full evidence objects go to admins only.
  // v21.4: serializeRecipePublic strips the raw evidence columns before
  // responding (the old `{ ...r, ...shapeRecipeEvidence() }` spread left the
  // raw JSONB fields in place for non-admins).
  const s = await getSessionUser(req);
  const admin = !!s && isAdmin(s);
  const shaped = recipes.map((r) => serializeRecipePublic(r, admin));

  // `limit` kept for backward compatibility (same value as pageSize).
  return apiOk({ recipes: shaped, page: info.page, limit: info.take, pageSize: info.take, pageCount: info.pageCount, total });
}

/**
 * Create a private custom recipe.
 * Body: { name, ingredients: [{foodId?, name, grams, kcal?, proteinG?,
 *   carbsG?, fatG?, fiberG?}] (nutrients per 100 g), yieldGrams?, portions,
 *   instructions?, dietCategory (REQUIRED — v21.4), prepMin?, cookMin?,
 *   difficulty? }
 *
 * v21.4 (ITEM 6): `dietCategory` is REQUIRED — the zod schema rejects a
 * missing/unknown value (validation error), and the server NEVER defaults it
 * to 'vegetarian' (that default silently mislabeled meat recipes).
 *
 * The server computes totals from ingredient nutrients × grams and stores
 * per-portion values. Water rows contribute 0 kcal. Diary entries keep
 * snapshotting nutrients at log time, so later catalogue edits never
 * rewrite a user's recipe history.
 *
 * v21.4 (ITEM 6): allergen name-screening runs at creation — the detected
 * family list is stored in `allergens` and `allergenScreened: true` records
 * that the screening was performed. Screening is NAME-BASED ONLY (declared
 * from ingredient names), never a certified allergen analysis — the
 * ALLERGEN_CAVEAT must accompany it in the UI. An empty detected list with
 * screened=true means "nothing detected in the ingredient names", NOT
 * allergen-free.
 */
export async function POST(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = CustomRecipeSchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid recipe', 400, zodMessage(parsed.error));
  }
  const input = parsed.data;

  const { rows, missingFood, warnings, nutritionIncomplete } =
    await resolveIngredientRows(input.ingredients);
  if (missingFood) {
    return apiError('food_not_found', `Food not found for ingredient "${missingFood}"`, 404);
  }
  const { perPortion } = recipeNutrition(rows, input.portions);
  // V21.4 (ITEM 6): name-based allergen screening at creation. V21.5 (P2):
  // the screener sees the CANONICAL catalogue names + persisted food
  // aliases — never the client-supplied display name (a rename to "nutty
  // spread" must not hide the peanut). The detected
  // family list is stored as `allergens`; `allergenScreened: true` records
  // that the screening was performed — screening status is SEPARATE from
  // the list itself, so an empty list can never again read as "screened and
  // clean" by accident. The PATCH material-change path (owned by the PATCH
  // worker) re-runs this via dietAllergenRecheckNeeded() from @fitfusion/core.
  const screenedAllergens = screenIngredientAllergens(
    rows.flatMap(ingredientAllergenScreenNames),
  );
  // v21.5 (P3): the declared dietCategory is checked against the
  // ingredients — a 'vegetarian' declaration with unambiguous
  // meat/poultry/fish is REJECTED with a 400 naming the ingredient(s),
  // never silently stored. Free-text ingredients that cannot be confirmed
  // vegetarian keep the recipe under review (needsReview stays true with
  // a warning) — unfamiliar is never assumed vegetarian. Dairy/eggs are
  // NOT conflicts: lacto-ovo is a valid vegetarian interpretation in this
  // market (see packages/core/src/diet-conflicts.ts).
  const dietCheck = checkRecipeDiet(toDietScreenRows(rows), input.dietCategory);
  if (!dietCheck.ok) {
    return apiError(
      'diet_conflict',
      dietConflictMessage(dietCheck.conflicts, input.dietCategory),
      400,
    );
  }
  const dietWarnings = dietCheck.ambiguous.length
    ? [dietAmbiguityWarning(dietCheck.ambiguous)]
    : [];
  const slug =
    `u${s.user.id.replace(/[^a-z0-9]/gi, '').slice(-6)}-` +
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  const recipe = await prisma.recipe.create({
    data: {
      slug,
      title: input.name.trim(),
      // V21.4: dietCategory is REQUIRED (zod) — never defaulted to
      // 'vegetarian'; a missing value is a 400, not a guess.
      dietCategory: input.dietCategory,
      tags: [],
      servings: input.portions,
      prepMin: input.prepMin ?? 0,
      cookMin: input.cookMin ?? 0,
      difficulty: input.difficulty ?? 'easy',
      ingredients: rows as unknown as Prisma.InputJsonValue,
      instructions: toInstructionSteps(input.instructions),
      kcalPerServing: perPortion.kcal,
      proteinPerServing: perPortion.proteinG,
      carbsPerServing: perPortion.carbsG,
      fatPerServing: perPortion.fatG,
      fiberPerServing: perPortion.fiberG,
      source: 'user',
      verified: false,
      // V21.4: detected allergen families from ingredient-name screening,
      // recorded alongside the screening status. The empty list + false
      // state (pre-v21.4 rows) must never render as "no allergens".
      allergens: screenedAllergens,
      allergenScreened: true,
      userId: s.user.id,
      isPrivate: true,
      yieldGrams: input.yieldGrams ?? null,
      // V21.2 (P4/P1): unknown ingredients or un-convertible servings make
      // the recipe's nutrition incomplete — never silently partial.
      // v21.5 (P3): ambiguous vegetarian-declaration ingredients do too.
      needsReview: nutritionIncomplete || dietWarnings.length > 0,
      // V21.5 (P4): the initial content revision hash (optimistic
      // concurrency). V21.6: built through buildContentSnapshot — the
      // single source of truth — from the exact rows being persisted
      // (which carry foodId/canonicalName since v21.6), so the stored hash
      // can never drift from the stored JSON. Every later PATCH recomputes
      // it from the merged post-write content in the same atomic update.
      contentHash: computeRecipeContentHash(
        buildContentSnapshot({
          ingredients: rows,
          servings: input.portions,
          dietCategory: input.dietCategory,
          yieldGrams: input.yieldGrams ?? null,
          tags: [],
          allergens: screenedAllergens,
        }),
      ),
    },
  });
  // v21.4: never return the raw Prisma record — strip the evidence columns
  // (they are null at creation, but the serializer is the single safe path).
  return apiOk(
    {
      recipe: serializeRecipePublic(recipe, isAdmin(s)),
      nutritionWarnings: warnings,
      nutritionIncomplete,
      // v21.5 (P3): vegetarian-declaration ambiguity warnings (empty when
      // the declaration is clean or not vegetarian).
      dietWarnings,
    },
    201,
  );
}
