import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Bot,
  Camera,
  Dumbbell,
  Salad,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { branding, PLANS } from "@/lib/site";
import { GlassPanel, PlanCard } from "@/components/luxury";
import { ThemeSelector } from "@/components/ThemeSelector";

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Salad,
    title: "AI diet planner",
    text: "Personalized 7-day meal plans built around your goals, preferences, allergies, and budget.",
  },
  {
    icon: Camera,
    title: "Food scanner",
    text: "Snap a photo of your meal and get instant nutrition estimates — portions, calories, macros.",
  },
  {
    icon: Dumbbell,
    title: "Workouts",
    text: "Weekly workout schedules with exercise demos, timers, and set / rep / weight tracking.",
  },
  {
    icon: BookOpen,
    title: "Healthy recipes",
    text: "A curated library of balanced recipes with full nutrition per serving.",
  },
  {
    icon: Bot,
    title: "AI coach",
    text: "A supportive coach that answers questions and keeps your progress toward your goal on track.",
  },
  {
    icon: TrendingUp,
    title: "Progress tracking",
    text: "Weight, measurements, workouts, and nutrition trends in one dashboard.",
  },
];

/** Gold primary CTA link (mirrors LuxButton primary styling). */
function PrimaryCta({
  href,
  children,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`anim-press touch-target inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl px-8 text-lg font-semibold transition-colors ${className}`}
      style={{ backgroundColor: "var(--accent)", color: "var(--on-accent)" }}
    >
      {children}
    </Link>
  );
}

/** Outlined secondary CTA link (mirrors LuxButton secondary styling). */
function SecondaryCta({
  href,
  children,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`anim-press touch-target inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl border px-8 text-lg font-medium transition-colors ${className}`}
      style={{ borderColor: "var(--accent)", color: "var(--text)" }}
    >
      {children}
    </Link>
  );
}

export default function LandingPage() {
  return (
    <div className="anim-page-enter min-h-screen bg-[var(--bg)]">
      {/* Header */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={branding.logoPath} alt="" aria-hidden="true" className="h-9" />
          <span className="sr-only">{branding.appName}</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeSelector compact />
          <Link
            href="/login"
            className="inline-flex min-h-[44px] items-center rounded-xl px-4 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text)]"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="anim-press inline-flex min-h-[44px] items-center rounded-xl px-5 text-sm font-semibold transition-colors"
            style={{ backgroundColor: "var(--accent)", color: "var(--on-accent)" }}
          >
            Get started
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-12 text-center sm:pt-20">
        <h1 className="t-greeting mx-auto max-w-3xl sm:text-6xl sm:font-medium sm:tracking-tight">
          {branding.appName}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-[var(--text-secondary)] sm:text-xl">
          {branding.tagline}
        </p>
        <p className="t-body mx-auto mt-4 max-w-2xl text-[var(--text-secondary)]">
          Your AI-powered companion for nutrition, workouts, and healthy habits
          — personalized plans, smart food tracking, and coaching that supports
          your progress toward your goal.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <PrimaryCta href="/register">
            Start free <ArrowRight size={20} aria-hidden="true" />
          </PrimaryCta>
          <SecondaryCta href="/pricing">See plans</SecondaryCta>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="t-page-title text-center">
          Everything you need to build healthy habits
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <GlassPanel key={f.title} className="anim-hover-lift p-5">
                <span
                  aria-hidden="true"
                  className="flex h-11 w-11 items-center justify-center rounded-xl"
                  style={{
                    color: "var(--accent)",
                    backgroundColor: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <Icon size={20} />
                </span>
                <h3 className="t-card-heading mt-3">{f.title}</h3>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  {f.text}
                </p>
              </GlassPanel>
            );
          })}
        </div>
      </section>

      {/* Plan teaser */}
      <section className="border-y border-[var(--border)] py-12" style={{ backgroundColor: "var(--bg-elevated)" }}>
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="t-page-title text-center">Simple, honest pricing</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-sm text-[var(--text-secondary)]">
            Start free. Upgrade when you want personalized plans and unlimited
            AI coaching.
          </p>
          <div className="mx-auto mt-10 grid max-w-3xl gap-5 sm:grid-cols-3">
            {PLANS.filter((p) => p.available).map((plan) => (
              <PlanCard
                key={plan.id}
                name={plan.name}
                price={`$${plan.price.toFixed(2)}`}
                period={
                  plan.billingPeriod === "free"
                    ? "forever"
                    : `/ ${plan.billingPeriod.replace("ly", "")}`
                }
                features={plan.features}
                highlighted={plan.id === "diet"}
                cta={
                  <Link
                    href="/register"
                    className="anim-press inline-flex min-h-[44px] w-full items-center justify-center rounded-xl px-4 text-sm font-semibold transition-colors"
                    style={
                      plan.id === "diet"
                        ? { backgroundColor: "var(--accent)", color: "var(--on-accent)" }
                        : { border: "1px solid var(--accent)", color: "var(--text)" }
                    }
                  >
                    Choose {plan.name}
                  </Link>
                }
              />
            ))}
          </div>
          <p className="mt-6 text-center">
            <Link
              href="/pricing"
              className="text-sm font-medium text-[var(--accent)] hover:underline"
            >
              Compare all features →
            </Link>
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 py-16 text-center">
        <h2 className="t-page-title">Ready to start your journey?</h2>
        <p className="mx-auto mt-2 max-w-xl text-[var(--text-secondary)]">
          Join {branding.appName} today and take the first step toward a
          healthier you.
        </p>
        <div className="mt-6">
          <PrimaryCta href="/register">Create your free account</PrimaryCta>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:flex-row">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={branding.iconPath} alt="" aria-hidden="true" className="h-6 w-6" />
            <span className="text-sm font-semibold text-[var(--text)]">
              {branding.appName}
            </span>
          </div>
          <nav aria-label="Footer" className="flex gap-6 text-sm">
            <Link href="/pricing" className="text-[var(--text-secondary)] hover:underline">
              Pricing
            </Link>
            <Link href="/login" className="text-[var(--text-secondary)] hover:underline">
              Sign in
            </Link>
            <Link href="/register" className="text-[var(--text-secondary)] hover:underline">
              Sign up
            </Link>
          </nav>
          <p className="text-xs text-[var(--text-secondary)]">
            © {new Date().getFullYear()} {branding.appName}. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
