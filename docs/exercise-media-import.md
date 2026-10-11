# Exercise media import — manifest format & licensing rules

How human-demonstration assets (GIF / WebP / MP4 / WebM) get into the
FitFusion AI exercise library, honestly and lawfully.

## The workflow

1. **Obtain assets lawfully** (see Licensing rules below).
2. **Place files** in an assets directory (NOT in the git repo — use the
   existing storage architecture or a CDN for production).
3. **Write a manifest JSON** (see format below).
4. **Run the validator:**
   `npx tsx scripts/import-exercise-media.ts path/to/manifest.json`
   This checks every file (exists, allowed extension, ≤ 15 MB), every slug
   (must be one of the 50 exercise slugs), and requires non-empty
   `attribution` + `license` for every item. It writes:
   - `registry.patch.json` — the validated entries, and
   - `import-report.md` — a human-readable report.
   
   The script **never edits** `apps/web/lib/exercise-media/registry.ts`
   itself.
5. **Professional review:** a qualified fitness professional watches each
   file and confirms it demonstrates the correct exercise with safe,
   technically correct form. Incorrect demos teach unsafe technique — this
   gate is not optional.
6. **Apply the patch by hand:** copy the validated entries into the
   registry, set `verificationStatus: "verified"`, and set `reviewDate`.
   Only then does `<ExerciseMedia>` show the human asset.

## Manifest format

```json
{
  "assetsDir": "./exercise-assets",
  "items": [
    {
      "file": "push-up.mp4",
      "slug": "push-up",
      "mediaType": "mp4",
      "poster": "push-up-poster.jpg",
      "attribution": "Filmed by FitFusion Media, 2026",
      "license": "Proprietary — commissioned work, commercial app use granted"
    },
    {
      "file": "bodyweight-squat.gif",
      "slug": "bodyweight-squat",
      "attribution": "Jane Doe / FitStock",
      "license": "FitStock Commercial License #12345"
    }
  ]
}
```

- `file` (required): filename inside `assetsDir`.
- `slug` (required): one of the 50 exercise slugs (see the registry).
- `mediaType` (optional): `gif` | `webp` | `mp4` | `webm`. Must match the
  file extension (a mismatch is a warning; the extension wins).
- `poster` (optional): thumbnail image (`.jpg` / `.jpeg` / `.png` / `.webp`).
- `attribution` (required): who made or supplied the asset.
- `license` (required): the license identifier — it must expressly permit
  commercial use inside a fitness app.

## Licensing rules

- **Allowed:** original demonstrations you filmed; assets generated from an
  authorized source and reviewed; stock assets purchased under a license
  that expressly permits commercial use inside a fitness app.
- **Forbidden:** scraping exercise websites, downloading media from search
  results, or re-uploading someone else's videos/GIFs without a license.
- **ExerciseDB:** its free tier is **non-commercial**. Do not use free-tier
  ExerciseDB media in this app unless it stays non-commercial; a commercial
  plan is required for paid/commercial app use. Confirm the plan's terms
  before importing anything from it.
- Every imported asset must carry `attribution` + `license` in the
  registry — the validator rejects items without them, and
  `validateRegistry()` rejects registry entries that claim `verified`
  without them.

## Media guidance

- Short loops (one clean rep): prefer GIF or WebP.
- Longer or higher-quality demos: prefer MP4/WebM (better compression).
- Keep files ≤ 15 MB; provide a poster; the app lazy-loads and shows the
  poster first.
- Never mark an exercise `verified` from a file you haven't watched.
