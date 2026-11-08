// Minimal .env file helpers for setup/doctor. Values are never logged.

const MIN_INGEST_TOKEN_LENGTH = 32;

/** Value of `KEY=value` in a .env text (last assignment wins), or undefined. Strips matching quotes. */
export function readEnvValue(text: string, key: string): string | undefined {
  const line = text
    .split(/\r?\n/)
    .filter((l) => l.startsWith(`${key}=`))
    .at(-1);
  if (line === undefined) return undefined;
  const raw = line.slice(key.length + 1).trim();
  const quoted = raw.length >= 2 && (raw[0] === '"' || raw[0] === "'") && raw.at(-1) === raw[0];
  return quoted ? raw.slice(1, -1) : raw;
}

/** New .env text with an empty `INGEST_TOKEN=` filled in, or null when nothing needs filling. */
export function fillIngestToken(text: string, token: string): string | null {
  const pattern = /^INGEST_TOKEN=[ \t]*$/m;
  return pattern.test(text) ? text.replace(pattern, `INGEST_TOKEN=${token}`) : null;
}

export function isValidIngestToken(value: string | undefined): boolean {
  return value !== undefined && value.length >= MIN_INGEST_TOKEN_LENGTH;
}

export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
