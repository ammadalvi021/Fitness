"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Button, Field, Input } from "@/components/ui";

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
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          Invalid reset link
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          This password reset link is missing its token. Please request a new
          one.
        </p>
        <Link
          href="/forgot-password"
          className="mt-6 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-brand px-4 font-semibold text-white hover:bg-brand-dark"
        >
          Request a new link
        </Link>
      </>
    );
  }

  if (done) {
    return (
      <>
        <div aria-hidden="true" className="text-5xl">
          ✅
        </div>
        <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          Password updated
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          You can now sign in with your new password.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-brand px-4 font-semibold text-white hover:bg-brand-dark"
        >
          Sign in
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
        Choose a new password
      </h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        {error && (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
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
        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading ? "Updating…" : "Update password"}
        </Button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
      <ResetInner />
    </Suspense>
  );
}
