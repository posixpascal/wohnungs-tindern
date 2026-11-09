// CLI: bun scraper/availability.ts list [--limit 40] ["data/raw/<date>-list-*.json" ...]
//      bun scraper/availability.ts apply "data/raw/<date>-avail-*.json"
// End-of-run availability check for listings that are still in play on the website.
//   list   fetches the app's watchlist (${WOHNUNG_URL}/api/ingest/watchlist: active, nobody said nope; matches
//          first) and prints one JSON line per listing to check. Listings in the given list files were seen live
//          on a result page today and are skipped. Run it after ingest.ts.
//   apply  reads the availability check results (data/raw/<date>-avail-<portal>-<portal_id>.json, one
//          {status, signal} object each, see the portal files) and marks `gone` listings gone; `active` ones get
//          last_seen_at = now so sweep.ts doesn't drop a live listing that fell off the capped result pages.
//          `unknown` (bot wall, unexpected page) changes nothing. Only today's result files count: an old `active`
//          would keep a dead listing past the sweep. Confirmed listings get re-pushed (last_seen_at > synced_at),
//          harmless. Run it before sweep.ts and push.ts.

import type { Database } from "bun:sqlite";
import { getListing, openDb } from "./db";
import { expandArgs, readInputs } from "./ingest";
import { postJson, readPushEnv, type FetchFn, type PushEnv } from "./push";
import { parseRawRecord, recordId } from "./raw";
import { localDay } from "./report";

export const WATCHLIST_PATH = "api/ingest/watchlist";
export const DEFAULT_LIMIT = 40;

const AVAIL_FILE = /(\d{4}-\d{2}-\d{2})-avail-(immoscout24|immowelt|kleinanzeigen|wg-gesucht)-([A-Za-z0-9_-]+)\.json$/;
const STATUSES = ["active", "gone", "unknown"] as const;

export type Availability = (typeof STATUSES)[number];

/** The app sends no URL on purpose: navigation targets come from the local DB only. */
export interface WatchlistEntry {
  readonly id: string;
  readonly likes: number;
  readonly matched: boolean;
}

export type CheckTarget = WatchlistEntry & { readonly url: string };

export interface CheckResult {
  readonly id: string;
  readonly status: Availability;
  readonly signal: string;
}

export interface ApplySummary {
  readonly checked: number;
  readonly gone: number;
  readonly active: number;
  readonly unknown: number;
  readonly invalid: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function validateWatchlist(data: unknown): WatchlistEntry[] {
  if (!isRecord(data) || !Array.isArray(data.listings)) throw new Error("unexpected watchlist response");
  return data.listings.map((e, i) => {
    const valid = isRecord(e) && typeof e.id === "string" && typeof e.likes === "number" && typeof e.matched === "boolean";
    if (!valid) throw new Error(`unexpected watchlist entry #${i}`);
    return { id: e.id as string, likes: e.likes as number, matched: e.matched as boolean };
  });
}

export async function fetchWatchlist(env: PushEnv, fetchFn: FetchFn = fetch): Promise<WatchlistEntry[]> {
  return validateWatchlist(await postJson(env, WATCHLIST_PATH, {}, fetchFn));
}

/** ids of the valid records in today's list files: those listings were live on a result page. */
export function seenIds(input: readonly unknown[]): Set<string> {
  return new Set(input.flatMap((item) => {
    const res = parseRawRecord(item);
    return res.ok ? [recordId(res.record)] : [];
  }));
}

/**
 * Watchlist entries still active in the local DB and not seen today, in the app's order (matches first),
 * capped at `limit`. The URL comes from the local DB like every other navigation target.
 */
export function checkTargets(
  db: Database,
  watchlist: readonly WatchlistEntry[],
  seen: ReadonlySet<string>,
  limit: number = DEFAULT_LIMIT,
): CheckTarget[] {
  return watchlist
    .filter((e) => !seen.has(e.id))
    .flatMap((e): CheckTarget[] => {
      const local = getListing(db, e.id);
      return local?.status === "active" ? [{ ...e, url: local.url }] : [];
    })
    .slice(0, limit);
}

/**
 * Parses one result file; the listing id comes from the file name (a gone page may redirect elsewhere).
 * With `today` (YYYY-MM-DD) a file from another day is rejected.
 */
export function parseResult(path: string, text: string, today?: string): CheckResult {
  const m = path.match(AVAIL_FILE);
  if (!m) throw new Error("file name is not <date>-avail-<portal>-<portal_id>.json");
  if (today !== undefined && m[1] !== today) throw new Error(`result is from ${m[1]}, not today (${today})`);
  const parsed: unknown = JSON.parse(text);
  const value = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
  if (!isRecord(value) || !STATUSES.includes(value.status as Availability)) {
    throw new Error(`status must be one of ${STATUSES.join(" | ")}`);
  }
  return { id: `${m[2]}:${m[3]}`, status: value.status as Availability, signal: String(value.signal ?? "") };
}

/** Applies results in one transaction; only active listings change, so a re-run is harmless. */
export function applyResults(db: Database, results: readonly CheckResult[], now: string): Omit<ApplySummary, "invalid"> {
  const markGone = db.query("UPDATE listings SET status = 'gone', synced_at = NULL WHERE id = ? AND status = 'active'");
  const markSeen = db.query("UPDATE listings SET last_seen_at = ? WHERE id = ? AND status = 'active'");
  const outcomes = db.transaction((): Availability[] =>
    results.map((r) => {
      const changed = r.status === "gone" ? markGone.run(r.id).changes
        : r.status === "active" ? markSeen.run(now, r.id).changes
        : 0;
      const outcome: Availability = changed > 0 ? r.status : "unknown";
      const note = changed === 0 && r.status !== "unknown" ? " (nicht aktiv in der DB)" : "";
      console.error(`${outcome}: ${r.id} – ${r.signal || "kein Signal"}${note}`);
      return outcome;
    }))();
  const count = (status: Availability): number => outcomes.filter((o) => o === status).length;
  return { checked: results.length, gone: count("gone"), active: count("active"), unknown: count("unknown") };
}

/** Reads result files; a bad or stale file is reported and counted as invalid, never aborts the batch. */
export async function readResults(files: readonly string[], today: string): Promise<{ results: CheckResult[]; invalid: number }> {
  const parsed = await Promise.all(files.map(async (file) => {
    try {
      return parseResult(file, await Bun.file(file).text(), today);
    } catch (err) {
      console.error(`invalid: ${file} – ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }));
  const results = parsed.filter((r): r is CheckResult => r !== null);
  return { results, invalid: parsed.length - results.length };
}

export type Command =
  | { readonly kind: "list"; readonly limit: number; readonly files: readonly string[] }
  | { readonly kind: "apply"; readonly files: readonly string[] };

export function parseArgs(argv: readonly string[]): Command {
  const [command, ...rest] = argv;
  if (command === "apply") {
    if (rest.length === 0) throw new Error('apply needs result files ("data/raw/<date>-avail-*.json")');
    return { kind: "apply", files: rest };
  }
  if (command !== "list") throw new Error(`unknown command ${command ?? "(none)"} (list | apply)`);
  const i = rest.indexOf("--limit");
  const limit = i < 0 ? DEFAULT_LIMIT : Number(rest[i + 1]);
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");
  const files = rest.filter((_, j) => i < 0 || (j !== i && j !== i + 1));
  const unknown = files.find((f) => f.startsWith("--"));
  if (unknown) throw new Error(`unknown option ${unknown}`);
  return { kind: "list", limit, files };
}

async function runList(db: Database, limit: number, files: readonly string[]): Promise<void> {
  const env = readPushEnv(Bun.env);
  if (!env) {
    console.error(JSON.stringify({ skipped: "WOHNUNG_URL/INGEST_TOKEN not set" }));
    return;
  }
  const watchlist = await fetchWatchlist(env);
  const { input } = await readInputs(expandArgs(files));
  const targets = checkTargets(db, watchlist, seenIds(input), limit);
  for (const t of targets) console.log(JSON.stringify(t));
  console.error(JSON.stringify({ watchlist: watchlist.length, to_check: targets.length }));
}

async function main(): Promise<void> {
  const command = parseArgs(process.argv.slice(2));
  const db = openDb();
  try {
    if (command.kind === "list") return await runList(db, command.limit, command.files);
    const now = new Date();
    const { results, invalid } = await readResults(expandArgs(command.files), localDay(now));
    console.log(JSON.stringify({ ...applyResults(db, results, now.toISOString()), invalid }));
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(`availability failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
