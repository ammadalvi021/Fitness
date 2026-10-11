"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Field, Input } from "@/components/ui";
import { LuxButton } from "@/components/luxury";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api("/api/auth/register", {
        method: "POST",
        body: { email, password, name: name || undefined },
      });
      // Ask the user to verify their email before continuing.
      router.push(`/verify?email=${encodeURIComponent(email)}`);
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
      <h1 className="t-card-heading text-2xl">Create your account</h1>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        Free to start — no credit card required.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
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
        <Field label="Name" htmlFor="name" hint="What should we call you?">
          <Input
            id="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
          />
        </Field>
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
        <Field
          label="Password"
          htmlFor="password"
          required
          hint="At least 8 characters with a letter and a number."
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Choose a strong password"
          />
        </Field>
        <LuxButton type="submit" className="w-full" disabled={loading}>
          {loading ? "Creating account…" : "Create account"}
        </LuxButton>
      </form>

      <p className="mt-6 text-center text-sm text-[var(--text-secondary)]">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-[var(--accent)] hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
