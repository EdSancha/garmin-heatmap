// A config file lists the grids a site shows. From it, `planBuild` works out
// the only data worth fetching (sources and date range), and `renderGrids`
// draws each enabled grid. Disabled grids fetch nothing.
//
// {
//   "grids": [
//     { "name": "running", "metric": "distance", "types": ["running"], "noun": "runs" },
//     { "name": "sleep", "metric": "sleep", "weeks": 17, "enabled": false }
//   ]
// }
// Grid keys are `name`, `enabled` and the options in OPTION_NAMES.

import { addDays, today as currentDate } from './dates.js';
import { getMetric } from './metrics.js';
import { DEFAULTS, OPTION_NAMES, parseOptions, renderHeatmap } from './render.js';

const NAME = /^[a-z0-9][a-z0-9-]*$/;

export function planBuild(config, { today = currentDate() } = {}) {
  if (!Array.isArray(config?.grids)) throw new Error('Config needs a "grids" list');
  const names = new Set();
  const grids = [];
  for (const [i, grid] of config.grids.entries()) {
    const where = `grids[${i}]`;
    if (!NAME.test(grid.name ?? '')) throw new Error(`${where}: "name" must be lowercase letters, digits and dashes`);
    if (names.has(grid.name)) throw new Error(`${where}: duplicate name "${grid.name}"`);
    names.add(grid.name);
    const unknown = Object.keys(grid).filter((k) => k !== 'name' && k !== 'enabled' && !OPTION_NAMES.includes(k));
    if (unknown.length) throw new Error(`${where}: unknown key ${unknown.map((k) => `"${k}"`).join(', ')}`);
    if (grid.enabled === false) continue;

    const strings = Object.fromEntries(OPTION_NAMES.map((k) => [k, Array.isArray(grid[k]) ? grid[k].join(',') : grid[k]]));
    const options = parseOptions(strings);
    getMetric(options.metric ?? DEFAULTS.metric);
    grids.push({ name: grid.name, options });
  }

  // Fetch from the earliest day any grid shows to the latest.
  const ends = grids.map((g) => g.options.end ?? today);
  const starts = grids.map((g, i) => g.options.start ?? addDays(ends[i], -((g.options.weeks ?? DEFAULTS.weeks) * 7 - 1)));
  const sources = [...new Set(grids.map((g) => getMetric(g.options.metric ?? DEFAULTS.metric).source))];
  return {
    grids,
    sources,
    start: starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : null,
    end: ends.length ? ends.reduce((a, b) => (a > b ? a : b)) : null,
  };
}

/** Renders every planned grid. All or nothing: throws before returning any SVG. */
export function renderGrids(data, plan) {
  return plan.grids.map(({ name, options }) => ({ name, svg: renderHeatmap(data, options) }));
}
