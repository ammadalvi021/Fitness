# Exercise Media Workflow (Admin)

How a real human demonstration video gets from "idea" to live on the
exercise detail page — without ever shipping a fake, broken, or
unreviewed clip.

> **Rule zero:** `apps/web/lib/exercise-media/registry.ts` is intentionally
> empty. An entry is filled in ONLY after all six steps below are complete
> for that exercise. Until then, the app honestly shows the labeled
> "Animated demonstration" (interim) or "Video coming soon" — never a
> placeholder URL.

## Step 1 — Obtain footage (licensed, original, or generated + reviewed)

Pick ONE source per exercise:

- **Film it yourself** with a qualified trainer performing the movement.
- **License stock footage** with a commercial license that covers app
  embedding (keep the license file; see the note below).
- **Generate it** from the tailored prompt in
  `docs/exercise-video-prompts.md` (one prompt per slug — never a generic
  one). Expect to iterate: AI-generated humans still get joint angles and
  tempo wrong.

Then the **professional-review gate** (non-negotiable): a qualified fitness
professional (certified trainer, physiotherapist, or sports-medicine
clinician) watches the full clip and signs off against the review checklist
at the bottom of `docs/exercise-video-prompts.md`. If they flag anything —
re-shoot or re-generate. Do not edit around a bad rep; wrong demos teach
unsafe technique.

**License / rights ledger:** keep a private record (NOT in the repo) of:
source, license terms, reviewer name + credential, review date. If a
license expires or a clip is disputed, you need to know exactly which
entries to pull.

## Step 2 — Host the video (never commit video files to the repo)

Upload the final clip to a CDN or object-storage provider (e.g. Cloudflare
R2/Stream, Bunny Stream, Mux, S3 + CloudFront — pick whatever fits the
budget). Requirements:

- Direct HTTPS URL to an MP4 (H.264) file, ideally ≤ 20 MB per clip
  (1080p is plenty; these are short loops).
- The host must allow hotlinking/embedding from the app's domain.
- Prefer a provider that can serve a poster frame, or export one yourself.

Do NOT commit `.mp4` files to the git repo — they bloat every clone and
deploy, and Render build minutes are not a video host.

## Step 3 — Upload the poster

Export or capture a representative still frame (the mid-rep position that
best shows the movement) as a `.jpg` (~1280×720) and host it next to the
video. The player shows this poster before the video loads, so it must be
an honest frame of the actual clip — not a stock photo.

## Step 4 — Update the registry (or the exercise record)

Option A — curated path (preferred): in
`apps/web/lib/exercise-media/registry.ts`, replace the entry's nulls:

```ts
"push-up": {
  videoUrl: "https://cdn.example.com/videos/push-up.mp4",
  posterUrl: "https://cdn.example.com/posters/push-up.jpg",
},
```

Option B — database path: if an admin UI for exercises exists, set the
exercise's `mediaType` to `"video"` and `mediaUrl` to the video URL. The
`<ExerciseMedia>` priority logic treats a registry video and a
`mediaType === "video"` + `mediaUrl` record identically; the registry wins
when both exist.

After editing, run the honesty tests to confirm the registry still covers
all 50 slugs:

```bash
cd apps/web && DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy \
  npx vitest run tests/integration/exercise-media.test.ts
```

## Step 5 — Verify loading, reduced-motion, and mobile

On a real device (or the Render preview deploy), check the updated
exercise's detail page:

1. The video area shows the poster immediately; the file itself loads only
   when scrolled into view (lazy `<source>` via IntersectionObserver) or
   when "Load video" is tapped.
2. Native controls work; the custom **Replay**, **0.5× Slow-mo**, and
   **Loop** buttons all respond and are reachable by keyboard (Tab/Enter).
3. With the OS "reduce motion" setting ON, the video never autoplays and
   the reduced-motion note appears.
4. On a phone (small viewport), the player is full-width, controls are
   tappable (≥ 44px targets), and the clip plays inline (no fullscreen
   hijack).
5. The written technique panel (steps, breathing, mistakes, variations,
   safety notes) still renders below the video.

## Step 6 — Deploy

Commit the registry change, push, and let Render redeploy. Spot-check the
live URL for the updated exercise. If anything looks wrong, revert the
single registry entry to `{ videoUrl: null, posterUrl: null }` — the page
falls back gracefully to the animation / coming-soon panel; nothing breaks.

---

## Quick reference

| Step | Done when… |
| ---- | ---------- |
| 1 | Footage obtained AND a qualified professional signed off (name/credential/date recorded privately). |
| 2 | MP4 (H.264, ≤ ~20 MB) on a CDN with an embeddable HTTPS URL. Repo has no video files. |
| 3 | Honest poster frame hosted next to the video. |
| 4 | Registry entry (or DB mediaType/mediaUrl) updated; honesty tests green. |
| 5 | Lazy load, reduced-motion, mobile, keyboard, and technique panel verified. |
| 6 | Pushed, redeployed, spot-checked live. |
