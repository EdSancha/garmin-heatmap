// Writes examples/sample.json: a made-up year of training, sleep and HRV in
// the dataset format, so the examples and tests run without a Garmin key.
// Deterministic (seeded), so the file only changes when this script does.
import { writeFile } from 'node:fs/promises';
import { addDays, dateRange, weekday } from '../src/dates.js';

let seed = 42;
const random = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const between = (min, max) => min + random() * (max - min);

const end = '2026-09-30';
const start = addDays(end, -364);
const days = {};

for (const date of dateRange(start, end)) {
  const day = {};
  const dow = weekday(date);
  if (dow !== 1 && random() < 0.85) {
    const long = dow === 0;
    const distance = Math.round((long ? between(18, 30) : between(6, 14)) * 1000);
    const type = random() < 0.2 ? 'trail_running' : 'running';
    day.activities = {
      [type]: {
        count: 1,
        distance,
        duration: Math.round(distance * between(0.28, 0.34)),
        elevation: Math.round(distance * (type === 'trail_running' ? between(0.03, 0.06) : between(0.002, 0.012))),
      },
    };
  }
  if (random() < 0.95) day.sleep = { seconds: Math.round(between(5.8, 8.6) * 3600), score: Math.round(between(55, 95)) };
  if (random() < 0.95) day.hrv = Math.round(between(105, 140));
  day.steps = Math.round(between(6000, 22000));
  days[date] = day;
}

const dataset = { version: 1, generated: `${end}T06:00:00.000Z`, start, end, days };
await writeFile(new URL('../examples/sample.json', import.meta.url), `${JSON.stringify(dataset)}\n`);
