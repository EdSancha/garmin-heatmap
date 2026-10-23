import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { planBuild, renderGrids } from '../src/build.js';

const sample = JSON.parse(await readFile(new URL('../examples/sample.json', import.meta.url), 'utf8'));

test('fetches only what enabled grids show', () => {
  const plan = planBuild(
    {
      grids: [
        { name: 'running', metric: 'distance', types: ['running'], noun: 'runs' },
        { name: 'climbing', metric: 'elevation', weeks: 17 },
        { name: 'sleep', metric: 'sleep', enabled: false },
        { name: 'hrv', metric: 'hrv', enabled: false },
      ],
    },
    { today: '2026-10-22' }
  );
  assert.deepEqual(plan.sources, ['activities']);
  assert.deepEqual(plan.grids.map((g) => g.name), ['running', 'climbing']);
  assert.equal(plan.end, '2026-10-22');
  assert.equal(plan.start, '2025-10-24'); // 52 weeks, the longest grid
  assert.deepEqual(plan.grids[0].options, { metric: 'distance', types: ['running'], noun: 'runs' });
});

test('turning a grid on adds its source and widens the range', () => {
  const plan = planBuild(
    { grids: [{ name: 'running', weeks: 4 }, { name: 'hrv', metric: 'hrv', start: '2026-01-01', summary: false }] },
    { today: '2026-10-22' }
  );
  assert.deepEqual(plan.sources, ['activities', 'hrv']);
  assert.equal(plan.start, '2026-01-01');
  assert.equal(plan.grids[1].options.summary, false);
});

test('nothing enabled means nothing fetched', () => {
  const plan = planBuild({ grids: [{ name: 'sleep', metric: 'sleep', enabled: false }] });
  assert.deepEqual(plan, { grids: [], sources: [], start: null, end: null });
});

test('rejects config mistakes', () => {
  assert.throws(() => planBuild({}), /"grids" list/);
  assert.throws(() => planBuild({ grids: [{ name: '../x' }] }), /lowercase/);
  assert.throws(() => planBuild({ grids: [{ name: 'a' }, { name: 'a' }] }), /duplicate/);
  assert.throws(() => planBuild({ grids: [{ name: 'a', metrc: 'hrv' }] }), /unknown key "metrc"/);
  assert.throws(() => planBuild({ grids: [{ name: 'a', metric: 'vo2' }] }), /Unknown metric/);
});

test('renders each grid', () => {
  const plan = planBuild({ grids: [{ name: 'running', types: ['running'] }, { name: 'hrv', metric: 'hrv' }] }, { today: sample.end });
  const grids = renderGrids(sample, plan);
  assert.deepEqual(grids.map((g) => g.file), ['running.svg', 'hrv.svg']);
  assert.ok(grids.every((g) => g.svg.startsWith('<svg')));
});

test('renders a standalone image per theme', () => {
  const plan = planBuild({ grids: [{ name: 'running', types: ['running'] }] }, { today: sample.end });
  const grids = renderGrids(sample, plan, { themes: ['light', 'dark'] });
  assert.deepEqual(grids.map((g) => g.file), ['running.svg', 'running-light.svg', 'running-dark.svg']);
  assert.doesNotMatch(grids[0].svg, /style="[^"]*color:#/);
  assert.match(grids[1].svg, /style="[^"]*color:#1f2328;/);
  assert.match(grids[2].svg, /style="[^"]*color:#e6edf3;/);
  assert.match(grids[2].svg, /fill="#21262d"/);
});
