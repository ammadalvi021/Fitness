"use client";

import { LuxBadge } from "./luxury";

/** nutritionStatus -> badge tone + label (binding honesty: statuses are never hidden). */
const STATUS_META: Record<string, { tone: "success" | "warning" | "neutral"; label: string }> = {
  restaurant_published: { tone: "success", label: "Restaurant published" },
  calculated_estimate: { tone: "warning", label: "Calculated estimate" },
  menu_photo_estimate: { tone: "warning", label: "Photo estimate" },
  user_submitted: { tone: "neutral", label: "User submitted" },
  unavailable: { tone: "neutral", label: "Unavailable" },
};

export function MenuStatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { tone: "neutral" as const, label: status };
  return <LuxBadge tone={meta.tone}>{meta.label}</LuxBadge>;
}

/**
 * Map a nutritionStatus to the VerificationBadge verification value.
 * Only 'restaurant_published' is verified; everything with numbers is an
 * estimate; 'unavailable' has nothing to badge.
 */
export function verificationForStatus(status: string): "verified" | "estimate" | null {
  if (status === "restaurant_published") return "verified";
  if (status === "unavailable") return null;
  return "estimate";
}
