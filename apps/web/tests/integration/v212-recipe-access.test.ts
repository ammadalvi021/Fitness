/**
 * V21.2 private recipe access control.
 *
 * GET /api/recipes/[slug] must enforce isPrivate/ownership:
 *  (1) anonymous GET on a private recipe -> 404 (no existence leakage)
 *  (2) owner GET on a private recipe -> 200 with the recipe
 *  (3) authenticated non-owner GET on a private recipe -> 404
 *  (4) public recipe GET (anonymous + authenticated) -> 200
 *
 * DB-backed — skipped gracefully when no PostgreSQL is reachable (db-guard).
 */
import { NextRequest } from 'next/server';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@fitfusion/db';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { GET as recipeGET } from '@/app/api/recipes/[slug]/route';
import { POST as favoritePOST } from '@/app/api/recipes/[slug]/favorite/route';
import {
  authed,
  cleanupUsers,
  jsonRequest,
  readJson,
  registerAndLogin,
  uniqueEmail,
} from './helpers';
import { dbAvailable } from './db-guard';

const HAS_DB = await dbAvailable();

const RUN = `v212r${Date.now().toString(36)}`;

function recipeData(title: string, extra: Record<string, unknown> = {}) {
  return {
    slug: `${RUN}-${title.replace(/\s+/g, '-').toLowerCase()}`,
    title: `${RUN} ${title}`,
    dietCategory: 'vegetarian',
    tags: [],
    servings: 2,
    prepMin: 10,
    cookMin: 20,
    difficulty: 'easy',
    ingredients: [],
    instructions: [],
    kcalPerServing: 100,
    proteinPerServing: 5,
    carbsPerServing: 15,
    fatPerServing: 3,
    fiberPerServing: 2,
    source: 'curated',
    ...extra,
  };
}

describe.skipIf(!HAS_DB)('V21.2 private recipe access control', () => {
  let ownerToken = '';
  let strangerToken = '';
  let ownerId = '';
  let privateRecipe: { id: string; slug: string };
  let publicRecipe: { id: string; slug: string };
  const recipeIds: string[] = [];

  afterAll(async () => {
    for (const id of recipeIds) {
      await prisma.recipe.delete({ where: { id } }).catch(() => {});
    }
    await cleanupUsers();
  });

  it('registers an owner and a stranger', async () => {
    const a = await registerAndLogin(registerPOST, loginPOST, uniqueEmail('ff-v212a'));
    const b = await registerAndLogin(registerPOST, loginPOST, uniqueEmail('ff-v212b'));
    ownerToken = a.token;
    strangerToken = b.token;
    ownerId = a.userId;
    expect(ownerToken).toBeTruthy();
    expect(strangerToken).toBeTruthy();
  });

  it('creates one private (owned) and one public recipe', async () => {
    const priv = await prisma.recipe.create({
      data: recipeData('private', { userId: ownerId, isPrivate: true, source: 'user' }),
    });
    const pub = await prisma.recipe.create({
      data: recipeData('public', { isPrivate: false }),
    });
    privateRecipe = { id: priv.id, slug: priv.slug };
    publicRecipe = { id: pub.id, slug: pub.slug };
    recipeIds.push(priv.id, pub.id);
    expect(priv.isPrivate).toBe(true);
    expect(pub.isPrivate).toBe(false);
  });

  it('(1) anonymous GET on a private recipe -> 404', async () => {
    const res = await recipeGET(
      jsonRequest(`http://localhost/api/recipes/${privateRecipe.slug}`, 'GET'),
      { params: { slug: privateRecipe.slug } },
    );
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.error.code).toBe('not_found');
  });

  it('(2) owner GET on a private recipe -> 200 with data', async () => {
    const res = await recipeGET(
      authed(
        jsonRequest(`http://localhost/api/recipes/${privateRecipe.slug}`, 'GET'),
        ownerToken,
      ),
      { params: { slug: privateRecipe.slug } },
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.recipe.id).toBe(privateRecipe.id);
    expect(body.recipe.isPrivate).toBe(true);
  });

  it('(3) authenticated non-owner GET on a private recipe -> 404', async () => {
    const res = await recipeGET(
      authed(
        jsonRequest(`http://localhost/api/recipes/${privateRecipe.slug}`, 'GET'),
        strangerToken,
      ),
      { params: { slug: privateRecipe.slug } },
    );
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.error.code).toBe('not_found');
  });

  it('(4a) anonymous GET on a public recipe -> 200', async () => {
    const res = await recipeGET(
      jsonRequest(`http://localhost/api/recipes/${publicRecipe.slug}`, 'GET'),
      { params: { slug: publicRecipe.slug } },
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.recipe.id).toBe(publicRecipe.id);
  });

  it('(4b) authenticated GET on a public recipe -> 200', async () => {
    const res = await recipeGET(
      authed(
        jsonRequest(`http://localhost/api/recipes/${publicRecipe.slug}`, 'GET'),
        strangerToken,
      ),
      { params: { slug: publicRecipe.slug } },
    );
    expect(res.status).toBe(200);
  });

  it('missing slug still -> 404', async () => {
    const res = await recipeGET(
      jsonRequest('http://localhost/api/recipes/no-such-slug', 'GET'),
      { params: { slug: 'no-such-slug' } },
    );
    expect(res.status).toBe(404);
  });

  it('favorite sibling: non-owner favoriting a private recipe -> 404', async () => {
    const res = await favoritePOST(
      authed(
        jsonRequest(
          `http://localhost/api/recipes/${privateRecipe.slug}/favorite`,
          'POST',
        ),
        strangerToken,
      ),
      { params: { slug: privateRecipe.slug } },
    );
    expect(res.status).toBe(404);
  });

  it('favorite sibling: owner favoriting their own private recipe -> 201', async () => {
    const res = await favoritePOST(
      authed(
        jsonRequest(
          `http://localhost/api/recipes/${privateRecipe.slug}/favorite`,
          'POST',
        ),
        ownerToken,
      ),
      { params: { slug: privateRecipe.slug } },
    );
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.favorited).toBe(true);
  });
});
