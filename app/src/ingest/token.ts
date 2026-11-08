import { timingSafeEqual } from "node:crypto";

const BEARER_PREFIX = "Bearer ";

// Constant-time comparison so response timing can't leak how much of the
// token matched.
export function verifyIngestToken(authorizationHeader: string | null | undefined, expected: string): boolean {
  if (!authorizationHeader?.startsWith(BEARER_PREFIX)) return false;
  const received = authorizationHeader.slice(BEARER_PREFIX.length);

  const receivedBuf = Buffer.from(received);
  const expectedBuf = Buffer.from(expected);
  if (receivedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(receivedBuf, expectedBuf);
}
