/**
 * @fitfusion/ai — SERVER ONLY.
 *
 * OpenAI-compatible AI provider adapter (chat completions + vision).
 *
 * NEVER import this package from a client component or any client-side
 * bundle: it reads server secrets (AI_API_KEY) and must stay on the server.
 * Every function returns `{ status: 'not_configured' }` when AI_API_KEY is
 * unset — no network call is ever made without a key.
 *
 * NEVER-FABRICATE RULE: on any failure to obtain or parse a real model
 * response, these functions return `{ status: 'error', items: [], ... }`
 * (or the equivalent empty/error shape) — they NEVER return invented
 * items, meals, recipes, or advice. An error is always honest.
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export interface AIConfig {
  baseUrl: string;
  apiKey: string | null;
  chatModel: string | null;
  visionModel: string | null;
}

export function readAIConfig(): AIConfig {
  const baseUrl = (process.env.AI_BASE_URL || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
  const apiKey = (process.env.AI_API_KEY || "").trim() || null;
  const chatModel = (process.env.AI_MODEL || "").trim() || null;
  const visionModel = (process.env.AI_VISION_MODEL || "").trim() || null;
  return { baseUrl, apiKey, chatModel, visionModel };
}

export interface AIStatus {
  chat: boolean;
  vision: boolean;
  provider: string | null;
  models: { chat: string | null; vision: string | null };
}

/**
 * Capability snapshot for GET /api/config.
 * chat === true iff API key + chat model are set.
 * vision === true iff API key + vision model are set.
 */
export function aiStatus(): AIStatus {
  const cfg = readAIConfig();
  const chat = Boolean(cfg.apiKey && cfg.chatModel);
  const vision = Boolean(cfg.apiKey && cfg.visionModel);
  return {
    chat,
    vision,
    provider: cfg.apiKey ? cfg.baseUrl : null,
    models: {
      chat: chat ? cfg.chatModel : null,
      vision: vision ? cfg.visionModel : null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Typed AI provider failure. `userMessage` is safe to show in the UI —
 * it never contains raw provider JSON. `detail` carries the raw body for
 * server-side logs only and must never be sent to the client.
 */
export class AIProviderError extends Error {
  readonly httpStatus: number;
  readonly userMessage: string;
  readonly retryable: boolean;
  readonly detail: string;
  constructor(httpStatus: number, userMessage: string, retryable: boolean, detail = "") {
    super(`AI provider HTTP ${httpStatus}: ${userMessage}`);
    this.name = "AIProviderError";
    this.httpStatus = httpStatus;
    this.userMessage = userMessage;
    this.retryable = retryable;
    this.detail = detail;
  }
}

/** Friendly, non-technical message for a provider HTTP status. */
export function friendlyAIMessage(httpStatus: number): { userMessage: string; retryable: boolean } {
  if (httpStatus === 429 || httpStatus === 503) {
    return {
      userMessage:
        "The AI service is busy right now (high demand). Please try again in a minute or two.",
      retryable: true,
    };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      userMessage:
        "The AI API key was rejected. Check that AI_API_KEY is set correctly in the Render dashboard.",
      retryable: false,
    };
  }
  if (httpStatus >= 500) {
    return {
      userMessage: "The AI service had a temporary problem. Please try again.",
      retryable: true,
    };
  }
  if (httpStatus === 400) {
    return { userMessage: "The AI request was invalid. Please try again.", retryable: false };
  }
  return { userMessage: "AI generation failed. Please try again.", retryable: false };
}

/**
 * Extract a UI-safe message from any AI failure. Provider internals
 * (raw JSON bodies, status dumps) never reach the user.
 */
export function aiUserMessage(err: unknown, fallback: string): string {
  if (err instanceof AIProviderError) return err.userMessage;
  return fallback;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<Record<string, unknown>>;
}

async function chatCompletion(cfg: AIConfig, payload: {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  responseFormat?: { type: string };
}): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  // One automatic retry for transient provider failures (429/503/5xx):
  // a single overloaded-model hiccup shouldn't fail a whole 7-day plan.
  const maxAttempts = 2;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: payload.model,
          messages: payload.messages,
          max_tokens: payload.maxTokens ?? 2000,
          temperature: payload.temperature ?? 0.2,
          ...(payload.responseFormat ? { response_format: payload.responseFormat } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const { userMessage, retryable } = friendlyAIMessage(res.status);
        throw new AIProviderError(res.status, userMessage, retryable, body.slice(0, 500));
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const content = data?.choices?.[0]?.message?.content;
      if (!content || typeof content !== "string") {
        throw new Error("AI provider returned an empty response");
      }
      return content;
    } catch (err) {
      lastError = err;
      const retryable = err instanceof AIProviderError ? err.retryable : false;
      if (retryable && attempt < maxAttempts) {
        // Brief backoff before the single retry.
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("AI request failed");
}

/** Extract a JSON object from a model reply, tolerating ```json fences. */
export function extractJsonObject(text: string): unknown {
  let candidate = text.trim();
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) candidate = fence[1].trim();
  // Fallback: cut to the first {...} span.
  if (!candidate.startsWith("{")) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("No JSON object found in AI response");
    }
    candidate = candidate.slice(start, end + 1);
  }
  return JSON.parse(candidate);
}

const FOOD_SCAN_DISCLAIMER =
  "Estimates only — a photo can't show exact portions, oils, or hidden ingredients. " +
  "Treat these numbers as a rough guide, not a medical measurement.";

/* ------------------------------------------------------------------ */
/* Food scan (vision)                                                  */
/* ------------------------------------------------------------------ */

const ConfidenceSchema = z.enum(["low", "medium", "high"]);

export const FoodScanItemSchema = z.object({
  name: z.string().min(1),
  portion: z.string().min(1),
  gramsEstimate: z.number().nullable(),
  kcalLow: z.number().nonnegative(),
  kcalHigh: z.number().nonnegative(),
  kcalBest: z.number().nonnegative(),
  proteinG: z.number().nonnegative(),
  carbsG: z.number().nonnegative(),
  fatG: z.number().nonnegative(),
  fiberG: z.number().nonnegative().nullable(),
  confidence: ConfidenceSchema,
  assumptions: z.array(z.string()).default([]),
  alternatives: z.array(z.string()).default([]),
});
export type FoodScanItem = z.infer<typeof FoodScanItemSchema>;

export const FoodScanResultSchema = z.object({
  items: z.array(FoodScanItemSchema),
  overallConfidence: ConfidenceSchema.nullable().optional(),
});
export type FoodScanResultPayload = z.infer<typeof FoodScanResultSchema>;

export interface FoodScanResult {
  status: "ok" | "error" | "not_configured";
  items: FoodScanItem[];
  overallConfidence: "low" | "medium" | "high" | null;
  disclaimer: string;
  model: string | null;
  error?: string;
}

const FOOD_SCAN_SYSTEM_PROMPT = `You are a nutrition-vision assistant. You analyze a photo of food and estimate its nutrition.
RULES:
- Respond with STRICT JSON only — no prose, no markdown fences, no commentary.
- The JSON object must have exactly this shape:
  {"items":[{"name":string,"portion":string,"gramsEstimate":number|null,"kcalLow":number,"kcalHigh":number,"kcalBest":number,"proteinG":number,"carbsG":number,"fatG":number,"fiberG":number|null,"confidence":"low"|"medium"|"high","assumptions":string[],"alternatives":string[]}],"overallConfidence":"low"|"medium"|"high"|null}
- Identify each distinct food item visible. If you cannot see any food, return {"items":[],"overallConfidence":null}.
- Give an honest low-high kcal RANGE (kcalLow <= kcalBest <= kcalHigh). Be conservative: if unsure, widen the range and set confidence "low".
- Never invent items that are not visible. List anything you are unsure about under "alternatives" instead of "name".
- "assumptions" must note what you could not see (e.g. "oil used in cooking unknown", "portion size guessed from plate").
- Do not give medical advice. This is an estimate, not a diagnosis.`;

export async function analyzeFoodImage(
  imageBase64: string,
  mime: string,
  context: { hints?: string } = {}
): Promise<FoodScanResult> {
  const cfg = readAIConfig();
  if (!cfg.apiKey || !cfg.visionModel) {
    return {
      status: "not_configured",
      items: [],
      overallConfidence: null,
      disclaimer: FOOD_SCAN_DISCLAIMER,
      model: null,
    };
  }

  try {
    const userContent: Array<Record<string, unknown>> = [
      {
        type: "image_url",
        image_url: { url: `data:${mime};base64,${imageBase64}`, detail: "high" },
      },
    ];
    if (context.hints && context.hints.trim()) {
      userContent.push({ type: "text", text: `User hints: ${context.hints.trim().slice(0, 500)}` });
    }
    userContent.push({
      type: "text",
      text: "Analyze this food photo. Reply with STRICT JSON only, in the exact shape described by the system prompt.",
    });

    const raw = await chatCompletion(cfg, {
      model: cfg.visionModel,
      messages: [
        { role: "system", content: FOOD_SCAN_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      maxTokens: 1500,
      temperature: 0.1,
    });

    // NEVER FABRICATE: any parse/validation failure -> honest empty error.
    let parsed: unknown;
    try {
      parsed = extractJsonObject(raw);
    } catch {
      return {
        status: "error",
        items: [],
        overallConfidence: null,
        disclaimer: FOOD_SCAN_DISCLAIMER,
        model: cfg.visionModel,
        error: "Could not parse the AI response as JSON",
      };
    }
    const validated = FoodScanResultSchema.safeParse(parsed);
    if (!validated.success) {
      return {
        status: "error",
        items: [],
        overallConfidence: null,
        disclaimer: FOOD_SCAN_DISCLAIMER,
        model: cfg.visionModel,
        error: "AI response failed validation",
      };
    }
    return {
      status: "ok",
      items: validated.data.items,
      overallConfidence: validated.data.overallConfidence ?? null,
      disclaimer: FOOD_SCAN_DISCLAIMER,
      model: cfg.visionModel,
    };
  } catch (err) {
    return {
      status: "error",
      items: [],
      overallConfidence: null,
      disclaimer: FOOD_SCAN_DISCLAIMER,
      model: cfg.visionModel,
      error: aiUserMessage(err, "Food scan failed"),
    };
  }
}

/* ------------------------------------------------------------------ */
/* AI meal-plan generation                                             */
/* ------------------------------------------------------------------ */

export interface MealPlanProfile {
  dietPreference?: string;
  allergies?: string[];
  intolerances?: string[];
  dislikedIngredients?: string[];
  preferredCuisines?: string[];
  mealsPerDay?: number;
  budgetTier?: string;
  maxCookMinutes?: number;
  halalOnly?: boolean;
}

export interface MealPlanConstraints {
  calorieTarget: number;
  proteinG?: number;
  goal?: string;
}

export interface AiPlannedMeal {
  name: string;
  mealType: "breakfast" | "morning_snack" | "lunch" | "afternoon_snack" | "dinner" | "extra";
  description?: string;
  ingredients: string[];
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
  prepMin?: number;
  cookMin?: number;
  dietCategory?: "vegetarian" | "non_vegetarian";
  labels?: string[];
  /** Populated server-side when a meal violates the user's allergy list. */
  allergyFlags?: string[];
}

export interface DayPlanShape {
  day: number;
  meals: AiPlannedMeal[];
  totalsKcal?: number;
}

export interface MealPlanAIResult {
  status: "ok" | "error" | "not_configured";
  days?: DayPlanShape[];
  warnings?: string[];
  error?: string;
}

const AiPlannedMealSchema = z.object({
  name: z.string().min(1),
  mealType: z.enum(["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner", "extra"]),
  description: z.string().optional(),
  ingredients: z.array(z.string().min(1)).min(1),
  kcal: z.number().nonnegative(),
  proteinG: z.number().nonnegative(),
  carbsG: z.number().nonnegative(),
  fatG: z.number().nonnegative(),
  fiberG: z.number().nonnegative().optional(),
  prepMin: z.number().nonnegative().optional(),
  cookMin: z.number().nonnegative().optional(),
  dietCategory: z.enum(["vegetarian", "non_vegetarian"]).optional(),
  labels: z.array(z.string()).optional(),
});

const MealPlanResponseSchema = z.object({
  days: z.array(
    z.object({
      day: z.number().int().min(1).max(7),
      meals: z.array(AiPlannedMealSchema).min(1),
    })
  ).length(7),
});

/** Case-insensitive substring match, same rule as @fitfusion/core's mealContainsAllergen. */
function findAllergenMatches(ingredients: string[], allergens: string[]): string[] {
  const matched: string[] = [];
  for (const allergen of allergens) {
    const needle = allergen.trim().toLowerCase();
    if (!needle) continue;
    if (ingredients.some((ing) => ing.toLowerCase().includes(needle))) {
      matched.push(allergen);
    }
  }
  return matched;
}

/**
 * Generate a 7-day meal plan with the AI chat model.
 * Meals are validated against the user's allergy list server-side: violating
 * meals are NEVER silently kept — they are flagged and excluded from `days`.
 */
export async function generateMealPlanAI(
  profile: MealPlanProfile,
  constraints: MealPlanConstraints
): Promise<MealPlanAIResult> {
  const cfg = readAIConfig();
  if (!cfg.apiKey || !cfg.chatModel) {
    return { status: "not_configured", error: "AI provider is not configured" };
  }

  const allergies = (profile.allergies ?? []).filter((a) => a.trim());
  const system = `You are a nutrition planning assistant. Generate a 7-day meal plan.
RULES:
- Respond with STRICT JSON only — no prose, no markdown fences.
- Shape: {"days":[{"day":1,"meals":[{...}, ...]}, ...]} with exactly 7 days.
- Each meal: {"name":string,"mealType":"breakfast"|"morning_snack"|"lunch"|"afternoon_snack"|"dinner"|"extra","description":string?,"ingredients":string[] (each a plain ingredient name),"kcal":number,"proteinG":number,"carbsG":number,"fatG":number,"fiberG":number?,"prepMin":number?,"cookMin":number?,"dietCategory":"vegetarian"|"non_vegetarian","labels":string[]?}
- Each day's meals must total within ±15% of the daily calorie target.
- NEVER include any of these allergens: ${allergies.length ? allergies.join(", ") : "(none listed)"}.
${profile.intolerances?.length ? `- Avoid these intolerances: ${profile.intolerances.join(", ")}.` : ""}
${profile.dislikedIngredients?.length ? `- Avoid disliked ingredients: ${profile.dislikedIngredients.join(", ")}.` : ""}
${profile.dietPreference && profile.dietPreference !== "flexible" ? `- Diet preference: ${profile.dietPreference}. All meals must comply.` : ""}
${profile.preferredCuisines?.length ? `- Preferred cuisines: ${profile.preferredCuisines.join(", ")}.` : ""}
${profile.budgetTier ? `- Budget tier: ${profile.budgetTier}.` : ""}
${profile.maxCookMinutes ? `- Keep total prep+cook time at or under ${profile.maxCookMinutes} minutes per meal.` : ""}
${profile.halalOnly ? `- Halal only: no pork, no alcohol; meat must be labelled halal.` : ""}
- Do not give medical advice. Keep portions realistic.`;

  try {
    const raw = await chatCompletion(cfg, {
      model: cfg.chatModel,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `Generate the 7-day meal plan. Daily calorie target: ${constraints.calorieTarget} kcal.` +
            (constraints.proteinG ? ` Daily protein target: ~${constraints.proteinG} g.` : "") +
            (constraints.goal ? ` User goal: ${constraints.goal}.` : "") +
            (profile.mealsPerDay ? ` Meals per day: ${profile.mealsPerDay}.` : "") +
            ` Respond with STRICT JSON only.`,
        },
      ],
      maxTokens: 4000,
      temperature: 0.4,
    });

    let parsed: unknown;
    try {
      parsed = extractJsonObject(raw);
    } catch {
      return { status: "error", error: "Could not parse the AI response as JSON" };
    }
    const validated = MealPlanResponseSchema.safeParse(parsed);
    if (!validated.success) {
      return { status: "error", error: "AI response failed validation" };
    }

    // Server-side allergy validation: flag AND exclude violating meals.
    const warnings: string[] = [];
    const days: DayPlanShape[] = validated.data.days.map((d) => {
      const kept: AiPlannedMeal[] = [];
      for (const meal of d.meals) {
        const flags = findAllergenMatches(meal.ingredients, allergies);
        if (flags.length > 0) {
          warnings.push(
            `Day ${d.day} meal "${meal.name}" excluded: contains allergen(s) ${flags.join(", ")}`
          );
          continue; // dropped, never silently kept
        }
        kept.push({ ...meal, allergyFlags: [] });
      }
      const totalsKcal = kept.reduce((sum, m) => sum + m.kcal, 0);
      return { day: d.day, meals: kept, totalsKcal: Math.round(totalsKcal) };
    });

    return { status: "ok", days, warnings: warnings.length ? warnings : undefined };
  } catch (err) {
    return { status: "error", error: aiUserMessage(err, "Meal plan generation failed") };
  }
}

/* ------------------------------------------------------------------ */
/* AI recipe suggestions                                               */
/* ------------------------------------------------------------------ */

export interface RecipeSuggestInput {
  dietPreference?: string;
  allergies?: string[];
  cuisines?: string[];
  maxKcal?: number;
  count?: number;
  query?: string;
}

export interface RecipeSuggestion {
  title: string;
  description: string;
  cuisine?: string;
  dietCategory?: "vegetarian" | "non_vegetarian";
  kcalPerServing: number;
  proteinPerServing?: number;
  carbsPerServing?: number;
  fatPerServing?: number;
  prepMin?: number;
  cookMin?: number;
  ingredients: string[];
  instructions: string[];
  tags?: string[];
}

export interface RecipeSuggestResult {
  status: "ok" | "error" | "not_configured";
  recipes?: RecipeSuggestion[];
  error?: string;
}

const RecipeSuggestionSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
  cuisine: z.string().optional(),
  dietCategory: z.enum(["vegetarian", "non_vegetarian"]).optional(),
  kcalPerServing: z.number().nonnegative(),
  proteinPerServing: z.number().nonnegative().optional(),
  carbsPerServing: z.number().nonnegative().optional(),
  fatPerServing: z.number().nonnegative().optional(),
  prepMin: z.number().nonnegative().optional(),
  cookMin: z.number().nonnegative().optional(),
  ingredients: z.array(z.string().min(1)).min(1),
  instructions: z.array(z.string().min(1)).min(1),
  tags: z.array(z.string()).optional(),
});

const RecipeSuggestResponseSchema = z.object({
  recipes: z.array(RecipeSuggestionSchema).min(1),
});

export async function suggestRecipesAI(input: RecipeSuggestInput): Promise<RecipeSuggestResult> {
  const cfg = readAIConfig();
  if (!cfg.apiKey || !cfg.chatModel) {
    return { status: "not_configured", error: "AI provider is not configured" };
  }
  const count = Math.min(Math.max(input.count ?? 5, 1), 10);
  const allergies = (input.allergies ?? []).filter((a) => a.trim());

  try {
    const raw = await chatCompletion(cfg, {
      model: cfg.chatModel,
      messages: [
        {
          role: "system",
          content: `You are a recipe assistant. Suggest healthy recipes as STRICT JSON only — no prose, no markdown fences.
Shape: {"recipes":[{"title":string,"description":string,"cuisine":string?,"dietCategory":"vegetarian"|"non_vegetarian","kcalPerServing":number,"proteinPerServing":number?,"carbsPerServing":number?,"fatPerServing":number?,"prepMin":number?,"cookMin":number?,"ingredients":string[],"instructions":string[],"tags":string[]?}]}
RULES:
- Suggest exactly ${count} recipes.
- NEVER include these allergens: ${allergies.length ? allergies.join(", ") : "(none listed)"}.
${input.dietPreference && input.dietPreference !== "flexible" ? `- Diet preference: ${input.dietPreference}.` : ""}
${input.cuisines?.length ? `- Prefer cuisines: ${input.cuisines.join(", ")}.` : ""}
${input.maxKcal ? `- Each recipe must be at most ${input.maxKcal} kcal per serving.` : ""}
- Keep ingredients and instructions realistic and safe. No medical claims.`,
        },
        {
          role: "user",
          content: input.query
            ? `Suggest recipes matching: ${input.query.slice(0, 300)}. STRICT JSON only.`
            : "Suggest recipes. STRICT JSON only.",
        },
      ],
      maxTokens: 2500,
      temperature: 0.5,
    });

    let parsed: unknown;
    try {
      parsed = extractJsonObject(raw);
    } catch {
      return { status: "error", error: "Could not parse the AI response as JSON" };
    }
    const validated = RecipeSuggestResponseSchema.safeParse(parsed);
    if (!validated.success) {
      return { status: "error", error: "AI response failed validation" };
    }

    // Server-side allergy validation: drop violating recipes, never silently keep.
    const recipes: RecipeSuggestion[] = [];
    for (const r of validated.data.recipes) {
      const flags = findAllergenMatches(r.ingredients, allergies);
      if (flags.length > 0) continue;
      recipes.push(r);
    }
    if (recipes.length === 0) {
      return { status: "error", error: "All suggested recipes contained listed allergens" };
    }
    return { status: "ok", recipes };
  } catch (err) {
    return { status: "error", error: aiUserMessage(err, "Recipe suggestion failed") };
  }
}

/* ------------------------------------------------------------------ */
/* AI coach                                                            */
/* ------------------------------------------------------------------ */

export interface CoachMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface CoachReplyResult {
  status: "ok" | "error" | "not_configured";
  reply?: string;
  error?: string;
}

const COACH_SYSTEM_PROMPT = `You are FitFusion's fitness & nutrition coach: supportive, practical, and honest about uncertainty.
SAFETY GUARDRAILS (always apply):
- Never diagnose medical conditions, injuries, or mental-health disorders, and never prescribe medication.
- BMI is a screening measure, not a diagnosis. If BMI or weight comes up, use screening language and note its limits.
- Never prescribe extreme diets (very-low-calorie crash diets, prolonged fasting without supervision, elimination diets) or extreme training.
- If the user shows signs of disordered eating (purging, extreme restriction, compulsive exercise, body-image distress), respond with an eating-disorder-safe completion: be kind and non-judgmental, do NOT give dieting or weight-loss tactics, and encourage them to talk to a qualified health professional or a trusted support service promptly.
- For minors, pregnancy, breastfeeding, or any reported medical condition: encourage consulting a qualified health professional for personalized guidance instead of giving specific targets.
- For chest pain, dizziness, fainting, or unusual shortness of breath during exercise: tell them to stop and seek medical attention.
- Keep answers concise and actionable. When unsure, say so rather than guessing.`;

export async function coachReply(
  messages: CoachMessage[],
  contextSummary: string
): Promise<CoachReplyResult> {
  const cfg = readAIConfig();
  if (!cfg.apiKey || !cfg.chatModel) {
    return { status: "not_configured", error: "AI provider is not configured" };
  }

  try {
    const history: ChatMessage[] = messages.slice(-20).map((m) => ({
      role: m.role,
      content: m.content.slice(0, 4000),
    }));
    const raw = await chatCompletion(cfg, {
      model: cfg.chatModel,
      messages: [
        { role: "system", content: COACH_SYSTEM_PROMPT },
        ...(contextSummary.trim()
          ? [{ role: "system" as const, content: `User context: ${contextSummary.trim().slice(0, 1500)}` }]
          : []),
        ...history,
      ],
      maxTokens: 800,
      temperature: 0.6,
    });
    const reply = raw.trim();
    if (!reply) {
      return { status: "error", error: "AI provider returned an empty reply" };
    }
    return { status: "ok", reply };
  } catch (err) {
    return { status: "error", error: aiUserMessage(err, "Coach reply failed") };
  }
}
