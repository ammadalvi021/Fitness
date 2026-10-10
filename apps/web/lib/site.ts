/**
 * Shared site config for client components.
 *
 * Re-exports the root branding + plan catalog so components can import from
 * "@/lib/site" without reaching outside the app directory themselves.
 *
 * NOTE: apps/web/lib is three levels below the repo root
 * (apps/web/lib -> apps/web -> apps -> root), hence the ../../.. depth.
 */
export { branding, brandingCssVariables } from "../../../config/branding";
export { PLANS, getPlan, planIncludes } from "../../../config/plans";
export type { PlanId, PlanDefinition } from "../../../config/plans";
