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
} from '@prisma/client';
