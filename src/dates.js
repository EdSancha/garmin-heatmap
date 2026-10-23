// Calendar dates are plain "YYYY-MM-DD" strings, handled in UTC so the
// time zone of the machine (a laptop, a CI runner, a reader's browser)
// never shifts a day.

const DAY_MS = 86_400_000;

export function parseDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`Invalid date "${iso}", expected YYYY-MM-DD`);
  return new Date(`${iso}T00:00:00Z`);
}

export function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  return formatDate(new Date(parseDate(iso).getTime() + days * DAY_MS));
}

export function daysBetween(from, to) {
  return Math.round((parseDate(to) - parseDate(from)) / DAY_MS);
}

/** Every date from `start` to `end`, both included. */
export function dateRange(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Splits [start, end] into consecutive ranges of at most `size` days. */
export function chunkRange(start, end, size) {
  const out = [];
  for (let s = start; s <= end; s = addDays(s, size)) {
    const e = addDays(s, size - 1);
    out.push([s, e < end ? e : end]);
  }
  return out;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(iso) {
  return parseDate(iso).getUTCDay();
}

export function today() {
  return formatDate(new Date());
}
