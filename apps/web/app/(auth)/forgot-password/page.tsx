"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Field, Input } from "@/components/ui";
import { LuxButton } from "@/components/luxury";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      // Always 200 (no account enumeration); we always show the same message.
      await api("/api/auth/forgot-password", {
        method: "POST",
        body: { email },
      });
    } catch {
      // Deliberately ignored: same UX either way.
    } finally {
      setLoading(false);
      setSent(true);
    }
  }

  return (
    <>
      <h1 className="t-card-heading text-2xl">Reset your password</h1>
      {!sent ? (
        <>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Enter your account email and we&apos;ll send you a reset link.
          </p>
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
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
            <LuxButton type="submit" className="w-full" disabled={loading}>
              {loading ? "Sending…" : "Send reset link"}
            </LuxButton>
          </form>
        </>
      ) : (
        <p
          role="status"
          className="mt-4 rounded-xl px-4 py-3 text-sm"
          style={{
            color: "var(--success)",
            backgroundColor:
              "color-mix(in srgb, var(--success) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--success) 38%, transparent)",
          }}
        >
          If an account exists for <strong>{email}</strong>, a password reset
          link is on its way. Check your inbox (and spam folder).
        </p>
      )}
      <p className="mt-6 text-center text-sm text-[var(--text-secondary)]">
        <Link href="/login" className="font-medium text-[var(--accent)] hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
