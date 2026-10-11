"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, MailOpen } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { LuxButton } from "@/components/luxury";

type State =
  | { kind: "awaiting" } // no token yet: check-email + resend
  | { kind: "verifying" }
  | { kind: "verified" }
  | { kind: "failed"; message: string };

/** Tinted icon chip for the verify status illustrations. */
function StatusIcon({ tone, children }: { tone: "success" | "accent"; children: React.ReactNode }) {
  const color = tone === "success" ? "var(--success)" : "var(--accent)";
  return (
    <span
      aria-hidden="true"
      className="flex h-14 w-14 items-center justify-center rounded-2xl"
      style={{
        color,
        backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 38%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

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
        <h1 className="t-card-heading text-2xl">Verifying…</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Please wait while we confirm your email.
        </p>
      </>
    );
  }

  if (state.kind === "verified") {
    return (
      <>
        <StatusIcon tone="success">
          <CheckCircle2 size={26} />
        </StatusIcon>
        <h1 className="t-card-heading mt-4 text-2xl">Email verified!</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Your account is ready. Let&apos;s set up your profile.
        </p>
        <Link
          href="/onboarding"
          className="anim-press mt-6 inline-flex min-h-[52px] w-full items-center justify-center rounded-xl px-6 text-lg font-semibold transition-colors"
          style={{ backgroundColor: "var(--accent)", color: "var(--on-accent)" }}
        >
          Continue to onboarding
        </Link>
      </>
    );
  }

  if (state.kind === "failed") {
    return (
      <>
        <h1 className="t-card-heading text-2xl">Verification failed</h1>
        <p
          role="alert"
          className="mt-2 rounded-xl px-4 py-3 text-sm"
          style={{
            color: "var(--error)",
            backgroundColor:
              "color-mix(in srgb, var(--error) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--error) 38%, transparent)",
          }}
        >
          {state.message}
        </p>
        <p className="mt-4 text-sm text-[var(--text-secondary)]">
          The link may have expired. Request a new one below.
        </p>
        <LuxButton onClick={resend} className="mt-4 w-full" disabled={resendState === "sending"}>
          {resendState === "sending" ? "Sending…" : "Resend verification email"}
        </LuxButton>
      </>
    );
  }

  // awaiting: user just registered, no token in URL
  return (
    <>
      <StatusIcon tone="accent">
        <MailOpen size={26} />
      </StatusIcon>
      <h1 className="t-card-heading mt-4 text-2xl">Check your email</h1>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        We sent a verification link to{" "}
        <strong>{email ?? "your email address"}</strong>. Click it to activate
        your account.
      </p>
      {resendState === "sent" && (
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
          Verification email sent. Please check your inbox.
        </p>
      )}
      {resendState === "error" && (
        <p
          role="alert"
          className="mt-4 rounded-xl px-4 py-3 text-sm"
          style={{
            color: "var(--error)",
            backgroundColor:
              "color-mix(in srgb, var(--error) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--error) 38%, transparent)",
          }}
        >
          Couldn&apos;t send the email. Please try again in a moment.
        </p>
      )}
      <LuxButton
        variant="secondary"
        className="mt-6 w-full"
        onClick={resend}
        disabled={resendState === "sending"}
      >
        {resendState === "sending" ? "Sending…" : "Resend email"}
      </LuxButton>
      <p className="mt-6 text-center text-sm text-[var(--text-secondary)]">
        <Link href="/login" className="font-medium text-[var(--accent)] hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={<p className="text-sm text-[var(--text-secondary)]">Loading…</p>}
    >
      <VerifyInner />
    </Suspense>
  );
}
