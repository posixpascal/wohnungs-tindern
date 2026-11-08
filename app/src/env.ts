// Startup environment validation. Fails fast with a clear message so a
// misconfigured deploy never silently runs with weak defaults.

import { isAbsolute, resolve } from "node:path";

/**
 * Base for a relative DB_PATH. From source: app/src/env.ts -> repo root, so it
 * resolves the same whether the cwd is the repo root or app/ (bun run dev). In a
 * `bun build --compile` binary import.meta.dir is virtual (/$bunfs/root,
 * B:\~BUN\root on Windows), so fall back to the cwd (WorkingDirectory=).
 */
export function dbBaseDir(moduleDir: string, cwd: string): string {
  const compiled = moduleDir.startsWith("/$bunfs") || moduleDir.includes("~BUN");
  return compiled ? cwd : resolve(moduleDir, "..", "..");
}

function resolveDbPath(path: string): string {
  if (path === ":memory:" || isAbsolute(path)) return path;
  return resolve(dbBaseDir(import.meta.dir, process.cwd()), path);
}

export type AppEnv = {
  readonly port: number;
  readonly host: string;
  readonly dbPath: string;
  readonly ingestToken: string;
  readonly cookieSecure: boolean;
  readonly trustProxy: boolean;
  // null = no LLM configured; inquiries fall back to the built-in template.
  readonly inquiry: InquiryLlmConfig | null;
};

export type InquiryLlmConfig = {
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly model: string;
};

export const DEFAULT_INQUIRY_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_INQUIRY_MODEL = "anthropic/claude-haiku-5.5";

// Enabled by INQUIRY_API_KEY (OpenRouter by default) or by INQUIRY_BASE_URL
// alone for a keyless local server such as Ollama (http://127.0.0.1:11434/v1).
export function loadInquiryConfig(source: NodeJS.ProcessEnv): InquiryLlmConfig | null {
  const apiKey = source["INQUIRY_API_KEY"] || null;
  const baseUrlRaw = source["INQUIRY_BASE_URL"] || null;
  if (!apiKey && !baseUrlRaw) return null;

  const baseUrl = baseUrlRaw ?? DEFAULT_INQUIRY_BASE_URL;
  let protocol = "";
  try {
    protocol = new URL(baseUrl).protocol;
  } catch {
    protocol = "";
  }
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("INQUIRY_BASE_URL must be an http(s) URL");
  }
  return { baseUrl, apiKey, model: source["INQUIRY_MODEL"] || DEFAULT_INQUIRY_MODEL };
}

const MIN_INGEST_TOKEN_LENGTH = 32;

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() !== "false" && value !== "0";
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const ingestToken = source["INGEST_TOKEN"];
  if (!ingestToken || ingestToken.length < MIN_INGEST_TOKEN_LENGTH) {
    throw new Error(
      `INGEST_TOKEN must be set and at least ${MIN_INGEST_TOKEN_LENGTH} characters long`,
    );
  }

  const portRaw = source["PORT"] ?? "3000";
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT must be a valid port number, got "${portRaw}"`);
  }

  return {
    port,
    host: source["HOST"] ?? "127.0.0.1",
    dbPath: resolveDbPath(source["DB_PATH"] ?? "./data/wohnung.sqlite"),
    ingestToken,
    cookieSecure: parseBool(source["COOKIE_SECURE"], true),
    trustProxy: parseBool(source["TRUST_PROXY"], false),
    inquiry: loadInquiryConfig(source),
  };
}
