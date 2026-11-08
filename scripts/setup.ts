// CLI: bun run setup
// First-time local setup, idempotent: installs app dependencies, creates .env
// (with a random INGEST_TOKEN) and config/search.json if missing, builds the
// web client. Never overwrites an existing .env or config/search.json.

import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fillIngestToken, isValidIngestToken, randomToken, readEnvValue } from "./env-file";

const ROOT = resolve(import.meta.dir, "..");
const APP_DIR = join(ROOT, "app");
const ENV_PATH = join(ROOT, ".env");
const CONFIG_PATH = join(ROOT, "config", "search.json");

function run(args: readonly string[], cwd: string): void {
  const result = Bun.spawnSync([process.execPath, ...args], { cwd, stdio: ["inherit", "inherit", "inherit"] });
  if (result.exitCode !== 0) {
    throw new Error(`bun ${args.join(" ")} failed in ${cwd} (exit ${result.exitCode})`);
  }
}

// 0600: .env holds the ingest secret (mode is ignored on Windows).
const ENV_MODE = 0o600;

function ensureEnv(): void {
  if (existsSync(ENV_PATH)) {
    console.log(".env already exists, leaving it alone");
  } else {
    writeFileSync(ENV_PATH, readFileSync(join(ROOT, ".env.example"), "utf8"), { mode: ENV_MODE });
    console.log("Created .env from .env.example");
  }
  const text = readFileSync(ENV_PATH, "utf8");
  const filled = fillIngestToken(text, randomToken());
  if (filled !== null) {
    writeFileSync(ENV_PATH, filled);
    chmodSync(ENV_PATH, ENV_MODE);
    console.log("Generated INGEST_TOKEN in .env");
  } else if (!isValidIngestToken(readEnvValue(text, "INGEST_TOKEN"))) {
    console.warn("INGEST_TOKEN in .env is missing or shorter than 32 chars: add an empty `INGEST_TOKEN=` line and re-run");
  }
}

function ensureConfig(): void {
  if (existsSync(CONFIG_PATH)) {
    console.log("config/search.json already exists, leaving it alone");
    return;
  }
  copyFileSync(join(ROOT, "config", "search.example.json"), CONFIG_PATH);
  console.log("Created config/search.json from the example - edit it (or run the wohnung-setup skill)");
}

if (import.meta.main) {
  try {
    run(["install"], APP_DIR);
    ensureEnv();
    ensureConfig();
    run(["run", "build:web"], APP_DIR);
    console.log("\nSetup done. Next: bun run doctor");
  } catch (err) {
    console.error(`setup failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
