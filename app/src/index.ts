import { loadEnv } from "./env";
import { openDb } from "./db";
import { runUserAdd, runUserList, runPasswd, runUserRemove } from "./cli/user";
import { runBackup } from "./cli/backup";

function printUsage(): void {
  console.error(
    "Usage: wohnung [serve|user add <username>|user list|user passwd <username>|user remove <username>|backup <path>]",
  );
}

async function main(): Promise<void> {
  const [command, sub, ...rest] = process.argv.slice(2);
  const env = loadEnv();
  const db = openDb(env.dbPath);

  try {
    if (command === undefined || command === "serve") {
      const { serve } = await import("./server");
      serve(db, env);
      return; // keep db open for the lifetime of the server
    }

    if (command === "user" && sub === "add") {
      const username = rest[0];
      if (!username) {
        printUsage();
        process.exit(1);
      }
      await runUserAdd(db, username);
    } else if (command === "user" && sub === "list") {
      runUserList(db);
    } else if (command === "user" && sub === "passwd") {
      const username = rest[0];
      if (!username) {
        printUsage();
        process.exit(1);
      }
      await runPasswd(db, username);
    } else if (command === "user" && sub === "remove") {
      const username = rest[0];
      if (!username) {
        printUsage();
        process.exit(1);
      }
      runUserRemove(db, username);
    } else if (command === "backup") {
      const targetPath = sub;
      if (!targetPath) {
        printUsage();
        process.exit(1);
      }
      runBackup(db, targetPath);
    } else {
      printUsage();
      process.exit(1);
    }
  } finally {
    if (command !== undefined && command !== "serve") db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
