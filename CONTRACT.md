# FitFusion AI — Integration Contract

Every contributor (human or agent) MUST conform to this contract. It is the
single source of truth for cross-package interfaces. If you need to change a
contract, update this file AND notify the coordinator — do not silently drift.

## Repo layout

```
fitfusion-ai/
  config/branding.ts        # app name, logo, colors (env-overridable)
  config/plans.ts           # Free / Diet / Diet+Exercise catalog + gating
  packages/core/            # @fitfusion/core — pure logic, NO I/O, vitest unit tests
    src/index.ts            # re-exports everything below
  packages/db/              # @fitfusion/db — Prisma schema, migrations, seeds
    prisma/schema.prisma
    prisma/migrations/
    prisma/seed.ts          # recipes (~30) + exercises (~50) + starter foods
    src/index.ts            # exports prisma singleton + types
  packages/ai/              # @fitfusion/ai — SERVER ONLY, OpenAI-compatible provider
    src/index.ts
  apps/web/                 # Next.js 14 App Router + Tailwind
    app/api/...             # REST API routes (route.ts per resource)
    app/(marketing)/...     # landing, pricing, auth pages
    app/(app)/...           # authenticated app shell
    components/             # shared UI
    lib/auth.ts             # requireUser/getSessionUser/requirePlan
    lib/storage.ts          # upload storage adapter
    lib/email.ts            # email driver (console/smtp)
    public/manifest.webmanifest, public/sw.js, public/brand/, public/icons/
```

## @fitfusion/core API (pure functions, no I/O)

```ts
// ---- units ----
export function kgFromLb(lb:number):number
export function lbFromKg(kg:number):number
export function cmFromIn(inches:number):number
export function inFromCm(cm:number):number
export function cmFromFeetInches(ft:number,inches:number):number

// ---- types ----
export type Sex = 'male'|'female'|'other'|'prefer_not_to_say';
export type ActivityLevel = 'sedentary'|'light'|'moderate'|'active'|'very_active';
export type Goal = 'lose'|'maintain'|'gain'|'improve_fitness'|'eat_healthier';
export type MealType = 'breakfast'|'morning_snack'|'lunch'|'afternoon_snack'|'dinner'|'extra';
export interface Nutrients { kcal:number; proteinG:number; carbsG:number; fatG:number; fiberG:number }
export interface SafetyFlags {
  isMinor?:boolean; isPregnant?:boolean; isBreastfeeding?:boolean;
  eatingDisorderRisk?:boolean; medicalCondition?:boolean;
}

// ---- BMI: adult classification ONLY for age >= 18 ----
export interface BmiResult {
  bmi:number;                       // rounded to 1 decimal
  isMinor:boolean;
  classificationKey:'underweight'|'healthy'|'overweight'|'obesity'|null;
  classificationLabel:string|null;   // null for minors
  screeningNote:string;             // always: BMI is a screening measure, not a diagnosis
  pediatricGuidance?:string;        // set for minors: direct to pediatric assessment
}
export function calculateBMI(o:{weightKg:number;heightCm:number;ageYears?:number}):BmiResult

// ---- energy ----
export const ACTIVITY_FACTORS: Record<ActivityLevel,number>;
// { sedentary:1.2, light:1.375, moderate:1.55, active:1.725, very_active:1.9 }
export function mifflinStJeor(o:{sex:Sex;weightKg:number;heightCm:number;ageYears:number}):number
export interface CalorieTarget {
  targetKcal:number; deficitKcal:number; warnings:string[];
  weightLossDisabled:boolean; professionalGuidance?:string; assumptions:string[];
}
export function calculateCalorieTarget(o:{
  tdee:number; goal:Goal; sex:Sex; flags:SafetyFlags;
  targetRateKgPerWeek?:number;      // default 0.5
  userOverrideKcal?:number|null;    // explicit user override, requires acknowledged warning
}):CalorieTarget
// RULES (non-negotiable):
// - Any of isMinor/isPregnant/isBreastfeeding/eatingDisorderRisk/medicalCondition
//   => weightLossDisabled=true, targetKcal=round(tdee), professionalGuidance set,
//      NO deficit prescribed, goal 'lose' treated as 'maintain' with explanation.
// - Else goal 'lose': deficit = min(20% of TDEE, targetRateKgPerWeek*1100, 750);
//   default targetRateKgPerWeek 0.5 (≈550 kcal/day); floor 1500 kcal (male) /
//   1200 kcal (female/other) unless userOverrideKcal provided (then accept but add warning).
// - goal 'gain': +300 kcal surplus. 'maintain'/'improve_fitness'/'eat_healthier': tdee.

// ---- macros & water ----
export function calculateMacros(o:{calories:number;goal:Goal;weightKg:number}):
  {proteinG:number;carbsG:number;fatG:number;fiberG:number;notes:string[]}
// protein g/kg: lose 2.0, gain 1.8, maintain 1.6, else 1.4; fat = 25% kcal /9;
// carbs = remainder /4; fiber = 14g per 1000 kcal.
export function waterGuidanceMl(o:{weightKg:number;activityLevel:ActivityLevel;hotClimate?:boolean}):
  {mlPerDay:number;glasses:number;note:string}
// 35 ml/kg base, +500 ml if active/very_active, +500 if hotClimate.

// ---- nutrition math ----
export function scaleNutrients(n:Nutrients, fromServings:number, toServings:number):Nutrients
export function sumNutrients(list:Nutrients[]):Nutrients
export function roundNutrients(n:Nutrients):Nutrients   // 1 decimal

// ---- allergy / diet validation ----
export function mealContainsAllergen(ingredients:string[], allergens:string[]):string[]
// case-insensitive substring match; returns the matched allergen names
export interface AllergyCheckMeal {
  name?:string; ingredients:{name:string}[]; dietCategory:string; labels:string[];
}
export interface AllergyProfile { allergies?:string[]; dietPreference?:string }
export interface MealValidation { ok:boolean; violations:string[] }
export function validateMealAgainstProfile(meal:AllergyCheckMeal, profile:AllergyProfile):MealValidation
// dietPreference rules: 'vegetarian' => dietCategory must be 'vegetarian';
// 'vegan' => vegetarian + labels include 'vegan'; 'halal' => labels include 'halal'
//   OR dietCategory 'vegetarian' (plant-based is halal-safe); 'pescatarian' =>
//   vegetarian OR labels include 'pescatarian'/'fish'/'seafood'.
// NEVER silently substitute a restricted food: violations must be surfaced.

// ---- deterministic plan generation (works with NO AI keys) ----
export interface TemplateMeal {
  id:string; name:string; mealType:MealType;
  ingredients:{name:string;quantity:string;grams:number}[];
  nutrients:Nutrients;              // per 1 serving
  prepMin:number; cookMin:number; instructions:string[];
  tags:string[]; cuisine?:string;
  dietCategory:'vegetarian'|'non_vegetarian'; labels:string[];
}
export interface PlannedMeal extends TemplateMeal { servings:number; scaledNutrients:Nutrients }
export interface DayPlan { dayIndex:number; targetKcal:number; meals:PlannedMeal[]; totals:Nutrients }
export const DEFAULT_TEMPLATE_MEALS: TemplateMeal[];   // ~24 meals, all 6 meal types
export function generateWeeklyPlan(o:{
  meals:TemplateMeal[]; calorieTarget:number; dietPreference:string;
  allergies:string[]; dislikedIngredients:string[]; seed?:number;
}):DayPlan[]
// DETERMINISTIC: seeded PRNG (fixed default seed). Filters out any meal violating
// diet/allergy/dislikes. Picks meals landing near calorieTarget (within ~15%).
export function regenerateMeal(dayPlan:DayPlan, dayIndex:number, mealType:MealType,
  pool:TemplateMeal[], calorieTarget:number):DayPlan
export function swapMealsBetweenDays(plan:DayPlan[], d1:number, m1:number, d2:number, m2:number):DayPlan[]
export function scaleMealServings(meal:PlannedMeal, servings:number):PlannedMeal

// ---- shopping list ----
export interface ShoppingItem { name:string; quantity:string; grams?:number; category:string }
export function consolidateShoppingList(items:ShoppingItem[]):Record<string,ShoppingItem[]>
// groups by category; merges same-name items (quantity strings joined with " + ")

// ---- idempotency ----
export function normalizeIdempotencyKey(key:string|undefined|null):string|null
// trims; empty/whitespace => null

// ---- validation (zod) ----
export const RegisterSchema;      // email, password min 8 with letter+number, name?
export const LoginSchema;         // email, password
export const ProfileUpdateSchema; // all-optional profile fields, sane ranges
export const OnboardingSchema;    // onboarding answers incl. safety flags
export const DiaryEntrySchema;    // date, mealType, foodId|customName, servings, nutrients
export const MeasurementSchema;   // type, value, unit, recordedAt?
export const WaterLogSchema;      // date, ml
export const ScanConfirmSchema;   // items[] with name/servings/nutrients
export const CoachMessageSchema;  // content min 1
// plus inferred TS types: RegisterInput, LoginInput, etc.
## Prisma models (packages/db/prisma/schema.prisma)

Model names and key fields are FIXED — API code depends on them:

- `User`: id(cuid), email(unique), passwordHash(String?), name(String?),
  emailVerifiedAt(DateTime?), status(String @default "active"), createdAt, updatedAt
- `VerificationToken`: id, userId(FK), tokenHash(unique), type("email_verify"|"password_reset"),
  expiresAt, usedAt(DateTime?), createdAt
- `Session`: id, userId(FK), tokenHash(unique), expiresAt, createdAt, lastSeenAt,
  userAgent(String?), ip(String?)
- `Consent`: id, userId(FK), type(String), granted(Boolean), grantedAt, textVersion(String), createdAt
- `Profile`: id, userId(unique FK), displayName(String?), dateOfBirth(DateTime?), sex(String?),
  heightCm(Float?), activityLevel(String?), goal(String?), targetWeightKg(Float?),
  fitnessExperience(String?), workoutLocation(String?), equipment(String[] @default []),
  workoutDays(String[] @default []), workoutMinutesPerDay(Int?),
  dietPreference(String? @default "flexible"), allergies(String[] @default []),
  intolerances(String[] @default []), halalOnly(Boolean @default false),
  preferredCuisines(String[] @default []), dislikedIngredients(String[] @default []),
  mealsPerDay(Int? @default 3), budgetTier(String?), maxCookMinutes(Int?),
  healthLimitations(String?), exerciseRestrictions(String?),
  eatingDisorderRisk(Boolean @default false), isPregnant(Boolean @default false),
  isBreastfeeding(Boolean @default false), onboardingCompletedAt(DateTime?), updatedAt
- `Subscription`: id, userId(unique FK), planId(String @default "free"),
  status(String @default "active"), billingPeriod(String?), provider(String?),
  providerRef(String?), currentPeriodEnd(DateTime?), createdAt, updatedAt
- `Measurement`: id, userId(FK), type("weight"|"height"|"waist"|"bmi"), value(Float),
  unit(String), recordedAt(DateTime @default now()), note(String?)
- `Food`: id, name(unique), brand(String?), servingSize(Float), servingUnit(String),
  kcal(Float), proteinG(Float), carbsG(Float), fatG(Float), fiberG(Float),
  source("seeded"|"user"|"ai_estimate"), verified(Boolean @default false), createdAt
- `DiaryEntry`: id, userId(FK), date(DateTime @db.Date), mealType(String),
  foodId(FK?), customName(String?), servings(Float @default 1),
  kcal(Float), proteinG(Float), carbsG(Float), fatG(Float), fiberG(Float),
  source("manual"|"scan"|"recipe"|"plan"), scanId(FK?), recipeId(FK?),
  idempotencyKey(String?), createdAt, updatedAt
  @@unique([userId, idempotencyKey])
- `WaterLog`: id, userId(FK), date(DateTime @db.Date), ml(Int @default 0), updatedAt
  @@unique([userId, date])
- `MealPlan`: id, userId(FK), weekStart(DateTime @db.Date), days(Json),
  calorieTarget(Int), generatedBy("template"|"ai"), status(String @default "active"), createdAt
- `FavoriteMeal`: id, userId(FK), name(String), items(Json), kcal(Float),
  proteinG(Float), carbsG(Float), fatG(Float), fiberG(Float), createdAt
- `Cuisine`: id, name(unique), region(String?), createdAt
- `Recipe`: id, slug(unique), title, cuisineId(FK?), dietCategory("vegetarian"|"non_vegetarian"),
  tags(String[] @default []), servings(Int), prepMin(Int), cookMin(Int), difficulty(String),
  ingredients(Json), instructions(Json), kcalPerServing(Float),
  proteinPerServing(Float), carbsPerServing(Float), fatPerServing(Float), fiberPerServing(Float),
  imageUrl(String?), videoUrl(String?), source("curated"|"ai"), verified(Boolean @default false),
  allergens(String[] @default []), createdAt, updatedAt
- `Exercise`: id, slug(unique), name, description, muscleGroups(String[]),
  equipment(String[]), difficulty("beginner"|"intermediate"|"advanced"),
  exerciseType(String), trainingStyles(String[]), homeSuitable(Boolean), gymSuitable(Boolean),
  steps(Json), breathing(String?), commonMistakes(Json),
  easierVariation(String?), harderVariation(String?), safetyNotes(String?),
  mediaType(String @default "none"), mediaUrl(String?), createdAt
- `WorkoutPlan`: id, userId(FK), weekStart(DateTime @db.Date), days(Json),
  generatedBy("template"|"ai"), createdAt
- `WorkoutSession`: id, userId(FK), workoutPlanId(FK?), name(String),
  startedAt(DateTime @default now()), endedAt(DateTime?), status(String @default "in_progress"), createdAt
- `WorkoutLog`: id, sessionId(FK), exerciseId(FK), sets(Json), notes(String?), createdAt
- `PersonalRecord`: id, userId(FK), exerciseId(FK), metric(String), value(Float),
  unit(String), achievedAt(DateTime @default now())
  @@unique([userId, exerciseId, metric])
- `FoodScan`: id, userId(FK), imageUrl(String?), items(Json),
  status("pending"|"review"|"confirmed"|"failed"|"not_configured"), provider(String?),
  createdAt
- `CoachConversation`: id, userId(FK), title(String?), createdAt, updatedAt
- `CoachMessage`: id, conversationId(FK), role("user"|"assistant"|"system"), content(String), createdAt
- `DataExport`: id, userId(FK), status("pending"|"ready"|"failed"), fileUrl(String?),
  requestedAt(DateTime @default now()), completedAt(DateTime?)

## API routes (apps/web/app/api/**/route.ts)

All routes: JSON in/out, `NextResponse.json`. Errors: `{error:{code,message}}`.
Auth via `lib/auth.ts`. Server-side zod validation of every input.

- `POST /api/auth/register` {email,password,name} -> 201 {user}
- `POST /api/auth/login` {email,password} -> 200 {user} + httpOnly cookie
- `POST /api/auth/logout` -> clears cookie
- `GET /api/auth/me` -> {user, profile, subscription} | 401
- `POST /api/auth/request-verification` -> sends token email
- `POST /api/auth/verify` {token} -> marks verified
- `POST /api/auth/forgot-password` {email} -> always 200 (no enumeration)
- `POST /api/auth/reset-password` {token,newPassword}
- `GET /api/auth/oauth/[provider]` -> {configured:false} | redirect to provider
- `GET /api/profile`, `PUT /api/profile`
- `POST /api/onboarding` (save + mark complete)
- `GET /api/plans` (public catalog), `GET /api/subscriptions`,
  `POST /api/subscriptions` {planId} (records selection; billing only via provider),
  `POST /api/subscriptions/cancel`
- `GET /api/diary?date=YYYY-MM-DD`, `POST /api/diary` (Idempotency-Key),
  `PATCH /api/diary/[id]`, `DELETE /api/diary/[id]`
- `GET /api/water?date=`, `POST /api/water` {date, ml} — upsert/set semantics
  (idempotent absolute daily total; read-then-write is safe)
- `GET /api/calculators/bmi` info; `POST /api/calculators/bmi` {weight,height,units,ageYears?}
  (public, no auth required)
- `POST /api/meals/plans/generate` {weekStart?, useAI?} (plan:diet)
- `GET /api/meals/plans`, `POST /api/meals/plans/[id]/regenerate-meal` {dayIndex,mealType}
- `GET /api/meals/shopping-list?planId=`
- `GET /api/exercises?q=&muscle=&equipment=&difficulty=`, `GET /api/exercises/[slug]`
- `POST /api/workouts/plans/generate` (plan:diet_exercise), `GET /api/workouts/plans`
- `POST /api/workouts/sessions` {name?,workoutPlanId?}, `GET /api/workouts/sessions/[id]`,
  `PATCH /api/workouts/sessions/[id]` {status|endedAt}, `POST /api/workouts/sessions/[id]/logs` {exerciseId,sets,notes?}
- `GET /api/recipes?cuisine=&diet=&tag=&q=&maxKcal=`, `GET /api/recipes/[slug]`,
  `POST /api/recipes/[id]/favorite`, `GET /api/favorites`
- `POST /api/scans` (multipart `image`, ≤UPLOAD_MAX_MB) -> {scan} (status review|not_configured)
- `GET /api/scans`, `POST /api/scans/[id]/confirm` {items:[...]} -> creates DiaryEntries
- `GET /api/coach/conversations`, `POST /api/coach/conversations`,
  `POST /api/coach/conversations/[id]/messages` {content}
- `GET /api/progress?days=30` {weights, nutritionByDay, workouts, waterByDay}
- `GET /api/measurements?type=`, `POST /api/measurements`
- `GET /api/settings`, `PUT /api/settings`
- `POST /api/data-export`, `GET /api/data-export/[id]`
- `DELETE /api/account` {password} -> wipes user data
- `GET /api/health` -> {ok:true}, `GET /api/config` -> {branding, plans, ai:{chat,vision}, billing}

## UI routes (apps/web/app)

- `/` marketing landing; `/pricing`; `/auth/login|register|verify|forgot-password|reset-password`
- `/onboarding` (multi-step, skippable); `/dashboard` (home)
- `/nutrition` (diary), `/nutrition/plans`, `/scanner`, `/recipes`, `/recipes/[slug]`
- `/workouts`, `/workouts/library`, `/workouts/session/[id]`, `/progress`
- `/coach`, `/goals`, `/calculators`, `/profile`, `/settings`, `/plans` (subscription mgmt)

Mobile bottom nav: Home, Nutrition, Workouts, Food Scanner, Profile.
Desktop: sidebar with full nav. Light/dark toggle persisted in localStorage.

## Safety copy (must appear verbatim-ish in UI)

- BMI: "BMI is a screening measure, not a diagnosis."
- Food scan: "Estimates only — a photo can't show exact portions, oils, or hidden ingredients."
- Workout: "Stop exercising and seek medical attention if you feel chest pain, dizziness, or unusual shortness of breath."
- Minors/pregnancy/etc: "Please consult a qualified health professional for personalized guidance."

## Acceptance rules

PASS only when exercised and verified. IMPLEMENTED = code exists, unverified.
PARTIAL = required production path missing. PLANNED = not implemented.
BLOCKED = external dependency, with unblock requirement named.
