/**
 * import-exercise-media.ts — validate a human-demonstration asset manifest.
 *
 * Usage:
 *   npx tsx scripts/import-exercise-media.ts path/to/manifest.json [--assets-dir ./assets]
 *
 * The manifest maps asset filenames to exercise slugs with licensing info:
 * {
 *   "assetsDir": "./exercise-assets",          // optional (overridden by --assets-dir)
 *   "items": [
 *     {
 *       "file": "push-up.mp4",
 *       "slug": "push-up",
 *       "mediaType": "mp4",                     // gif | webp | mp4 | webm
 *       "poster": "push-up-poster.jpg",         // optional
 *       "attribution": "Filmed by FitFusion Media",
 *       "license": " proprietary / CC-BY-4.0 / … — must permit commercial app use"
 *     }
 *   ]
 * }
 *
 * What it does:
 *   1. Validates every file (exists, allowed extension, ≤ 15 MB).
 *   2. Validates every slug against the 50-slug registry.
 *   3. Requires non-empty attribution + license strings for every item.
 *   4. Writes registry.patch.json (validated entries) + a human-readable
 *      report. It NEVER edits registry.ts itself — a human reviews the
 *      footage for correct form and applies the patch deliberately.
 *
 * Licensing rules (see docs/exercise-media-import.md):
 *   - Only assets you filmed, generated from an authorized source, or
 *     purchased under a license that expressly permits commercial use
 *     inside a fitness app.
 *   - NEVER scrape exercise websites or search-result images.
 *   - ExerciseDB's free tier is NON-COMMERCIAL — a commercial plan is
 *     required before using its media in this app.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
  file: string;
  slug: string;
  mediaType?: string;
  poster?: string;
  attribution?: string;
  license?: string;
}

interface Manifest {
  assetsDir?: string;
  items: ManifestItem[];
}

interface PatchEntry {
  slug: string;
  displayName?: string;
  mediaType: "gif" | "webp" | "mp4" | "webm";
  assetUrl: string;
  posterUrl: string | null;
  attribution: string;
  license: string;
  verificationStatus: "pending-review";
  reviewDate: null;
  note: string;
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
    if (!item.file || typeof item.file !== "string") {
      errors.push(`${tag}: "file" is required`);
      return;
    }
    const filePath = join(assetsDir, item.file);
    if (!existsSync(filePath)) {
      errors.push(`${tag}: file not found: ${filePath}`);
      return;
    }
    const ext = extname(item.file).toLowerCase();
    const inferred = ALLOWED_EXT[ext];
    if (!inferred) {
      errors.push(`${tag}: unsupported extension "${ext}" — allowed: .gif .webp .mp4 .webm`);
      return;
    }
    const size = statSync(filePath).size;
    if (size > MAX_BYTES) {
      errors.push(`${tag}: ${(size / 1048576).toFixed(1)} MB exceeds the 15 MB limit`);
      return;
    }
    if (item.mediaType && item.mediaType !== inferred) {
      warnings.push(`${tag}: declared mediaType "${item.mediaType}" does not match file extension (${inferred}); using "${inferred}"`);
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
      assetUrl: item.file,
      posterUrl,
      attribution: item.attribution.trim(),
      license: item.license.trim(),
      verificationStatus: "pending-review",
      reviewDate: null,
      note: `Imported ${today} — set verificationStatus to "verified" + reviewDate ONLY after a qualified fitness professional reviews the footage for correct form.`,
    });
  });

  const reportLines = [
    "# Exercise media import report",
    ``,
    `- Manifest: ${manifestPath}`,
    `- Assets dir: ${assetsDir}`,
    `- Date: ${today}`,
    `- Items in manifest: ${manifest.items.length}`,
    `- Validated OK: ${patch.length}`,
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
      reportLines.push(`- ${p.slug}: ${p.mediaType} ${p.assetUrl} — ${p.attribution} (${p.license})`)
    );
    reportLines.push(
      "",
      "Next step: a qualified fitness professional reviews each file for correct",
      "form, then a human applies registry.patch.json to",
      "apps/web/lib/exercise-media/registry.ts (verificationStatus -> \"verified\",",
      "reviewDate set). The script never edits the registry itself."
    );
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
