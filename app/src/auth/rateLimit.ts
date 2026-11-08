// In-memory login rate limiter: N failures per window, keyed by IP+username,
// plus a looser per-username-only bucket (so attackers spraying a single
// username from many IPs still get capped). Good enough for a two-person app
// behind a single process; no Redis needed.

type Bucket = { failures: number; windowStart: number };

// Hard cap on how many distinct buckets we'll hold in memory at once, so an
// attacker cycling through usernames/IPs can't grow these maps unbounded.
const MAX_BUCKETS = 10_000;

export class LoginRateLimiter {
  private readonly ipBuckets = new Map<string, Bucket>();
  private readonly usernameBuckets = new Map<string, Bucket>();
  private inFlightVerifications = 0;

  constructor(
    private readonly maxIpFailures = 5,
    private readonly ipWindowMs = 15 * 60 * 1000,
    private readonly maxUsernameFailures = 20,
    private readonly usernameWindowMs = 60 * 60 * 1000,
    private readonly maxConcurrentVerifications = 4,
  ) {}

  private ipKey(ip: string, username: string): string {
    return `${ip}:${username.toLowerCase()}`;
  }

  private usernameKey(username: string): string {
    return username.toLowerCase();
  }

  private isActive(bucket: Bucket | undefined, windowMs: number): bucket is Bucket {
    return bucket !== undefined && Date.now() - bucket.windowStart <= windowMs;
  }

  isBlocked(ip: string, username: string): boolean {
    const ipBucket = this.ipBuckets.get(this.ipKey(ip, username));
    if (this.isActive(ipBucket, this.ipWindowMs) && ipBucket.failures >= this.maxIpFailures) return true;

    const usernameBucket = this.usernameBuckets.get(this.usernameKey(username));
    if (this.isActive(usernameBucket, this.usernameWindowMs) && usernameBucket.failures >= this.maxUsernameFailures) {
      return true;
    }
    return false;
  }

  // Records this attempt *before* the slow password verification runs, so
  // concurrent requests can't all pass isBlocked() before any of them
  // increments the counter. recordSuccess() clears it again if the attempt
  // actually succeeds.
  recordAttempt(ip: string, username: string): void {
    this.bump(this.ipBuckets, this.ipKey(ip, username), this.ipWindowMs);
    this.bump(this.usernameBuckets, this.usernameKey(username), this.usernameWindowMs);
  }

  recordSuccess(ip: string, username: string): void {
    this.ipBuckets.delete(this.ipKey(ip, username));
    this.usernameBuckets.delete(this.usernameKey(username));
  }

  private bump(map: Map<string, Bucket>, key: string, windowMs: number): void {
    this.sweep(map, windowMs);
    const existing = map.get(key);
    if (!this.isActive(existing, windowMs)) {
      map.set(key, { failures: 1, windowStart: Date.now() });
      return;
    }
    existing.failures += 1;
  }

  private sweep(map: Map<string, Bucket>, windowMs: number): void {
    const now = Date.now();
    for (const [key, bucket] of map) {
      if (now - bucket.windowStart > windowMs) map.delete(key);
    }
    if (map.size <= MAX_BUCKETS) return;
    // Still oversized (e.g. many distinct ip/username pairs within one
    // window) — drop the oldest entries first rather than grow unbounded.
    const byAge = [...map.entries()].sort((a, b) => a[1].windowStart - b[1].windowStart);
    for (const [key] of byAge.slice(0, map.size - MAX_BUCKETS)) map.delete(key);
  }

  // Password verification (argon2) is CPU-heavy; cap how many run at once so
  // a burst of login attempts can't starve the event loop for everyone else.
  tryAcquireVerificationSlot(): boolean {
    if (this.inFlightVerifications >= this.maxConcurrentVerifications) return false;
    this.inFlightVerifications += 1;
    return true;
  }

  releaseVerificationSlot(): void {
    this.inFlightVerifications = Math.max(0, this.inFlightVerifications - 1);
  }
}
