"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Field, Input, Select, Skeleton } from "@/components/ui";
import { GlassPanel, LuxButton } from "@/components/luxury";
import { useSession } from "../layout";

interface ProfileForm {
  displayName: string;
  sex: string;
  heightCm: string;
  weightKg: string;
  activityLevel: string;
  goal: string;
  targetWeightKg: string;
  dietPreference: string;
  allergies: string;
  dislikedIngredients: string;
  mealsPerDay: string;
}

const EMPTY: ProfileForm = {
  displayName: "",
  sex: "",
  heightCm: "",
  weightKg: "",
  activityLevel: "",
  goal: "",
  targetWeightKg: "",
  dietPreference: "flexible",
  allergies: "",
  dislikedIngredients: "",
  mealsPerDay: "",
};

function toForm(p: Record<string, unknown>): ProfileForm {
  const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const list = (v: unknown) => (Array.isArray(v) ? v.join(", ") : "");
  return {
    displayName: str(p.displayName),
    sex: str(p.sex),
    heightCm: str(p.heightCm),
    weightKg: str(p.weightKg),
    activityLevel: str(p.activityLevel),
    goal: str(p.goal),
    targetWeightKg: str(p.targetWeightKg),
    dietPreference: str(p.dietPreference) || "flexible",
    allergies: list(p.allergies),
    dislikedIngredients: list(p.dislikedIngredients),
    mealsPerDay: str(p.mealsPerDay),
  };
}

function toPayload(f: ProfileForm): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  const setStr = (k: string, v: string) => { if (v.trim()) p[k] = v.trim(); };
  const setNum = (k: string, v: string) => {
    const n = parseFloat(v);
    if (Number.isFinite(n)) p[k] = n;
  };
  setStr("displayName", f.displayName);
  setStr("sex", f.sex);
  setNum("heightCm", f.heightCm);
  setNum("weightKg", f.weightKg);
  setStr("activityLevel", f.activityLevel);
  setStr("goal", f.goal);
  setNum("targetWeightKg", f.targetWeightKg);
  setStr("dietPreference", f.dietPreference);
  const allergies = f.allergies.split(",").map((s) => s.trim()).filter(Boolean);
  if (allergies.length) p.allergies = allergies;
  const dislikes = f.dislikedIngredients.split(",").map((s) => s.trim()).filter(Boolean);
  if (dislikes.length) p.dislikedIngredients = dislikes;
  const mpd = parseInt(f.mealsPerDay, 10);
  if (Number.isFinite(mpd)) p.mealsPerDay = mpd;
  return p;
}

export default function ProfilePage() {
  const session = useSession();
  const [form, setForm] = useState<ProfileForm>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ profile?: Record<string, unknown> } | Record<string, unknown>>("/api/profile")
      .then((data) => {
        if (cancelled) return;
        const p = ("profile" in data && typeof data.profile === "object"
          ? data.profile
          : data) as Record<string, unknown>;
        setForm(toForm(p ?? {}));
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Couldn't load your profile. Please try again.");
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  function set<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      await api("/api/profile", { method: "PUT", body: toPayload(form) });
      setNotice("Profile updated ✓");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div aria-busy="true" aria-label="Loading profile">
        <Skeleton className="h-9 w-1/3" />
        <Skeleton className="mt-6 h-64" />
      </div>
    );
  }

  return (
    <div className="anim-page-enter">
      <h1 className="t-greeting">Profile</h1>
      <p className="t-body mt-1 text-[var(--text-secondary)]">
        Keep your details up to date — they power your targets and plans.
      </p>

      <GlassPanel className="mt-6 p-6">
        <p className="mb-6 text-sm text-[var(--text-secondary)]">
          Signed in as <strong className="text-[var(--text)]">{session.user.email}</strong>
        </p>
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
        {notice && (
          <p
            role="status"
            className="mb-4 rounded-xl px-4 py-3 text-sm"
            style={{
              color: "var(--success)",
              backgroundColor:
                "color-mix(in srgb, var(--success) 12%, transparent)",
              border: "1px solid color-mix(in srgb, var(--success) 38%, transparent)",
            }}
          >
            {notice}
          </p>
        )}
        <form onSubmit={onSave} className="grid gap-5 sm:grid-cols-2">
          <Field label="Display name" htmlFor="pf-name">
            <Input id="pf-name" value={form.displayName} onChange={(e) => set("displayName", e.target.value)} autoComplete="nickname" />
          </Field>
          <Field label="Sex" htmlFor="pf-sex" hint="Used only in the calorie-estimation formula.">
            <Select id="pf-sex" value={form.sex} onChange={(e) => set("sex", e.target.value)}>
              <option value="">Prefer not to say</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Height (cm)" htmlFor="pf-height">
            <Input id="pf-height" type="number" min={50} max={250} step="0.1" inputMode="decimal" value={form.heightCm} onChange={(e) => set("heightCm", e.target.value)} />
          </Field>
          <Field label="Weight (kg)" htmlFor="pf-weight">
            <Input id="pf-weight" type="number" min={20} max={300} step="0.1" inputMode="decimal" value={form.weightKg} onChange={(e) => set("weightKg", e.target.value)} />
          </Field>
          <Field label="Activity level" htmlFor="pf-activity">
            <Select id="pf-activity" value={form.activityLevel} onChange={(e) => set("activityLevel", e.target.value)}>
              <option value="">Not set</option>
              <option value="sedentary">Sedentary</option>
              <option value="light">Light</option>
              <option value="moderate">Moderate</option>
              <option value="active">Active</option>
              <option value="very_active">Very active</option>
            </Select>
          </Field>
          <Field label="Goal" htmlFor="pf-goal">
            <Select id="pf-goal" value={form.goal} onChange={(e) => set("goal", e.target.value)}>
              <option value="">Not set</option>
              <option value="lose">Lose weight</option>
              <option value="maintain">Maintain weight</option>
              <option value="gain">Gain weight</option>
              <option value="improve_fitness">Improve fitness</option>
              <option value="eat_healthier">Eat healthier</option>
            </Select>
          </Field>
          <Field label="Target weight (kg)" htmlFor="pf-target">
            <Input id="pf-target" type="number" min={20} max={300} step="0.1" inputMode="decimal" value={form.targetWeightKg} onChange={(e) => set("targetWeightKg", e.target.value)} />
          </Field>
          <Field label="Diet preference" htmlFor="pf-diet">
            <Select id="pf-diet" value={form.dietPreference} onChange={(e) => set("dietPreference", e.target.value)}>
              <option value="flexible">Flexible</option>
              <option value="vegetarian">Vegetarian</option>
              <option value="vegan">Vegan</option>
              <option value="pescatarian">Pescatarian</option>
              <option value="halal">Halal</option>
            </Select>
          </Field>
          <Field label="Allergies" htmlFor="pf-allergies" hint="Comma-separated.">
            <Input id="pf-allergies" value={form.allergies} onChange={(e) => set("allergies", e.target.value)} placeholder="peanuts, shellfish" />
          </Field>
          <Field label="Disliked ingredients" htmlFor="pf-dislikes" hint="Comma-separated.">
            <Input id="pf-dislikes" value={form.dislikedIngredients} onChange={(e) => set("dislikedIngredients", e.target.value)} placeholder="olives, mushrooms" />
          </Field>
          <Field label="Meals per day" htmlFor="pf-mpd">
            <Input id="pf-mpd" type="number" min={1} max={8} inputMode="numeric" value={form.mealsPerDay} onChange={(e) => set("mealsPerDay", e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <LuxButton type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </LuxButton>
          </div>
        </form>
      </GlassPanel>
    </div>
  );
}
