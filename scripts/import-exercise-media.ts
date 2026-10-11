/**
 * import-exercise-media.ts — validate a human-demonstration asset manifest.
 *
 * Usage:
 *   npx tsx scripts/import-exercise-media.ts path/to/manifest.json [--assets-dir ./assets]
 *
 * The manifest maps asset filenames (or remote URLs) to exercise slugs:
 * {
 *   "assetsDir": "./exercise-assets",          // optional (overridden by --assets-dir)
 *   "items": [
 *     {
 *       "file": "push-up.mp4",                 // local file, OR use "url" instead
 *       "slug": "push-up",
 *       "mediaType": "mp4",                     // gif | webp | mp4 | webm
 *       "poster": "push-up-poster.jpg",         // optional (local file)
 *       "attribution": "Filmed by FitFusion Media",
 *       "license": "proprietary / CC-BY-4.0 / … — must permit commercial app use",
 *       "source": "in-house shoot 2026-11-01"   // REQUIRED: where the asset came from
 *     },
 *     {
 *       "url": "https://cdn.example.com/gifs/squat.gif",
 *       "slug": "bodyweight-squat",
 *       "mediaType": "gif",
 *       "attribution": "Licensed from ExampleFit",
 *       "license": "ExampleFit Commercial Plan 2026",
 *       "source": "ExampleFit commercial library"
 *     }
 *   ]
 * }
 *
 * What it does:
 *   1. Validates every file (exists, allowed extension, ≤ 15 MB, magic-byte
 *      MIME check so a renamed .exe can't pass as a .gif).
 *   2. Validates remote URLs (https only, allowed extension in path).
 *   3. Validates every slug against the 50-slug registry; rejects duplicates.
 *   4. Requires non-empty attribution + license + source for every item.
 *   5. Writes registry.patch.json (validated entries, pending-review) + a
 *      human-readable report covering ALL 50 exercises. It NEVER edits
 *      registry.ts itself — a human reviews the footage for correct form
 *      and applies the patch deliberately.
 *
 * Licensing rules (see docs/exercise-media-import.md):
 *   - Only assets you filmed, generated from an authorized source, or
 *     purchased under a license that expressly permits commercial use
 *     inside a fitness app.
 *   - NEVER scrape exercise websites or search-result images.
 *   - ExerciseDB's free tier is NON-COMMERCIAL — a commercial plan is
 *     required before using its media in this app.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

const ALLOWED_EXT: Record<string, "gif" | "webp" | "mp4" | "webm"> = {
  ".gif": "gif",
  ".webp": "webp",
  ".mp4": "mp4",
  ".webm": "webm",
};
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const ALLOWED_POSTER_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

interface ManifestItem {
  /** Local filename (relative to assetsDir), OR use `url` for a remote asset. */
  file?: string;
  /** Remote https URL (CDN). Validated by format + extension only — the file
   *  itself can't be inspected, so remote assets always need human review. */
  url?: string;
  slug: string;
  mediaType?: string;
  poster?: string;
  attribution?: string;
  license?: string;
  /** REQUIRED: where the asset came from (shoot date, vendor, library). */
  source?: string;
}

interface Manifest {
  assetsDir?: string;
  items: ManifestItem[];
}

interface PatchEntry {
  slug: string;
  mediaType: "gif" | "webp" | "mp4" | "webm";
  assetUrl: string;
  posterUrl: string | null;
  attribution: string;
  license: string;
  source: string;
  verificationStatus: "pending-review";
  reviewDate: null;
  note: string;
}

/**
 * Magic-byte check: the first bytes of a file must match its claimed type.
 * Catches renamed executables / corrupt downloads that extension checks miss.
 */
function sniffMediaType(buf: Buffer): "gif" | "webp" | "mp4" | "webm" | null {
  const at = (i: number): number | undefined => (i < buf.length ? buf[i] : undefined);
  // GIF87a / GIF89a — needs 6 bytes.
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) {
    const ver = buf.subarray(3, 6).toString("ascii");
    return ver === "87a" || ver === "89a" ? "gif" : null;
  }
  // EBML header (WebM) — needs 4 bytes.
  if (at(0) === 0x1a && at(1) === 0x45 && at(2) === 0xdf && at(3) === 0xa3) {
    return "webm";
  }
  // ....ftyp (MP4) — needs 8 bytes.
  if (at(4) === 0x66 && at(5) === 0x74 && at(6) === 0x79 && at(7) === 0x70) {
    return "mp4";
  }
  // RIFF....WEBP — needs 12 bytes.
  if (
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) {
    return "webp";
  }
  return null;
}

function fail(msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) fail("usage: npx tsx scripts/import-exercise-media.ts <manifest.json> [--assets-dir <dir>]");
  const dirFlag = process.argv.indexOf("--assets-dir");
  const assetsDirOverride = dirFlag >= 0 ? process.argv[dirFlag + 1] : null;

  const manifest: Manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(manifest.items)) fail("manifest must contain an \"items\" array");
  const assetsDir = resolve(assetsDirOverride ?? manifest.assetsDir ?? dirname(resolve(manifestPath)));

  // Load the registry slugs (source of truth for valid slugs).
  const registrySrc = readFileSync("apps/web/lib/exercise-media/registry.ts", "utf8");
  const registrySlugs = new Set(
    [...registrySrc.matchAll(/^  '([a-z0-9-]+)':/gm)].map((m) => m[1])
  );
  if (registrySlugs.size === 0) fail("could not parse registry slugs");

  const errors: string[] = [];
  const warnings: string[] = [];
  const patch: PatchEntry[] = [];
  const seenSlugs = new Set<string>();
  const today = new Date().toISOString().slice(0, 10);

  manifest.items.forEach((item, i) => {
    const tag = `items[${i}]${item.slug ? ` (${item.slug})` : ""}`;
    const hasFile = typeof item.file === "string" && item.file.length > 0;
    const hasUrl = typeof item.url === "string" && item.url.length > 0;
    if (!hasFile && !hasUrl) {
      errors.push(`${tag}: either "file" or "url" is required`);
      return;
    }
    if (hasFile && hasUrl) {
      errors.push(`${tag}: provide "file" OR "url", not both`);
      return;
    }

    // Resolve + validate the asset location.
    let assetRef: string;
    let inferred: "gif" | "webp" | "mp4" | "webm";
    let remote = false;
    if (hasUrl) {
      remote = true;
      let parsed: URL;
      try {
        parsed = new URL(item.url as string);
      } catch {
        errors.push(`${tag}: "url" is not a valid URL`);
        return;
      }
      if (parsed.protocol !== "https:") {
        errors.push(`${tag}: remote asset URLs must use https`);
        return;
      }
      const ext = extname(parsed.pathname).toLowerCase();
      const fromExt = ALLOWED_EXT[ext];
      if (!fromExt) {
        errors.push(`${tag}: URL path extension "${ext || "(none)"}" not allowed — use .gif .webp .mp4 .webm`);
        return;
      }
      inferred = fromExt;
      assetRef = (item.url as string).trim();
      warnings.push(`${tag}: remote asset — content could not be inspected; professional review is mandatory before verifying`);
    } else {
      const filePath = join(assetsDir, item.file as string);
      if (!existsSync(filePath)) {
        errors.push(`${tag}: file not found: ${filePath}`);
        return;
      }
      const ext = extname(item.file as string).toLowerCase();
      const fromExt = ALLOWED_EXT[ext];
      if (!fromExt) {
        errors.push(`${tag}: unsupported extension "${ext}" — allowed: .gif .webp .mp4 .webm`);
        return;
      }
      const size = statSync(filePath).size;
      if (size > MAX_BYTES) {
        errors.push(`${tag}: ${(size / 1048576).toFixed(1)} MB exceeds the 15 MB limit`);
        return;
      }
      // Magic-byte check: the content must actually be what the extension claims.
      const sniffed = sniffMediaType(readFileSync(filePath).subarray(0, 16));
      if (!sniffed) {
        errors.push(`${tag}: file content not recognized as gif/webp/mp4/webm (magic bytes mismatch — possibly corrupt or mislabeled)`);
        return;
      }
      if (sniffed !== fromExt) {
        errors.push(`${tag}: extension says ${fromExt} but file content is ${sniffed} — rename or re-encode`);
        return;
      }
      inferred = fromExt;
      assetRef = item.file as string;
    }

    if (item.mediaType && item.mediaType !== inferred) {
      warnings.push(`${tag}: declared mediaType "${item.mediaType}" does not match ${remote ? "URL" : "file"} (${inferred}); using "${inferred}"`);
    }
    if (!item.slug || !registrySlugs.has(item.slug)) {
      errors.push(`${tag}: unknown exercise slug "${item.slug ?? "(missing)"}"`);
      return;
    }
    if (seenSlugs.has(item.slug)) {
      errors.push(`${tag}: duplicate slug "${item.slug}" in manifest`);
      return;
    }
    seenSlugs.add(item.slug);
    if (!item.attribution || !item.attribution.trim()) {
      errors.push(`${tag}: "attribution" is required (who made/supplied this asset)`);
      return;
    }
    if (!item.license || !item.license.trim()) {
      errors.push(`${tag}: "license" is required (must permit commercial app use)`);
      return;
    }
    if (!item.source || !item.source.trim()) {
      errors.push(`${tag}: "source" is required (where the asset came from: shoot, vendor, library)`);
      return;
    }
    let posterUrl: string | null = null;
    if (item.poster) {
      const posterPath = join(assetsDir, item.poster);
      if (!existsSync(posterPath)) {
        errors.push(`${tag}: poster not found: ${posterPath}`);
        return;
      }
      if (!ALLOWED_POSTER_EXT.has(extname(item.poster).toLowerCase())) {
        errors.push(`${tag}: poster extension must be .jpg/.jpeg/.png/.webp`);
        return;
      }
      posterUrl = item.poster;
    }

    patch.push({
      slug: item.slug,
      mediaType: inferred,
      assetUrl: assetRef,
      posterUrl,
      attribution: item.attribution.trim(),
      license: item.license.trim(),
      source: item.source.trim(),
      verificationStatus: "pending-review",
      reviewDate: null,
      note: `Imported ${today} — set verificationStatus to "verified" + reviewDate ONLY after a qualified fitness professional reviews the footage for correct form.`,
    });
  });

  // Full 50-exercise coverage: every registry slug accounted for.
  const coveredSlugs = new Set(patch.map((p) => p.slug));
  const missingSlugs = [...registrySlugs].filter((s) => !coveredSlugs.has(s)).sort();

  const reportLines = [
    "# Exercise media import report",
    ``,
    `- Manifest: ${manifestPath}`,
    `- Assets dir: ${assetsDir}`,
    `- Date: ${today}`,
    `- Exercises in registry: ${registrySlugs.size}`,
    `- Items in manifest: ${manifest.items.length}`,
    `- Validated OK: ${patch.length}`,
    `- Still missing media: ${missingSlugs.length}`,
    `- Errors: ${errors.length}`,
    `- Warnings: ${warnings.length}`,
    ``,
  ];
  if (errors.length) {
    reportLines.push("## Errors (must fix before import)", "");
    errors.forEach((e) => reportLines.push(`- ${e}`));
    reportLines.push("");
  }
  if (warnings.length) {
    reportLines.push("## Warnings", "");
    warnings.forEach((w) => reportLines.push(`- ${w}`));
    reportLines.push("");
  }
  if (patch.length) {
    reportLines.push("## Validated entries (pending-review — NOT yet verified)", "");
    patch.forEach((p) =>
      reportLines.push(`- ${p.slug}: ${p.mediaType} ${p.assetUrl} — ${p.attribution} (${p.license}) [source: ${p.source}]`)
    );
    reportLines.push(
      "",
      "Next step: a qualified fitness professional reviews each file for correct",
      "form, then a human applies registry.patch.json to",
      "apps/web/lib/exercise-media/registry.ts (verificationStatus -> \"verified\",",
      "reviewDate set). The script never edits the registry itself."
    );
  }
  if (missingSlugs.length) {
    reportLines.push("## Exercises still missing media", "");
    missingSlugs.forEach((s) => reportLines.push(`- ${s}`));
    reportLines.push("");
  }

  const outDir = dirname(resolve(manifestPath));
  writeFileSync(join(outDir, "registry.patch.json"), JSON.stringify(patch, null, 2) + "\n");
  writeFileSync(join(outDir, "import-report.md"), reportLines.join("\n"));
  console.log(reportLines.join("\n"));

  if (errors.length) {
    console.error(`\n${errors.length} error(s) — registry.patch.json still written for the ${patch.length} valid entr${patch.length === 1 ? "y" : "ies"}.`);
    process.exit(2);
  }
}

main().catch((e) => fail(String(e?.message ?? e)));
