import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createLastLightServer } from '../server/index.js';
import { GameEngine } from '../server/engine.js';
import { SerialBridge } from '../server/serial.js';
import { Leaderboard, leaderboardCsv } from '../server/leaderboard.js';
import { DEFAULT_EVENT_SETTINGS, EventSettings } from '../server/settings.js';

const quiet = { warn() {}, error() {} };
const result = (roundId = 'event-round') => ({ roundId, survived: true, difficulty: 'normal', practice: false,
  score: { total: 387, priority: 265, criticalBonus: 0, efficiency: 22, survival: 100 },
  stats: { saved: 5, criticalSaved: 0, criticalLost: 4 }, storage: 37.3, survivalTime: 60 });
async function directory(t) {
  const location = await mkdtemp(path.join(os.tmpdir(), 'last-light-events-'));
  t.after(() => rm(location, { recursive: true, force: true }));
  return location;
}
async function fixture(t, options = {}) {
  const location = await mkdtemp(path.join(os.tmpdir(), 'last-light-event-api-'));
  const engine = new GameEngine({ config: { ROUND_DURATION: 1, COUNTDOWN_DURATION: 0 }, random: () => 0.5 });
  const server = await createLastLightServer({ directory: location, engine, serial: new SerialBridge(), logger: quiet, ...options });
  const address = await server.listen(0);
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await server.close(); await rm(location, { recursive: true, force: true }); });
  return { server, engine, location, base, ws: base.replace('http:', 'ws:') + '/ws' };
}
const post = (base, endpoint, body) => fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function until(condition) {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for event');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('v1 migration preserves every existing entry and original file bytes', async (t) => {
  const location = await directory(t);
  const board = await new Leaderboard(location).load();
  await board.submit('Induj', result());
  for (let index = 0; index < 12; index += 1) await board.submit(`Visitor ${index}`, result(`round-${index}`));
  const original = JSON.stringify({ version: 1, entries: board.entries, submittedRounds: [...board.submittedRounds] }, null, 2);
  await writeFile(board.file, original);
  const migrated = await new Leaderboard(location).load();
  assert.equal(migrated.entries.length, 13);
  assert.equal(migrated.top().length, 10);
  assert.deepEqual(migrated.entries[0], board.entries[0]);
  assert.equal(migrated.entries[0].name, 'Induj');
  assert.equal(migrated.entries[0].finalScore, 387);
  const backup = (await readdir(location)).find((file) => file.includes('.v1-backup-'));
  assert.equal(await readFile(path.join(location, backup), 'utf8'), original);
  assert.equal(JSON.parse(await readFile(board.file, 'utf8')).version, 2);
});

test('CSV exports every submission with quotes and spreadsheet formula protection', async (t) => {
  const board = await new Leaderboard(await directory(t)).load();
  for (let index = 0; index < 12; index += 1) await board.submit(index === 0 ? '=SUM(1,2)' : `Visitor ${index}`, result(`round-${index}`));
  assert.equal(board.csv().trim().split('\r\n').length, 13);
  assert.ok(board.csv().includes('"\'=SUM(1,2)"'));
  const csv = leaderboardCsv([{ ...board.entries[0], name: 'Ada, "A"\nNext' }], { id: 'test', name: '+Event' });
  assert.ok(csv.includes('"Ada, ""A""\nNext"'));
  assert.ok(csv.includes('"\'+Event"'));
});

test('new event archives full ledger and rejects queued submissions for the previous event', async (t) => {
  const board = await new Leaderboard(await directory(t)).load();
  await board.updateSettings(DEFAULT_EVENT_SETTINGS);
  const firstEventId = board.event.id;
  const first = board.submit('First', result('first'));
  const archived = board.startEvent('Day two', DEFAULT_EVENT_SETTINGS);
  const stale = board.submit('Late', result('late'), firstEventId);
  await first;
  const previous = await archived;
  await assert.rejects(stale, (error) => error.status === 410);
  assert.equal(previous.submissionCount, 1);
  assert.equal(board.metadata().submissionCount, 0);
  assert.equal(board.event.name, 'Day two');
  const archive = await board.archive(firstEventId);
  assert.equal(archive.entries[0].name, 'First');
  assert.equal(archive.settings.roundDuration, 60);
  assert.equal((await board.history())[0].id, firstEventId);
  await assert.rejects(board.archive('../leaderboard'), (error) => error.status === 400);
});

test('failed event archive leaves current scores and current event file untouched', async (t) => {
  const board = await new Leaderboard(await directory(t), { logger: quiet }).load();
  await board.submit('Induj', result());
  const original = await readFile(board.file, 'utf8');
  const originalEvent = board.metadata();
  await writeFile(board.archiveDirectory, 'A file blocks creation of the events directory.');
  await assert.rejects(board.startEvent('New event', DEFAULT_EVENT_SETTINGS));
  assert.equal(await readFile(board.file, 'utf8'), original);
  assert.deepEqual(board.metadata(), originalEvent);
  assert.equal(board.top()[0].name, 'Induj');
  await board.submit('Still works', result('next-round'));
  assert.equal(board.entries.length, 2);
});

test('event settings validate bounds and persist both ledger and settings mirror', async (t) => {
  const { server, engine, location, base } = await fixture(t);
  const changed = { eventName: 'College Day', difficulty: 'hard', roundDuration: 90, resetSeconds: 20, attractEnabled: false, attractIdleSeconds: 60 };
  const response = await post(base, '/api/event/settings', changed);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.settings, changed);
  assert.equal(data.event.name, 'College Day');
  assert.equal(engine.config.ROUND_DURATION, 90);
  assert.equal(engine.snapshot().remaining, 90);
  const persisted = await new EventSettings(location).load();
  assert.deepEqual(persisted.settings, changed);
  const ledger = await new Leaderboard(location).load();
  assert.deepEqual(ledger.settings, changed);
  await writeFile(path.join(location, 'event-settings.json'), JSON.stringify({ version: 1, settings: DEFAULT_EVENT_SETTINGS }));
  const recovered = await new EventSettings(location).load(ledger.settings);
  assert.deepEqual(recovered.settings, changed);
  for (const invalid of [{ roundDuration: 29 }, { resetSeconds: 61 }, { attractIdleSeconds: 14 }, { attractEnabled: 'true' }, { eventName: '' }, { difficulty: 'extreme' }, { constructor: 1 }]) {
    assert.equal((await post(base, '/api/event/settings', invalid)).status, 400);
  }
  assert.deepEqual(server.snapshot().settings, changed);
});

test('active and practice rounds reject event mutations; result settings preserve frozen results', async (t) => {
  const { engine, base } = await fixture(t);
  engine.command({ type: 'practice' });
  assert.equal((await post(base, '/api/event/settings', { difficulty: 'easy' })).status, 409);
  assert.equal((await post(base, '/api/event/new', { name: 'No reset' })).status, 409);
  engine.command({ type: 'start' });
  assert.equal((await post(base, '/api/event/settings', { roundDuration: 90 })).status, 409);
  engine.tick(1);
  const frozen = engine.snapshot().result;
  assert.equal((await post(base, '/api/event/settings', { resetSeconds: 20 })).status, 200);
  assert.deepEqual(engine.snapshot().result, frozen);
  assert.equal(engine.config.AUTO_RESET_DURATION, 20);
});

test('fresh-event API archives exports and invalidates previous cached results', async (t) => {
  const { server, engine, base } = await fixture(t);
  engine.command({ type: 'start' }); engine.tick(1);
  const roundId = server.snapshot().result.roundId;
  await server.leaderboard.submit('Archived visitor', result('another-result'));
  const response = await post(base, '/api/event/new', { name: 'Tomorrow' });
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(data.event.submissionCount, 0);
  assert.equal(data.previousEvent.submissionCount, 1);
  assert.equal((await post(base, '/api/leaderboard', { roundId, name: 'Late result' })).status, 410);
  const archived = await fetch(`${base}/api/event/${data.previousEvent.id}/export.csv`);
  assert.equal(archived.status, 200);
  assert.ok((await archived.text()).includes('Archived visitor'));
  assert.equal((await fetch(base + '/api/leaderboard/export.csv')).status, 200);
  assert.equal((await (await fetch(base + '/api/event/history')).json()).events.length, 1);
});

test('neutral hardware permits attract mode and cannot overwrite the autonomous power output', async (t) => {
  let time = 0;
  let hardware = { x: 0, y: 0, knob: 17, powerMode: 'low', pressed: false };
  const serial = new SerialBridge();
  serial.input = () => hardware && { ...hardware };
  serial.connection = () => ({ mode: 'hardware', connected: true });
  const { server, engine } = await fixture(t, { serial, now: () => time });
  server.tick();
  time = 45001; server.tick();
  assert.equal(engine.snapshot().phase, 'demo');
  const commands = [];
  const original = engine.command.bind(engine);
  engine.command = (message) => { commands.push(message); return original(message); };
  for (let frame = 0; frame < 5; frame += 1) { time += 50; server.tick(); }
  assert.equal(commands.some((message) => message.type === 'power'), false);
  assert.equal(engine.snapshot().phase, 'demo');
  hardware = { ...hardware, knob: 20 };
  time += 50; server.tick();
  assert.equal(engine.snapshot().phase, 'ready');
  assert.equal(commands.at(-2)?.type === 'wake' || commands.at(-1)?.type === 'wake', true);
  assert.equal(engine.snapshot().practice, false);
});

test('demo consumes the first human start, and organizer activity postpones automatic demo', async (t) => {
  let time = 0;
  const { server, engine, ws } = await fixture(t, { now: () => time });
  const client = new WebSocket(ws);
  await once(client, 'open');
  t.after(() => client.terminate());
  engine.command({ type: 'demo' });
  client.send(JSON.stringify({ type: 'input', x: 0, y: 0, powerDelta: 0 }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(engine.snapshot().phase, 'demo');
  client.send(JSON.stringify({ type: 'start' }));
  await until(() => engine.snapshot().phase === 'ready');
  assert.equal(engine.snapshot().elapsed, 0);
  time = 40000;
  client.send(JSON.stringify({ type: 'activity' }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  time = 46000; server.tick();
  assert.equal(engine.snapshot().phase, 'ready');
  client.send(JSON.stringify({ type: 'start' }));
  await until(() => engine.snapshot().phase === 'playing');
});

test('waking a manually started demo releases its previous display owner', async (t) => {
  const { engine, ws } = await fixture(t);
  const first = new WebSocket(ws);
  await once(first, 'open');
  const second = new WebSocket(ws);
  await once(second, 'open');
  t.after(() => { first.terminate(); second.terminate(); });
  first.send(JSON.stringify({ type: 'demo' }));
  await until(() => engine.snapshot().phase === 'demo');
  second.send(JSON.stringify({ type: 'wake' }));
  await until(() => engine.snapshot().phase === 'ready');
  second.send(JSON.stringify({ type: 'start' }));
  await until(() => engine.snapshot().phase === 'playing');
});
