// CLI: bun run scrape | bun run scrape:headless
// Starts the agent with the wohnung-suche skill. Override the command with
// SCRAPE_CMD / SCRAPE_HEADLESS_CMD (environment or .env), e.g. for Codex:
//   SCRAPE_HEADLESS_CMD='codex exec --full-auto "Use the wohnung-suche skill in headless mode"'
// INGEST_TOKEN must live in .env: it is withheld from the agent process, and
// scraper/push.ts (started by the agent) reads it from .env again.
// Before the agent starts, the district selection is pulled from the app
// (scraper/settings.ts), so every run, local or scheduled, filters by what the
// group set on the Einstellungen page.

export const DEFAULT_SCRAPE_CMD = 'claude "/wohnung-suche"';
export const DEFAULT_SCRAPE_HEADLESS_CMD = 'claude -p "/wohnung-suche headless"';

/** Secrets Bun auto-loads from .env that the agent process must not see; the scraper scripts reload .env themselves. */
const HIDDEN_FROM_AGENT = ["INGEST_TOKEN"] as const;

export function scrapeCommand(env: Readonly<Record<string, string | undefined>>, headless: boolean): string {
  const override = (headless ? env.SCRAPE_HEADLESS_CMD : env.SCRAPE_CMD)?.trim();
  return override || (headless ? DEFAULT_SCRAPE_HEADLESS_CMD : DEFAULT_SCRAPE_CMD);
}

export function agentEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !(HIDDEN_FROM_AGENT as readonly string[]).includes(entry[0]),
    ),
  );
}

/** Like Node's `shell: true`: on Windows the whole command is wrapped in quotes and passed verbatim (see spawn below). */
export function shellArgs(command: string, platform: string): readonly string[] {
  return platform === "win32" ? ["cmd.exe", "/d", "/s", "/c", `"${command}"`] : ["sh", "-c", command];
}

const SYNC_SCRIPT = new URL("../scraper/settings.ts", import.meta.url).pathname;

/** Non-fatal: if the app is unreachable, the last stored selection or the config applies. */
async function syncDistricts(): Promise<void> {
  console.error("$ bun scraper/settings.ts");
  const sync = Bun.spawn([process.execPath, SYNC_SCRIPT], { stdio: ["ignore", "inherit", "inherit"], env: Bun.env });
  const code = await sync.exited;
  if (code !== 0) console.error(`Stadtteil-Abgleich fehlgeschlagen (exit ${code}) – letzte gespeicherte Auswahl bzw. config gilt.`);
}

if (import.meta.main) {
  await syncDistricts();
  const command = scrapeCommand(Bun.env, process.argv.includes("--headless"));
  console.error(`$ ${command}`);
  const proc = Bun.spawn([...shellArgs(command, process.platform)], {
    stdio: ["inherit", "inherit", "inherit"],
    env: agentEnv(Bun.env),
    windowsVerbatimArguments: process.platform === "win32",
  });
  process.exit(await proc.exited);
}
