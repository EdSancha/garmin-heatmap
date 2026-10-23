#!/usr/bin/env node
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { buildDataset } from '../src/aggregate.js';
import { planBuild, renderGrids } from '../src/build.js';
import { addDays, today } from '../src/dates.js';
import { SOURCES, createClient, fetchRaw, getAccessToken } from '../src/garmin.js';
import { OPTION_NAMES, parseOptions, renderHeatmap } from '../src/render.js';

const HELP = `garmin-heatmap: Garmin Connect data as GitHub-style activity grids

Usage:
  garmin-heatmap build  --config heatmaps.json --out-dir DIR [--data-out garmin.json]
  garmin-heatmap fetch  [--days 365] [--end YYYY-MM-DD] [--sources ${SOURCES.join(',')}] [--out garmin.json]
  garmin-heatmap render --data garmin.json [--metric distance] [--types running] [--out grid.svg] [options]

build fetches only what the config's enabled grids show and writes one SVG per
grid. fetch writes the dataset (daily totals only: no activity names, IDs or GPS).
Both read your personal API key from GARMIN_API_KEY
(create one at https://connect.garmin.com/app/settings/personalApiToken).

render options: --metric (distance, elevation, duration, activities, sleep,
sleep-score, hrv, steps), --types, --start, --end, --weeks, --week-start,
--units (metric|imperial), --locale, --thresholds (a,b,c,d or auto),
--palette (6 colours), --summary false, --legend false, --noun, --title,
--cell-size, --gap, --radius`;

async function download({ start, end, sources }) {
  const token = await getAccessToken(process.env.GARMIN_API_KEY);
  // GitHub masks the key because it is a secret, but not the token derived from it.
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::add-mask::${token}`);
  const raw = await fetchRaw(createClient({ token }), { start, end, sources });
  return buildDataset(raw, { start, end });
}

async function writeJson(path, dataset) {
  await writeFile(path, `${JSON.stringify(dataset)}\n`);
  console.error(`Wrote ${Object.keys(dataset.days).length} days (${dataset.start} to ${dataset.end}) to ${path}`);
}

async function buildCommand(args) {
  const { values } = parseArgs({
    args,
    options: {
      config: { type: 'string', default: 'heatmaps.json' },
      'out-dir': { type: 'string' },
      'data-out': { type: 'string' },
    },
  });
  if (!values['out-dir']) throw new Error('--out-dir is required');
  const plan = planBuild(JSON.parse(await readFile(values.config, 'utf8')));
  const dir = values['out-dir'];
  await mkdir(dir, { recursive: true });

  let grids = [];
  if (plan.grids.length) {
    const dataset = await download(plan);
    grids = renderGrids(dataset, plan);
    if (values['data-out']) await writeJson(values['data-out'], dataset);
  }
  // Only write once everything rendered, and drop grids that are no longer enabled.
  for (const file of await readdir(dir)) {
    if (file.endsWith('.svg') && !grids.some((g) => `${g.name}.svg` === file)) await rm(join(dir, file));
  }
  for (const { name, svg } of grids) await writeFile(join(dir, `${name}.svg`), `${svg}\n`);
  console.error(`Wrote ${grids.length} grid(s) to ${dir}${plan.sources.length ? ` (sources: ${plan.sources.join(', ')})` : ''}`);
}

async function fetchCommand(args) {
  const { values } = parseArgs({
    args,
    options: {
      days: { type: 'string', default: '365' },
      end: { type: 'string' },
      sources: { type: 'string', default: SOURCES.join(',') },
      out: { type: 'string', default: 'garmin.json' },
    },
  });
  const days = Number(values.days);
  if (!Number.isInteger(days) || days < 1) throw new Error('--days must be a positive whole number');
  const sources = values.sources.split(',').map((s) => s.trim());
  const unknown = sources.filter((s) => !SOURCES.includes(s));
  if (unknown.length) throw new Error(`Unknown source: ${unknown.join(', ')}`);

  const end = values.end ?? today();
  await writeJson(values.out, await download({ start: addDays(end, -(days - 1)), end, sources }));
}

async function renderCommand(args) {
  const options = Object.fromEntries(OPTION_NAMES.map((name) => [name, { type: 'string' }]));
  const { values } = parseArgs({
    args,
    options: { ...options, data: { type: 'string', default: 'garmin.json' }, out: { type: 'string' } },
  });
  const data = JSON.parse(await readFile(values.data, 'utf8'));
  const svg = renderHeatmap(data, parseOptions(values));
  if (values.out) await writeFile(values.out, `${svg}\n`);
  else process.stdout.write(`${svg}\n`);
}

const [command, ...rest] = process.argv.slice(2);
const commands = { build: buildCommand, fetch: fetchCommand, render: renderCommand };

if (!commands[command]) {
  console.log(HELP);
  process.exit(command && !['-h', '--help', 'help'].includes(command) ? 1 : 0);
}

try {
  await commands[command](rest);
} catch (error) {
  console.error(`garmin-heatmap ${command}: ${error.message}`);
  process.exit(1);
}
