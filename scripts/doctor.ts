// CLI: bun run doctor
// Checks the local setup and prints a checklist plus the next step. Exit 1 when
// a required check fails, 0 otherwise (warnings only). Never prints secrets.

import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { loadConfig } from "../scraper/config";
import type { Config, Portal } from "../scraper/types";
import { isValidIngestToken, readEnvValue } from "./env-file";

const ROOT = resolve(import.meta.dir, "..");
const APP_URL_TIMEOUT_MS = 2_000;
const DEFAULT_APP_DB = "./data/wohnung.sqlite";

export type Status = "ok" | "warn" | "fail";

export interface Check {
  readonly name: string;
  readonly status: Status;
  readonly detail: string;
  readonly fix?: string;
}

const ok = (name: string, detail: string): Check => ({ name, status: "ok", detail });
const warn = (name: string, detail: string, fix: string): Check => ({ name, status: "warn", detail, fix });
const fail = (name: string, detail: string, fix: string): Check => ({ name, status: "fail", detail, fix });

/** True when a markdown table in `doc` has a row whose first cell is exactly `city`. */
export function hasLocationRow(doc: string, city: string): boolean {
  return doc.split(/\r?\n/).some((line) => line.trimStart().startsWith("|") && line.split("|")[1]?.trim() === city);
}

/** "portal: city" for every configured portal x city without a row in that portal's location table. */
export function missingLocationIds(
  config: Pick<Config, "portals" | "locations">,
  docs: Readonly<Partial<Record<Portal, string>>>,
): readonly string[] {
  return config.portals.flatMap((portal) =>
    config.locations
      .filter((loc) => !hasLocationRow(docs[portal] ?? "", loc.city))
      .map((loc) => `${portal}: ${loc.city}`),
  );
}

export function nextStep(checks: readonly Check[]): string | undefined {
  return (checks.find((c) => c.status === "fail") ?? checks.find((c) => c.status === "warn"))?.fix;
}

export function formatReport(checks: readonly Check[]): string {
  const icon: Record<Status, string> = { ok: "✓", warn: "!", fail: "✗" };
  const lines = checks.map((c) => `${icon[c.status]} ${c.name}: ${c.detail}${c.fix ? `\n    -> ${c.fix}` : ""}`);
  const next = nextStep(checks);
  return [...lines, "", next ? `Next: ${next}` : "All good. Next: run the wohnung-suche skill (Claude Code: /wohnung-suche)."].join(
    "\n",
  );
}

function readText(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

function checkDeps(): Check {
  return existsSync(join(ROOT, "app", "node_modules", "elysia"))
    ? ok("dependencies", "installed")
    : fail("dependencies", "app dependencies missing", "bun run setup");
}

function checkEnv(envText: string | undefined): Check {
  if (envText === undefined) return fail(".env", "missing", "bun run setup");
  return isValidIngestToken(readEnvValue(envText, "INGEST_TOKEN"))
    ? ok(".env", "present, INGEST_TOKEN set")
    : fail(".env", "INGEST_TOKEN missing or shorter than 32 chars", "set an empty `INGEST_TOKEN=` line in .env, then bun run setup");
}

async function checkConfig(): Promise<{ readonly check: Check; readonly config?: Config }> {
  const path = join(ROOT, "config", "search.json");
  const text = readText(path);
  if (text === undefined) return { check: fail("config", "config/search.json missing", "bun run setup") };
  try {
    const config = await loadConfig(path);
    const example = readText(join(ROOT, "config", "search.example.json"));
    const isExample = example !== undefined && JSON.stringify(JSON.parse(example)) === JSON.stringify(JSON.parse(text));
    const summary = `${config.locations.map((l) => l.city).join(", ")}; ${config.portals.join(", ")}`;
    const check = isExample
      ? warn("config", `valid, but still the example criteria (${summary})`, "run the wohnung-setup skill or edit config/search.json")
      : ok("config", `valid (${summary})`);
    return { check, config };
  } catch (err) {
    return { check: fail("config", (err as Error).message, "fix config/search.json (see README: Configuration)") };
  }
}

function checkPortalIds(config: Config): Check {
  const docs = Object.fromEntries(
    config.portals.map((p) => [p, readText(join(ROOT, ".agents", "skills", "wohnung-suche", "portals", `${p}.md`)) ?? ""]),
  );
  const missing = missingLocationIds(config, docs);
  return missing.length === 0
    ? ok("portal ids", "every configured city has a location id")
    : warn("portal ids", `missing for ${missing.join(", ")}`, "resolve them with the wohnung-kriterien skill (step: new cities)");
}

function checkWebBuild(): Check {
  return existsSync(join(ROOT, "app", "src", "web", "dist", "app.js"))
    ? ok("web client", "built")
    : warn("web client", "not built", "bun run setup");
}

/** True for a WOHNUNG_URL that points at an app on this machine (users then live in the local DB). */
export function isLocalUrl(url: string | undefined): boolean {
  if (!url) return true;
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return true;
  }
}

function checkUsers(envText: string): Check {
  if (!isLocalUrl(readEnvValue(envText, "WOHNUNG_URL"))) {
    return ok("app users", "app is deployed (WOHNUNG_URL); manage users on the server with the wohnung-users skill");
  }
  const configured = readEnvValue(envText, "DB_PATH") || DEFAULT_APP_DB;
  const dbPath = isAbsolute(configured) ? configured : resolve(ROOT, configured);
  const fix = "bun run user <name> (once per person, in your own terminal)";
  if (!existsSync(dbPath)) return warn("app users", "no app database yet", fix);
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = db.query<{ username: string }, []>("SELECT username FROM users ORDER BY id").all();
      return rows.length > 0 ? ok("app users", rows.map((r) => r.username).join(", ")) : warn("app users", "none", fix);
    } finally {
      db.close();
    }
  } catch (err) {
    return warn("app users", `cannot read ${configured}: ${(err as Error).message}`, fix);
  }
}

/** Origin only, so credentials in the URL are never printed. */
export function displayUrl(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "invalid URL";
  }
}

async function checkApp(envText: string): Promise<Check> {
  const url = readEnvValue(envText, "WOHNUNG_URL");
  if (!url) return warn("app", "WOHNUNG_URL not set, push will be skipped", "set WOHNUNG_URL in .env");
  try {
    await fetch(url, { signal: AbortSignal.timeout(APP_URL_TIMEOUT_MS), redirect: "manual" });
    return ok("app", `reachable at ${displayUrl(url)}`);
  } catch {
    const fix = isLocalUrl(url) ? "bun run dev (keep it running in a second terminal)" : "check the server with the wohnung-server skill";
    return warn("app", `not reachable at ${displayUrl(url)} (needed for push)`, fix);
  }
}

function checkNpx(): Check {
  return Bun.which("npx")
    ? ok("node/npx", "found (runs the Playwright MCP server from .mcp.json)")
    : warn("node/npx", "not found; the Playwright MCP server runs via npx", "install Node.js LTS from https://nodejs.org");
}

export async function runChecks(): Promise<readonly Check[]> {
  const envText = readText(join(ROOT, ".env"));
  const { check: configCheck, config } = await checkConfig();
  const optional = envText === undefined ? [] : [checkUsers(envText), await checkApp(envText)];
  return [
    ok("bun", Bun.version),
    checkDeps(),
    checkEnv(envText),
    configCheck,
    ...(config ? [checkPortalIds(config)] : []),
    checkWebBuild(),
    ...optional,
    checkNpx(),
  ];
}

if (import.meta.main) {
  const checks = await runChecks();
  console.log(formatReport(checks));
  process.exit(checks.some((c) => c.status === "fail") ? 1 : 0);
}
