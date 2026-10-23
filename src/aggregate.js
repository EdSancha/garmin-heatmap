// Turns raw Personal API records into one small record per day.
//
// The output is what a blog publishes, so it keeps daily totals only:
// no activity names, IDs, GPS coordinates or timestamps.
//
// {
//   version: 1, generated, start, end,
//   days: {
//     "2026-06-01": {
//       activities: { running: { count, distance, duration, elevation } },
//       sleep: { seconds, score },
//       hrv: 118,
//       steps: 11873
//     }
//   }
// }
// Units are SI: metres and seconds. Activity keys are Garmin type keys.

export const DATA_VERSION = 1;

export function buildDays({ activities = [], sleep = [], hrv = [], summaries = [] }, { start, end } = {}) {
  const days = {};
  const inRange = (date) => date && (!start || date >= start) && (!end || date <= end);
  const day = (date) => (days[date] ??= {});

  for (const a of activities) {
    const date = a.startTimeLocal?.slice(0, 10);
    if (!inRange(date)) continue;
    const type = a.activityType?.typeKey ?? 'other';
    const t = ((day(date).activities ??= {})[type] ??= { count: 0, distance: 0, duration: 0, elevation: 0 });
    t.count += 1;
    t.distance += Math.round(a.distance ?? 0);
    t.duration += Math.round(a.duration ?? 0);
    t.elevation += Math.round(a.elevationGain ?? 0);
  }

  for (const s of sleep) {
    if (!inRange(s.calendarDate) || !s.sleepTimeSeconds) continue;
    const entry = { seconds: s.sleepTimeSeconds };
    const score = s.sleepScores?.overall?.value;
    if (score != null) entry.score = score;
    day(s.calendarDate).sleep = entry;
  }

  for (const h of hrv) {
    if (inRange(h.calendarDate) && h.lastNightAvg != null) day(h.calendarDate).hrv = h.lastNightAvg;
  }

  for (const s of summaries) {
    const steps = s.movement?.steps?.value;
    if (inRange(s.calendarDate) && steps) day(s.calendarDate).steps = steps;
  }

  const sorted = {};
  for (const date of Object.keys(days).sort()) sorted[date] = days[date];
  return sorted;
}

export function buildDataset(raw, { start, end, generated = new Date().toISOString() }) {
  return { version: DATA_VERSION, generated, start, end, days: buildDays(raw, { start, end }) };
}
