import { describe, expect, test } from "bun:test";
import { appFix, displayUrl, formatReport, hasLocationRow, isLocalUrl, missingLocationIds, nextStep, parseUserList, type Check } from "./doctor";

const DOC = ["| City | code |", "|---|---|", "| Frankfurt am Main | AD08DE2509 |", "| Bad Camberg | AD08DE2737 |"].join("\n");

const loc = (city: string) => ({ city, radius_km: 0, preferred_districts: [], allowed_districts: [], excluded_districts: [], districts: [] });

describe("hasLocationRow", () => {
  test("matches the first cell exactly", () => {
    expect(hasLocationRow(DOC, "Frankfurt am Main")).toBe(true);
    expect(hasLocationRow(DOC, "Frankfurt")).toBe(false);
  });

  test("ignores other columns and non-table lines", () => {
    expect(hasLocationRow(DOC, "AD08DE2509")).toBe(false);
    expect(hasLocationRow("Bad Camberg is nice", "Bad Camberg")).toBe(false);
  });
});

describe("missingLocationIds", () => {
  test("lists every portal x city without a row", () => {
    const config = { portals: ["immowelt", "kleinanzeigen"] as const, locations: [loc("Bad Camberg"), loc("Mainz")] };
    expect(missingLocationIds(config, { immowelt: DOC })).toEqual([
      "immowelt: Mainz",
      "kleinanzeigen: Bad Camberg",
      "kleinanzeigen: Mainz",
    ]);
  });

  test("empty when everything is covered", () => {
    expect(missingLocationIds({ portals: ["immowelt"], locations: [loc("Bad Camberg")] }, { immowelt: DOC })).toEqual([]);
  });
});

describe("report", () => {
  const checks: readonly Check[] = [
    { name: "bun", status: "ok", detail: "1.2.3" },
    { name: "app", status: "warn", detail: "down", fix: "bun run dev" },
    { name: ".env", status: "fail", detail: "missing", fix: "bun run setup" },
  ];

  test("next step prefers failures over warnings", () => {
    expect(nextStep(checks)).toBe("bun run setup");
    expect(nextStep(checks.slice(0, 2))).toBe("bun run dev");
    expect(nextStep(checks.slice(0, 1))).toBeUndefined();
  });

  test("formats icons, fixes and the next step", () => {
    const out = formatReport(checks);
    expect(out).toContain("✓ bun: 1.2.3");
    expect(out).toContain("✗ .env: missing\n    -> bun run setup");
    expect(out).toContain("Next: bun run setup");
  });
});

describe("isLocalUrl", () => {
  test("localhost, loopback and unset count as local", () => {
    expect(isLocalUrl("http://127.0.0.1:3000")).toBe(true);
    expect(isLocalUrl("http://localhost:3000")).toBe(true);
    expect(isLocalUrl(undefined)).toBe(true);
  });

  test("a deployed domain is remote", () => {
    expect(isLocalUrl("https://wohnung.example.org")).toBe(false);
  });
});

describe("displayUrl", () => {
  test("drops credentials and paths", () => {
    expect(displayUrl("https://user:pw@wohnung.example.org/x")).toBe("https://wohnung.example.org");
    expect(displayUrl("not a url")).toBe("invalid URL");
  });
});

describe("parseUserList", () => {
  test("names from the tab-separated list", () => {
    const out = "1\talex\t2026-11-01 10:00:00\t12\t1\n2\tsam\t2026-11-02 10:00:00\t0\t0\n";
    expect(parseUserList(out)).toEqual(["alex", "sam"]);
  });

  test("empty for the no-users message", () => {
    expect(parseUserList("No users yet.\n")).toEqual([]);
  });
});

describe("appFix", () => {
  test("offers Docker for a local app when docker is installed", () => {
    expect(appFix("http://127.0.0.1:3000", true)).toStartWith("bun run docker:up");
    expect(appFix("http://127.0.0.1:3000", false)).toStartWith("bun run dev");
  });

  test("points at the server skill for a deployed app", () => {
    expect(appFix("https://wohnung.example.com", true)).toContain("wohnung-server");
  });
});
