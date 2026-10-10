"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button, Field, Input } from "@/components/ui";

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
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
        Reset your password
      </h1>
      {!sent ? (
        <>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
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
            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        </>
      ) : (
        <p role="status" className="mt-4 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700 dark:bg-green-900/30 dark:text-green-300">
          If an account exists for <strong>{email}</strong>, a password reset
          link is on its way. Check your inbox (and spam folder).
        </p>
      )}
      <p className="mt-6 text-center text-sm text-neutral-600 dark:text-neutral-400">
        <Link href="/login" className="font-medium text-brand hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
