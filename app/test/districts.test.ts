import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { buildApp } from "../src/app";
import { getQueue } from "../src/listings/queue";
import { createUser, insertListing, jsonRequest, testDb, testEnv } from "./helpers";

const INGEST_TOKEN = "test-ingest-token-32-characters!!";
const NO_LISTS = { allowed_districts: [], excluded_districts: [], preferred_districts: [] };

type App = ReturnType<typeof buildApp>;
type CitySelection = { city: string; allowed_districts: string[]; excluded_districts: string[]; preferred_districts: string[] };
type CitySettings = CitySelection & {
  districts: {
    name: string;
    summary: string | null;
    highlights: Record<string, string>;
    active_listings: number;
    described: boolean;
  }[];
  updated_by: string | null;
};

const district = (name: string, aliases: string[] = []) => ({
  name,
  aliases,
  summary: `${name} kurz`,
  highlights: { shopping: "Wochenmarkt" },
});

const frankfurt = (lists: Partial<CitySelection> = {}) => ({
  city: "Frankfurt am Main",
  districts: [district("Bornheim"), district("Gallus", ["Gallusviertel"]), district("Höchst")],
  ...NO_LISTS,
  ...lists,
});

function pushRequest(body: unknown, token = INGEST_TOKEN): Request {
  return new Request("http://localhost/api/ingest/districts", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

async function push(app: App, body: unknown): Promise<CitySelection[]> {
  const res = await app.handle(pushRequest(body));
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: { cities: CitySelection[] } }).data.cities;
}

async function login(app: App, db: Database, username = "alex"): Promise<string> {
  await createUser(db, username, "s3cret-password!");
  const res = await app.handle(
    jsonRequest("/api/login", { method: "POST", body: JSON.stringify({ username, password: "s3cret-password!" }) }),
  );
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error(`login failed: ${res.status}`);
  return cookie;
}

function put(app: App, cookie: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return app.handle(jsonRequest("/api/settings/districts", { method: "PUT", cookie, body: JSON.stringify(body), headers }));
}

async function settings(app: App, cookie: string): Promise<CitySettings[]> {
  const res = await app.handle(jsonRequest("/api/settings/districts", { cookie }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: CitySettings[] }).data;
}

function listingIn(db: Database, id: string, district: string | null, city = "Frankfurt am Main"): void {
  insertListing(db, { id, city });
  db.query("UPDATE listings SET district = ? WHERE id = ?").run(district, id);
}

describe("POST /api/ingest/districts", () => {
  test("requires the ingest token", async () => {
    const app = buildApp(testDb(), testEnv());
    const res = await app.handle(pushRequest({ overwrite: false, cities: [] }, "wrong-token-but-32-characters!!!"));
    expect(res.status).toBe(401);
  });

  test("seeds the selection from the config on the first push only", async () => {
    const app = buildApp(testDb(), testEnv());
    const first = await push(app, { overwrite: false, cities: [frankfurt({ excluded_districts: ["Höchst"] })] });
    expect(first).toEqual([{ city: "Frankfurt am Main", ...NO_LISTS, excluded_districts: ["Höchst"] }]);

    const second = await push(app, { overwrite: false, cities: [frankfurt({ allowed_districts: ["Bornheim"] })] });
    expect(second[0]?.excluded_districts).toEqual(["Höchst"]);
    expect(second[0]?.allowed_districts).toEqual([]);
  });

  test("overwrite replaces the app's selection with the config lists", async () => {
    const app = buildApp(testDb(), testEnv());
    await push(app, { overwrite: false, cities: [frankfurt({ excluded_districts: ["Höchst"] })] });
    const res = await push(app, { overwrite: true, cities: [frankfurt({ allowed_districts: ["Bornheim"] })] });
    expect(res).toEqual([{ city: "Frankfurt am Main", ...NO_LISTS, allowed_districts: ["Bornheim"] }]);
  });

  test("keeps cities missing from a push; only overwrite drops them", async () => {
    const app = buildApp(testDb(), testEnv());
    const idstein = { city: "Idstein", districts: [], ...NO_LISTS };
    await push(app, { overwrite: false, cities: [frankfurt({ excluded_districts: ["Höchst"] }), idstein] });
    const kept = await push(app, { overwrite: false, cities: [idstein] });
    expect(kept.map((c) => [c.city, c.excluded_districts])).toEqual([
      ["Frankfurt am Main", ["Höchst"]],
      ["Idstein", []],
    ]);
    const dropped = await push(app, { overwrite: true, cities: [idstein] });
    expect(dropped.map((c) => c.city)).toEqual(["Idstein"]);
  });

  test("keeps only known highlight keys", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    const extra = { ...frankfurt(), districts: [{ ...district("Bornheim"), highlights: { culture: "Theater", cinema: "Kino", pool: "Hallenbad", sights: "Dom", nightlife: "x" } }] };
    await push(app, { overwrite: false, cities: [extra] });
    const [city] = await settings(app, await login(app, db));
    expect(city?.districts[0]?.highlights).toEqual({ culture: "Theater", cinema: "Kino", pool: "Hallenbad", sights: "Dom" });
  });

  test("rejects a malformed body", async () => {
    const app = buildApp(testDb(), testEnv());
    const res = await app.handle(pushRequest({ overwrite: false, cities: [{ city: "Frankfurt am Main" }] }));
    expect(res.status).toBe(400);
  });
});

describe("/api/settings/districts", () => {
  test("is readable without a session, but hides who changed it", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    await push(app, { overwrite: false, cities: [frankfurt()] });
    db.query("UPDATE district_settings SET updated_by = 'alex'").run();
    const res = await app.handle(jsonRequest("/api/settings/districts"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { updated_by: string | null }[] };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((city) => city.updated_by === null)).toBe(true);
  });

  test("changing it requires a session", async () => {
    const app = buildApp(testDb(), testEnv());
    const res = await app.handle(
      jsonRequest("/api/settings/districts", {
        method: "PUT",
        body: JSON.stringify({ city: "Frankfurt am Main", allowed_districts: [], excluded_districts: [], preferred_districts: [] }),
      }),
    );
    expect(res.status).toBe(401);
  });

  test("lists metadata districts with listing counts (aliases included), then districts only seen in listings", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    await push(app, { overwrite: false, cities: [frankfurt()] });
    listingIn(db, "a:1", "Gallus");
    listingIn(db, "a:2", "Gallusviertel");
    listingIn(db, "a:3", "Seckbach");
    const cookie = await login(app, db);

    const [city] = await settings(app, cookie);
    expect(city?.districts.map((d) => [d.name, d.active_listings, d.described])).toEqual([
      ["Bornheim", 0, true],
      ["Gallus", 2, true],
      ["Höchst", 0, true],
      ["Seckbach", 1, false],
    ]);
    expect(city?.updated_by).toBeNull();
  });

  test("PUT saves a city's selection and records who changed it", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    await push(app, { overwrite: false, cities: [frankfurt()] });
    const cookie = await login(app, db);

    const lists = { allowed_districts: ["Bornheim"], excluded_districts: ["Höchst"], preferred_districts: ["Gallus"] };
    const res = await put(app, cookie, { city: "Frankfurt am Main", ...lists });
    expect(res.status).toBe(200);
    const [city] = await settings(app, cookie);
    expect(city).toMatchObject({ ...lists, updated_by: "alex" });

    // the scraper's next push gets the app's selection back
    expect(await push(app, { overwrite: false, cities: [frankfurt()] })).toEqual([{ city: "Frankfurt am Main", ...lists }]);
  });

  test("PUT rejects unknown cities, unknown districts and a district in two lists", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    await push(app, { overwrite: false, cities: [frankfurt()] });
    const cookie = await login(app, db);

    expect((await put(app, cookie, { city: "Mainz", ...NO_LISTS })).status).toBe(404);
    const unknown = await put(app, cookie, { city: "Frankfurt am Main", ...NO_LISTS, allowed_districts: ["Atlantis"] });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { error: string }).error).toContain("Atlantis");
    const twice = await put(app, cookie, {
      city: "Frankfurt am Main",
      ...NO_LISTS,
      allowed_districts: ["Bornheim"],
      excluded_districts: ["Bornheim"],
    });
    expect(twice.status).toBe(400);
  });

  test("PUT accepts a long district name only seen in listings (up to listings.district's 200 chars)", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    await push(app, { overwrite: false, cities: [frankfurt()] });
    const long = `Frankfurt am Main ${"Sehr langer Stadtteilname ".repeat(6)}`.trim();
    listingIn(db, "a:1", long);
    const cookie = await login(app, db);
    const res = await put(app, cookie, { city: "Frankfurt am Main", ...NO_LISTS, excluded_districts: [long] });
    expect(res.status).toBe(200);
  });

  test("PUT is CSRF-guarded", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    await push(app, { overwrite: false, cities: [frankfurt()] });
    const cookie = await login(app, db);
    const res = await put(app, cookie, { city: "Frankfurt am Main", ...NO_LISTS }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});

describe("queue district filter", () => {
  async function setup(lists: Partial<CitySelection>): Promise<{ db: Database; userId: number }> {
    const db = testDb();
    const app = buildApp(db, testEnv());
    await push(app, { overwrite: false, cities: [frankfurt(lists)] });
    listingIn(db, "bornheim", "Bornheim");
    listingIn(db, "gallus", "Gallus");
    listingIn(db, "hoechst", "Höchst");
    listingIn(db, "unknown", null);
    listingIn(db, "idstein", null, "Idstein");
    const userId = await createUser(db, "alex", "s3cret-password!");
    return { db, userId };
  }

  const ids = (db: Database, userId: number): string[] => getQueue(db, userId, 50).map((l) => l.id).sort();

  test("without a selection every listing is shown", async () => {
    const { db, userId } = await setup({});
    expect(ids(db, userId)).toEqual(["bornheim", "gallus", "hoechst", "idstein", "unknown"]);
  });

  test("hides excluded districts", async () => {
    const { db, userId } = await setup({ excluded_districts: ["Höchst"] });
    expect(ids(db, userId)).toEqual(["bornheim", "gallus", "idstein", "unknown"]);
  });

  test("a whitelist (allowed + preferred) hides other and unknown districts of that city only", async () => {
    const { db, userId } = await setup({ allowed_districts: ["Bornheim"], preferred_districts: ["Gallus"] });
    expect(ids(db, userId)).toEqual(["bornheim", "gallus", "idstein"]);
  });

  test("preferred alone does not restrict", async () => {
    const { db, userId } = await setup({ preferred_districts: ["Gallus"] });
    expect(ids(db, userId)).toHaveLength(5);
  });
});
