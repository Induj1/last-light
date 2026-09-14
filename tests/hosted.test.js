import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { get as httpGet } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createHostedServer } from '../server/hosted.js';
import { GameEngine } from '../server/engine.js';

const PASSWORD = 'test-only-organizer-password-not-a-deployment-secret';
async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'last-light-hosted-'));
  const server = await createHostedServer({ directory, publicOrigin: null, adminPassword: PASSWORD,
    engineFactory: () => new GameEngine({ config: { ROUND_DURATION: 1, COUNTDOWN_DURATION: 0 }, random: () => 0.5 }),
    logger: { warn() {}, error() {} }, ...options });
  const address = await server.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });
  async function visitor() {
    const response = await fetch(base + '/api/session');
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    const state = await response.json();
    const id = cookie?.split('=')[1];
    return { cookie, state, response, session: server.sessions.get(id) };
  }
  async function request(visitor, endpoint, body, headers = {}) {
    const response = await fetch(base + endpoint, { method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: visitor.cookie, Origin: base, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    if (cookie) visitor.cookie = cookie;
    return response;
  }
  async function socket(visitor) {
    const client = new WebSocket(base.replace('http:', 'ws:') + '/ws', { headers: { Cookie: visitor.cookie, Origin: base } });
    const received = [];
    client.on('message', (data) => received.push(JSON.parse(data.toString())));
    await once(client, 'open');
    return { client, received };
  }
  return { server, base, visitor, request, socket };
}
async function until(condition) {
  const deadline = Date.now() + 2500;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for hosted state');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function deniedSocket(url, cookie, origin) {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(url, { headers: { ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) } });
    client.on('unexpected-response', (request, response) => { response.resume(); client.terminate(); resolve(response.statusCode); });
    client.on('error', () => {});
    client.on('open', () => { client.close(); reject(new Error('Unexpected WebSocket acceptance')); });
  });
}

test('two browser cookies own independent games; same cookie reconnect resumes paused game', async (t) => {
  const { visitor, socket, request, server } = await fixture(t);
  const a = await visitor(); const b = await visitor();
  assert.notEqual(a.cookie, b.cookie);
  assert.match(a.response.headers.get('set-cookie'), /HttpOnly.*SameSite=Strict/);
  assert.deepEqual(a.state.hosting, { mode: 'online', admin: false });
  const first = await socket(a); const second = await socket(b);
  first.client.send(JSON.stringify({ type: 'practice' }));
  await until(() => a.session.engine.state.phase === 'practice');
  first.client.send(JSON.stringify({ type: 'select', id: 'farm' }));
  first.client.send(JSON.stringify({ type: 'power', mode: 'high' }));
  await until(() => a.session.engine.state.powerMode === 'high');
  assert.equal(b.session.engine.state.phase, 'ready');
  assert.equal(b.session.engine.state.powerMode, 'low');
  assert.equal(b.session.engine.state.power, 35);
  assert.notEqual(a.session.engine.state.roundId, b.session.engine.state.roundId);
  first.client.close(); await once(first.client, 'close');
  await until(() => a.session.engine.state.phase === 'paused');
  const round = a.session.engine.state.roundId;
  const resume = await request(a, '/api/session');
  assert.equal(resume.status, 200);
  const again = await socket(a);
  assert.equal(a.session.engine.state.roundId, round);
  assert.equal(a.session.engine.state.phase, 'paused');
  again.client.send(JSON.stringify({ type: 'pause' }));
  await until(() => a.session.engine.state.phase === 'practice');
  assert.equal(server.sessions.size, 2);
  again.client.close(); second.client.close();
});

test('score submission is authoritative and owned by the completing browser session', async (t) => {
  const { visitor, request, server } = await fixture(t);
  const a = await visitor(); const b = await visitor();
  a.session.engine.command({ type: 'start' }); a.session.engine.tick(1);
  const result = server.snapshot(a.session).result;
  assert.equal((await request(b, '/api/leaderboard', { roundId: result.roundId, name: 'Other browser' })).status, 410);
  const saved = await request(a, '/api/leaderboard', { roundId: result.roundId, name: 'Visitor', finalScore: 999999 });
  assert.equal(saved.status, 201);
  assert.equal((await saved.json()).entry.finalScore, result.score.total);
  assert.equal((await request(a, '/api/leaderboard', { roundId: result.roundId, name: 'Again' })).status, 409);
  assert.equal(server.leaderboard.entries.length, 1);
});

test('public users cannot mutate events, export histories, inspect serial or send organizer commands', async (t) => {
  const { visitor, request, socket } = await fixture(t);
  const a = await visitor();
  for (const [endpoint, body] of [
    ['/api/event/settings', { difficulty: 'hard' }], ['/api/event/new', { name: 'Unauthorized' }],
    ['/api/event/history'], ['/api/leaderboard/export.csv'], ['/api/event/missing/export.csv'], ['/api/config'], ['/api/serial/ports'], ['/api/serial/connect', { path: 'COM1' }],
  ]) assert.equal((await request(a, endpoint, body)).status, 403, endpoint);
  const { client, received } = await socket(a);
  for (const message of [{ type: 'debug', action: 'toggle' }, { type: 'difficulty', value: 'hard' }, { type: 'demo' }]) client.send(JSON.stringify(message));
  await until(() => received.filter((message) => message.type === 'error').length === 3);
  assert.equal(a.session.engine.state.debug, false);
  assert.equal(a.session.engine.state.difficulty, 'normal');
  assert.equal(a.session.engine.state.phase, 'ready');
  client.close();
});

test('organizer login rotates cookie, closes old-cookie sockets, updates settings and archives', async (t) => {
  const { visitor, request, socket, server } = await fixture(t);
  const admin = await visitor(); const player = await visitor();
  const { client, received } = await socket(admin);
  const originalClosed = once(client, 'close');
  const oldCookie = admin.cookie;
  const login = await request(admin, '/api/admin/login', { password: PASSWORD });
  assert.equal(login.status, 200); assert.notEqual(admin.cookie, oldCookie);
  assert.equal((await login.json()).hosting.admin, true);
  await until(() => received.some((message) => message.state?.hosting.admin === true));
  await originalClosed;
  assert.equal(await deniedSocket(server.http.address() ? `ws://127.0.0.1:${server.http.address().port}/ws` : '', oldCookie, `http://127.0.0.1:${server.http.address().port}`), 401);
  const refreshed = await socket(admin);
  player.session.engine.command({ type: 'start' });
  const oldDuration = player.session.engine.config.ROUND_DURATION;
  const settings = await request(admin, '/api/event/settings', { eventName: 'Hosted event', difficulty: 'hard', roundDuration: 90 });
  assert.equal(settings.status, 200);
  assert.equal(player.session.engine.config.ROUND_DURATION, oldDuration);
  assert.equal(player.session.pendingSettings.roundDuration, 90);
  player.session.engine.tick(1);
  const completed = server.snapshot(player.session).result;
  assert.equal((await request(player, '/api/leaderboard', { roundId: completed.roundId, name: 'Archived result' })).status, 201);
  const playerSocket = await socket(player);
  playerSocket.client.send(JSON.stringify({ type: 'reset' }));
  await until(() => player.session.engine.config.ROUND_DURATION === 90);
  assert.equal(player.session.engine.state.phase, 'ready');
  assert.equal(player.session.engine.state.difficulty, 'hard');
  playerSocket.client.close();
  const next = await request(admin, '/api/event/new', { name: 'Next event' });
  assert.equal(next.status, 201);
  const archived = (await next.json()).previousEvent;
  assert.equal(player.session.engine.state.phase, 'ready');
  assert.equal(player.session.engine.config.ROUND_DURATION, 90);
  assert.equal((await request(player, '/api/leaderboard', { roundId: completed.roundId, name: 'Old round' })).status, 410);
  assert.equal((await request(admin, '/api/event/history')).status, 200);
  const csv = await request(admin, `/api/event/${archived.id}/export.csv`);
  assert.equal(csv.status, 200); assert.ok((await csv.text()).includes('Archived result'));
  assert.equal((await request(admin, '/api/admin/logout', {})).status, 200);
  assert.equal((await request(admin, '/api/event/history')).status, 403);
  await until(() => refreshed.received.at(-1)?.state?.hosting.admin === false);
  refreshed.client.close();
});

test('admin sign-in failures are bounded and cross-origin writes or sockets are rejected', async (t) => {
  const { visitor, request, base } = await fixture(t);
  const a = await visitor();
  assert.equal((await request(a, '/api/admin/login', { password: PASSWORD }, { Origin: 'https://evil.example' })).status, 403);
  for (let attempt = 0; attempt < 5; attempt += 1) assert.equal((await request(a, '/api/admin/login', { password: 'wrong' })).status, 401);
  assert.equal((await request(a, '/api/admin/login', { password: PASSWORD })).status, 429);
  const url = base.replace('http:', 'ws:') + '/ws';
  assert.equal(await deniedSocket(url, a.cookie, 'https://evil.example'), 403);
  assert.equal(await deniedSocket(url, null, base), 401);
  assert.equal(await deniedSocket(url, a.cookie), 403);
  const noOrigin = await fetch(base + '/api/admin/logout', { method: 'POST', headers: { Cookie: a.cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(noOrigin.status, 403);
});

test('sessions and WebSockets are bounded; disconnected idle games expire without ticking', async (t) => {
  let time = 0;
  const { visitor, socket, base, server } = await fixture(t, { now: () => time, maxSessions: 2, maxSessionsPerIp: 1, maxSocketsPerSession: 1, sessionTtlMs: 1000 });
  const a = await visitor();
  const blocked = await visitor(); assert.equal(blocked.response.status, 429);
  const { client } = await socket(a);
  assert.equal(await deniedSocket(base.replace('http:', 'ws:') + '/ws', a.cookie, base), 429);
  client.send(JSON.stringify({ type: 'start' }));
  await until(() => a.session.engine.state.phase === 'playing');
  time = 2000; server.cleanup();
  assert.equal(server.sessions.size, 1);
  client.close(); await once(client, 'close');
  await until(() => a.session.engine.state.phase === 'paused');
  const elapsed = a.session.engine.state.elapsed;
  server.tick(); server.tick();
  assert.equal(a.session.engine.state.elapsed, elapsed);
  time = 3001; server.cleanup();
  assert.equal(server.sessions.size, 0);
  const replacement = await visitor(); assert.equal(replacement.response.status, 200);
  assert.notEqual(replacement.cookie, a.cookie);
});

test('health probes bypass external Host checks while session endpoints require configured origin', async (t) => {
  const { base } = await fixture(t, { publicOrigin: 'https://last-light.example' });
  assert.equal((await fetch(base + '/api/health')).status, 200);
  assert.equal((await fetch(base + '/api/session')).status, 403);
  const session = await new Promise((resolve, reject) => {
    const request = httpGet(base + '/api/session', { headers: { Host: 'last-light.example', Origin: 'https://last-light.example' } }, (response) => {
      response.resume(); response.on('end', () => resolve(response));
    });
    request.on('error', reject);
  });
  assert.equal(session.statusCode, 200);
  assert.match(session.headers['set-cookie'][0], /; Secure/);
  assert.equal(session.headers['cache-control'], 'private, no-store');
});
