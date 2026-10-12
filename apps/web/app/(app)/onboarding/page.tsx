"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check } from "lucide-react";
import {
  cmFromFeetInches,
  inFromCm,
  kgFromLb,
  lbFromKg,
} from "@fitfusion/core";
import { api, ApiError } from "@/lib/api";
import { Field, Input, Select } from "@/components/ui";
import { GlassPanel, LuxButton } from "@/components/luxury";
import {
  ACTIVITY_OPTIONS,
  BUDGET_OPTIONS,
  COUNTRY_OPTIONS,
  DAY_OPTIONS,
  DIET_OPTIONS,
  EQUIPMENT_OPTIONS,
  FITNESS_EXPERIENCE_OPTIONS,
  GOAL_OPTIONS,
  LANGUAGE_OPTIONS,
  SEX_OPTIONS,
  WORKOUT_LOCATION_OPTIONS,
} from "@/lib/onboarding-options";

const STEPS = ["Basics", "Goals", "Nutrition", "Location", "Workouts", "Review"] as const;

function splitList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border px-4 py-2 text-sm transition-colors"
      style={{
        borderColor: checked ? "var(--accent)" : "var(--border)",
        backgroundColor: checked
          ? "color-mix(in srgb, var(--accent) 8%, transparent)"
          : "transparent",
        color: "var(--text)",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 shrink-0"
        style={{ accentColor: "var(--accent)" }}
      />
      {label}
    </label>
  );
}

/** Segmented metric/imperial unit toggle. */
function UnitToggle({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: "metric" | "imperial";
  options: { value: "metric" | "imperial"; label: string }[];
  onChange: (v: "metric" | "imperial") => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex rounded-xl border border-[var(--border)] p-0.5"
      style={{ backgroundColor: "var(--bg-secondary)" }}
    >
      {options.map((u) => {
        const selected = value === u.value;
        return (
          <button
            key={u.value}
            type="button"
            onClick={() => onChange(u.value)}
            aria-pressed={selected}
            className="anim-press min-h-[44px] rounded-[10px] px-4 text-sm font-medium transition-colors"
            style={
              selected
                ? { backgroundColor: "var(--accent)", color: "var(--on-accent)" }
                : { color: "var(--text-secondary)" }
            }
          >
            {u.label}
          </button>
        );
      })}
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: basics
  const [displayName, setDisplayName] = useState("");
  const [dob, setDob] = useState("");
  const [sex, setSex] = useState("");
  const [heightUnit, setHeightUnit] = useState<"metric" | "imperial">("metric");
  const [heightCm, setHeightCm] = useState("");
  const [heightFt, setHeightFt] = useState("");
  const [heightIn, setHeightIn] = useState("");
  const [weightUnit, setWeightUnit] = useState<"metric" | "imperial">("metric");
  const [weightKg, setWeightKg] = useState("");
  const [weightLb, setWeightLb] = useState("");

  // Step 2: goals
  const [goal, setGoal] = useState("");
  const [activityLevel, setActivityLevel] = useState("");
  const [targetWeight, setTargetWeight] = useState("");

  // Step 3: diet
  const [dietPreference, setDietPreference] = useState("flexible");
  const [allergies, setAllergies] = useState("");
  const [intolerances, setIntolerances] = useState("");
  const [cuisines, setCuisines] = useState("");
  const [dislikes, setDislikes] = useState("");
  const [budgetTier, setBudgetTier] = useState("");
  const [mealsPerDay, setMealsPerDay] = useState("");

  // Step 4 (V18): location & language
  const [country, setCountry] = useState("PK");
  const [cityRegion, setCityRegion] = useState("");
  const [language, setLanguage] = useState("");
  const [unitSystem, setUnitSystem] = useState<"metric" | "imperial">("metric");
  const [halalOnly, setHalalOnly] = useState(false);

  // Step 5: workouts
  const [fitnessExperience, setFitnessExperience] = useState("");
  const [workoutLocation, setWorkoutLocation] = useState("");
  const [equipment, setEquipment] = useState<string[]>([]);
  const [workoutDays, setWorkoutDays] = useState<string[]>([]);
  const [workoutMinutes, setWorkoutMinutes] = useState("");
  const [exerciseRestrictions, setExerciseRestrictions] = useState("");

  // Step 6: safety (all optional, asked gently)
  const [isPregnant, setIsPregnant] = useState(false);
  const [isBreastfeeding, setIsBreastfeeding] = useState(false);
  const [eatingDisorderRisk, setEatingDisorderRisk] = useState(false);
  const [healthLimitations, setHealthLimitations] = useState("");

  function resolvedHeightCm(): number | undefined {
    if (heightUnit === "metric") {
      const v = parseFloat(heightCm);
      return Number.isFinite(v) && v > 0 ? v : undefined;
    }
    const ft = parseFloat(heightFt);
    const inch = parseFloat(heightIn);
    if (Number.isFinite(ft) && Number.isFinite(inch) && (ft > 0 || inch > 0)) {
      return Math.round(cmFromFeetInches(ft || 0, inch || 0) * 10) / 10;
    }
    return undefined;
  }

  function resolvedWeightKg(): number | undefined {
    if (weightUnit === "metric") {
      const v = parseFloat(weightKg);
      return Number.isFinite(v) && v > 0 ? v : undefined;
    }
    const v = parseFloat(weightLb);
    return Number.isFinite(v) && v > 0
      ? Math.round(kgFromLb(v) * 10) / 10
      : undefined;
  }

  function isMinor(): boolean {
    if (!dob) return false;
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) return false;
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    return age < 18;
  }

  const hasSafetyFlag =
    isPregnant || isBreastfeeding || eatingDisorderRisk || isMinor();

  // Basics (step 0) is the foundation every target depends on: without a
  // valid height, weight, and date of birth the dashboard and nutrition
  // pages cannot compute anything personal. Block progressing until they
  // are present — a silent skip here produced "Invalid onboarding data"
  // confusion and empty dashboards in the wild.
  function validDob(): boolean {
    if (!dob) return false;
    const d = new Date(dob);
    return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
  }
  const basicsValid =
    resolvedHeightCm() !== undefined &&
    resolvedWeightKg() !== undefined &&
    validDob();
  const basicsMissing: string[] = [];
  if (resolvedHeightCm() === undefined) basicsMissing.push("height");
  if (resolvedWeightKg() === undefined) basicsMissing.push("weight");
  if (!validDob()) basicsMissing.push("date of birth");

  function buildPayload(): Record<string, unknown> {
    const p: Record<string, unknown> = {};
    if (displayName.trim()) p.displayName = displayName.trim();
    if (dob) p.dateOfBirth = dob;
    if (sex) p.sex = sex;
    const h = resolvedHeightCm();
    if (h) p.heightCm = h;
    const w = resolvedWeightKg();
    if (w) p.weightKg = w;
    if (goal) p.goal = goal;
    if (activityLevel) p.activityLevel = activityLevel;
    const tw = parseFloat(targetWeight);
    if (Number.isFinite(tw) && tw > 0) {
      p.targetWeightKg =
        weightUnit === "imperial"
          ? Math.round(kgFromLb(tw) * 10) / 10
          : tw;
    }
    if (dietPreference) p.dietPreference = dietPreference;
    const al = splitList(allergies);
    if (al.length) p.allergies = al;
    const intol = splitList(intolerances);
    if (intol.length) p.intolerances = intol;
    const cui = splitList(cuisines);
    if (cui.length) p.preferredCuisines = cui;
    const dis = splitList(dislikes);
    if (dis.length) p.dislikedIngredients = dis;
    if (budgetTier) p.budgetTier = budgetTier;
    const mpd = parseInt(mealsPerDay, 10);
    if (Number.isFinite(mpd) && mpd > 0) p.mealsPerDay = mpd;
    if (fitnessExperience) p.fitnessExperience = fitnessExperience;
    if (workoutLocation) p.workoutLocation = workoutLocation;
    // Step 4 (V18): location & language — country defaults to Pakistan.
    if (country) p.country = country;
    if (cityRegion.trim()) p.cityRegion = cityRegion.trim();
    if (language) p.language = language;
    p.unitSystem = unitSystem;
    p.halalOnly = halalOnly;
    if (equipment.length) p.equipment = equipment;
    if (workoutDays.length) p.workoutDays = workoutDays;
    const wm = parseInt(workoutMinutes, 10);
    if (Number.isFinite(wm) && wm > 0) p.workoutMinutesPerDay = wm;
    if (exerciseRestrictions.trim()) p.exerciseRestrictions = exerciseRestrictions.trim();
    if (healthLimitations.trim()) p.healthLimitations = healthLimitations.trim();
    // Safety flags — always sent so the server can apply safe defaults.
    p.isPregnant = isPregnant;
    p.isBreastfeeding = isBreastfeeding;
    p.eatingDisorderRisk = eatingDisorderRisk;
    return p;
  }

  async function finish() {
    setError(null);
    setSaving(true);
    try {
      await api("/api/onboarding", { method: "POST", body: buildPayload() });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Couldn't save your answers. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  function next() {
    setError(null);
    if (step < STEPS.length - 1) setStep(step + 1);
    else finish();
  }

  function skip() {
    setError(null);
    if (step < STEPS.length - 1) setStep(step + 1);
    else finish(); // skipping review still saves what was entered
  }

  function toggleIn(list: string[], v: string, set: (l: string[]) => void) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  }

  return (
    <div className="anim-page-enter mx-auto max-w-2xl">
      <h1 className="t-greeting">Let&apos;s personalize your experience</h1>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        Every step is optional — skip anything you&apos;d rather not answer.
      </p>

      {/* Stepper — gold milestones mark completed steps. */}
      <ol
        aria-label="Onboarding progress"
        className="mt-6 flex items-center gap-1.5"
      >
        {STEPS.map((label, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <li key={label} className="flex flex-1 flex-col items-center gap-1.5">
              <span
                aria-hidden="true"
                className="flex h-2.5 w-full items-center justify-center overflow-hidden rounded-full"
                style={{
                  backgroundColor:
                    done || current ? "var(--accent)" : "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                }}
              >
                {done && (
                  <Check
                    size={12}
                    strokeWidth={3.5}
                    style={{ color: "var(--on-accent)" }}
                  />
                )}
              </span>
              <span
                className={`text-[11px] ${
                  current
                    ? "font-semibold text-[var(--accent)]"
                    : done
                      ? "font-medium text-[var(--text)]"
                      : "font-medium text-[var(--text-secondary)]"
                }`}
                aria-current={current ? "step" : undefined}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>

      <GlassPanel className="mt-6 p-6">
        {error && (
          <p
            role="alert"
            className="mb-4 rounded-xl px-4 py-3 text-sm"
            style={{
              color: "var(--error)",
              backgroundColor:
                "color-mix(in srgb, var(--error) 12%, transparent)",
              border: "1px solid color-mix(in srgb, var(--error) 38%, transparent)",
            }}
          >
            {error}
          </p>
        )}

        {/* ---------------- Step 1: basics ---------------- */}
        {step === 0 && (
          <div className="space-y-5">
            <h2 className="t-card-heading">The basics</h2>
            <Field label="What should we call you?" htmlFor="ob-name">
              <Input id="ob-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name or nickname" autoComplete="nickname" />
            </Field>
            <Field label="Date of birth" htmlFor="ob-dob" hint="We use your age to estimate calorie needs and to apply age-appropriate guidance.">
              <Input id="ob-dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} autoComplete="bday" />
            </Field>
            <Field label="Sex" htmlFor="ob-sex" hint="Used only in the calorie-estimation formula (Mifflin-St Jeor). Choose whatever fits, or skip.">
              <Select id="ob-sex" value={sex} onChange={(e) => setSex(e.target.value)}>
                {SEX_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </Field>
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-[var(--text)]">Height</span>
                <UnitToggle
                  label="Height units"
                  value={heightUnit}
                  onChange={setHeightUnit}
                  options={[
                    { value: "metric", label: "cm" },
                    { value: "imperial", label: "ft/in" },
                  ]}
                />
              </div>
              {heightUnit === "metric" ? (
                <Input type="number" min={50} max={250} value={heightCm} onChange={(e) => setHeightCm(e.target.value)} placeholder="Height in cm" inputMode="decimal" aria-label="Height in centimeters" />
              ) : (
                <div className="flex gap-2">
                  <Input type="number" min={0} max={9} value={heightFt} onChange={(e) => setHeightFt(e.target.value)} placeholder="Feet" inputMode="numeric" aria-label="Height in feet" />
                  <Input type="number" min={0} max={11.99} step="0.5" value={heightIn} onChange={(e) => setHeightIn(e.target.value)} placeholder="Inches" inputMode="decimal" aria-label="Height in inches" />
                </div>
              )}
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-[var(--text)]">Current weight</span>
                <UnitToggle
                  label="Weight units"
                  value={weightUnit}
                  onChange={setWeightUnit}
                  options={[
                    { value: "metric", label: "kg" },
                    { value: "imperial", label: "lb" },
                  ]}
                />
              </div>
              <Field label="" htmlFor="ob-weight" hint="Your current weight helps us personalize calorie and macro targets. No judgment — it's just a starting point.">
                <Input id="ob-weight" type="number" min={20} max={300} step="0.1" value={weightUnit === "metric" ? weightKg : weightLb}
                  onChange={(e) => weightUnit === "metric" ? setWeightKg(e.target.value) : setWeightLb(e.target.value)}
                  placeholder={weightUnit === "metric" ? "Weight in kg" : "Weight in lb"} inputMode="decimal" />
              </Field>
            </div>
          </div>
        )}

        {/* ---------------- Step 2: goals ---------------- */}
        {step === 1 && (
          <div className="space-y-5">
            <h2 className="t-card-heading">Your goals</h2>
            <Field label="What's your main goal?" htmlFor="ob-goal" hint="This shapes your calorie target and plan recommendations.">
              <Select id="ob-goal" value={goal} onChange={(e) => setGoal(e.target.value)}>
                {GOAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="How active are you day-to-day?" htmlFor="ob-activity" hint="Outside of planned workouts — your job, commute, and daily movement.">
              <Select id="ob-activity" value={activityLevel} onChange={(e) => setActivityLevel(e.target.value)}>
                {ACTIVITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </Field>
            <Field label={`Target weight (${weightUnit === "metric" ? "kg" : "lb"})`} htmlFor="ob-target" hint="Optional. A healthy target keeps your plan realistic and sustainable.">
              <Input id="ob-target" type="number" min={20} max={300} step="0.1" value={targetWeight} onChange={(e) => setTargetWeight(e.target.value)} placeholder="e.g. 70" inputMode="decimal" />
            </Field>
          </div>
        )}

        {/* ---------------- Step 3: diet ---------------- */}
        {step === 2 && (
          <div className="space-y-5">
            <h2 className="t-card-heading">Food preferences</h2>
            <p className="text-sm text-[var(--text-secondary)]">
              This is how your meal plans avoid foods you can&apos;t — or don&apos;t want to — eat. We never silently swap a restricted food.
            </p>
            <Field label="Diet preference" htmlFor="ob-diet">
              <Select id="ob-diet" value={dietPreference} onChange={(e) => setDietPreference(e.target.value)}>
                {DIET_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Allergies" htmlFor="ob-allergies" hint="Comma-separated, e.g. peanuts, shellfish, dairy. Meals containing these are filtered out.">
              <Input id="ob-allergies" value={allergies} onChange={(e) => setAllergies(e.target.value)} placeholder="peanuts, shellfish" />
            </Field>
            <Field label="Intolerances" htmlFor="ob-intol" hint="Comma-separated, e.g. lactose, gluten.">
              <Input id="ob-intol" value={intolerances} onChange={(e) => setIntolerances(e.target.value)} placeholder="lactose" />
            </Field>
            <Field label="Favorite cuisines" htmlFor="ob-cuisines" hint="Comma-separated — we'll lean toward these in your plans.">
              <Input id="ob-cuisines" value={cuisines} onChange={(e) => setCuisines(e.target.value)} placeholder="Mediterranean, Pakistani, Italian" />
            </Field>
            <Field label="Foods you dislike" htmlFor="ob-dislikes" hint="Comma-separated — we'll keep these out of your plans.">
              <Input id="ob-dislikes" value={dislikes} onChange={(e) => setDislikes(e.target.value)} placeholder="olives, mushrooms" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Budget" htmlFor="ob-budget">
                <Select id="ob-budget" value={budgetTier} onChange={(e) => setBudgetTier(e.target.value)}>
                  {BUDGET_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Meals per day" htmlFor="ob-mpd">
                <Input id="ob-mpd" type="number" min={1} max={8} value={mealsPerDay} onChange={(e) => setMealsPerDay(e.target.value)} placeholder="3" inputMode="numeric" />
              </Field>
            </div>
          </div>
        )}

        {/* ---------------- Step 4 (V18): location & language ---------------- */}
        {step === 3 && (
          <div className="space-y-5">
            <h2 className="t-card-heading">Where are you?</h2>
            <p className="text-sm text-[var(--text-secondary)]">
              This picks the right food catalogue for you (Pakistani home foods,
              local portions) and the language for food names.
            </p>
            <Field label="Country" htmlFor="ob-country">
              <Select id="ob-country" value={country} onChange={(e) => setCountry(e.target.value)}>
                {COUNTRY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="City / region" htmlFor="ob-city" hint="Optional — used for nearby restaurants and local foods.">
              <Input id="ob-city" value={cityRegion} onChange={(e) => setCityRegion(e.target.value)} placeholder="e.g. Lahore" autoComplete="address-level2" />
            </Field>
            <Field label="Language" htmlFor="ob-language" hint="Food names appear in this language where available.">
              <Select id="ob-language" value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </Field>
            <div>
              <span className="mb-2 block text-sm font-medium text-[var(--text)]">Units</span>
              <UnitToggle
                label="Unit system"
                value={unitSystem}
                onChange={setUnitSystem}
                options={[
                  { value: "metric", label: "Metric (kg, cm)" },
                  { value: "imperial", label: "Imperial (lb, in)" },
                ]}
              />
            </div>
            <CheckRow label="Halal only — keep non-halal foods out of my plans" checked={halalOnly} onChange={setHalalOnly} />
          </div>
        )}

        {/* ---------------- Step 5: workouts ---------------- */}
        {step === 4 && (
          <div className="space-y-5">
            <h2 className="t-card-heading">Workouts</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Experience level" htmlFor="ob-exp">
                <Select id="ob-exp" value={fitnessExperience} onChange={(e) => setFitnessExperience(e.target.value)}>
                  {FITNESS_EXPERIENCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Where do you work out?" htmlFor="ob-loc">
                <Select id="ob-loc" value={workoutLocation} onChange={(e) => setWorkoutLocation(e.target.value)}>
                  {WORKOUT_LOCATION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div>
              <span className="mb-2 block text-sm font-medium text-[var(--text)]">Equipment you have</span>
              <div className="grid gap-2 sm:grid-cols-2">
                {EQUIPMENT_OPTIONS.map((eq) => (
                  <CheckRow key={eq} label={eq} checked={equipment.includes(eq)} onChange={(v) => toggleIn(equipment, eq, setEquipment)} />
                ))}
              </div>
            </div>
            <div>
              <span className="mb-2 block text-sm font-medium text-[var(--text)]">Days you can train</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {DAY_OPTIONS.map((d) => (
                  <CheckRow key={d} label={d.slice(0, 3)} checked={workoutDays.includes(d)} onChange={(v) => toggleIn(workoutDays, d, setWorkoutDays)} />
                ))}
              </div>
            </div>
            <Field label="Minutes per session" htmlFor="ob-mins">
              <Input id="ob-mins" type="number" min={5} max={300} value={workoutMinutes} onChange={(e) => setWorkoutMinutes(e.target.value)} placeholder="45" inputMode="numeric" />
            </Field>
            <Field label="Any exercise restrictions?" htmlFor="ob-restr" hint="Injuries, joint issues, or movements to avoid — we'll plan around them.">
              <Input id="ob-restr" value={exerciseRestrictions} onChange={(e) => setExerciseRestrictions(e.target.value)} placeholder="e.g. avoid high-impact on knees" />
            </Field>
          </div>
        )}

        {/* ---------------- Step 6: review + safety ---------------- */}
        {step === 5 && (
          <div className="space-y-5">
            <h2 className="t-card-heading">Almost done — a quick health check</h2>
            <p className="text-sm text-[var(--text-secondary)]">
              These questions are completely optional and asked with care. If any
              apply to you, we&apos;ll keep your plan safe and
              maintenance-focused — and we recommend checking in with a
              qualified health professional for personalized guidance.
            </p>
            <div className="space-y-2">
              <CheckRow label="I am currently pregnant" checked={isPregnant} onChange={setIsPregnant} />
              <CheckRow label="I am currently breastfeeding" checked={isBreastfeeding} onChange={setIsBreastfeeding} />
              <CheckRow label="I have a history of, or current concerns about, disordered eating" checked={eatingDisorderRisk} onChange={setEatingDisorderRisk} />
            </div>
            {hasSafetyFlag && (
              <p
                role="note"
                className="rounded-xl px-4 py-3 text-sm"
                style={{
                  color: "var(--warning)",
                  backgroundColor:
                    "color-mix(in srgb, var(--warning) 12%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--warning) 38%, transparent)",
                }}
              >
                Thanks for sharing. Your plan will stay at maintenance level —
                no weight-loss targets — and we encourage you to consult a
                qualified health professional for personalized guidance.
              </p>
            )}
            <Field label="Anything else we should know?" htmlFor="ob-health" hint="Health conditions, medications, or limitations — only what you're comfortable sharing.">
              <Input id="ob-health" value={healthLimitations} onChange={(e) => setHealthLimitations(e.target.value)} placeholder="Optional" />
            </Field>

            <div
              className="rounded-xl border border-[var(--border)] p-4 text-sm"
              style={{ backgroundColor: "var(--bg-secondary)", color: "var(--text)" }}
            >
              <p className="t-meta">Your answers</p>
              <ul className="mt-2 space-y-1">
                <li>Goal: {goal ? GOAL_OPTIONS.find((o) => o.value === goal)?.label : "—"}</li>
                <li>Activity: {activityLevel ? ACTIVITY_OPTIONS.find((o) => o.value === activityLevel)?.label : "—"}</li>
                <li>Height: {resolvedHeightCm() ? `${resolvedHeightCm()} cm` : "—"}{weightUnit === "imperial" && heightUnit === "imperial" && resolvedHeightCm() ? ` (${Math.round(inFromCm(resolvedHeightCm()!))} in)` : ""}</li>
                <li>Weight: {resolvedWeightKg() ? `${resolvedWeightKg()} kg` : "—"}{weightUnit === "imperial" && resolvedWeightKg() ? ` (${Math.round(lbFromKg(resolvedWeightKg()!))} lb)` : ""}</li>
                <li>Diet: {DIET_OPTIONS.find((o) => o.value === dietPreference)?.label}</li>
                <li>Country: {country ? COUNTRY_OPTIONS.find((o) => o.value === country)?.label : "—"}{cityRegion.trim() ? ` · ${cityRegion.trim()}` : ""}</li>
                <li>Language: {language ? LANGUAGE_OPTIONS.find((o) => o.value === language)?.label : "—"} · Units: {unitSystem === "metric" ? "Metric" : "Imperial"}{halalOnly ? " · Halal only" : ""}</li>
              </ul>
            </div>
          </div>
        )}

        {step === 0 && !basicsValid && (
          <p
            role="alert"
            className="mt-4 flex items-start gap-3 rounded-xl px-4 py-3 text-sm font-medium"
            style={{
              color: "var(--warning)",
              backgroundColor:
                "color-mix(in srgb, var(--warning) 14%, transparent)",
              border: "1px solid color-mix(in srgb, var(--warning) 45%, transparent)",
            }}
          >
            <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>
              Please add your {basicsMissing.join(", ")} — your calorie and macro
              targets can&apos;t be calculated without them.
            </span>
          </p>
        )}
        {/* Nav buttons */}
        <div className="mt-8 flex items-center justify-between gap-3">
          <LuxButton
            variant="ghost"
            onClick={skip}
            disabled={saving || (step === 0 && !basicsValid)}
            aria-label={step === STEPS.length - 1 ? "Skip review and finish" : `Skip ${STEPS[step]} step`}
            title={step === 0 && !basicsValid ? "Height, weight, and date of birth are required to continue" : undefined}
          >
            Skip for now
          </LuxButton>
          <div className="flex gap-2">
            {step > 0 && (
              <LuxButton variant="secondary" onClick={() => setStep(step - 1)} disabled={saving}>
                Back
              </LuxButton>
            )}
            <LuxButton onClick={next} disabled={saving || (step === 0 && !basicsValid)}>
              {saving ? "Saving…" : step === STEPS.length - 1 ? "Finish" : "Continue"}
            </LuxButton>
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}
