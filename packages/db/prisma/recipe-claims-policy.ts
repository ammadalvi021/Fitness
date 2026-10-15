/**
 * FitFusion AI — recipe claims policy: RE-EXPORT SHIM (v21.3).
 *
 * The canonical policy lives in `packages/core/src/recipe-claims.ts` so the
 * web client can import the same single source of truth without duplicating
 * logic. This module re-exports it verbatim for the existing importers in
 * `packages/db/prisma/` (seeds, seed tests). Do NOT add logic here — every
 * function, type, and constant is defined in @fitfusion/core.
 */
export * from '@fitfusion/core';
