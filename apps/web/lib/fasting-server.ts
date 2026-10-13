/**
 * Server-only helper: normalize the validated `fastingSession` profile value
 * for Prisma's nullable-Json input typing (V20 Feature 5).
 *
 * Prisma 5 does not accept a plain `null` for a `Json?` field, and a zod-
 * inferred record carries optional (`| undefined`) properties that are not
 * valid `InputJsonValue` members. This maps:
 * - `undefined` → omit the key (field untouched)
 * - `null`      → `Prisma.DbNull` (SQL NULL — clears the server-side fast)
 * - record      → clean JSON round-trip (strips `undefined` optionals)
 */
import { PrismaRuntime, type Prisma } from '@fitfusion/db';
import type { FastingRecord } from '@fitfusion/core';

export function toPrismaFastingSession(
  v: FastingRecord | null | undefined,
): { fastingSession?: Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue } {
  if (v === undefined) return {};
  if (v === null) return { fastingSession: PrismaRuntime.DbNull };
  return {
    fastingSession: JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue,
  };
}
