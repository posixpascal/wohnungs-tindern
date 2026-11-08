import { describe, expect, test } from "bun:test";
import {
  addUser,
  listUsers,
  parsePipedPassword,
  removeUser,
  runPasswd,
  runUserRemove,
  setPassword,
} from "../src/cli/user";
import { createSession, findUserBySessionToken } from "../src/auth/session";
import { verifyPassword } from "../src/auth/password";
import { insertListing, testDb } from "./helpers";

function userId(db: ReturnType<typeof testDb>, username: string): number {
  const entry = listUsers(db).find((u) => u.username === username);
  if (!entry) throw new Error(`fixture bug: user "${username}" not found`);
  return entry.id;
}

describe("addUser", () => {
  test("rejects a password shorter than 12 characters", async () => {
    const db = testDb();
    await expect(addUser(db, "alex", "short-pw1")).rejects.toThrow(/at least 12 characters/);
    expect(listUsers(db)).toHaveLength(0);
  });

  test("accepts a password of exactly 12 characters", async () => {
    const db = testDb();
    await addUser(db, "alex", "123456789012");
    expect(listUsers(db).map((u) => u.username)).toEqual(["alex"]);
  });

  test("rejects an existing username with a clear error", async () => {
    const db = testDb();
    await addUser(db, "alex", "123456789012");
    await expect(addUser(db, "alex", "another-password")).rejects.toThrow(/already exists/);
  });

  test("rejects an empty username", async () => {
    const db = testDb();
    await expect(addUser(db, "   ", "a-long-enough-password")).rejects.toThrow(/Username/);
  });
});

describe("parsePipedPassword", () => {
  test("strips exactly one trailing LF or CRLF", () => {
    expect(parsePipedPassword("a-long-password\n")).toBe("a-long-password");
    expect(parsePipedPassword("a-long-password\r\n")).toBe("a-long-password");
    expect(parsePipedPassword("a-long-password")).toBe("a-long-password");
  });

  test("rejects empty input with a hint about the interactive prompt", () => {
    expect(() => parsePipedPassword("")).toThrow(/interactive terminal/);
    expect(() => parsePipedPassword("\n")).toThrow(/interactive terminal/);
  });

  test("rejects multi-line input instead of embedding a newline", () => {
    expect(() => parsePipedPassword("first-line\nsecond-line\n")).toThrow(/single line/);
  });
});

describe("listUsers", () => {
  test("reports swipe and active session counts per user", async () => {
    const db = testDb();
    await addUser(db, "alex", "123456789012");
    const id = userId(db, "alex");
    createSession(db, id);
    createSession(db, id);
    insertListing(db, { id: "l1" });
    db.query("INSERT INTO swipes (user_id, listing_id, decision) VALUES (?, ?, ?)").run(
      id,
      "l1",
      "like",
    );

    const [entry] = listUsers(db);
    expect(entry?.swipe_count).toBe(1);
    expect(entry?.active_session_count).toBe(2);
  });

  test("does not count expired sessions as active", async () => {
    const db = testDb();
    await addUser(db, "alex", "123456789012");
    const id = userId(db, "alex");
    db.query(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
    ).run("expired-hash", id, "2000-01-01T00:00:00.000Z");

    expect(listUsers(db)[0]?.active_session_count).toBe(0);
  });
});

describe("setPassword", () => {
  test("rejects a new password shorter than 12 characters", async () => {
    const db = testDb();
    await addUser(db, "alex", "123456789012");
    await expect(setPassword(db, "alex", "short-pw1")).rejects.toThrow(/at least 12 characters/);
  });

  test("errors for an unknown user", async () => {
    const db = testDb();
    await expect(setPassword(db, "ghost", "123456789012")).rejects.toThrow(/Unknown user/);
  });

  test("updates the hash and revokes all sessions", async () => {
    const db = testDb();
    await addUser(db, "alex", "123456789012");
    const id = userId(db, "alex");
    createSession(db, id);
    createSession(db, id);

    await setPassword(db, "alex", "a-new-password-1");

    const row = db
      .query<{ password_hash: string }, [number]>("SELECT password_hash FROM users WHERE id = ?")
      .get(id);
    expect(await verifyPassword("a-new-password-1", row!.password_hash)).toBe(true);
    expect(await verifyPassword("123456789012", row!.password_hash)).toBe(false);
    expect(listUsers(db)[0]?.active_session_count).toBe(0);
  });
});

describe("removeUser", () => {
  test("errors for an unknown user", () => {
    const db = testDb();
    expect(() => removeUser(db, "ghost")).toThrow(/Unknown user/);
  });

  test("deletes the user along with their sessions and swipes", async () => {
    const db = testDb();
    await addUser(db, "alex", "123456789012");
    const id = userId(db, "alex");
    const { token } = createSession(db, id);
    insertListing(db, { id: "l1" });
    db.query("INSERT INTO swipes (user_id, listing_id, decision) VALUES (?, ?, ?)").run(
      id,
      "l1",
      "like",
    );

    removeUser(db, "alex");

    expect(listUsers(db)).toHaveLength(0);
    expect(findUserBySessionToken(db, token)).toBeNull();
    expect(db.query("SELECT * FROM swipes WHERE user_id = ?").all(id)).toHaveLength(0);
  });
});

describe("runPasswd", () => {
  test("uses the injected password reader and reports success", async () => {
    const db = testDb();
    await addUser(db, "alex", "123456789012");
    await runPasswd(db, "alex", async () => "a-new-password-1");

    const row = db
      .query<{ password_hash: string }, [string]>("SELECT password_hash FROM users WHERE username = ?")
      .get("alex");
    expect(await verifyPassword("a-new-password-1", row!.password_hash)).toBe(true);
  });
});

describe("runUserRemove", () => {
  test("removes the user", async () => {
    const db = testDb();
    await addUser(db, "alex", "123456789012");
    runUserRemove(db, "alex");
    expect(listUsers(db)).toHaveLength(0);
  });
});
