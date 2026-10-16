"use client";

/**
 * Admin-only recipe review panel (v21.3).
 *
 * Admin detection follows the established pattern (see
 * app/(app)/admin/menus/page.tsx): the panel probes the admin-gated
 * GET /api/admin/recipes/[slug]/review endpoint. Success → the caller is an
 * admin and the panel renders; 401/403 → the panel renders nothing.
 * Ordinary users never see it and cannot self-grant — the server enforces
 * the ADMIN_EMAILS allowlist on every request.
 *
 * The reviewer identity is prefilled from the session (the GET returns it)
 * and is read-only here; the server overwrites it with the session email
 * anyway, so a forged identity can never be recorded.
 */
import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { REVIEW_METHODS } from '@fitfusion/core';
import {
  GlassPanel,
  LuxButton,
} from '@/components/luxury';
import { Input, Select, Textarea, Field } from '@/components/ui';

interface ReviewState {
  reviewer: string;
  tier: string;
  reviewEvidence: Record<string, unknown> | null;
  verificationEvidence: Record<string, unknown> | null;
  verified: boolean;
  /** v21.4: incomplete-nutrition status — verification is blocked while true. */
  needsReview: boolean;
  unresolvedIngredients: string[];
  verificationBlocked: boolean;
  /**
   * v21.6: the content revision hash from the GET prefill. Sent back as
   * expectedContentHash so a concurrent recipe edit fails the review POST
   * with 409 instead of recording evidence against changed content.
   * null = the recipe predates hash tracking (the client then sends
   * explicit null; the server writes conditionally on contentHash IS NULL).
   * v21.7: `revision` is the second half of the guard pair
   * (recipe-governance.ts §5b) — the mutation counter the GET returned.
   * Sent back as expectedRevision; every review/verify/clear bumps it, so
   * a stale admin action 409s instead of silently overwriting a newer
   * review state. 0 = the recipe was written before v21.7 (the migration
   * default).
   */
  contentHash: string | null;
  revision: number;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function todayYMD(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export default function AdminRecipeReview({
  slug,
  onChanged,
}: {
  slug: string;
  onChanged: () => void;
}) {
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [state, setState] = useState<ReviewState | null>(null);
  const [reviewer, setReviewer] = useState('');
  const [date, setDate] = useState(todayYMD());
  const [method, setMethod] = useState<string>(REVIEW_METHODS[0]);
  const [reference, setReference] = useState('');
  const [dietaryRechecked, setDietaryRechecked] = useState(false);
  const [allergenRechecked, setAllergenRechecked] = useState(false);
  const [verifyRechecked, setVerifyRechecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Raw fetch (not the api() helper): the helper redirects to /login
        // on 401, which must NOT happen on this public page — a non-admin
        // or anonymous viewer simply never sees the panel.
        const res = await fetch(
          `/api/admin/recipes/${encodeURIComponent(slug)}/review`,
          { credentials: 'same-origin' },
        );
        if (cancelled) return;
        if (res.status === 401 || res.status === 403 || !res.ok) {
          setAdmin(false);
          return;
        }
        const data = (await res.json()) as Record<string, unknown>;
        if (cancelled) return;
        setState({
          reviewer: str(data.reviewer),
          tier: str(data.tier),
          reviewEvidence:
            data.reviewEvidence && typeof data.reviewEvidence === 'object'
              ? (data.reviewEvidence as Record<string, unknown>)
              : null,
          verificationEvidence:
            data.verificationEvidence && typeof data.verificationEvidence === 'object'
              ? (data.verificationEvidence as Record<string, unknown>)
              : null,
          verified: data.verified === true,
          needsReview: data.needsReview === true,
          unresolvedIngredients: asStringArray(data.unresolvedIngredients),
          verificationBlocked: data.verificationBlocked === true,
          contentHash:
            typeof data.contentHash === 'string' ? data.contentHash : null,
          revision:
            typeof data.revision === 'number' && Number.isInteger(data.revision)
              ? data.revision
              : 0,
        });
        setReviewer(str(data.reviewer));
        setAdmin(true);
      } catch {
        // A probe failure is not proof of non-admin (the menus admin page
        // treats unexpected errors the same way); hide the panel either way.
        if (cancelled) return;
        setAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (admin !== true) return null;

  async function submit(action: 'review' | 'verify' | 'clear') {
    // v21.4: recording a fresh review on a verified recipe RESETS the
    // verification (server-side, same update). Say so before the click lands.
    if (
      action === 'review' &&
      state?.verified === true &&
      !window.confirm(
        'This recipe is currently Verified. Recording a new review will RESET ' +
          'the verification (it was tied to the earlier review). Continue?',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const reviewEvidence = {
        reviewedAt: date,
        method,
        reference,
        dietaryRechecked,
        allergenRechecked,
      };
      const body: Record<string, unknown> =
        action === 'clear'
          ? { action }
          : action === 'review'
            ? { action, evidence: reviewEvidence }
            : {
                action,
                evidence: {
                  checkedAt: date,
                  method,
                  allergenAndDietRechecked: verifyRechecked,
                },
                // Verify requires a complete review record; sending it in the
                // same call satisfies the requirement in one step.
                reviewEvidence,
              };
      // v21.6: optimistic concurrency — the server REQUIRES the guard on
      // every review write (recipe-governance.ts §5). Always send the hash
      // the GET prefill returned: a string for hashed rows, EXPLICIT null
      // for legacy rows that predate hash tracking (the server then writes
      // conditionally on contentHash IS NULL instead of failing over to an
      // unconditional write — a concurrent edit moves the hash to non-null
      // and the write 409s). Omitting it is a 409, never a silent write.
      // v21.7: the guard is the (hash, revision) PAIR (§5b) — also send the
      // revision token the GET returned (0 for pre-v21.7 rows). A review /
      // verify / clear that does not move the hash still moves the
      // revision, so a stale admin action 409s instead of silently
      // overwriting a newer review state.
      body.expectedContentHash = state?.contentHash ?? null;
      body.expectedRevision = state?.revision ?? 0;
      const data = await api<Record<string, unknown>>(
        `/api/admin/recipes/${encodeURIComponent(slug)}/review`,
        { method: 'POST', body },
      );
      const res = (data.recipe ?? {}) as Record<string, unknown>;
      setState({
        reviewer,
        tier: str(res.tier),
        reviewEvidence:
          res.reviewEvidence && typeof res.reviewEvidence === 'object'
            ? (res.reviewEvidence as Record<string, unknown>)
            : null,
        verificationEvidence:
          res.verificationEvidence && typeof res.verificationEvidence === 'object'
            ? (res.verificationEvidence as Record<string, unknown>)
            : null,
        verified: res.verified === true,
        // The review POST can reset verification server-side; the
        // incomplete status is unchanged by review actions (the API does
        // not clear needsReview), so carry it forward. Review actions do
        // not change content, so the content hash is carried forward too
        // (a 409 stale_recipe would have thrown below instead).
        // v21.7: the POST bumps the revision token (review/verify/clear
        // move it in the same statement) — take the NEW value from the
        // response so the next write carries a fresh guard.
        needsReview: state?.needsReview === true,
        unresolvedIngredients: state?.unresolvedIngredients ?? [],
        verificationBlocked: state?.verificationBlocked === true,
        contentHash: state?.contentHash ?? null,
        revision:
          typeof res.revision === 'number' && Number.isInteger(res.revision)
            ? res.revision
            : (state?.revision ?? 0),
      });
      setDone(
        action === 'clear'
          ? 'Review status cleared.'
          : action === 'review' && res.verificationReset === true
            ? 'Review recorded. The previous verification was reset.'
            : action === 'review'
              ? 'Review recorded.'
              : 'Verification recorded.',
      );
      onChanged();
    } catch (e: unknown) {
      // v21.5: a 409 stale_recipe means a concurrent recipe edit landed
      // while the admin was reviewing — say so explicitly (the safe move
      // is to reload and re-check the current content, not retry blindly).
      // v21.7: the same 409 also covers a concurrent review-state change
      // (a second admin's review/verify/clear moved the revision token),
      // so the message names both.
      setError(
        e instanceof ApiError && e.code === 'stale_recipe'
          ? 'The recipe\u2019s content or its review state changed while you were reviewing. Reload the page to see the current content and status, re-check it, then record your review.'
          : e instanceof ApiError
            ? e.message
            : 'Could not save the review.',
      );
    } finally {
      setBusy(false);
    }
  }

  const currentReview = state?.reviewEvidence;
  const currentVerify = state?.verificationEvidence;

  return (
    <GlassPanel className="p-6">
      <p className="t-body flex items-center gap-2 font-bold">
        <ShieldCheck size={18} aria-hidden="true" />
        Admin review panel
      </p>
      <p className="t-meta mt-1" style={{ color: 'var(--text-secondary)' }}>
        Current tier: <strong>{state?.tier ?? '—'}</strong>
        {currentReview && (
          <>
            {' '}· reviewed by {str(currentReview.reviewer)} on{' '}
            {str(currentReview.reviewedAt)}
          </>
        )}
        {currentVerify && (
          <>
            {' '}· verified by {str(currentVerify.checkedBy)} on{' '}
            {str(currentVerify.checkedAt)}
          </>
        )}
      </p>

      {state?.verificationBlocked === true && (
        <div
          role="alert"
          className="t-body mt-3 rounded-md p-3"
          style={{
            background: 'color-mix(in srgb, var(--error) 10%, transparent)',
            border: '1px solid var(--error)',
          }}
        >
          <strong>Verification blocked — nutrition is incomplete.</strong>
          {state.unresolvedIngredients.length > 0 && (
            <>
              {' '}Unresolved ingredients:{' '}
              {state.unresolvedIngredients.join(', ')}.
            </>
          )}{' '}
          Required path: resolve the missing nutritional values or serving
          info, recalculate, re-review, then verify. The needsReview flag is
          never cleared to bypass this check.
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Reviewer (from your session)">
          <Input value={reviewer} readOnly aria-readonly="true" />
        </Field>
        <Field label="Date">
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {REVIEW_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reference / evidence used">
          <Textarea
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. USDA SR Legacy #170923; independent spreadsheet recomputation"
            rows={2}
          />
        </Field>
      </div>

      <div className="mt-3 space-y-2">
        <label className="t-body flex items-center gap-2">
          <input
            type="checkbox"
            checked={dietaryRechecked}
            onChange={(e) => setDietaryRechecked(e.target.checked)}
          />
          Dietary claims (tags, diet category) re-checked against the ingredient list
        </label>
        <label className="t-body flex items-center gap-2">
          <input
            type="checkbox"
            checked={allergenRechecked}
            onChange={(e) => setAllergenRechecked(e.target.checked)}
          />
          Allergen list re-checked against the ingredient list
        </label>
        <label className="t-body flex items-center gap-2">
          <input
            type="checkbox"
            checked={verifyRechecked}
            onChange={(e) => setVerifyRechecked(e.target.checked)}
          />
          For verification: dietary + allergen claims re-checked at verification time
        </label>
      </div>

      {error && (
        <p role="alert" className="t-body mt-3" style={{ color: 'var(--error)' }}>
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="t-body mt-3" style={{ color: 'var(--text-secondary)' }}>
          {done}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <LuxButton disabled={busy} onClick={() => submit('review')}>
          {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
          Record review
        </LuxButton>
        <LuxButton
          disabled={busy || state?.verificationBlocked === true}
          title={
            state?.verificationBlocked === true
              ? 'Verification is blocked: the recipe nutrition is incomplete. Resolve the missing values, recalculate, re-review, then verify.'
              : undefined
          }
          onClick={() => submit('verify')}
        >
          {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
          Record verification
        </LuxButton>
        <LuxButton
          disabled={busy}
          onClick={() => {
            if (window.confirm('Clear all review/verification status for this recipe?')) {
              void submit('clear');
            }
          }}
        >
          Clear status
        </LuxButton>
      </div>
      <p className="t-meta mt-3" style={{ color: 'var(--text-secondary)' }}>
        Only emails on the ADMIN_EMAILS allowlist can record reviews. The
        reviewer identity is taken from your session, never from what is typed
        here.
      </p>
    </GlassPanel>
  );
}
