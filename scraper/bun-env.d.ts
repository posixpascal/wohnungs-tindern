// Minimal ambient types for the Bun APIs this package uses, so `tsc --noEmit`
// works without installing @types/bun (the scraper has zero npm dependencies).

declare module "bun:sqlite" {
  type Binding = string | number | bigint | boolean | null | Uint8Array;

  export class Statement<Row = unknown> {
    all(...params: Binding[]): Row[];
    get(...params: Binding[]): Row | null;
    run(...params: Binding[]): { changes: number; lastInsertRowid: number | bigint };
  }

  export class Database {
    constructor(filename?: string, options?: { create?: boolean; readwrite?: boolean; strict?: boolean });
    query<Row = unknown>(sql: string): Statement<Row>;
    prepare<Row = unknown>(sql: string): Statement<Row>;
    run(sql: string, params?: Binding[]): void;
    exec(sql: string): void;
    transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R;
    close(): void;
  }
}

declare module "bun:test" {
  interface Matchers {
    not: Matchers;
    resolves: Matchers;
    rejects: Matchers;
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toContain(expected: unknown): void;
    toHaveLength(n: number): void;
    toBeGreaterThan(n: number): void;
    toBeGreaterThanOrEqual(n: number): void;
    toBeLessThan(n: number): void;
    toBeLessThanOrEqual(n: number): void;
    toThrow(expected?: string | RegExp): void;
  }
  type TestFn = (name: string, fn: () => void | Promise<void>) => void;
  type EachFn = <T>(
    cases: readonly T[],
  ) => (name: string, fn: (...args: T extends readonly unknown[] ? [...T] : [T]) => void | Promise<void>) => void;

  export const test: TestFn & { each: EachFn };
  export const describe: (name: string, fn: () => void) => void;
  export const beforeEach: (fn: () => void | Promise<void>) => void;
  export function expect(actual: unknown): Matchers;
}

interface BunFile {
  text(): Promise<string>;
  exists(): Promise<boolean>;
}

declare const Bun: {
  Glob: new (pattern: string) => { scanSync(options?: { cwd?: string }): IterableIterator<string> };
  file(path: string): BunFile;
  write(path: string, data: string): Promise<number>;
  stdin: { text(): Promise<string> };
  env: Record<string, string | undefined>;
};

declare const process: {
  argv: string[];
  exitCode: number | undefined;
  exit(code?: number): never;
};

interface ImportMeta {
  readonly dir: string;
  readonly main: boolean;
}

declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}
