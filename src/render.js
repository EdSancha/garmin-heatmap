// Renders one metric as a GitHub-style contribution grid, as an SVG string.
// Pure and DOM-free: the same code runs in Node (static SVG) and in the
// browser (the <garmin-heatmap> element).

import { addDays, dateRange, today, weekday } from './dates.js';
import { DARK_PALETTES, PALETTES, METRICS, THEME_TEXT, autoThresholds, formatValue, getMetric, levelFor } from './metrics.js';

export const DEFAULTS = {
  metric: 'distance',
  weeks: 52,
  weekStart: 1, // Monday
  units: 'metric',
  locale: 'en',
  cellSize: 11,
  gap: 3,
  radius: 2,
  summary: true,
  legend: true,
};

const LABEL_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const LABEL_SIZE = 10;
const CHAR_WIDTH = LABEL_SIZE * 0.6; // monospace advance width
const DAY_LABEL_WIDTH = 32;
const MONTH_LABEL_HEIGHT = 16;
const SUMMARY_HEIGHT = 40;
const LEGEND_HEIGHT = 24;

/**
 * @param {object} data    Dataset written by `garmin-heatmap fetch`.
 * @param {object} options See DEFAULTS, plus start, end, types, thresholds, palette, noun, title.
 * @returns {string} SVG markup
 */
export function renderHeatmap(data, options = {}) {
  const o = { ...DEFAULTS, ...stripUndefined(options) };
  const metric = getMetric(o.metric);
  const days = data?.days ?? {};

  const end = o.end ?? data?.end ?? Object.keys(days).at(-1) ?? today();
  const start = o.start ?? addDays(end, -(o.weeks * 7 - 1));
  if (start > end) throw new Error(`start (${start}) is after end (${end})`);
  const dates = dateRange(start, end);

  // Days outside the fetched range have no data, rather than being rest days.
  const covered = (d) => (!data?.start || d >= data.start) && (!data?.end || d <= data.end);
  const values = dates.map((d) => (covered(d) ? metric.value(days[d], o) : null));

  const requested = o.thresholds ?? metric.thresholds(o);
  const thresholds = requested === 'auto' ? autoThresholds(values) : requested;
  if (o.theme && !THEME_TEXT[o.theme]) throw new Error(`theme must be "light" or "dark", got "${o.theme}"`);
  const palette = o.palette ?? (o.theme === 'dark' ? DARK_PALETTES : PALETTES)[metric.palette];
  // Without a theme, text uses currentColor and follows the page it is inlined in.
  const textColor = o.theme ? `color:${THEME_TEXT[o.theme]};` : '';
  if (palette.length !== thresholds.length + 2) {
    throw new Error(`palette needs ${thresholds.length + 2} colours (rest + ${thresholds.length + 1} levels), got ${palette.length}`);
  }

  // Geometry: one column per week, one row per weekday.
  const step = o.cellSize + o.gap;
  const firstRow = (weekday(start) - o.weekStart + 7) % 7;
  const columns = Math.floor((firstRow + dates.length - 1) / 7) + 1;
  const gridLeft = DAY_LABEL_WIDTH;
  const gridTop = (o.summary ? SUMMARY_HEIGHT : 0) + MONTH_LABEL_HEIGHT;
  const gridHeight = 7 * step - o.gap;
  const width = gridLeft + columns * step - o.gap;
  const height = gridTop + gridHeight + (o.legend ? LEGEND_HEIGHT : 0);

  const dateFormat = new Intl.DateTimeFormat(o.locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const summary = summarize(metric, dates, values, days, o);
  const title = o.title ?? `${metric.label}, ${dateFormat.format(new Date(start))} – ${dateFormat.format(new Date(end))}`;
  const label = summary ? `${title}: ${summary.value} ${summary.caption}` : title;

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" class="garmin-heatmap" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"` +
      ` role="img" aria-label="${esc(label)}"` +
      ` style="max-width:100%;height:auto;${textColor}font-family:var(--garmin-heatmap-font, system-ui, sans-serif)">`,
    `<title>${esc(label)}</title>`
  );

  if (summary) {
    parts.push(
      `<text x="0" y="26" fill="currentColor">` +
        `<tspan font-size="24" font-weight="700">${esc(summary.value)}</tspan>` +
        `<tspan dx="8" font-size="12" opacity="0.7">${esc(summary.caption)}</tspan>` +
        (summary.detail ? `<tspan dx="4" font-size="10" opacity="0.5">${esc(summary.detail)}</tspan>` : '') +
        `</text>`
    );
  }

  parts.push(`<g font-family="${LABEL_FONT}" font-size="${LABEL_SIZE}" fill="currentColor" opacity="0.55">`);
  for (const { column, text } of monthLabels(dates, firstRow, o.locale)) {
    parts.push(`<text x="${gridLeft + column * step}" y="${gridTop - 5}">${esc(text)}</text>`);
  }
  for (const { row, text } of dayLabels(o.weekStart, o.locale)) {
    parts.push(`<text x="0" y="${gridTop + row * step + o.cellSize - 2}">${esc(text)}</text>`);
  }
  parts.push('</g>');

  parts.push('<g>');
  dates.forEach((date, i) => {
    const index = firstRow + i;
    const x = gridLeft + Math.floor(index / 7) * step;
    const y = gridTop + (index % 7) * step;
    const value = values[i];
    const level = levelFor(value, thresholds);
    const shown = value == null ? 'No data' : value <= 0 ? 'Rest' : formatValue(metric, value, o);
    parts.push(
      `<rect x="${x}" y="${y}" width="${o.cellSize}" height="${o.cellSize}" rx="${o.radius}"` +
        ` fill="${esc(palette[level])}" class="level-${level}" data-date="${date}"` +
        (value == null ? '' : ` data-value="${round(value)}"`) +
        `><title>${esc(`${dateFormat.format(new Date(date))} · ${shown}`)}</title></rect>`
    );
  });
  parts.push('</g>');

  if (o.legend) parts.push(legend(metric, thresholds, palette, o, gridTop + gridHeight + 10));

  parts.push('</svg>');
  return parts.join('');
}

function summarize(metric, dates, values, days, o) {
  if (!o.summary) return null;
  const present = values.filter((v) => v != null);
  if (metric.summary === 'week') {
    const weeks = Math.max(present.length, 1) / 7;
    const total = present.reduce((sum, v) => sum + v, 0);
    const summary = { value: formatValue(metric, total / weeks, o), caption: metric.caption ?? 'per week' };
    if (metric !== METRICS.activities && metric.countDetail !== false) {
      const count = dates.reduce((n, d) => n + METRICS.activities.value(days[d], o), 0);
      summary.detail = `(${count} ${o.noun ?? 'activities'})`;
    }
    return summary;
  }
  const readings = present.filter((v) => v > 0);
  const average = readings.reduce((sum, v) => sum + v, 0) / Math.max(readings.length, 1);
  return {
    value: readings.length ? formatValue(metric, average, o) : '–',
    caption: metric.caption,
    detail: `(${readings.length} ${o.noun ?? metric.count})`,
  };
}

function monthLabels(dates, firstRow, locale) {
  const format = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
  const labels = [];
  dates.forEach((date, i) => {
    if (date.endsWith('-01')) labels.push({ column: Math.floor((firstRow + i) / 7), text: format.format(new Date(date)) });
  });
  // Label the first column too, unless the next label would crowd it.
  if (!labels.length || labels[0].column >= 3) labels.unshift({ column: 0, text: format.format(new Date(dates[0])) });
  return labels;
}

function dayLabels(weekStart, locale) {
  const format = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  // Monday, Wednesday, Friday, like GitHub. 2023-12-31 was a Sunday.
  return [1, 3, 5].map((dow) => ({
    row: (dow - weekStart + 7) % 7,
    text: format.format(new Date(addDays('2023-12-31', dow))),
  }));
}

function legend(metric, thresholds, palette, o, y) {
  const size = o.cellSize;
  const number = (v) => (metric.format ? metric.format(v) : new Intl.NumberFormat(o.locale, { maximumFractionDigits: metric.decimals ?? 1 }).format(v));
  const unit = metric.format ? '' : metric.unit?.(o) ?? '';
  const parts = [`<g font-family="${LABEL_FONT}" font-size="${LABEL_SIZE}">`];
  let x = 0;
  const text = (t) => {
    parts.push(`<text x="${x}" y="${y + size - 2}" fill="currentColor" opacity="0.55">${esc(t)}</text>`);
    x += t.length * CHAR_WIDTH + 5;
  };
  const box = (level) => {
    parts.push(`<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${o.radius}" fill="${esc(palette[level])}" class="level-${level}"/>`);
    x += size + 3;
  };
  if (metric.kind === 'activity') {
    text('Rest');
    box(0);
    x += 6;
  }
  text(`<${number(thresholds[0])}`);
  for (let level = 1; level < palette.length; level++) box(level);
  x += 2;
  text(`${number(thresholds.at(-1))}+${unit ? ` ${unit}` : ''}`);
  parts.push('</g>');
  return parts.join('');
}

/** Option names as HTML attributes, CLI flags and config keys use them. */
export const OPTION_NAMES = [
  'metric', 'types', 'start', 'end', 'weeks', 'week-start', 'units', 'locale', 'thresholds',
  'palette', 'theme', 'summary', 'legend', 'noun', 'title', 'cell-size', 'gap', 'radius',
];

/** Reads options from strings keyed by OPTION_NAMES. */
export function parseOptions(input) {
  const get = (key) => {
    const v = input[key];
    return v == null || v === '' ? undefined : String(v).trim();
  };
  const list = (key) => get(key)?.split(',').map((s) => s.trim()).filter(Boolean);
  const number = (key) => {
    const v = get(key);
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`${key} must be a number, got "${v}"`);
    return n;
  };
  const flag = (key) => (get(key) === undefined ? undefined : get(key) !== 'false');
  const weekStart = get('week-start');
  const thresholds = get('thresholds');
  if (thresholds && thresholds !== 'auto' && thresholds.split(',').some((t) => !Number.isFinite(Number(t)))) {
    throw new Error(`thresholds must be "auto" or comma-separated numbers, got "${thresholds}"`);
  }
  return stripUndefined({
    metric: get('metric'),
    types: list('types'),
    start: get('start'),
    end: get('end'),
    weeks: number('weeks'),
    weekStart: weekStart === undefined ? undefined : weekStart === 'sunday' ? 0 : weekStart === 'monday' ? 1 : number('week-start'),
    units: get('units'),
    locale: get('locale'),
    thresholds: thresholds === 'auto' ? 'auto' : thresholds?.split(',').map(Number),
    palette: list('palette'),
    theme: get('theme'),
    summary: flag('summary'),
    legend: flag('legend'),
    noun: get('noun'),
    title: get('title'),
    cellSize: number('cell-size'),
    gap: number('gap'),
    radius: number('radius'),
  });
}

function stripUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
