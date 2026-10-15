// @fitfusion/db — Prisma client singleton (dev-safe via globalThis guard)
// plus re-exports of Prisma model types for the web app.
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export type { Prisma } from '@prisma/client';
// V20 Feature 5: runtime Prisma namespace (DbNull for clearing nullable Json).
export { Prisma as PrismaRuntime } from '@prisma/client';
export type {
  User,
  VerificationToken,
  Session,
  Consent,
  Profile,
  Subscription,
  Measurement,
  Food,
  DiaryEntry,
  WaterLog,
  MealPlan,
  FavoriteMeal,
  Cuisine,
  Recipe,
  Exercise,
  WorkoutPlan,
  WorkoutSession,
  WorkoutLog,
  PersonalRecord,
  FoodScan,
  CoachConversation,
  CoachMessage,
  DataExport,
  // V18 — location-aware food database (restaurants & menus)
  Restaurant,
  RestaurantMenuItem,
  MenuCorrection,
  // V21.2 — recipe aliases
  RecipeAlias,
} from '@prisma/client';

// V21.2 — recipe alias normalization & search-clause helpers (pure, no DB I/O).
export {
  normalizeAlias,
  detectAliasLanguage,
  buildRecipeAliasRows,
  buildAliasSearchClause,
} from './alias-normalize.js';
export type { AliasLanguage, RecipeAliasRow } from './alias-normalize.js';
