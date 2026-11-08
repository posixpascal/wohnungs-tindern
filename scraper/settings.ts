// CLI: bun scraper/settings.ts [--from-config]
// Syncs the district settings with the swipe app (${WOHNUNG_URL}/api/ingest/districts, bearer INGEST_TOKEN):
//   1. pushes every configured city with its district metadata (config/districts/<city-slug>.json) and the
//      district lists from config/search.json – the app takes the lists only for cities it has no selection for yet
//      (first sync) or, with --from-config, for every city (config overwrites what was set in the app);
//   2. stores the app's answer, the selection that now applies, in data/district-selection.json.
// loadConfig() applies that file on top of config/search.json: per city the app's selection wins.
// Run it before candidates.ts / ingest.ts (wohnung-suche) and after changing district lists (wohnung-kriterien).

import { rmSync } from "node:fs";
import { CONFIG_PATH, loadConfig, selectionPathFor } from "./config";
import { canonicalDistrict, validateSelection, type DistrictSelection } from "./districts";
import { postJson, readPushEnv, type FetchFn, type PushEnv } from "./push";
import type { Config } from "./types";

export const DISTRICTS_PATH = "api/ingest/districts";

/** Request body: every configured city, its metadata and its config lists (aliases mapped to canonical names). */
export function districtPayload(config: Config, overwrite: boolean): unknown {
  return {
    overwrite,
    cities: config.locations.map((loc) => {
      const canonical = (names: readonly string[]): string[] => [...new Set(names.map((n) => canonicalDistrict(n, loc)))];
      return {
        city: loc.city,
        districts: loc.districts,
        allowed_districts: canonical(loc.allowed_districts),
        excluded_districts: canonical(loc.excluded_districts),
        preferred_districts: canonical(loc.preferred_districts),
      };
    }),
  };
}

/** Pushes metadata + config lists and returns the selection the app now holds for the configured cities. */
export async function syncDistricts(
  config: Config,
  env: PushEnv,
  { overwrite = false, fetchFn = fetch }: { readonly overwrite?: boolean; readonly fetchFn?: FetchFn } = {},
): Promise<DistrictSelection[]> {
  const data = await postJson(env, DISTRICTS_PATH, districtPayload(config, overwrite), fetchFn);
  return validateSelection(data);
}

export function parseArgs(argv: readonly string[]): { overwrite: boolean } {
  const unknown = argv.find((a) => a !== "--from-config");
  if (unknown) throw new Error(`unknown option ${unknown}`);
  return { overwrite: argv.includes("--from-config") };
}

export interface SyncResult {
  readonly synced: number;
  readonly overwrite: boolean;
  readonly path: string;
  readonly skipped?: string;
  readonly selection: readonly DistrictSelection[];
}

/**
 * Syncs and stores the app's selection next to the config (data/district-selection.json).
 * Without push env the stored selection is removed, so config/search.json really applies.
 */
export async function runSync(
  configPath: string,
  env: PushEnv | null,
  { overwrite = false, fetchFn = fetch }: { readonly overwrite?: boolean; readonly fetchFn?: FetchFn } = {},
): Promise<SyncResult> {
  const path = selectionPathFor(configPath);
  if (!env) {
    rmSync(path, { force: true });
    const skipped = "WOHNUNG_URL/INGEST_TOKEN not set – config/search.json applies (stored app selection removed)";
    return { synced: 0, overwrite, path, skipped, selection: [] };
  }
  const config = await loadConfig(configPath, { selectionPath: null });
  const selection = await syncDistricts(config, env, { overwrite, fetchFn });
  await Bun.write(path, `${JSON.stringify({ synced_at: new Date().toISOString(), cities: selection }, null, 2)}\n`);
  return { synced: selection.length, overwrite, path, selection };
}

async function main(): Promise<void> {
  const { overwrite } = parseArgs(process.argv.slice(2));
  const { selection, ...result } = await runSync(CONFIG_PATH, readPushEnv(Bun.env), { overwrite });
  for (const s of selection) {
    console.error(
      `${s.city}: erlaubt ${s.allowed_districts.length || "alle"}, ausgeschlossen ${s.excluded_districts.length}, bevorzugt ${s.preferred_districts.length}`,
    );
  }
  console.log(JSON.stringify(result));
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(`settings sync failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
