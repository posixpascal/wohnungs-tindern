import { describe, expect, test } from "bun:test";
import { DEFAULT_SCRAPE_CMD, DEFAULT_SCRAPE_HEADLESS_CMD, agentEnv, scrapeCommand, shellArgs } from "./scrape";

describe("scrapeCommand", () => {
  test("defaults to Claude Code", () => {
    expect(scrapeCommand({}, false)).toBe(DEFAULT_SCRAPE_CMD);
    expect(scrapeCommand({}, true)).toBe(DEFAULT_SCRAPE_HEADLESS_CMD);
  });

  test("uses the matching override and ignores blanks", () => {
    const env = { SCRAPE_CMD: 'codex "x"', SCRAPE_HEADLESS_CMD: "  " };
    expect(scrapeCommand(env, false)).toBe('codex "x"');
    expect(scrapeCommand(env, true)).toBe(DEFAULT_SCRAPE_HEADLESS_CMD);
  });
});

describe("agentEnv", () => {
  test("drops the ingest token and undefined values", () => {
    expect(agentEnv({ PATH: "/bin", INGEST_TOKEN: "secret", EMPTY: undefined })).toEqual({ PATH: "/bin" });
  });
});

describe("shellArgs", () => {
  test("uses cmd.exe on Windows and sh elsewhere", () => {
    expect(shellArgs("a b", "win32")).toEqual(["cmd.exe", "/d", "/s", "/c", '"a b"']);
    expect(shellArgs("a b", "darwin")).toEqual(["sh", "-c", "a b"]);
  });
});
