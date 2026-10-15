/**
 * check-syntax.mjs — fail fast on syntax errors in prisma scripts.
 *
 * The db tsconfig only covers src/, so prisma/seed.ts and friends were never
 * typechecked — a stray `//` comment inside an object literal broke the
 * Render deploy (esbuild TransformError at seed time). This check runs every
 * prisma/*.ts file through esbuild's transformer, exactly like tsx does at
 * runtime: syntax errors fail the check, type-level issues are ignored
 * (esbuild strips types without checking them).
 *
 * Run: npm run check:prisma-syntax --workspace @fitfusion/db
 */
import { transformSync } from "esbuild";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

let failures = 0;
for (const f of files) {
  const path = join(dir, f);
  const source = readFileSync(path, "utf8");
  try {
    transformSync(source, { loader: "ts", format: "cjs" });
  } catch (err) {
    failures += 1;
    const msg = err instanceof Error ? err.message.split("\n").slice(0, 4).join("\n") : String(err);
    console.error(`SYNTAX ERROR in prisma/${f}:\n${msg}\n`);
  }
}

if (failures > 0) {
  console.error(`${failures} file(s) failed the syntax check.`);
  process.exit(1);
}
console.log(`prisma syntax OK — ${files.length} file(s) checked.`);
