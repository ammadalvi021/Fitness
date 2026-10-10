import Link from "next/link";
import { branding, PLANS } from "@/lib/site";
import { Card, PageHeader } from "@/components/ui";
import { ThemeToggle } from "@/components/ThemeToggle";

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
    <div className="min-h-screen bg-white dark:bg-neutral-950">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Link href="/" className="flex items-center gap-2" aria-label="Back to home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={branding.logoPath} alt="" aria-hidden="true" className="h-9" />
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/login"
            className="inline-flex min-h-[44px] items-center rounded-xl px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-12">
        <PageHeader
          title="Plans & pricing"
          subtitle="Start free and upgrade when you're ready. Billing is only ever charged through a configured payment provider."
        />

        <div className="grid gap-5 md:grid-cols-3">
          {plans.map((plan) => (
            <Card
              key={plan.id}
              className={
                plan.id === "diet"
                  ? "border-2 border-brand"
                  : undefined
              }
            >
              <h2 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">
                {plan.name}
              </h2>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                {plan.tagline}
              </p>
              <p className="mt-4">
                <span className="text-4xl font-extrabold text-neutral-900 dark:text-neutral-100">
                  ${plan.price.toFixed(2)}
                </span>{" "}
                <span className="text-sm text-neutral-500 dark:text-neutral-400">
                  {plan.billingPeriod === "free"
                    ? "forever free"
                    : `per ${plan.billingPeriod.replace("ly", "")}`}
                </span>
              </p>

              <ul className="mt-5 space-y-2 text-sm text-neutral-700 dark:text-neutral-300">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span aria-hidden="true" className="text-green-600">
                      ✓
                    </span>
                    {f}
                  </li>
                ))}
              </ul>

              <div className="mt-5 border-t border-neutral-200 pt-4 text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                <p className="font-semibold uppercase tracking-wide">
                  Usage limits
                </p>
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
                className="mt-6 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-brand px-4 font-semibold text-white hover:bg-brand-dark"
              >
                {plan.price === 0 ? "Start free" : `Choose ${plan.name}`}
              </Link>
            </Card>
          ))}
        </div>

        <p className="mx-auto mt-10 max-w-2xl text-center text-xs text-neutral-500 dark:text-neutral-400">
          Plan selection is recorded in your account. You are never charged
          without going through a configured payment provider first — if no
          provider is configured, selecting a paid plan simply unlocks the
          features in-app with no charge.
        </p>
      </main>
    </div>
  );
}
