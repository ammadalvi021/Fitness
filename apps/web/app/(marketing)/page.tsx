import Link from "next/link";
import { branding, PLANS } from "@/lib/site";
import { Card } from "@/components/ui";
import { ThemeToggle } from "@/components/ThemeToggle";

const FEATURES = [
  {
    icon: "🥗",
    title: "AI diet planner",
    text: "Personalized 7-day meal plans built around your goals, preferences, allergies, and budget.",
  },
  {
    icon: "📷",
    title: "Food scanner",
    text: "Snap a photo of your meal and get instant nutrition estimates — portions, calories, macros.",
  },
  {
    icon: "🏋️",
    title: "Workouts",
    text: "Weekly workout schedules with exercise demos, timers, and set / rep / weight tracking.",
  },
  {
    icon: "📖",
    title: "Healthy recipes",
    text: "A curated library of balanced recipes with full nutrition per serving.",
  },
  {
    icon: "🤖",
    title: "AI coach",
    text: "A supportive coach that answers questions and keeps your progress toward your goal on track.",
  },
  {
    icon: "📈",
    title: "Progress tracking",
    text: "Weight, measurements, workouts, and nutrition trends in one dashboard.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950">
      {/* Header */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={branding.logoPath} alt="" aria-hidden="true" className="h-9" />
          <span className="sr-only">{branding.appName}</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/login"
            className="inline-flex min-h-[44px] items-center rounded-xl px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="inline-flex min-h-[44px] items-center rounded-xl bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            Get started
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-12 text-center sm:pt-20">
        <h1 className="mx-auto max-w-3xl text-4xl font-extrabold tracking-tight text-neutral-900 dark:text-neutral-100 sm:text-6xl">
          {branding.appName}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-neutral-600 dark:text-neutral-400 sm:text-xl">
          {branding.tagline}
        </p>
        <p className="mx-auto mt-4 max-w-2xl text-base text-neutral-600 dark:text-neutral-400">
          Your AI-powered companion for nutrition, workouts, and healthy habits
          — personalized plans, smart food tracking, and coaching that supports
          your progress toward your goal.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/register"
            className="inline-flex min-h-[52px] items-center rounded-xl bg-brand px-8 text-lg font-semibold text-white hover:bg-brand-dark"
          >
            Start free
          </Link>
          <Link
            href="/pricing"
            className="inline-flex min-h-[52px] items-center rounded-xl border border-neutral-300 px-8 text-lg font-medium text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            See plans
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="text-center text-2xl font-bold text-neutral-900 dark:text-neutral-100 sm:text-3xl">
          Everything you need to build healthy habits
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Card key={f.title}>
              <div aria-hidden="true" className="text-3xl">
                {f.icon}
              </div>
              <h3 className="mt-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                {f.title}
              </h3>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                {f.text}
              </p>
            </Card>
          ))}
        </div>
      </section>

      {/* Plan teaser */}
      <section className="border-y border-neutral-200 bg-neutral-50 py-12 dark:border-neutral-800 dark:bg-neutral-900/40">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-2xl font-bold text-neutral-900 dark:text-neutral-100 sm:text-3xl">
            Simple, honest pricing
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-sm text-neutral-600 dark:text-neutral-400">
            Start free. Upgrade when you want personalized plans and unlimited
            AI coaching.
          </p>
          <div className="mx-auto mt-8 grid max-w-3xl gap-4 sm:grid-cols-3">
            {PLANS.filter((p) => p.available).map((plan) => (
              <Card
                key={plan.id}
                className={
                  plan.id === "diet"
                    ? "border-2 border-brand"
                    : undefined
                }
              >
                <h3 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
                  {plan.name}
                </h3>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  {plan.tagline}
                </p>
                <p className="mt-3">
                  <span className="text-3xl font-extrabold text-neutral-900 dark:text-neutral-100">
                    ${plan.price.toFixed(2)}
                  </span>
                  <span className="text-sm text-neutral-500 dark:text-neutral-400">
                    {plan.billingPeriod === "free"
                      ? " forever"
                      : ` / ${plan.billingPeriod.replace("ly", "")}`}
                  </span>
                </p>
                <Link
                  href="/register"
                  className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark"
                >
                  Choose {plan.name}
                </Link>
              </Card>
            ))}
          </div>
          <p className="mt-6 text-center">
            <Link
              href="/pricing"
              className="text-sm font-medium text-brand hover:underline"
            >
              Compare all features →
            </Link>
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 py-16 text-center">
        <h2 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 sm:text-3xl">
          Ready to start your journey?
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-neutral-600 dark:text-neutral-400">
          Join {branding.appName} today and take the first step toward a
          healthier you.
        </p>
        <div className="mt-6">
          <Link
            href="/register"
            className="inline-flex min-h-[52px] items-center rounded-xl bg-brand px-8 text-lg font-semibold text-white hover:bg-brand-dark"
          >
            Create your free account
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-neutral-200 py-8 dark:border-neutral-800">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:flex-row">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={branding.iconPath} alt="" aria-hidden="true" className="h-6 w-6" />
            <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              {branding.appName}
            </span>
          </div>
          <nav aria-label="Footer" className="flex gap-6 text-sm">
            <Link href="/pricing" className="text-neutral-600 hover:underline dark:text-neutral-400">
              Pricing
            </Link>
            <Link href="/login" className="text-neutral-600 hover:underline dark:text-neutral-400">
              Sign in
            </Link>
            <Link href="/register" className="text-neutral-600 hover:underline dark:text-neutral-400">
              Sign up
            </Link>
          </nav>
          <p className="text-xs text-neutral-500 dark:text-neutral-500">
            © {new Date().getFullYear()} {branding.appName}. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
