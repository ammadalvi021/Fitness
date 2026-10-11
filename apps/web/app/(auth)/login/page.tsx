"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Field, Input } from "@/components/ui";
import { LuxButton } from "@/components/luxury";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: { email, password },
      });
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h1 className="t-card-heading text-2xl">Welcome back</h1>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        Sign in to continue your progress toward your goal.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate={false}>
        {error && (
          <p
            role="alert"
            className="rounded-xl px-4 py-3 text-sm"
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
        <Field label="Email" htmlFor="email" required>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </Field>
        <Field label="Password" htmlFor="password" required>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
          />
        </Field>
        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-[var(--accent)] hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <LuxButton type="submit" className="w-full" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </LuxButton>
      </form>

      <p className="mt-6 text-center text-sm text-[var(--text-secondary)]">
        New here?{" "}
        <Link href="/register" className="font-medium text-[var(--accent)] hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<p className="text-sm text-[var(--text-secondary)]">Loading…</p>}>
      <LoginForm />
    </Suspense>
  );
}
