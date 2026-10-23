import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDays } from '../src/aggregate.js';
import { chunkRange } from '../src/dates.js';
import { BASE_URL, TOKEN_PATH, createClient, fetchRaw, getAccessToken } from '../src/garmin.js';

function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ url: u, init });
    const handler = routes.find(([prefix]) => u.pathname.startsWith(prefix))?.[1];
    const { status = 200, body } = handler ? handler(u, calls.length) : { status: 404 };
    return new Response(status === 204 ? null : JSON.stringify(body ?? null), { status, headers: { 'retry-after': '0' } });
  };
  return { fetch, calls };
}

test('exchanges the API key for an access token', async () => {
  const { fetch, calls } = fakeFetch([[TOKEN_PATH, () => ({ body: { access_token: 'tok', expires_in: 86400 } })]]);
  assert.equal(await getAccessToken('key', { fetch }), 'tok');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'ApiKey key');
  assert.equal(calls[0].init.headers.Accept, undefined);
  assert.equal(calls[0].url.origin, BASE_URL);
});

test('accepts a plain-text token', async () => {
  const fetch = async () => new Response('plain-token\n', { status: 200, headers: { 'content-type': 'text/plain' } });
  assert.equal(await getAccessToken('key', { fetch }), 'plain-token');
});

test('fails clearly without a key or with a rejected key', async () => {
  await assert.rejects(getAccessToken(undefined), /Missing/);
  const { fetch } = fakeFetch([[TOKEN_PATH, () => ({ status: 401 })]]);
  await assert.rejects(getAccessToken('bad', { fetch }), /HTTP 401/);
});

test('errors never contain the key or the token', async () => {
  const messages = [];
  const rejected = fakeFetch([[TOKEN_PATH, () => ({ status: 403 })]]);
  await getAccessToken('SECRET-KEY', { fetch: rejected.fetch }).catch((e) => messages.push(e.message, e.stack));
  const failing = fakeFetch([['/x', () => ({ status: 401 })]]);
  await createClient({ token: 'SECRET-TOKEN', fetch: failing.fetch })('/x', { q: 1 }).catch((e) => messages.push(e.message, e.stack));
  assert.equal(messages.length, 4);
  for (const m of messages) assert.doesNotMatch(m, /SECRET/);
});

test('retries rate limits, then gives up', async () => {
  let n = 0;
  const { fetch } = fakeFetch([['/x', () => (++n < 3 ? { status: 429 } : { body: [1] })]]);
  const get = createClient({ token: 't', fetch, sleep: async () => {} });
  assert.deepEqual(await get('/x'), [1]);
  const always = fakeFetch([['/x', () => ({ status: 503 })]]);
  await assert.rejects(createClient({ token: 't', fetch: always.fetch, sleep: async () => {} })('/x'), /HTTP 503/);
  assert.equal(always.calls.length, 4);
});

test('fetches every source in chunks and aggregates per day', async () => {
  const { fetch, calls } = fakeFetch([
    ['/activitylist-service', (u) => ({
      body: u.searchParams.get('start') === '0'
        ? [
            { startTimeLocal: '2026-01-05 07:00:00', activityType: { typeKey: 'running' }, distance: 10000.4, duration: 3000, elevationGain: 50, hrTimeInZone_4: 600, hrTimeInZone_5: 120.4, startLatitude: 40.1, activityName: 'Secret' },
            { startTimeLocal: '2026-01-05 18:00:00', activityType: { typeKey: 'running' }, distance: 5000, duration: 1500, elevationGain: 20 },
          ]
        : [],
    })],
    ['/sleep-service', (u) => ({ body: u.searchParams.get('startDate') === '2026-01-01' ? [{ calendarDate: '2026-01-05', sleepTimeSeconds: 28800, sleepScores: { overall: { value: 88 } } }] : [] })],
    ['/hrv-service', () => ({ status: 204 })],
    ['/usersummary-service', () => ({ body: { data: [{ calendarDate: '2026-01-06', movement: { steps: { value: 12000 } } }] } })],
  ]);
  const get = createClient({ token: 'tok', fetch });
  const raw = await fetchRaw(get, { start: '2026-01-01', end: '2026-03-01' });
  const days = buildDays(raw, { start: '2026-01-01', end: '2026-03-01' });

  assert.deepEqual(days, {
    '2026-01-05': { activities: { running: { count: 2, distance: 15000, duration: 4500, elevation: 70, hard: 720 } }, sleep: { seconds: 28800, score: 88 } },
    '2026-01-06': { steps: 12000 },
  });
  assert.ok(calls.every((c) => c.init.headers.Authorization === 'Bearer tok'));
  // 60 days: two 31-day chunks each for sleep and HRV.
  assert.equal(calls.filter((c) => c.url.pathname.startsWith('/sleep-service')).length, 2);
  assert.equal(calls.filter((c) => c.url.pathname.startsWith('/hrv-service')).length, 2);
  assert.ok(calls.some((c) => c.url.pathname === '/hrv-service/hrv/daily/2026-02-01/2026-03-01'));
});

test('chunks date ranges', () => {
  assert.deepEqual(chunkRange('2026-01-01', '2026-01-10', 4), [
    ['2026-01-01', '2026-01-04'],
    ['2026-01-05', '2026-01-08'],
    ['2026-01-09', '2026-01-10'],
  ]);
});
