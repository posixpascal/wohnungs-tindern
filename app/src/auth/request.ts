// Small request helpers shared by auth routes: client IP extraction (only
// trusting X-Forwarded-For when explicitly configured) and CSRF origin check.
import { fail, type Envelope } from "../http/envelope";
import { INGEST_PATH } from "../ingest/routes";

// Minimal structural type for Bun's Server so this module doesn't need to
// import Bun's global types directly.
export type RequestIpSource = { requestIP(request: Request): { address: string } | null } | null;

// Behind Caddy (TRUST_PROXY=true) the rightmost X-Forwarded-For entry is the
// one Caddy itself appended from the real socket peer; anything to its left
// is client-supplied and spoofable. Without a trusted proxy, ask Bun for the
// actual socket address instead of trusting any header.
export function getClientIp(request: Request, trustProxy: boolean, server: RequestIpSource): string {
  if (trustProxy) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      const parts = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
      const rightmost = parts[parts.length - 1];
      if (rightmost) return rightmost;
    }
  }
  return server?.requestIP(request)?.address ?? "unknown";
}

export function isJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.toLowerCase().startsWith("application/json");
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  // No Origin header: same-site requests from non-browser or plain navigation
  // don't always send it. We rely on SameSite=Lax cookies as the primary
  // defense and only reject when Origin is present and mismatched.
  if (!origin) return true;
  // Compare against the Host header rather than request.url: behind a TLS
  // terminating reverse proxy (Caddy) the backend only ever sees plain HTTP,
  // so comparing protocols here would reject every legitimate request.
  const host = request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// CSRF defense for cookie-authenticated mutating endpoints: browsers cannot
// set Content-Type: application/json on a cross-site form submission, so
// requiring it (plus a same-origin Origin header when present) blocks
// classic CSRF without needing a separate token.
export function isSafeMutation(request: Request): boolean {
  return isJsonContentType(request) && isSameOrigin(request);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Elysia validates `body` schemas before `beforeHandle` runs, so a wrong
// Content-Type on a route with a required body never reaches an in-handler
// check — it fails body validation first. Running this as `.onRequest()`
// (before parsing/validation) ensures the CSRF check always applies.
//
// `onRequest` hooks registered by any plugin apply to every route in the
// merged app (Elysia flattens them), so this must explicitly exempt
// `/api/ingest`: that path is bearer-token authenticated, not cookie
// authenticated, and has its own (differently-shaped) client — CSRF defenses
// built around browser Content-Type/Origin headers don't apply to it.
export function csrfGuard({
  request,
  set,
}: {
  request: Request;
  set: { status?: number | string };
}): Envelope<never> | undefined {
  if (new URL(request.url).pathname === INGEST_PATH) return undefined;
  if (SAFE_METHODS.has(request.method.toUpperCase())) return undefined;
  if (isSafeMutation(request)) return undefined;
  return fail(set, 403, "Forbidden");
}
