// Detail visits are recorded as files: data/raw/<YYYY-MM-DD>-detail-<portal>-<portal_id>.json.
// Their existence tells which listings got a detail visit and when (no DB column needed).

export const DETAIL_GLOB = "data/raw/*-detail-*.json";

const DETAIL_FILE = /(\d{4}-\d{2}-\d{2})-detail-(immoscout24|immowelt|kleinanzeigen|wg-gesucht)-([A-Za-z0-9_-]+)\.json$/;

export const isDetailFile = (path: string): boolean => DETAIL_FILE.test(path);

/** id → date (YYYY-MM-DD) of the latest detail visit. */
export function detailVisits(paths: readonly string[]): Map<string, string> {
  const visits = new Map<string, string>(); // local accumulator, never escapes
  for (const p of paths) {
    const m = p.match(DETAIL_FILE);
    if (!m) continue;
    const [, date, portal, id] = m as unknown as [string, string, string, string];
    const key = `${portal}:${id}`;
    if (date > (visits.get(key) ?? "")) visits.set(key, date);
  }
  return visits;
}
