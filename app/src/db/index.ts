import { Database } from "bun:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { fullSchema } from "./schema";

export function openDb(path: string): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  // ON DELETE CASCADE (user removal) silently does nothing without this.
  const fk = db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get();
  if (fk?.foreign_keys !== 1) throw new Error("SQLite foreign key enforcement could not be enabled");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(fullSchema);
  return db;
}
