import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoThresholds, levelFor, matchesType } from '../src/metrics.js';
import { parseOptions, renderHeatmap } from '../src/render.js';

const data = {
  version: 1,
  start: '2026-06-01',
  end: '2026-06-14',
  days: {
    '2026-06-01': { activities: { running: { count: 1, distance: 12000, duration: 3600, elevation: 150 } }, sleep: { seconds: 27000, score: 81 }, hrv: 120 },
    '2026-06-02': { activities: { trail_running: { count: 1, distance: 30000, duration: 10800, elevation: 1200 }, cycling: { count: 1, distance: 40000, duration: 5400, elevation: 300 } } },
    '2026-06-03': { sleep: { seconds: 21600 }, hrv: 110 },
  },
};

const cells = (svg) => [...svg.matchAll(/<rect [^>]*data-date="([^"]+)"[^>]*class="level-(\d)"|<rect [^>]*class="level-(\d)"[^>]*data-date="([^"]+)"/g)]
  .map((m) => ({ date: m[1] ?? m[4], level: Number(m[2] ?? m[3]) }));

test('draws one cell per day in range', () => {
  const svg = renderHeatmap(data, { start: '2026-06-01', end: '2026-06-14' });
  assert.equal(cells(svg).length, 14);
  assert.match(svg, /^<svg [^>]*role="img"/);
});

test('defaults to 52 weeks ending on the dataset end', () => {
  const svg = renderHeatmap(data);
  const dates = cells(svg).map((c) => c.date);
  assert.equal(dates.length, 364);
  assert.equal(dates.at(-1), '2026-06-14');
});

test('days before the fetched range are "No data", not rest days', () => {
  const svg = renderHeatmap(data, { start: '2026-05-31', end: '2026-06-01' });
  assert.match(svg, /data-date="2026-05-31"><title>May 31, 2026 · No data<\/title>/);
});

test('filters activities by type, matching subtypes', () => {
  const svg = renderHeatmap(data, { start: '2026-06-01', end: '2026-06-03', types: ['running'] });
  const levels = Object.fromEntries(cells(svg).map((c) => [c.date, c.level]));
  // 12 km: level 3 of [5,10,15,25]; 30 km of trail running (cycling excluded): level 5; rest: 0.
  assert.deepEqual(levels, { '2026-06-01': 3, '2026-06-02': 5, '2026-06-03': 0 });
  assert.match(svg, /\(2 activities\)/);
});

test('counts hard minutes across activities', () => {
  const days = {
    '2026-06-01': { activities: { running: { count: 1, distance: 10000, duration: 3600, elevation: 0, hard: 1800 }, cycling: { count: 1, distance: 0, duration: 3600, elevation: 0, hard: 600 } } },
    '2026-06-02': { activities: { running: { count: 1, distance: 10000, duration: 3600, elevation: 0, hard: 120 } } },
  };
  const svg = renderHeatmap({ start: '2026-06-01', end: '2026-06-07', days }, { metric: 'intensity' });
  const levels = Object.fromEntries(cells(svg).map((c) => [c.date, c.level]));
  // 40 min: level 4 of [5,15,30,45]; 2 min: level 1.
  assert.equal(levels['2026-06-01'], 4);
  assert.equal(levels['2026-06-02'], 1);
  assert.match(svg, /42 min<\/tspan><tspan[^>]*>in zones 4–5 per week<\/tspan><\/text>/);
});

test('writes short durations without hours', () => {
  const svg = renderHeatmap(data, { metric: 'duration', start: '2026-06-01', end: '2026-06-01' });
  assert.match(svg, />&lt;30m<\/text>/);
  assert.match(svg, /Jun 1, 2026 · 1h<\/title>/);
});

test('converts units for imperial', () => {
  const svg = renderHeatmap(data, { start: '2026-06-01', end: '2026-06-01', types: ['running'], units: 'imperial' });
  assert.match(svg, /Jun 1, 2026 · 7\.5 mi/);
});

test('places the first day on its weekday row', () => {
  // 2026-06-03 is a Wednesday: row 2 with Monday first, row 3 with Sunday first.
  const y = (weekStart) => Number(renderHeatmap(data, { start: '2026-06-03', end: '2026-06-03', weekStart, summary: false })
    .match(/<rect x="\d+" y="(\d+)"[^>]*data-date/)[1]);
  assert.equal(y(0) - y(1), 14);
});

test('averages measures over days with readings', () => {
  const svg = renderHeatmap(data, { metric: 'sleep', start: '2026-06-01', end: '2026-06-14' });
  assert.match(svg, /6h 45m<\/tspan><tspan[^>]*>sleep per night<\/tspan><tspan[^>]*>\(2 nights\)/);
});

test('escapes text', () => {
  const svg = renderHeatmap(data, { start: '2026-06-01', end: '2026-06-02', title: '<script>"x"</script>' });
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&lt;script&gt;&quot;x&quot;/);
});

test('rejects bad input', () => {
  assert.throws(() => renderHeatmap(data, { metric: 'vo2max' }), /Unknown metric/);
  assert.throws(() => renderHeatmap(data, { start: '2026-06-10', end: '2026-06-01' }), /after end/);
  assert.throws(() => renderHeatmap(data, { palette: ['#fff'] }), /palette needs 6 colours/);
  assert.throws(() => parseOptions({ thresholds: '1,two' }), /thresholds/);
  assert.throws(() => renderHeatmap(data, { theme: 'sepia' }), /theme must be/);
});

test('parses attribute and flag strings', () => {
  assert.deepEqual(
    parseOptions({ metric: 'hrv', types: 'running, cycling', weeks: '17', 'week-start': 'sunday', thresholds: 'auto', summary: 'false', title: null }),
    { metric: 'hrv', types: ['running', 'cycling'], weeks: 17, weekStart: 0, thresholds: 'auto', summary: false }
  );
  assert.deepEqual(parseOptions({ thresholds: '1,2,3,4' }).thresholds, [1, 2, 3, 4]);
});

test('buckets values', () => {
  assert.equal(levelFor(null, [1, 2, 3, 4]), 0);
  assert.equal(levelFor(0, [1, 2, 3, 4]), 0);
  assert.equal(levelFor(0.5, [1, 2, 3, 4]), 1);
  assert.equal(levelFor(2, [1, 2, 3, 4]), 3);
  assert.equal(levelFor(9, [1, 2, 3, 4]), 5);
  assert.deepEqual(autoThresholds([10, 20, 30, 40, 50, 60, null, 0]), [20, 30, 40, 50]);
  assert.ok(matchesType('trail_running', ['running']));
  assert.ok(!matchesType('cycling', ['running']));
});
