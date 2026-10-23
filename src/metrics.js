// What each heatmap can show: how to read a value from a day record,
// its unit, the default colour buckets and the headline summary.

const METRES_PER_MILE = 1609.344;
const METRES_PER_FOOT = 0.3048;

// Six colours: index 0 is a rest day or no data, 1–5 are the buckets.
export const PALETTES = {
  green: ['#ebedf0', '#c6e8c3', '#8fd18b', '#56a85f', '#2f7d3e', '#1d4d28'],
  orange: ['#ebedf0', '#fbe1cc', '#f3bf92', '#e2955a', '#c2652d', '#843c15'],
  purple: ['#ebedf0', '#e0daf7', '#bdb0ee', '#9483de', '#6a53c7', '#45309a'],
  blue: ['#ebedf0', '#d6e5fa', '#a6c4f0', '#6c9de2', '#3c70c6', '#1f3f86'],
};

/** Does Garmin type key `key` match the requested `types`? "running" also matches "trail_running". */
export function matchesType(key, types) {
  return !types?.length || types.some((t) => key === t || key.includes(t));
}

function sumActivities(day, types, field) {
  let total = 0;
  for (const [key, a] of Object.entries(day?.activities ?? {})) {
    if (matchesType(key, types)) total += field === 'count' ? a.count : a[field] ?? 0;
  }
  return total;
}

const imperial = (o) => o.units === 'imperial';

function hoursAndMinutes(hours) {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// source: the Personal API data the metric needs (see SOURCES in garmin.js).
// kind "activity": a day without activity is a rest day (value 0).
// kind "measure": a day without a reading has no value (null).
// summary "week": total per week. summary "day": average over days with data.
export const METRICS = {
  distance: {
    source: 'activities',
    kind: 'activity',
    label: 'Distance',
    value: (day, o) => sumActivities(day, o.types, 'distance') / (imperial(o) ? METRES_PER_MILE : 1000),
    unit: (o) => (imperial(o) ? 'mi' : 'km'),
    decimals: 1,
    thresholds: (o) => (imperial(o) ? [3, 6, 10, 15] : [5, 10, 15, 25]),
    summary: 'week',
    palette: 'green',
  },
  elevation: {
    source: 'activities',
    kind: 'activity',
    label: 'Elevation gain',
    value: (day, o) => sumActivities(day, o.types, 'elevation') / (imperial(o) ? METRES_PER_FOOT : 1),
    unit: (o) => (imperial(o) ? 'ft' : 'm'),
    decimals: 0,
    thresholds: (o) => (imperial(o) ? [300, 1000, 2000, 3000] : [100, 300, 600, 1000]),
    summary: 'week',
    caption: 'climbed per week',
    palette: 'orange',
  },
  duration: {
    source: 'activities',
    kind: 'activity',
    label: 'Training time',
    value: (day, o) => sumActivities(day, o.types, 'duration') / 3600,
    format: hoursAndMinutes,
    thresholds: () => [0.5, 1, 1.5, 2],
    summary: 'week',
    palette: 'green',
  },
  activities: {
    source: 'activities',
    kind: 'activity',
    label: 'Activities',
    value: (day, o) => sumActivities(day, o.types, 'count'),
    decimals: 0,
    thresholds: () => [2, 3, 4, 5],
    summary: 'week',
    caption: 'activities per week',
    palette: 'green',
  },
  sleep: {
    source: 'sleep',
    kind: 'measure',
    label: 'Sleep',
    value: (day) => (day?.sleep?.seconds ? day.sleep.seconds / 3600 : null),
    format: hoursAndMinutes,
    thresholds: () => [6, 7, 7.5, 8],
    summary: 'day',
    caption: 'sleep per night',
    count: 'nights',
    palette: 'purple',
  },
  'sleep-score': {
    source: 'sleep',
    kind: 'measure',
    label: 'Sleep score',
    value: (day) => day?.sleep?.score ?? null,
    decimals: 0,
    thresholds: () => [60, 70, 80, 90],
    summary: 'day',
    caption: 'average sleep score',
    count: 'nights',
    palette: 'purple',
  },
  hrv: {
    source: 'hrv',
    kind: 'measure',
    label: 'Overnight HRV',
    value: (day) => day?.hrv ?? null,
    unit: () => 'ms',
    decimals: 0,
    // HRV is personal, so the buckets follow your own range by default.
    thresholds: () => 'auto',
    summary: 'day',
    caption: 'overnight HRV',
    count: 'nights',
    palette: 'blue',
  },
  steps: {
    source: 'steps',
    kind: 'measure',
    label: 'Steps',
    value: (day) => day?.steps ?? null,
    decimals: 0,
    thresholds: () => [5000, 7500, 10000, 15000],
    summary: 'day',
    caption: 'steps per day',
    count: 'days',
    palette: 'green',
  },
};

export function getMetric(name) {
  const metric = METRICS[name];
  if (!metric) throw new Error(`Unknown metric "${name}". Use one of: ${Object.keys(METRICS).join(', ')}`);
  return metric;
}

/** Formats a value with its unit, e.g. "12.3 km", "7h 30m", "10,412". */
export function formatValue(metric, value, options) {
  if (metric.format) return metric.format(value);
  const number = new Intl.NumberFormat(options.locale, { maximumFractionDigits: metric.decimals ?? 1 }).format(value);
  const unit = metric.unit?.(options);
  return unit ? `${number} ${unit}` : number;
}

/** Four cut points from the 20th, 40th, 60th and 80th percentiles of the values present. */
export function autoThresholds(values) {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length < 5) return [1, 2, 3, 4];
  return [0.2, 0.4, 0.6, 0.8].map((q) => sorted[Math.floor(q * (sorted.length - 1))]);
}

/** 0 for rest or no data, otherwise 1 + the number of cut points at or below the value. */
export function levelFor(value, thresholds) {
  if (value == null || value <= 0) return 0;
  let level = 1;
  for (const cut of thresholds) if (value >= cut) level++;
  return level;
}
