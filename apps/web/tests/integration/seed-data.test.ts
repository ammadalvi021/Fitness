/**
 * Phase 4 regression: seed data integrity (read-only — never reseeds) and
 * the recipes pagination default (clampInt regression: a missing `limit`
 * param must fall back to 20, not clamp to min=1).
 */
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@fitfusion/db';
import { GET as recipesGET } from '@/app/api/recipes/route';
import { readJson } from './helpers';

describe('seed data (read-only counts)', () => {
  it('has 13 cuisines', async () => {
    expect(await prisma.cuisine.count()).toBe(13);
  });

  it('has 31 recipes', async () => {
    expect(await prisma.recipe.count()).toBe(31);
  });

  it('has 50 exercises', async () => {
    expect(await prisma.exercise.count()).toBe(50);
  });

  it('has 149 foods (40 starter + 109 V18 Pakistani home foods)', async () => {
    expect(await prisma.food.count()).toBe(149);
  });

  it('has 16 V18 food categories', async () => {
    expect(await prisma.foodCategory.count()).toBe(16);
  });

  it('has 544 food aliases (430 V18 + 114 starter-food extensions)', async () => {
    expect(await prisma.foodAlias.count()).toBe(544);
  });

  it('has 230 household portions (183 V18 + 47 starter-food extensions)', async () => {
    expect(await prisma.householdPortion.count()).toBe(230);
  });
});

describe('recipes pagination defaults', () => {
  it('GET /api/recipes with no params returns the default page of 20 of 31', async () => {
    const res = await recipesGET(new NextRequest('http://localhost/api/recipes'));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.total).toBe(31);
    expect(body.limit).toBe(20);
    expect(body.page).toBe(1);
    expect(body.recipes.length).toBe(20); // NOT 1 (the old clampInt bug)
  });

  it('page 2 returns the remaining 11', async () => {
    const res = await recipesGET(
      new NextRequest('http://localhost/api/recipes?page=2'),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.page).toBe(2);
    expect(body.recipes.length).toBe(11);
  });
});
