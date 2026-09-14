import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createVercelApp, signToken, verifyToken } from '../server/vercel/app.js';
import { LUA, RedisRest, StoreError, VercelStore } from '../server/vercel/store.js';
import { createSeededEngine, REPLAY_STEP } from '../shared/replay.js';
import { FakeRedis } from './support/fake-redis.js';

const SECRET = 'isolated-test-secret-at-least-thirty-two-characters';
const PASSWORD = 'isolated-test-organizer-password';
async function fixture(t, options = {}) {
  const clock = options.clock || { time: Date.now() };
  const now = () => clock.time;
  const redis = options.redis || new FakeRedis({ now });
  const store = new VercelStore(new RedisRest({ url: 'https://redis.test', token: 'test-token', fetchImpl: redis.fetch }), { now, prefix: '{isolated-test}:v1' });
  const app = createVercelApp({ env: {}, store, secret: SECRET, adminPassword: PASSWORD, now, logger: { error() {} }, ...options.app });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => server.close(resolve)));
  async function request(jar, endpoint, body, headers = {}) {
    const response = await fetch(base + endpoint, { method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; '), Origin: base, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    for (const cookie of response.headers.getSetCookie()) { const [key, value] = cookie.split(';')[0].split('='); if (value) jar.set(key, value); else jar.delete(key); }
    return response;
  }
  async function visitor() { const jar = new Map(); const response = await request(jar, '/api/session'); return { jar, response, state: await response.json() }; }
  async function start(jar) { const response = await request(jar, '/api/round/start', {}); assert.equal(response.status, 200); return response.json(); }
  async function login(jar) { const response = await request(jar, '/api/admin/login', { password: PASSWORD }); assert.equal(response.status, 200); return response.json(); }
  return { redis, store, clock, now, base, request, visitor, start, login };
}
function play(round) {
  const engine = createSeededEngine(round); engine.command({ type: 'start' });
  let ticks = 0;
  while (engine.state.phase !== 'results' && ticks < 4000) { engine.tick(REPLAY_STEP); ticks += 1; }
  assert.equal(engine.state.phase, 'results');
  return { name: 'Player', ticket: round.ticket, commands: [], ticks, expected: engine.snapshot().result };
}
function entry(index, score = index) {
  return { id: `entry-${index}`, roundId: `round-${index}`, name: index === 1 ? '=SUM(1,2)' : `Player ${index}`, finalScore: score, priorityScore: score,
    criticalBonus: 0, efficiencyBonus: 0, survivalBonus: 0, storageRemaining: 10, buildingsSaved: 1, criticalSaved: 0, criticalLost: 0,
    survivalTime: 60, difficulty: 'normal', survived: true, createdAt: new Date(1700000000000 + index).toISOString() };
}

test('Vercel sessions are signed, browser-bound, and work across independent function instances', async (t) => {
  const f = await fixture(t); const a = await f.visitor(); const b = await f.visitor();
  assert.equal(a.response.status, 200); assert.deepEqual(a.state.hosting, { mode: 'online', transport: 'replay', admin: false });
  assert.match(a.response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.notEqual(a.jar.get('last_light_visitor'), b.jar.get('last_light_visitor'));
  const second = await fixture(t, { redis: f.redis, clock: f.clock });
  assert.equal((await second.request(a.jar, '/api/status')).status, 200);
  const round = await f.start(a.jar); const tape = play(round); f.clock.time += tape.ticks * 50;
  assert.equal((await f.request(b.jar, '/api/leaderboard', tape)).status, 410);
  const damaged = new Map(a.jar); damaged.set('last_light_visitor', `${a.jar.get('last_light_visitor')}x`);
  assert.equal((await f.request(damaged, '/api/status')).status, 401);
  assert.equal((await second.request(a.jar, '/api/leaderboard', tape)).status, 201);
});

test('only canonical replay metrics are saved and concurrent duplicate claims save exactly once', async (t) => {
  const f = await fixture(t); const a = await f.visitor(); const second = await fixture(t, { redis: f.redis, clock: f.clock });
  const tape = play(await f.start(a.jar)); f.clock.time += tape.ticks * 50;
  const results = await Promise.all([f.request(a.jar, '/api/leaderboard', { ...tape, score: 99999999, finalScore: 99999999 }), second.request(a.jar, '/api/leaderboard', tape)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const saved = await results.find((r) => r.status === 201).json();
  assert.equal(saved.entry.finalScore, tape.expected.score.total); assert.deepEqual(saved.result.decisionReport, tape.expected.decisionReport);
  const view = await f.store.view(); assert.equal(view.event.submissionCount, 1); assert.equal(view.leaderboard.length, 1);
});

test('tickets reject tampering, outdated builds, expiration, early completion, and invalid control logs', async (t) => {
  const f = await fixture(t); const a = await f.visitor(); const round = await f.start(a.jar); const tape = play(round);
  assert.equal((await f.request(a.jar, '/api/leaderboard', tape)).status, 409);
  assert.equal((await f.request(a.jar, '/api/leaderboard', { ...tape, ticket: `${tape.ticket}x` })).status, 410);
  f.clock.time += tape.ticks * 50;
  assert.equal((await f.request(a.jar, '/api/leaderboard', { ...tape, commands: [{ tick: 0, command: { type: 'debug', action: 'storage', value: 100 } }] })).status, 400);
  assert.equal((await f.request(a.jar, '/api/leaderboard', { ...tape, ticks: tape.ticks + 1 })).status, 400);
  const updated = await fixture(t, { redis: f.redis, clock: f.clock, app: { buildId: 'new-deployment' } });
  assert.equal((await updated.request(a.jar, '/api/leaderboard', tape)).status, 410);
  f.clock.time += 600000;
  assert.equal((await f.request(a.jar, '/api/leaderboard', tape)).status, 410);
});

test('organizer endpoints require signed login, bind to visitor, and copied credentials are revoked at logout', async (t) => {
  const f = await fixture(t); const a = await f.visitor(); const b = await f.visitor();
  for (const endpoint of ['/api/event/history', '/api/leaderboard/export.csv', '/api/config', '/api/serial/ports']) assert.equal((await f.request(a.jar, endpoint)).status, 403);
  for (const endpoint of ['/api/event/settings', '/api/event/new']) assert.equal((await f.request(a.jar, endpoint, {})).status, 403);
  assert.equal((await f.request(a.jar, '/api/admin/login', { password: 'wrong' })).status, 401);
  assert.equal((await f.login(a.jar)).hosting.admin, true);
  const copied = new Map(a.jar); b.jar.set('last_light_organizer', a.jar.get('last_light_organizer'));
  assert.equal((await f.request(b.jar, '/api/event/history')).status, 403);
  assert.equal((await f.request(a.jar, '/api/event/settings', { roundDuration: 90, difficulty: 'hard' })).status, 200);
  assert.equal((await f.request(a.jar, '/api/serial/ports')).status, 200);
  assert.equal((await f.request(a.jar, '/api/admin/logout', {})).status, 200);
  assert.equal((await f.request(copied, '/api/event/history')).status, 403);
});

test('durable login rates survive function replacement and expire without unbounded identity insertion', async (t) => {
  const f = await fixture(t); const a = await f.visitor();
  for (let i = 0; i < 5; i += 1) assert.equal((await f.request(a.jar, '/api/admin/login', { password: 'wrong' })).status, 401);
  const second = await fixture(t, { redis: f.redis, clock: f.clock });
  assert.equal((await second.request(a.jar, '/api/admin/login', { password: PASSWORD })).status, 429);
  f.clock.time += 61000; assert.equal((await f.login(a.jar)).hosting.admin, true);
  for (let i = 0; i < 6; i += 1) await f.store.rate('bounded-test', `ip-${i}`, 2, 1);
  const identityKeys = [...f.redis.values.keys()].filter((key) => key.includes('rate:bounded-test:ip-'));
  assert.equal(identityKeys.length, 2);
});

test('partial event setting updates use CAS, preserve concurrent changes, and affect new signed rounds', async (t) => {
  const f = await fixture(t); const a = await f.visitor(); await f.login(a.jar);
  const second = await fixture(t, { redis: f.redis, clock: f.clock });
  const responses = await Promise.all([f.request(a.jar, '/api/event/settings', { difficulty: 'hard' }), second.request(a.jar, '/api/event/settings', { roundDuration: 90 })]);
  assert.ok(responses.every((r) => r.status === 200));
  const view = await f.store.view(); assert.equal(view.settings.difficulty, 'hard'); assert.equal(view.settings.roundDuration, 90);
  const round = await f.start(a.jar); assert.equal(round.config.DIFFICULTY, 'hard'); assert.equal(round.config.ROUND_DURATION, 90);
  assert.equal((await f.request(a.jar, '/api/event/settings', { roundDuration: 1 })).status, 400);
  assert.equal((await f.request(a.jar, '/api/event/settings', { arbitrary: true })).status, 400);
});

test('new events atomically archive every score, invalidate old tickets, and preserve CSV escaping', async (t) => {
  const f = await fixture(t); const a = await f.visitor(); await f.login(a.jar); const tape = play(await f.start(a.jar));
  const old = await f.store.view();
  await Promise.all(Array.from({ length: 13 }, (_, index) => f.store.submit(old.event.id, entry(index))));
  const view = await f.store.view(); assert.equal(view.event.submissionCount, 13); assert.equal(view.leaderboard.length, 10); assert.equal(view.leaderboard[0].finalScore, 12);
  const exported = await f.request(a.jar, '/api/leaderboard/export.csv'); const csv = await exported.text();
  assert.equal(csv.trim().split('\r\n').length, 14); assert.ok(csv.includes('"\'=SUM(1,2)"'));
  f.clock.time += tape.ticks * 50;
  const response = await f.request(a.jar, '/api/event/new', { name: 'Next event' }); assert.equal(response.status, 201);
  const next = await response.json(); assert.equal(next.event.submissionCount, 0); assert.equal(next.previousEvent.submissionCount, 13);
  assert.equal((await f.request(a.jar, '/api/leaderboard', tape)).status, 410);
  const history = await (await f.request(a.jar, '/api/event/history')).json(); assert.equal(history.events.length, 1);
  const archived = await (await f.request(a.jar, `/api/event/${old.event.id}/export.csv`)).text(); assert.equal(archived, csv);
  assert.equal((await f.store.archive(old.event.id)).entries.length, 13);
});

test('a failed archival storage operation preserves the current event and all scores', async (t) => {
  const f = await fixture(t); const a = await f.visitor(); await f.login(a.jar); const old = await f.store.view(); await f.store.submit(old.event.id, entry(1));
  f.redis.failScript = LUA.newEvent;
  assert.equal((await f.request(a.jar, '/api/event/new', { name: 'Must not replace current event' })).status, 503);
  f.redis.failScript = null;
  const view = await f.store.view(); assert.equal(view.event.id, old.event.id); assert.equal(view.event.submissionCount, 1); assert.equal((await f.store.history()).length, 0);
});

test('same-origin and payload checks reject cross-site writes and oversized organizer requests', async (t) => {
  const f = await fixture(t); const a = await f.visitor();
  assert.equal((await f.request(a.jar, '/api/round/start', {}, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.request(a.jar, '/api/round/start', {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await f.request(a.jar, '/api/admin/login', { password: 'x'.repeat(3000) })).status, 413);
  assert.equal((await f.request(a.jar, '/api/leaderboard', { commands: 'x'.repeat(270000) })).status, 413);
  const withoutOrigin = await fetch(f.base + '/api/round/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(withoutOrigin.status, 403);
});

test('missing secrets, short organizer passwords, and unavailable durable storage fail closed', async (t) => {
  const badSecret = await fixture(t, { app: { secret: '' } }); assert.equal((await badSecret.visitor()).response.status, 503);
  const badPassword = await fixture(t, { app: { adminPassword: 'too-short' } }); assert.equal((await badPassword.visitor()).response.status, 503);
  const noStore = await fixture(t, { app: { store: undefined } }); const missing = await noStore.visitor(); assert.equal(missing.response.status, 503); assert.match(missing.state.error, /Persistent storage is not configured/);
  const f = await fixture(t); f.redis.failScript = LUA.init; assert.equal((await f.visitor()).response.status, 503);
  f.redis.failScript = null; assert.equal((await f.visitor()).response.status, 200);
  await assert.rejects(new RedisRest({ url: 'https://redis.test', token: 'test-token', fetchImpl: async () => { throw new Error('network unavailable'); } }).command('GET', 'key'), StoreError);
});

test('signed tokens cannot cross purposes or outlive their expiry', () => {
  const token = signToken(SECRET, 'round', { exp: 200, value: 1 });
  assert.equal(verifyToken(SECRET, 'visitor', token, 100), null);
  assert.equal(verifyToken(SECRET, 'round', token, 200), null);
  assert.equal(verifyToken(SECRET, 'round', token, 100).value, 1);
});
