import type { Database } from "bun:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

// A safe, consistent snapshot even while the server has the WAL open:
// VACUUM INTO writes a fully checkpointed copy to a new file.
export function runBackup(db: Database, targetPath: string): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  db.query("VACUUM INTO ?").run(targetPath);
  console.log(`Backup written to ${targetPath}`);
}
