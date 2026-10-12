# Ramadan framework (V18 Phase E)

## What it is

An opt-in framework for users who fast during Ramadan. Enabled per-user via
`profile.ramadanMode` (toggle in **Settings → Food logging** or on the
`/ramadan` page itself).

When Ramadan mode is on:

- **Sehri / Iftar meal types** appear in the nutrition diary's meal sections
  and in every meal-type selector (voice log, repeat page). They are accepted
  by `POST /api/diary` — `DiaryEntry.mealType` is a free String in the DB, so
  no migration was needed; only the `@fitfusion/core` zod enum and
  `MealType` union were extended.
- **`/ramadan` hub** with:
  - Sehri / Iftar shortcuts that deep-link into voice logging with the meal
    pre-selected (`/log/voice?meal=sehri`).
  - **Your fasting window**: two time inputs the user sets themselves,
    stored in `localStorage` (`ff-ramadan-window`). Displayed as "your
    fasting window" everywhere.
  - **Water tracker** reusing the existing `WaterLog` API
    (`GET`/`POST /api/water`), shown against the fasting window.
  - **Opt-in in-browser reminders** (Notification API) for the start/end of
    the user's set window plus an evening water nudge. They fire only while
    the Ramadan page is open and only for user-set times.
- **`/log` hub** shows a Ramadan card linking to `/ramadan`.

## What it deliberately does NOT do

- **No prayer times.** FitFusion has no prayer-time data source, so none are
  shown, fetched, or implied. The fasting window is explicitly labeled as
  the user's own schedule ("your fasting window — not prayer times") in the
  UI, in Settings, and here. Per the binding honesty rules, no times are
  ever hardcoded or presented as religious times.
- **No fasting advice.** The framework logs meals and water; it does not
  prescribe fasting schedules, calorie targets for fasting, or medical
  guidance. Existing safety rules (minors, pregnancy flags, calorie floors)
  continue to apply unchanged.
- **No new nutrition data.** Water and diary writes reuse the existing
  `WaterLog` and `DiaryEntry` APIs, including idempotency keys.

## Storage

| Key | Location | Content |
| --- | --- | --- |
| `profile.ramadanMode` | PostgreSQL (`Profile`) | on/off |
| `ff-ramadan-window` | browser localStorage | `{start:"HH:MM", end:"HH:MM"}` — user-set |
| `ff-ramadan-notify` | browser localStorage | reminder opt-in flag |

## Files

- `apps/web/app/(app)/ramadan/page.tsx` — the hub
- `apps/web/lib/ramadan.ts` — window storage + reminder helpers (pure/tested)
- `apps/web/app/(app)/log/page.tsx` — hub card
- `packages/core/src/types.ts`, `packages/core/src/validation.ts` — `sehri`/`iftar`
- `apps/web/app/(app)/nutrition/_shared.ts` — `mealTypeOptions(ramadanMode)`
