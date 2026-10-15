'use client';

/**
 * IncompleteNutritionAck — action-time acknowledgement for recipes whose
 * nutrition is partial (v21.3).
 *
 * Rendered as an `alertdialog`: keyboard-operable (focus moves into the
 * panel, Escape cancels), and a bare dismiss / cancel NEVER proceeds —
 * only the explicit confirm button does. The copy never describes partial
 * totals as complete or as an estimate ("partial — excludes: X, Y").
 */
import { AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/ui';
import { LuxButton } from '@/components/luxury';
import { partialTotalsSummary } from '@fitfusion/core';

export function IncompleteNutritionAck({
  open,
  unresolvedNames,
  onConfirm,
  onCancel,
  confirmLabel = 'I understand — log anyway',
  cancelLabel = 'Cancel',
  note,
}: {
  open: boolean;
  /** Names of the ingredients excluded from the totals (may be empty). */
  unresolvedNames: string[];
  /** Fires ONLY on explicit confirm — never on dismiss. */
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Optional extra line, e.g. the review-flag consequence on save. */
  note?: string;
}) {
  return (
    <Modal open={open} onClose={onCancel} title="Nutrition incomplete" role="alertdialog">
      <div className="space-y-3">
        <p className="t-body flex items-start gap-2 font-semibold">
          <AlertTriangle
            size={18}
            aria-hidden="true"
            className="mt-0.5 shrink-0"
            style={{ color: 'var(--warning, #b45309)' }}
          />
          This recipe&apos;s nutrition is incomplete.
        </p>
        <p className="t-body" style={{ color: 'var(--text-secondary)' }}>
          The values are {partialTotalsSummary(unresolvedNames)}. They contribute
          0 to the totals — what you see is lower than what the dish actually
          contains.
        </p>
        {note && (
          <p className="t-body" style={{ color: 'var(--text-secondary)' }}>
            {note}
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <LuxButton className="w-full" onClick={onConfirm}>
            {confirmLabel}
          </LuxButton>
          <LuxButton variant="secondary" className="w-full" onClick={onCancel}>
            {cancelLabel}
          </LuxButton>
        </div>
      </div>
    </Modal>
  );
}
