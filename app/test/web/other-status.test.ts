import { describe, expect, test } from "bun:test";
import { isMatch } from "../../src/web/client/otherStatus";

describe("isMatch", () => {
  test("false with no others", () => {
    expect(isMatch([])).toBe(false);
  });

  test("true when every other user liked it", () => {
    expect(isMatch([{ username: "a", decision: "liked" }])).toBe(true);
    expect(
      isMatch([
        { username: "a", decision: "liked" },
        { username: "b", decision: "liked" },
      ]),
    ).toBe(true);
  });

  test("false if any other user hasn't liked it yet", () => {
    expect(
      isMatch([
        { username: "a", decision: "liked" },
        { username: "b", decision: "pending" },
      ]),
    ).toBe(false);
    expect(
      isMatch([
        { username: "a", decision: "liked" },
        { username: "b", decision: "noped" },
      ]),
    ).toBe(false);
  });
});
