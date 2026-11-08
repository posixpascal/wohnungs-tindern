// Consistent `{ success, data, error }` envelope used by every API route.

export type Envelope<T> = { success: true; data: T; error: null } | { success: false; data: null; error: string };

export function ok<T>(data: T): Envelope<T> {
  return { success: true, data, error: null };
}

type Settable = { status?: number | string };

export function fail(set: Settable, status: number, message: string): Envelope<never> {
  set.status = status;
  return { success: false, data: null, error: message };
}
