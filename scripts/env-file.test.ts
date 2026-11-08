import { describe, expect, test } from "bun:test";
import { fillIngestToken, isValidIngestToken, randomToken, readEnvValue } from "./env-file";

describe("readEnvValue", () => {
  test("reads a plain value", () => {
    expect(readEnvValue("A=1\nINGEST_TOKEN=abc\n", "INGEST_TOKEN")).toBe("abc");
  });

  test("ignores comments and prefixed keys", () => {
    expect(readEnvValue("# INGEST_TOKEN=x\nMY_INGEST_TOKEN=y\n", "INGEST_TOKEN")).toBeUndefined();
  });

  test("strips matching quotes and handles CRLF", () => {
    expect(readEnvValue('WOHNUNG_URL="http://x"\r\n', "WOHNUNG_URL")).toBe("http://x");
  });

  test("last assignment wins", () => {
    expect(readEnvValue("PORT=1\nPORT=2\n", "PORT")).toBe("2");
  });
});

describe("fillIngestToken", () => {
  test("fills an empty token and keeps the rest", () => {
    expect(fillIngestToken("A=1\nINGEST_TOKEN=\nB=2\n", "t0k")).toBe("A=1\nINGEST_TOKEN=t0k\nB=2\n");
  });

  test("returns null when a token is already set", () => {
    expect(fillIngestToken("INGEST_TOKEN=existing\n", "t0k")).toBeNull();
  });

  test("returns null when the key is missing", () => {
    expect(fillIngestToken("A=1\n", "t0k")).toBeNull();
  });
});

describe("tokens", () => {
  test("randomToken is 64 hex chars and valid", () => {
    const token = randomToken();
    expect(token).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(token)).toBe(true);
    expect(isValidIngestToken(token)).toBe(true);
  });

  test("short or missing tokens are invalid", () => {
    expect(isValidIngestToken("short")).toBe(false);
    expect(isValidIngestToken(undefined)).toBe(false);
  });
});
