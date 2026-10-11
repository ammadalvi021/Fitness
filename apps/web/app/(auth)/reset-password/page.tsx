"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Field, Input } from "@/components/ui";
import { LuxButton } from "@/components/luxury";

function ResetInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await api("/api/auth/reset-password", {
        method: "POST",
        body: { token, newPassword: password },
      });
      setDone(true);
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

  if (!token) {
    return (
      <>
        <h1 className="t-card-heading text-2xl">Invalid reset link</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          This password reset link is missing its token. Please request a new
          one.
        </p>
        <Link
          href="/forgot-password"
          className="anim-press mt-6 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl px-4 font-semibold transition-colors"
          style={{ backgroundColor: "var(--accent)", color: "var(--on-accent)" }}
        >
          Request a new link
        </Link>
      </>
    );
  }

  if (done) {
    return (
      <>
        <span
          aria-hidden="true"
          className="flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{
            color: "var(--success)",
            backgroundColor:
              "color-mix(in srgb, var(--success) 12%, transparent)",
            border:
              "1px solid color-mix(in srgb, var(--success) 38%, transparent)",
          }}
        >
          <CheckCircle2 size={26} />
        </span>
        <h1 className="t-card-heading mt-4 text-2xl">Password updated</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          You can now sign in with your new password.
        </p>
        <Link
          href="/login"
          className="anim-press mt-6 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl px-4 font-semibold transition-colors"
          style={{ backgroundColor: "var(--accent)", color: "var(--on-accent)" }}
        >
          Sign in
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="t-card-heading text-2xl">Choose a new password</h1>
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
        <Field
          label="New password"
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
          />
        </Field>
        <Field label="Confirm new password" htmlFor="confirm" required>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        <LuxButton type="submit" className="w-full" disabled={loading}>
          {loading ? "Updating…" : "Update password"}
        </LuxButton>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<p className="text-sm text-[var(--text-secondary)]">Loading…</p>}>
      <ResetInner />
    </Suspense>
  );
}
