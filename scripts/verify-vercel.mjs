import assert from 'node:assert/strict';
import { createSeededEngine, REPLAY_VERSION } from '../shared/replay.js';
import { POWER_LEVELS } from '../shared/power.js';

const base = new URL(process.argv[2] || 'http://127.0.0.1:3004').origin;
async function visitor() {
  const response = await fetch(`${base}/api/session`);
  assert.equal(response.status, 200, 'Session must be public and available');
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'A new visitor receives a session cookie');
  assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
  const data = await response.json();
  assert.equal(data.hosting.transport, 'replay');
  assert.equal(data.hosting.admin, false);
  return { cookie, data };
}
async function request(player, endpoint, body, origin = base) {
  return fetch(`${base}${endpoint}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Cookie: player.cookie, Origin: origin,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const health = await fetch(`${base}/api/health`);
assert.equal(health.status, 200, 'Database-backed health check');
assert.equal((await health.json()).version, REPLAY_VERSION, 'Deployed server must use the current replay mechanics');
const [first, second] = await Promise.all([visitor(), visitor()]);
assert.notEqual(first.cookie, second.cookie, 'Visitors have independent sessions');
const startA = await request(first, '/api/round/start', {});
const startB = await request(second, '/api/round/start', {});
assert.equal(startA.status, 200);
assert.equal(startB.status, 200);
const a = await startA.json(), b = await startB.json();
assert.notEqual(a.roundId, b.roundId);
assert.notEqual(a.seed, b.seed);
assert.ok(a.ticket && b.ticket);
assert.equal(a.version, REPLAY_VERSION);
assert.equal(b.version, REPLAY_VERSION);
const cityA = createSeededEngine(a), cityB = createSeededEngine(b);
assert.equal(cityA.state.powerMode, 'low');
assert.equal(cityA.state.stats.lossLimit, 27);
cityA.command({ type: 'start' });
assert.equal(cityA.command({ type: 'power', value: 85 }), false, 'Numeric power commands must be rejected');
for (const mode of ['low', 'medium', 'high']) {
  assert.equal(cityA.command({ type: 'power', mode }), true);
  assert.equal(cityA.state.powerMode, mode);
  assert.equal(cityA.state.power, POWER_LEVELS[mode]);
}
assert.equal(cityB.state.powerMode, 'low', 'Another tab retains its own power mode');
const stolen = await request(second, '/api/leaderboard', {
  name: 'Verification', ticket: a.ticket, commands: [], ticks: 1,
});
assert.ok([401, 403, 410].includes(stolen.status), 'A visitor cannot claim another visitor’s round');
for (const [endpoint, body] of [
  ['/api/event/settings', { difficulty: 'hard' }],
  ['/api/event/new', { name: 'Not permitted' }],
  ['/api/event/history'],
  ['/api/leaderboard/export.csv'],
]) {
  assert.equal((await request(first, endpoint, body)).status, 403, endpoint);
}
assert.equal((await request(first, '/api/round/start', {}, 'https://foreign.example')).status, 403);
const fresh = await request(first, '/api/session');
assert.equal(fresh.status, 200);
assert.deepEqual((await fresh.json()).leaderboard, first.data.leaderboard, 'No score was submitted');
console.log(`Vercel smoke checks passed: ${base}`);
console.log('Independent sessions and round tickets, current three-mode mechanics, protected organizer routes, ownership, origin validation, and durable health. No scores submitted.');
