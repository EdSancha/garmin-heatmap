// Client for the Garmin Connect Personal API (pull-only, your own data).
// Docs: https://developer.garmin.com/gc-developer-program/personal/personal-api/
// Endpoints: https://developer.garmin.com/gc-developer-program/personal/swagger-docs/

import { chunkRange } from './dates.js';

export const BASE_URL = 'https://personal.connectapi.garmin.com';
export const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';

export const SOURCES = ['activities', 'sleep', 'hrv', 'steps'];

export class GarminError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GarminError';
    this.status = status;
  }
}

/**
 * Exchanges a personal API key for an access token (valid 24 hours, no
 * refresh tokens, so request a new one on every run).
 */
export async function getAccessToken(apiKey, { fetch = globalThis.fetch, baseUrl = BASE_URL } = {}) {
  if (!apiKey) throw new GarminError('Missing Garmin personal API key');
  // No Accept header: the endpoint answers `Accept: application/json` with
  // HTTP 406. Garmin's own example sends none.
  const res = await fetch(baseUrl + TOKEN_PATH, {
    method: 'POST',
    headers: { Authorization: `ApiKey ${apiKey}` },
  });
  if (!res.ok) throw new GarminError(`Token request failed with HTTP ${res.status}`, res.status);
  // The docs don't specify the response body, so accept the usual shapes.
  const text = (await res.text()).trim();
  let token;
  try {
    const body = JSON.parse(text);
    token = typeof body === 'string' ? body : body.access_token ?? body.accessToken ?? body.token;
  } catch {
    token = text;
  }
  if (!token) throw new GarminError('Token response did not contain an access token');
  return token;
}

/** Returns `get(path, params)`, which retries rate limits and server errors. */
export function createClient({
  token,
  fetch = globalThis.fetch,
  baseUrl = BASE_URL,
  retries = 3,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  return async function get(path, params = {}) {
    const url = new URL(path, baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value != null) url.searchParams.set(key, value);
    }
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (res.status === 204) return null;
      if (res.ok) return res.json();
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      throw new GarminError(`GET ${url.pathname} failed with HTTP ${res.status}`, res.status);
    }
  };
}

export async function fetchActivities(get, start, end) {
  const limit = 100;
  const all = [];
  // Page until an empty page, in case the server caps `limit` below ours.
  for (let offset = 0; ; offset += limit) {
    const page = await get('/activitylist-service/activities/search/activities', {
      startDate: start,
      endDate: end,
      start: offset,
      limit,
      sortOrder: 'asc',
    });
    if (!page?.length) return all;
    all.push(...page);
  }
}

export async function fetchSleep(get, start, end) {
  const all = [];
  // Documented maximum: 31 days per request.
  for (const [s, e] of chunkRange(start, end, 31)) {
    const rows = await get('/sleep-service/sleep/dailySleepSummariesByDate', { startDate: s, endDate: e });
    if (rows) all.push(...rows);
  }
  return all;
}

export async function fetchHrv(get, start, end) {
  const all = [];
  // No documented maximum; 31 days matches the sleep endpoint.
  for (const [s, e] of chunkRange(start, end, 31)) {
    const body = await get(`/hrv-service/hrv/daily/${s}/${e}`);
    if (body?.hrvSummaries) all.push(...body.hrvSummaries);
  }
  return all;
}

export async function fetchDailySummaries(get, start, end) {
  const all = [];
  // Documented maximum: one year per request.
  for (const [s, e] of chunkRange(start, end, 365)) {
    const body = await get('/usersummary-service/v2/dailysummaries', { startDate: s, endDate: e });
    if (body?.data) all.push(...body.data);
  }
  return all;
}

/** Pulls the raw records each source needs, for `buildDays`. */
export async function fetchRaw(get, { start, end, sources = SOURCES }) {
  const raw = {};
  if (sources.includes('activities')) raw.activities = await fetchActivities(get, start, end);
  if (sources.includes('sleep')) raw.sleep = await fetchSleep(get, start, end);
  if (sources.includes('hrv')) raw.hrv = await fetchHrv(get, start, end);
  if (sources.includes('steps')) raw.summaries = await fetchDailySummaries(get, start, end);
  return raw;
}
