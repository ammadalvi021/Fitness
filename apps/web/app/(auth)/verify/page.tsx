"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui";

type State =
  | { kind: "awaiting" } // no token yet: check-email + resend
  | { kind: "verifying" }
  | { kind: "verified" }
  | { kind: "failed"; message: string };

function VerifyInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const email = searchParams.get("email");
  const [state, setState] = useState<State>(
    token ? { kind: "verifying" } : { kind: "awaiting" }
  );
  const [resendState, setResendState] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");

  useEffect(() => {
    if (!token) return;
    api("/api/auth/verify", { method: "POST", body: { token } })
      .then(() => setState({ kind: "verified" }))
      .catch((err) =>
        setState({
          kind: "failed",
          message:
            err instanceof ApiError
              ? err.message
              : "Verification failed. Please try again.",
        })
      );
  }, [token]);

  async function resend() {
    setResendState("sending");
    try {
      await api("/api/auth/request-verification", { method: "POST" });
      setResendState("sent");
    } catch {
      setResendState("error");
    }
  }

  if (state.kind === "verifying") {
    return (
      <>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          Verifying…
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Please wait while we confirm your email.
        </p>
      </>
    );
  }

  if (state.kind === "verified") {
    return (
      <>
        <div aria-hidden="true" className="text-5xl">
          ✅
        </div>
        <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          Email verified!
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Your account is ready. Let&apos;s set up your profile.
        </p>
        <Link
          href="/onboarding"
          className="mt-6 inline-flex min-h-[52px] w-full items-center justify-center rounded-xl bg-brand px-6 text-lg font-semibold text-white hover:bg-brand-dark"
        >
          Continue to onboarding
        </Link>
      </>
    );
  }

  if (state.kind === "failed") {
    return (
      <>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          Verification failed
        </h1>
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
          {state.message}
        </p>
        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
          The link may have expired. Request a new one below.
        </p>
        <Button onClick={resend} size="lg" className="mt-4 w-full" disabled={resendState === "sending"}>
          {resendState === "sending" ? "Sending…" : "Resend verification email"}
        </Button>
      </>
    );
  }

  // awaiting: user just registered, no token in URL
  return (
    <>
      <div aria-hidden="true" className="text-5xl">
        ✉️
      </div>
      <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
        Check your email
      </h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        We sent a verification link to{" "}
        <strong>{email ?? "your email address"}</strong>. Click it to activate
        your account.
      </p>
      {resendState === "sent" && (
        <p role="status" className="mt-4 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700 dark:bg-green-900/30 dark:text-green-300">
          Verification email sent. Please check your inbox.
        </p>
      )}
      {resendState === "error" && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          Couldn&apos;t send the email. Please try again in a moment.
        </p>
      )}
      <Button
        variant="secondary"
        size="lg"
        className="mt-6 w-full"
        onClick={resend}
        disabled={resendState === "sending"}
      >
        {resendState === "sending" ? "Sending…" : "Resend email"}
      </Button>
      <p className="mt-6 text-center text-sm text-neutral-600 dark:text-neutral-400">
        <Link href="/login" className="font-medium text-brand hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={<p className="text-sm text-neutral-500">Loading…</p>}
    >
      <VerifyInner />
    </Suspense>
  );
}
