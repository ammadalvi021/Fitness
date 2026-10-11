import Link from "next/link";
import { Check } from "lucide-react";
import { branding, PLANS } from "@/lib/site";
import { GlassPanel } from "@/components/luxury";
import { ThemeSelector } from "@/components/ThemeSelector";

export const metadata = {
  title: "Pricing",
  description: `Plans and pricing for ${branding.appName}.`,
};

function limitLabel(value: number, unit: string): string {
  return value < 0 ? `Unlimited ${unit}` : `${value} ${unit}`;
}

export default function PricingPage() {
  const plans = PLANS.filter((p) => p.available);

  return (
    <div className="anim-page-enter min-h-screen bg-[var(--bg)]">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Link href="/" className="flex items-center gap-2" aria-label="Back to home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={branding.logoPath} alt="" aria-hidden="true" className="h-9" />
        </Link>
        <div className="flex items-center gap-2">
          <ThemeSelector compact />
          <Link
            href="/login"
            className="inline-flex min-h-[44px] items-center rounded-xl px-4 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text)]"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-12">
        <h1 className="t-greeting">Plans & pricing</h1>
        <p className="t-body mt-2 max-w-2xl text-[var(--text-secondary)]">
          Start free and upgrade when you&apos;re ready. Billing is only ever
          charged through a configured payment provider.
        </p>

        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {plans.map((plan) => (
            <GlassPanel
              key={plan.id}
              className="anim-hover-lift flex flex-col p-6"
              style={
                plan.id === "diet"
                  ? {
                      border: "1px solid var(--accent)",
                      boxShadow:
                        "0 16px 40px -16px rgba(0, 0, 0, 0.55)",
                    }
                  : undefined
              }
            >
              <h2 className="t-card-heading">{plan.name}</h2>
              <p className="text-sm text-[var(--text-secondary)]">
                {plan.tagline}
              </p>
              <p className="mt-4">
                <span className="t-numeral text-4xl">
                  ${plan.price.toFixed(2)}
                </span>{" "}
                <span className="text-sm text-[var(--text-secondary)]">
                  {plan.billingPeriod === "free"
                    ? "forever free"
                    : `per ${plan.billingPeriod.replace("ly", "")}`}
                </span>
              </p>

              <ul className="mt-5 space-y-2 text-sm text-[var(--text)]">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check
                      size={16}
                      aria-hidden="true"
                      className="mt-0.5 shrink-0"
                      style={{ color: "var(--accent)" }}
                    />
                    {f}
                  </li>
                ))}
              </ul>

              <div className="mt-5 border-t border-[var(--border)] pt-4 text-xs text-[var(--text-secondary)]">
                <p className="t-meta">Usage limits</p>
                <ul className="mt-2 space-y-1">
                  <li>{limitLabel(plan.limits.aiScansPerMonth, "AI food scans / month")}</li>
                  <li>{limitLabel(plan.limits.aiCoachMessagesPerDay, "AI coach messages / day")}</li>
                  <li>{limitLabel(plan.limits.aiPlanRegenerationsPerWeek, "AI meal-plan regenerations / week")}</li>
                  <li>{limitLabel(plan.limits.savedRecipes, "saved recipes")}</li>
                  <li>{limitLabel(plan.limits.customMeals, "custom meals")}</li>
                </ul>
              </div>

              <Link
                href="/register"
                className="anim-press mt-6 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl px-4 font-semibold transition-colors"
                style={
                  plan.id === "diet"
                    ? { backgroundColor: "var(--accent)", color: "var(--on-accent)" }
                    : { border: "1px solid var(--accent)", color: "var(--text)" }
                }
              >
                {plan.price === 0 ? "Start free" : `Choose ${plan.name}`}
              </Link>
            </GlassPanel>
          ))}
        </div>

        <p className="mx-auto mt-10 max-w-2xl text-center text-xs text-[var(--text-secondary)]">
          Plan selection is recorded in your account. You are never charged
          without going through a configured payment provider first — if no
          provider is configured, selecting a paid plan simply unlocks the
          features in-app with no charge.
        </p>
      </main>
    </div>
  );
}
