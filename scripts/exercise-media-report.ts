/**
 * exercise-media-report.ts — regenerate docs/exercise-media-report.md
 * from the registry.
 *
 * Usage: npx tsx scripts/exercise-media-report.ts
 *
 * Counts: verified human GIFs / verified human videos / three-stage
 * illustrations available / text-only technique instructions. Re-run this
 * every time assets are imported or the registry changes so the report
 * never drifts from reality.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(
  resolve("apps/web/lib/exercise-media/registry.ts"),
  "utf8"
);

// Parse entries: 'slug': { displayName: '…', ...MISSING } or inline fields.
const entryRe =
  /^  '([a-z0-9-]+)': \{ displayName: '((?:[^'\\]|\\.)*)', \.\.\.MISSING \},?$/gm;
const inlineRe =
  /^  '([a-z0-9-]+)': \{ displayName: '((?:[^'\\]|\\.)*)',([\s\S]*?)\},?$/gm;

interface Parsed {
  slug: string;
  displayName: string;
  mediaType: string | null;
  assetUrl: string | null;
  verificationStatus: string;
  reviewDate: string | null;
}

function field(body: string, name: string): string | null {
  const m = body.match(new RegExp(`${name}:\\s*(?:'((?:[^'\\\\]|\\\\.)*)'|null)`));
  return m ? (m[1] ?? null) : null;
}

const entries: Parsed[] = [];
let m: RegExpExecArray | null;
const missingSlugs = new Set<string>();
while ((m = entryRe.exec(src)) !== null) {
  missingSlugs.add(m[1]);
  entries.push({
    slug: m[1],
    displayName: m[2].replace(/\\'/g, "'"),
    mediaType: null,
    assetUrl: null,
    verificationStatus: "missing",
    reviewDate: null,
  });
}
while ((m = inlineRe.exec(src)) !== null) {
  if (missingSlugs.has(m[1])) continue; // already captured as MISSING
  const body = m[3];
  // ownerGif('<slug>') spread: owner-supplied verified GIF at the
  // conventional public path. Resolve without hardcoding per-slug data.
  const ownerGif = body.match(/\.\.\.ownerGif\('([a-z0-9-]+)'\)/);
  if (ownerGif) {
    entries.push({
      slug: m[1],
      displayName: m[2].replace(/\\'/g, "'"),
      mediaType: "gif",
      assetUrl: `/exercise-gifs/${ownerGif[1]}.gif`,
      verificationStatus: "verified",
      reviewDate: "2026-10-11",
    });
    continue;
  }
  entries.push({
    slug: m[1],
    displayName: m[2].replace(/\\'/g, "'"),
    mediaType: field(body, "mediaType"),
    assetUrl: field(body, "assetUrl"),
    verificationStatus: field(body, "verificationStatus") ?? "missing",
    reviewDate: field(body, "reviewDate"),
  });
}

// Illustration availability = pose data in the animation engine.
const animSrc = readFileSync(
  resolve("apps/web/lib/exercise-animation/animations.ts"),
  "utf8"
);
const animSlugs = new Set(
  [...animSrc.matchAll(/"([a-z0-9-]+)":\s*\{/g)].map((x) => x[1])
);

const verified = entries.filter((e) => e.verificationStatus === "verified" && e.assetUrl);
const verifiedGifs = verified.filter((e) => e.mediaType === "gif" || e.mediaType === "webp");
const verifiedVideos = verified.filter((e) => e.mediaType === "mp4" || e.mediaType === "webm");
const withIllustration = entries.filter((e) => animSlugs.has(e.slug)).length;
const textOnly = entries.length; // technique instructions always render

const today = new Date().toISOString().slice(0, 10);
const lines = [
  "# Exercise media availability report",
  ``,
  `Generated: ${today} — from \`apps/web/lib/exercise-media/registry.ts\`.`,
  `Regenerate with: \`npx tsx scripts/exercise-media-report.ts\``,
  ``,
  "## Counts",
  ``,
  `| Category | Count |`,
  `|---|---|`,
  `| Verified human GIFs (gif/webp) | ${verifiedGifs.length} |`,
  `| Verified human videos (mp4/webm) | ${verifiedVideos.length} |`,
  `| Exercises with three-stage illustration | ${withIllustration} |`,
  `| Exercises with text-only technique instructions | ${textOnly} |`,
  `| Total exercises in registry | ${entries.length} |`,
  ``,
];

if (verified.length) {
  lines.push("## Verified assets", "");
  verified.forEach((e) =>
    lines.push(`- ${e.slug} (${e.displayName}): ${e.mediaType} — reviewed ${e.reviewDate ?? "date unknown"}`)
  );
  lines.push("");
} else {
  lines.push(
    "## Verified assets",
    "",
    "None. No human GIF, WebP, MP4, or WebM demonstration exists for any",
    "exercise yet.",
    "",
    "Until real footage is imported (see docs/exercise-media-import.md),",
    "each exercise shows a three-stage static illustration captioned",
    "“Illustration — human demonstration coming soon”, plus the full",
    "written technique instructions.",
    ""
  );
}

if (verified.length) {
  lines.push(
    "## Provenance note",
    "",
    "The verified GIFs above are AI-generated pose-transition prototypes",
    "created and supplied by the app owner (2026-10-11), integrated per",
    "explicit owner direction. They are NOT motion-captured footage and",
    "their exercise technique has NOT been independently validated by a",
    "qualified fitness professional. Replace with professionally-reviewed",
    "footage when available.",
    ""
  );
}

const missing = entries.filter((e) => e.verificationStatus === "missing");
if (missing.length) {
  lines.push("## Awaiting human demonstration", "");
  missing.forEach((e) => lines.push(`- ${e.slug} (${e.displayName})`));
  lines.push("");
}

lines.push(
  "## Notes",
  "",
  "- This report is generated from the registry — it cannot drift from it.",
  "- Technique instructions (steps, breathing, mistakes, variations,",
  "  safety notes) come from the existing exercise seed data and are always",
  "  shown regardless of media state.",
  "- Exercise advice in this app has not been medically or professionally",
  "  reviewed unless an entry's reviewDate says so."
);

writeFileSync(resolve("docs/exercise-media-report.md"), lines.join("\n") + "\n");
console.log(`Report written: ${entries.length} exercises, ${verifiedGifs.length} gifs, ${verifiedVideos.length} videos.`);
