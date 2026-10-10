/** Type declarations for check-env.mjs (imported by the Next.js health route). */

export declare const REQUIRED_VARS: string[];

export declare function parseEnvFile(path: string): Record<string, string>;

export declare function findRepoRoot(startDir?: string): string;

export interface EnvCheckResult {
  ok: boolean;
  root: string;
  envPath: string;
  envFileExists: boolean;
  /** Required var NAMES missing from both the root .env and process.env. Never values. */
  missingVars: string[];
  errors: string[];
  warnings: string[];
}

export declare function checkEnv(rootDir?: string): EnvCheckResult;
