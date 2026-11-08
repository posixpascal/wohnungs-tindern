import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { buildApp } from "../src/app";
import { authRoutes } from "../src/auth/routes";
import { hashPassword, verifyPassword } from "../src/auth/password";
import { createSession, findUserBySessionToken, deleteSession, hashToken } from "../src/auth/session";
import { LoginRateLimiter } from "../src/auth/rateLimit";
import { getClientIp } from "../src/auth/request";
import { createUser, jsonRequest, testDb, testEnv } from "./helpers";

describe("password hashing", () => {
  test("hashes and verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  test("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });
});

describe("sessions", () => {
  test("creates a session that resolves back to the user", async () => {
    const db = testDb();
    const userId = await createUser(db, "alex", "s3cret!");
    const { token } = createSession(db, userId);
    const found = findUserBySessionToken(db, token);
    expect(found?.username).toBe("alex");
  });

  test("rejects an unknown token", () => {
    const db = testDb();
    expect(findUserBySessionToken(db, "not-a-real-token")).toBeNull();
  });

  test("deleting a session invalidates it", async () => {
    const db = testDb();
    const userId = await createUser(db, "alex", "s3cret!");
    const { token } = createSession(db, userId);
    deleteSession(db, token);
    expect(findUserBySessionToken(db, token)).toBeNull();
  });

  test("an expired session is rejected and pruned", async () => {
    const db = testDb();
    const userId = await createUser(db, "alex", "s3cret!");
    const { token } = createSession(db, userId);
    // Force the session to be in the past.
    db.query("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").run(
      new Date(Date.now() - 1000).toISOString(),
      hashToken(token),
    );
    expect(findUserBySessionToken(db, token)).toBeNull();
  });
});

describe("login rate limiter", () => {
  test("blocks after the configured number of failures", () => {
    const limiter = new LoginRateLimiter(3, 60_000);
    expect(limiter.isBlocked("1.2.3.4", "alex")).toBe(false);
    limiter.recordAttempt("1.2.3.4", "alex");
    limiter.recordAttempt("1.2.3.4", "alex");
    expect(limiter.isBlocked("1.2.3.4", "alex")).toBe(false);
    limiter.recordAttempt("1.2.3.4", "alex");
    expect(limiter.isBlocked("1.2.3.4", "alex")).toBe(true);
  });

  test("a success resets the failure count", () => {
    const limiter = new LoginRateLimiter(2, 60_000);
    limiter.recordAttempt("1.2.3.4", "alex");
    limiter.recordSuccess("1.2.3.4", "alex");
    limiter.recordAttempt("1.2.3.4", "alex");
    expect(limiter.isBlocked("1.2.3.4", "alex")).toBe(false);
  });

  test("ip+username failures don't block other ips or other usernames", () => {
    const limiter = new LoginRateLimiter(1, 60_000, 100, 60_000);
    limiter.recordAttempt("1.2.3.4", "alex");
    expect(limiter.isBlocked("5.6.7.8", "alex")).toBe(false);
    expect(limiter.isBlocked("1.2.3.4", "other")).toBe(false);
  });

  test("a looser per-username bucket blocks a single username sprayed from many ips", () => {
    const limiter = new LoginRateLimiter(100, 60_000, 2, 60_000);
    limiter.recordAttempt("1.1.1.1", "alex");
    limiter.recordAttempt("2.2.2.2", "alex");
    expect(limiter.isBlocked("3.3.3.3", "alex")).toBe(true);
    expect(limiter.isBlocked("4.4.4.4", "someone-else")).toBe(false);
  });

  test("caps concurrent password verifications", () => {
    const limiter = new LoginRateLimiter(5, 60_000, 20, 60_000, 2);
    expect(limiter.tryAcquireVerificationSlot()).toBe(true);
    expect(limiter.tryAcquireVerificationSlot()).toBe(true);
    expect(limiter.tryAcquireVerificationSlot()).toBe(false);
    limiter.releaseVerificationSlot();
    expect(limiter.tryAcquireVerificationSlot()).toBe(true);
  });
});

describe("getClientIp", () => {
  const request = new Request("http://localhost/api/login");

  test("without trustProxy, uses the server's socket address", () => {
    const server = { requestIP: () => ({ address: "203.0.113.9" }) };
    expect(getClientIp(request, false, server)).toBe("203.0.113.9");
  });

  test("without trustProxy and no server, falls back to unknown", () => {
    expect(getClientIp(request, false, null)).toBe("unknown");
  });

  test("ignores X-Forwarded-For when trustProxy is false", () => {
    const spoofed = new Request("http://localhost/api/login", { headers: { "x-forwarded-for": "9.9.9.9" } });
    const server = { requestIP: () => ({ address: "203.0.113.9" }) };
    expect(getClientIp(spoofed, false, server)).toBe("203.0.113.9");
  });

  test("with trustProxy, uses the rightmost X-Forwarded-For entry (the proxy's own hop)", () => {
    const forwarded = new Request("http://localhost/api/login", {
      headers: { "x-forwarded-for": "9.9.9.9, 203.0.113.9" },
    });
    expect(getClientIp(forwarded, true, null)).toBe("203.0.113.9");
  });
});

describe("login/logout/me routes", () => {
  test("logs in with correct credentials and sets a session cookie", async () => {
    const db = testDb();
    await createUser(db, "alex", "s3cret!");
    const app = buildApp(db, testEnv());

    const res = await app.handle(
      jsonRequest("/api/login", { method: "POST", body: JSON.stringify({ username: "alex", password: "s3cret!" }) }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { username: string } };
    expect(body.success).toBe(true);
    expect(body.data.username).toBe("alex");
    expect(res.headers.get("set-cookie")).toContain("session=");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
  });

  test("rejects wrong password with a generic message", async () => {
    const db = testDb();
    await createUser(db, "alex", "s3cret!");
    const app = buildApp(db, testEnv());

    const res = await app.handle(
      jsonRequest("/api/login", { method: "POST", body: JSON.stringify({ username: "alex", password: "wrong" }) }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe("Invalid credentials");
  });

  test("rejects unknown username with the same generic message", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());

    const res = await app.handle(
      jsonRequest("/api/login", { method: "POST", body: JSON.stringify({ username: "ghost", password: "whatever" }) }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Invalid credentials");
  });

  test("blocks login after repeated failures from the same ip+username", async () => {
    const db = testDb();
    await createUser(db, "alex", "s3cret!");
    const app = buildApp(db, testEnv());

    for (let i = 0; i < 5; i++) {
      await app.handle(
        jsonRequest("/api/login", { method: "POST", body: JSON.stringify({ username: "alex", password: "wrong" }) }),
      );
    }
    const res = await app.handle(
      jsonRequest("/api/login", { method: "POST", body: JSON.stringify({ username: "alex", password: "s3cret!" }) }),
    );
    expect(res.status).toBe(429);
  });

  test("rejects login without JSON content-type (CSRF defense)", async () => {
    const db = testDb();
    await createUser(db, "alex", "s3cret!");
    const app = buildApp(db, testEnv());

    const res = await app.handle(
      new Request("http://localhost/api/login", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ username: "alex", password: "s3cret!" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  test("rejects requests with a mismatched Origin header", async () => {
    const db = testDb();
    await createUser(db, "alex", "s3cret!");
    const app = buildApp(db, testEnv());

    const res = await app.handle(
      new Request("http://localhost/api/login", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body: JSON.stringify({ username: "alex", password: "s3cret!" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  test("/api/me requires authentication", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    const res = await app.handle(jsonRequest("/api/me"));
    expect(res.status).toBe(401);
  });

  test("/api/me returns the logged-in user via the session cookie", async () => {
    const db = testDb();
    await createUser(db, "alex", "s3cret!");
    const app = buildApp(db, testEnv());

    const loginRes = await app.handle(
      jsonRequest("/api/login", { method: "POST", body: JSON.stringify({ username: "alex", password: "s3cret!" }) }),
    );
    const cookie = loginRes.headers.get("set-cookie")!.split(";")[0]!;

    const meRes = await app.handle(jsonRequest("/api/me", { cookie }));
    expect(meRes.status).toBe(200);
    const body = (await meRes.json()) as { data: { username: string } };
    expect(body.data.username).toBe("alex");
  });

  test("logout clears the session so it can no longer be used", async () => {
    const db = testDb();
    await createUser(db, "alex", "s3cret!");
    const app = buildApp(db, testEnv());

    const loginRes = await app.handle(
      jsonRequest("/api/login", { method: "POST", body: JSON.stringify({ username: "alex", password: "s3cret!" }) }),
    );
    const cookie = loginRes.headers.get("set-cookie")!.split(";")[0]!;

    const logoutRes = await app.handle(jsonRequest("/api/logout", { method: "POST", cookie }));
    expect(logoutRes.status).toBe(200);

    const meRes = await app.handle(jsonRequest("/api/me", { cookie }));
    expect(meRes.status).toBe(401);
  });

  test("logging in again deletes the session cookie already presented by the browser", async () => {
    const db = testDb();
    await createUser(db, "alex", "s3cret!");
    const app = buildApp(db, testEnv());

    const firstLogin = await app.handle(
      jsonRequest("/api/login", { method: "POST", body: JSON.stringify({ username: "alex", password: "s3cret!" }) }),
    );
    const firstCookie = firstLogin.headers.get("set-cookie")!.split(";")[0]!;

    const secondLogin = await app.handle(
      jsonRequest("/api/login", {
        method: "POST",
        cookie: firstCookie,
        body: JSON.stringify({ username: "alex", password: "s3cret!" }),
      }),
    );
    const secondCookie = secondLogin.headers.get("set-cookie")!.split(";")[0]!;
    expect(secondCookie).not.toBe(firstCookie);

    const meWithOldCookie = await app.handle(jsonRequest("/api/me", { cookie: firstCookie }));
    expect(meWithOldCookie.status).toBe(401);

    const meWithNewCookie = await app.handle(jsonRequest("/api/me", { cookie: secondCookie }));
    expect(meWithNewCookie.status).toBe(200);
  });

  test("login prunes other users' already-expired sessions", async () => {
    const db = testDb();
    const partnerId = await createUser(db, "partner", "s3cret!");
    await createUser(db, "alex", "s3cret!");
    const app = buildApp(db, testEnv());

    const { token } = createSession(db, partnerId);
    db.query("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").run(
      new Date(Date.now() - 1000).toISOString(),
      hashToken(token),
    );
    expect(db.query("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).toEqual({ n: 1 });

    await app.handle(
      jsonRequest("/api/login", { method: "POST", body: JSON.stringify({ username: "alex", password: "s3cret!" }) }),
    );

    const remaining = db.query<{ token_hash: string }, []>("SELECT token_hash FROM sessions").all();
    expect(remaining.map((r) => r.token_hash)).not.toContain(hashToken(token));
  });

  test("returns 429 when the verification concurrency cap is already exhausted", async () => {
    const db = testDb();
    await createUser(db, "alex", "s3cret!");
    const limiter = new LoginRateLimiter(5, 60_000, 20, 60 * 60 * 1000, 1);
    const app = new Elysia().use(authRoutes(db, testEnv(), limiter));

    expect(limiter.tryAcquireVerificationSlot()).toBe(true); // simulate one verification already in flight

    const res = await app.handle(
      jsonRequest("/api/login", { method: "POST", body: JSON.stringify({ username: "alex", password: "s3cret!" }) }),
    );
    expect(res.status).toBe(429);
  });
});
