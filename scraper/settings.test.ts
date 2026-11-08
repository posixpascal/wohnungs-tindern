import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, validateConfig } from "./config";
import type { FetchFn } from "./push";
import { districtPayload, parseArgs, runSync, syncDistricts } from "./settings";

const config = validateConfig(
  {
    budget: { warm_max: 1200, nebenkosten_estimate_per_sqm: 3 },
    rooms: { min: 2, ideal: 3 },
    preferences: { amenities: [], ground_floor: false },
    locations: [
      { city: "Frankfurt am Main", radius_km: 0, excluded_districts: ["Gallusviertel", "Gallus"], preferred_districts: ["Bornheim"] },
      { city: "Idstein", radius_km: 0 },
    ],
    portals: ["kleinanzeigen"],
  },
  new Map([
    [
      "Frankfurt am Main",
      {
        city: "Frankfurt am Main",
        districts: [
          { name: "Gallus", aliases: ["Gallusviertel"], highlights: { transit: "S-Bahn Galluswarte" } },
          { name: "Bornheim", summary: "Lebendig" },
        ],
      },
    ],
  ]),
);

const ENV = { baseUrl: "https://wohnung.example", token: "t".repeat(32) };

type Call = { url: string; headers: Record<string, string>; body: unknown };

const fakeFetch = (calls: Call[], response: unknown, status = 200): FetchFn =>
  async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(response), { status });
  };

describe("districtPayload", () => {
  test("sends every city with its metadata and canonical, de-duplicated lists", () => {
    expect(districtPayload(config, false)).toEqual({
      overwrite: false,
      cities: [
        {
          city: "Frankfurt am Main",
          districts: [
            { name: "Gallus", aliases: ["Gallusviertel"], summary: null, highlights: { transit: "S-Bahn Galluswarte" } },
            { name: "Bornheim", aliases: [], summary: "Lebendig", highlights: {} },
          ],
          allowed_districts: [],
          excluded_districts: ["Gallus"],
          preferred_districts: ["Bornheim"],
        },
        { city: "Idstein", districts: [], allowed_districts: [], excluded_districts: [], preferred_districts: [] },
      ],
    });
  });
});

describe("syncDistricts", () => {
  test("posts to /api/ingest/districts with the token and returns the app's selection", async () => {
    const calls: Call[] = [];
    const selection = [{ city: "Frankfurt am Main", allowed_districts: ["Bornheim"], excluded_districts: [], preferred_districts: [] }];
    const response = { success: true, data: { cities: selection.map((s) => ({ ...s, updated_at: "x" })) }, error: null };

    expect(await syncDistricts(config, ENV, { overwrite: true, fetchFn: fakeFetch(calls, response) })).toEqual(selection);
    expect(calls[0]?.url).toBe("https://wohnung.example/api/ingest/districts");
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${ENV.token}`);
    expect((calls[0]?.body as { overwrite: boolean }).overwrite).toBe(true);
  });

  test("fails on server errors and malformed answers", async () => {
    const error = { success: false, data: null, error: "Unauthorized" };
    await expect(syncDistricts(config, ENV, { fetchFn: fakeFetch([], error, 401) })).rejects.toThrow(/401: Unauthorized/);
    const malformed = { success: true, data: { cities: [{ city: "" }] }, error: null };
    await expect(syncDistricts(config, ENV, { fetchFn: fakeFetch([], malformed) })).rejects.toThrow(/invalid district selection/);
  });
});

describe("parseArgs", () => {
  test("--from-config overwrites, anything else is an error", () => {
    expect(parseArgs([])).toEqual({ overwrite: false });
    expect(parseArgs(["--from-config"])).toEqual({ overwrite: true });
    expect(() => parseArgs(["--force"])).toThrow(/unknown option --force/);
  });
});

describe("runSync", () => {
  const setup = async (): Promise<{ dir: string; configPath: string; cache: string }> => {
    const dir = mkdtempSync(join(tmpdir(), "wohnung-sync-"));
    const configPath = join(dir, "config", "search.json");
    await Bun.write(
      configPath,
      JSON.stringify({
        budget: { warm_max: 1200, nebenkosten_estimate_per_sqm: 3 },
        rooms: { min: 2, ideal: 3 },
        preferences: { amenities: [], ground_floor: false },
        locations: [{ city: "Idstein", radius_km: 0, excluded_districts: ["Wörsdorf"] }],
        portals: ["kleinanzeigen"],
      }),
    );
    const cache = join(dir, "data", "district-selection.json");
    await Bun.write(cache, JSON.stringify({ cities: [{ city: "Idstein", allowed_districts: ["Walsdorf"] }] }));
    return { dir, configPath, cache };
  };

  test("without push env the stored app selection is removed, so the config really applies", async () => {
    const { dir, configPath, cache } = await setup();
    try {
      expect((await loadConfig(configPath)).locations[0]?.allowed_districts).toEqual(["Walsdorf"]);
      const result = await runSync(configPath, null);
      expect(result.synced).toBe(0);
      expect(result.skipped).toContain("config/search.json applies");
      expect(await Bun.file(cache).exists()).toBe(false);
      const loc = (await loadConfig(configPath)).locations[0];
      expect([loc?.allowed_districts, loc?.excluded_districts]).toEqual([[], ["Wörsdorf"]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("with push env the app's answer replaces the stored selection", async () => {
    const { dir, configPath } = await setup();
    try {
      const answer = { cities: [{ city: "Idstein", allowed_districts: [], excluded_districts: ["Wörsdorf"], preferred_districts: [] }] };
      const result = await runSync(configPath, ENV, { fetchFn: fakeFetch([], { success: true, data: answer, error: null }) });
      expect(result.synced).toBe(1);
      expect((await loadConfig(configPath)).locations[0]?.allowed_districts).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
