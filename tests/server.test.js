import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createLastLightServer, permittedOrigin, validCommand } from '../server/index.js';
import { Leaderboard } from '../server/leaderboard.js';
import { SerialBridge } from '../server/serial.js';
import { GameEngine } from '../server/engine.js';

const result = (roundId = 'round-1', total = 500) => ({
  roundId, survived: true, difficulty: 'normal', practice: false,
  score: { total, priority: total - 150, criticalBonus: 25, efficiency: 25, survival: 100 },
  stats: { saved: 8, criticalSaved: 3, criticalLost: 1 }, storage: 25, survivalTime: 60,
});
class TestEngine {
  constructor() { this.config = { ROUND_DURATION: 60 }; this.state = { phase: 'ready', storage: 100, remaining: 60, result: null }; this.commands = []; }
  snapshot() { return structuredClone(this.state); }
  tick() {}
  command(message) {
    this.commands.push(message);
    if (message.type === 'start') this.state.phase = 'playing';
    if (message.type === 'reset') { this.state.phase = 'ready'; this.state.result = null; }
    if (message.type === 'pause') this.state.phase = this.state.phase === 'paused' ? 'playing' : 'paused';
  }
}
async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'last-light-server-'));
  const engine = new TestEngine();
  const server = await createLastLightServer({ directory, engine, serial: new SerialBridge(), logger: { warn() {}, error() {} }, ...options });
  const address = await server.listen(0);
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });
  return { server, engine, directory, base, ws: base.replace('http:', 'ws:') + '/ws' };
}
async function connect(url) {
  const client = new WebSocket(url);
  const received = [];
  client.on('message', (data) => received.push(JSON.parse(data.toString())));
  await once(client, 'open');
  return { client, received };
}
async function until(condition) {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for server event');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
const post = (base, endpoint, body) => fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('command bounds and origin checks reject untrusted or invalid controls', () => {
  assert.equal(validCommand({ type: 'input', x: 1, y: -1, powerDelta: 0 }), true);
  assert.equal(validCommand({ type: 'input', x: Infinity }), false);
  for (const mode of ['low', 'medium', 'high']) assert.equal(validCommand({ type: 'power', mode }), true);
  for (const command of [{ type: 'power', value: 35 }, { type: 'power', value: 0 }, { type: 'power', mode: 'off' }, { type: 'power', mode: 35 }, { type: 'power', mode: 'low', value: 35 }]) assert.equal(validCommand(command), false);
  assert.equal(validCommand({ type: 'debug', action: 'storage', value: 70 }), true);
  assert.equal(validCommand({ type: 'debug', action: 'storage', value: '70' }), false);
  assert.equal(validCommand({ type: 'cheat', total: 100000 }), false);
  assert.equal(permittedOrigin('http://localhost:5173', '127.0.0.1:3001'), true);
  assert.equal(permittedOrigin('https://evil.example', 'localhost:3001'), false);
  assert.equal(permittedOrigin(undefined, 'malicious.example:3001'), false);
});

test('leaderboard serializes submissions, ranks top ten, retains metrics and survives reload', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'last-light-board-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const board = await new Leaderboard(directory).load();
  await Promise.all(Array.from({ length: 15 }, (_, index) => board.submit(`Player ${index}`, result(`round-${index}`, index * 10))));
  assert.equal(board.top().length, 10);
  assert.equal(board.top()[0].finalScore, 140);
  assert.equal(board.top()[0].criticalLost, 1);
  const reloaded = await new Leaderboard(directory).load();
  assert.deepEqual(reloaded.top(), board.top());
  await assert.rejects(reloaded.submit('Duplicate', result('round-0')), (error) => error.status === 409);
  await assert.rejects(reloaded.submit('Practice', { ...result('practice'), practice: true }), /Practice/);
  const data = JSON.parse(await readFile(path.join(directory, 'leaderboard.json'), 'utf8'));
  assert.equal(data.submittedRounds.length, 15);
  assert.equal(data.version, 2);
  assert.equal(data.entries.length, 15);
});

test('corrupt JSON is preserved, including valid JSON with missing score metrics', async (t) => {
  for (const bad of ['{incomplete', 'null', JSON.stringify({ version: 1, entries: [{ name: 'Incomplete', finalScore: 100, createdAt: '2026-09-10' }], submittedRounds: [] })]) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'last-light-corrupt-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(path.join(directory, 'leaderboard.json'), bad);
    const board = await new Leaderboard(directory, { logger: { warn() {} } }).load();
    assert.deepEqual(board.top(), []);
    const preserved = (await readdir(directory)).find((name) => name.includes('.corrupt-'));
    assert.equal(await readFile(path.join(directory, preserved), 'utf8'), bad);
    await board.submit('Recovered', result());
    assert.equal(board.top().length, 1);
  }
});

test('queued leaderboard submissions recheck a result disqualified while waiting', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'last-light-queue-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const board = await new Leaderboard(directory).load();
  let release;
  board.queue = new Promise((resolve) => { release = resolve; });
  const round = result();
  const submission = board.submit('Too late', round);
  round.practice = true;
  release();
  await assert.rejects(submission, /Practice/);
  assert.equal(board.top().length, 0);
});

test('REST accepts only authoritative completed results, caches reset rounds and blocks duplicates', async (t) => {
  let time = 1000;
  const { server, engine, base } = await fixture(t, { now: () => time });
  const health = await (await fetch(base + '/api/health')).json();
  assert.equal(health.ok, true);
  assert.equal(health.connection.mode, 'keyboard');
  assert.equal((await post(base, '/api/leaderboard', { roundId: 'fake', name: 'Cheat', finalScore: 10000 })).status, 410);
  engine.state.result = result();
  engine.state.phase = 'results';
  server.snapshot();
  engine.command({ type: 'reset' });
  const response = await post(base, '/api/leaderboard', { roundId: 'round-1', name: '  <Ada>  ', finalScore: 999999 });
  assert.equal(response.status, 201);
  const saved = await response.json();
  assert.equal(saved.entry.name, 'Ada');
  assert.equal(saved.entry.finalScore, 500);
  assert.equal((await post(base, '/api/leaderboard', { roundId: 'round-1', name: 'Again' })).status, 409);
  time += 120001;
  assert.equal((await post(base, '/api/leaderboard', { roundId: 'round-1', name: 'Expired' })).status, 410);
  assert.equal((await fetch(base + '/api/health', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await post(base, '/api/serial/calibrate', { deadzone: 999 })).status, 400);
});

test('WebSocket streams states, rejects malformed data, prevents spectator takeover and stops stale input', async (t) => {
  let time = 0;
  const { server, engine, ws } = await fixture(t, { now: () => time });
  const owner = await connect(ws);
  const spectator = await connect(ws);
  t.after(() => { owner.client.terminate(); spectator.client.terminate(); });
  await until(() => owner.received.some((message) => message.type === 'state'));
  owner.client.send('{broken');
  await until(() => owner.received.some((message) => message.type === 'error'));
  owner.client.send(JSON.stringify({ type: 'start' }));
  await until(() => engine.state.phase === 'playing');
  owner.client.send(JSON.stringify({ type: 'input', x: 1, y: 0, powerDelta: 1 }));
  await until(() => engine.commands.some((command) => command.type === 'input' && command.x === 1));
  spectator.client.send(JSON.stringify({ type: 'reset' }));
  await until(() => spectator.received.some((message) => message.type === 'error'));
  assert.equal(engine.state.phase, 'playing');
  time = 600;
  server.tick();
  assert.equal(engine.commands.at(-1).x, 0);
  owner.client.close();
  await until(() => engine.state.phase === 'paused');
  spectator.client.send(JSON.stringify({ type: 'reset' }));
  await until(() => engine.state.phase === 'ready');
});

test('real engine completes through server ticks and hardware input safely yields to keyboard fallback', async (t) => {
  let time = 0;
  let hardware = { x: 1, y: 0, knob: 80, powerMode: 'high', pressed: true };
  const serial = new SerialBridge();
  serial.input = () => { const value = hardware && { ...hardware }; if (hardware) hardware.pressed = false; return value; };
  serial.connection = () => ({ mode: hardware ? 'hardware' : 'keyboard', connected: Boolean(hardware) });
  const engine = new GameEngine({ config: { ROUND_DURATION: 1, COUNTDOWN_DURATION: 0 }, random: () => 0.5 });
  const { server, base } = await fixture(t, { engine, serial, now: () => time });
  server.tick();
  assert.equal(engine.snapshot().phase, 'practice');
  engine.command({ type: 'start' });
  server.tick();
  assert.equal(engine.snapshot().phase, 'playing');
  assert.equal(engine.snapshot().powerMode, 'high');
  assert.equal(engine.snapshot().power, 85);
  assert.equal(engine.snapshot().blocks.length, 36);
  assert.ok(engine.snapshot().cursor.x > 2);
  hardware = null;
  const stoppedAt = engine.snapshot().cursor.x;
  for (let frame = 0; frame < 25; frame += 1) { time += 50; server.tick(); }
  const final = server.snapshot();
  assert.equal(final.cursor.x, stoppedAt);
  assert.equal(final.phase, 'results');
  assert.equal(final.result.survivalTime, 1);
  const response = await post(base, '/api/leaderboard', { roundId: final.result.roundId, name: 'Engine test' });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).entry.finalScore, final.result.score.total);
});

test('debug mutations disqualify an already cached real engine result after a reset', async (t) => {
  const engine = new GameEngine({ config: { ROUND_DURATION: 1, COUNTDOWN_DURATION: 0 }, random: () => 0.5 });
  const { server, base } = await fixture(t, { engine });
  engine.command({ type: 'start' });
  engine.tick(1);
  const roundId = server.snapshot().result.roundId;
  engine.command({ type: 'debug', action: 'toggle' });
  engine.command({ type: 'debug', action: 'npc' });
  assert.equal(engine.snapshot().result.practice, true);
  server.snapshot();
  engine.command({ type: 'reset' });
  const response = await post(base, '/api/leaderboard', { roundId, name: 'Practice score' });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Practice/);
  assert.equal(server.leaderboard.top().length, 0);
});

test('results left on screen beyond two minutes cannot be recached after expiration', async (t) => {
  let time = 0;
  const { server, engine, base } = await fixture(t, { now: () => time });
  engine.state.result = result();
  engine.state.phase = 'results';
  server.snapshot();
  time = 120001;
  server.snapshot();
  server.snapshot();
  assert.equal((await post(base, '/api/leaderboard', { roundId: 'round-1', name: 'Expired' })).status, 410);
});

test('partial input messages replace axes instead of retaining a previous direction', async (t) => {
  const { engine, ws } = await fixture(t);
  const { client } = await connect(ws);
  t.after(() => client.terminate());
  client.send(JSON.stringify({ type: 'input', x: 1, y: 1, powerDelta: 0 }));
  await until(() => engine.commands.some((command) => command.type === 'input' && command.x === 1));
  client.send(JSON.stringify({ type: 'input', powerDelta: -1 }));
  await until(() => engine.commands.some((command) => command.type === 'input' && command.powerDelta === -1));
  const command = engine.commands.findLast((item) => item.type === 'input');
  assert.equal(command.x, 0);
  assert.equal(command.y, 0);
});
