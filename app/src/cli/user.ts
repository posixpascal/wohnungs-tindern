import type { Database } from "bun:sqlite";
import { createInterface } from "node:readline";
import { hashPassword } from "../auth/password";

const MIN_PASSWORD_LENGTH = 12;
const SIGINT_EXIT_CODE = 130;

// Accepts exactly one line: a single trailing "\n" or "\r\n" is stripped (the
// same thing readline strips on the TTY path), anything multi-line is
// rejected instead of silently becoming part of the password.
export function parsePipedPassword(text: string): string {
  const password = text.replace(/\r?\n$/, "");
  if (password.length === 0) {
    throw new Error(
      "No password on stdin. Run this in an interactive terminal for a hidden prompt, or pipe the password in.",
    );
  }
  if (/[\r\n]/.test(password)) {
    throw new Error("Password must be a single line");
  }
  return password;
}

export async function readPasswordFromStdin(): Promise<string> {
  return parsePipedPassword(await Bun.stdin.text());
}

// Toggles the controlling terminal's echo flag. Best effort: a missing `stty`
// must not abort the command (echo restore runs in `finally`/signal paths).
function setTerminalEcho(enabled: boolean): void {
  try {
    Bun.spawnSync(["stty", enabled ? "echo" : "-echo"], { stdin: "inherit" });
  } catch {
    // stty unavailable: nothing to toggle or restore
  }
}

async function promptLine(lines: AsyncIterator<string>, promptText: string): Promise<string> {
  process.stderr.write(promptText);
  const next = await lines.next();
  process.stderr.write("\n");
  if (next.done) throw new Error("No password entered (input closed)");
  return next.value;
}

// Interactive password entry for a real terminal: prompts twice with echo
// disabled and requires both entries to match. One readline interface for
// both prompts (its iterator buffers, so fast typing/paste isn't lost), closed
// in `finally` so stdin is released and the process can exit. Echo is
// restored on success, error, and Ctrl-C.
export async function readPasswordInteractive(): Promise<string> {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  const restoreEchoAndExit = (): void => {
    setTerminalEcho(true);
    process.stderr.write("\n");
    process.exit(SIGINT_EXIT_CODE);
  };
  process.once("SIGINT", restoreEchoAndExit);
  setTerminalEcho(false);
  try {
    const first = await promptLine(lines, "Passwort: ");
    const second = await promptLine(lines, "Wiederholen: ");
    if (first !== second) throw new Error("Passwords do not match");
    if (first.length === 0) throw new Error("Password must not be empty");
    return first;
  } finally {
    setTerminalEcho(true);
    rl.close();
    process.removeListener("SIGINT", restoreEchoAndExit);
  }
}

export type PasswordReader = () => Promise<string>;

// Default reader used by the CLI entry points: a hidden double-prompt on a
// real terminal, the existing single-line stdin read otherwise (piped input,
// e.g. from `wohnung-cli` or scripted test setups).
export function readPassword(): Promise<string> {
  return process.stdin.isTTY === true ? readPasswordInteractive() : readPasswordFromStdin();
}

export async function addUser(db: Database, username: string, password: string): Promise<void> {
  if (username.trim().length === 0) throw new Error("Username must not be empty");
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
  }
  const exists = db.query("SELECT 1 FROM users WHERE username = ?").get(username);
  if (exists) throw new Error(`User "${username}" already exists`);
  const passwordHash = await hashPassword(password);
  db.query("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, passwordHash);
}

function findUserId(db: Database, username: string): number {
  const row = db.query<{ id: number }, [string]>("SELECT id FROM users WHERE username = ?").get(username);
  if (!row) throw new Error(`Unknown user "${username}"`);
  return row.id;
}

// Sets a new password and revokes every existing session for that user, so a
// changed password always forces re-login.
export async function setPassword(db: Database, username: string, password: string): Promise<void> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
  }
  const id = findUserId(db, username);
  const passwordHash = await hashPassword(password);
  db.transaction(() => {
    db.query("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
    db.query("DELETE FROM sessions WHERE user_id = ?").run(id);
  })();
}

// Relies on `PRAGMA foreign_keys = ON` (enabled and checked in openDb,
// src/db/index.ts) so sessions and swipes for this user cascade-delete with it.
export function removeUser(db: Database, username: string): void {
  const id = findUserId(db, username);
  db.query("DELETE FROM users WHERE id = ?").run(id);
}

export type UserListEntry = {
  id: number;
  username: string;
  created_at: string;
  swipe_count: number;
  active_session_count: number;
};

export function listUsers(db: Database): UserListEntry[] {
  return db
    .query<UserListEntry, [string]>(
      `SELECT users.id AS id, users.username AS username, users.created_at AS created_at,
              (SELECT COUNT(*) FROM swipes WHERE swipes.user_id = users.id) AS swipe_count,
              (SELECT COUNT(*) FROM sessions
                 WHERE sessions.user_id = users.id AND sessions.expires_at > ?) AS active_session_count
       FROM users ORDER BY users.id`,
    )
    .all(new Date().toISOString());
}

export async function runUserAdd(
  db: Database,
  username: string,
  readNewPassword: PasswordReader = readPassword,
): Promise<void> {
  const password = await readNewPassword();
  await addUser(db, username, password);
  console.log(`User "${username}" created.`);
}

export function runUserList(db: Database): void {
  const users = listUsers(db);
  if (users.length === 0) {
    console.log("No users yet.");
    return;
  }
  for (const user of users) {
    console.log(
      `${user.id}\t${user.username}\t${user.created_at}\t${user.swipe_count}\t${user.active_session_count}`,
    );
  }
}

export async function runPasswd(
  db: Database,
  username: string,
  readNewPassword: PasswordReader = readPassword,
): Promise<void> {
  const password = await readNewPassword();
  await setPassword(db, username, password);
  console.log(`Password for "${username}" updated; all sessions revoked.`);
}

export function runUserRemove(db: Database, username: string): void {
  removeUser(db, username);
  console.log(`User "${username}" removed.`);
}
