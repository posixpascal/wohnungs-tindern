// Thin wrappers around Bun.password so call sites don't repeat the algorithm
// choice and the rest of the codebase stays testable/mockable.

export function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain, { algorithm: "argon2id" });
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return Bun.password.verify(plain, hash);
}
