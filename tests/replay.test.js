import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../server/engine.js';
import { createSeededEngine, replayRound, ReplayError, REPLAY_STEP, REPLAY_VERSION, MAX_REPLAY_COMMANDS } from '../shared/replay.js';

const fast = { ROUND_DURATION: 5, COUNTDOWN_DURATION: 0, MAX_ACTIVE_WARNINGS: 0 };
const options = (overrides = {}) => ({ seed: 123456789, roundId: 'replay-test-round', config: fast, ...overrides });
const invalid = (callback) => assert.throws(callback, (error) => error instanceof ReplayError && error.status === 400);

function capture(settings, strategy) {
  const engine = createSeededEngine(settings);
  const commands = [];
  let ticks = 0;
  const send = (command) => {
    assert.equal(engine.command(command), true);
    commands.push({ tick: ticks, command: structuredClone(command) });
  };
  assert.equal(engine.command({ type: 'start' }), true);
  while (engine.state.phase !== 'results' && ticks < 4000) {
    strategy?.({ engine, ticks, send });
    engine.tick(REPLAY_STEP);
    ticks += 1;
  }
  assert.equal(engine.state.phase, 'results');
  return { commands, ticks, expected: engine.snapshot().result };
}

test('engine portability retains browser-safe UUID defaults and supports canonical ticket IDs', () => {
  assert.match(new GameEngine().snapshot().roundId, /^[a-f0-9-]{36}$/);
  const engine = createSeededEngine(options());
  assert.equal(engine.state.phase, 'ready');
  assert.equal(engine.state.roundId, 'replay-test-round');
  assert.equal(engine.state.elapsed, 0);
  assert.equal(REPLAY_STEP, 0.05);
  assert.equal(typeof REPLAY_VERSION, 'string');
});

test('full seeded gameplay replays exactly, including NPC-driven randomness, rescues, energy, and outcomes', () => {
  const settings = options({ config: { COUNTDOWN_DURATION: 3 } });
  let targetId = null;
  let previousPower = -1;
  const tape = capture(settings, ({ engine, send }) => {
    if (engine.state.phase !== 'playing') return;
    let target = engine.state.blocks.find((block) => block.id === targetId && ['warning', 'stabilizing'].includes(block.status));
    if (!target) target = engine.state.blocks.filter((block) => ['warning', 'stabilizing'].includes(block.status))
      .sort((a, b) => b.priority - a.priority)[0];
    if (target && target.id !== targetId) { targetId = target.id; send({ type: 'select', id: targetId }); }
    const power = target?.powerMode ?? 'low';
    if (power !== previousPower) { previousPower = power; send({ type: 'power', mode: power }); }
  });
  assert.ok(tape.expected.stats.saved > 5);
  assert.ok(tape.expected.decisionReport.totalRescues > 0);
  assert.deepEqual(replayRound({ ...settings, ...JSON.parse(JSON.stringify(tape)) }), tape.expected);
  assert.deepEqual(replayRound({ ...settings, commands: tape.commands, ticks: tape.ticks }), tape.expected);
});

test('an unattended normal city can reach 75 percent blackout and replays its exact early finish', () => {
  const settings = options({ seed: 0, config: {} });
  const tape = capture(settings);
  assert.equal(tape.expected.endReason, 'city_blackout');
  assert.equal(tape.expected.stats.failed, 27);
  assert.equal(tape.expected.stats.online, 9);
  assert.ok(tape.expected.storage > 0);
  assert.ok(tape.expected.survivalTime < 60);
  assert.equal(tape.expected.score.survival, 0);
  assert.equal(tape.expected.score.efficiency, 0);
  assert.deepEqual(replayRound({ ...settings, commands: tape.commands, ticks: tape.ticks }), tape.expected);
  invalid(() => replayRound({ ...settings, commands: tape.commands, ticks: tape.ticks + 1 }));
});

test('held power detents and released edges replay without continuous intermediate output', () => {
  const settings = options();
  const modes = new Set();
  const tape = capture(settings, ({ engine, ticks, send }) => {
    if (ticks === 0 || ticks === 3) send({ type: 'input', powerDelta: 1 });
    if (ticks === 10) send({ type: 'input', powerDelta: -1 });
    if (ticks === 12) send({ type: 'input', powerDelta: 0 });
    if (ticks === 14) send({ type: 'input', powerDelta: -1 });
    modes.add(engine.state.powerMode);
    assert.equal(engine.state.power, { low: 35, medium: 60, high: 85 }[engine.state.powerMode]);
  });
  assert.deepEqual([...modes].sort(), ['high', 'low', 'medium']);
  assert.deepEqual(replayRound({ ...settings, commands: tape.commands, ticks: tape.ticks }), tape.expected);
});

test('commands apply before their tick and preserve same-tick ordering', () => {
  const request = { ...options(), ticks: 100 };
  const low = replayRound({ ...request, commands: [
    { tick: 0, command: { type: 'power', mode: 'high' } },
    { tick: 0, command: { type: 'power', mode: 'low' } },
  ] });
  const high = replayRound({ ...request, commands: [
    { tick: 0, command: { type: 'power', mode: 'low' } },
    { tick: 0, command: { type: 'power', mode: 'high' } },
  ] });
  assert.ok(low.decisionReport.outputDelivery > 0, 'LOW is a real output mode, not an off setting');
  assert.ok(high.decisionReport.outputDelivery > low.decisionReport.outputDelivery * 10);
  assert.ok(high.storage < low.storage);
});

test('pauses compress out of active ticks when both transitions record neutral input', () => {
  const settings = options({ config: { COUNTDOWN_DURATION: 3 } });
  const neutral = { type: 'input', x: 0, y: 0, powerDelta: 0, stabilize: false };
  let pauses = 0;
  const tape = capture(settings, ({ engine, ticks, send }) => {
    if (ticks === 0) send({ type: 'input', x: 1, y: 0, powerDelta: 0 });
    if (ticks === 100) send({ type: 'input', x: -1, y: 1, powerDelta: 0.2 });
    if ([20, 450].includes(ticks)) {
      pauses += 1;
      // Match the transport: neutral before pausing, no controls while paused.
      send(neutral);
      const before = engine.snapshot();
      engine.command({ type: 'pause' });
      engine.tick(120);
      assert.equal(engine.state.phase, 'paused');
      engine.command({ type: 'pause' });
      send(neutral);
      assert.deepEqual(engine.snapshot(), before, 'Paused wall time changes no timers, captions, deadlines, or metrics');
    }
  });
  assert.equal(pauses, 2);
  assert.deepEqual(replayRound({ ...settings, commands: tape.commands, ticks: tape.ticks }), tape.expected);
});

test('early collapse is valid only at its actual completion tick', () => {
  const settings = options({ config: { ...fast, INITIAL_STORAGE: 0.1 } });
  const tape = capture(settings, ({ ticks, send }) => {
    if (ticks === 0) { send({ type: 'select', id: 'farm' }); send({ type: 'power', mode: 'high' }); }
  });
  assert.equal(tape.expected.outcome, 'collapse');
  assert.equal(tape.ticks, 1);
  assert.deepEqual(replayRound({ ...settings, commands: tape.commands, ticks: tape.ticks }), tape.expected);
  invalid(() => replayRound({ ...settings, commands: tape.commands, ticks: 2 }));
});

test('incomplete, extended, unsorted, out-of-range, and oversized tapes are rejected', () => {
  const valid = { ...options(), commands: [], ticks: 100 };
  for (const ticks of [0, -1, 1.5, NaN, Infinity, 99, 101, 10000000]) invalid(() => replayRound({ ...valid, ticks }));
  for (const commands of [null, {}, [null], [{ tick: 0 }], [{ tick: 0, command: { type: 'power', mode: 'low' }, score: 9000 }],
    [{ tick: -1, command: { type: 'power', mode: 'low' } }], [{ tick: 100, command: { type: 'power', mode: 'low' } }],
    [{ tick: 2, command: { type: 'power', mode: 'low' } }, { tick: 1, command: { type: 'power', mode: 'low' } }],
    Array.from({ length: MAX_REPLAY_COMMANDS + 1 }, () => ({ tick: 0, command: { type: 'input', x: 0 } })),
  ]) invalid(() => replayRound({ ...valid, commands }));
});

test('only strictly bounded input, targeting, and power commands can affect a replay', () => {
  const disallowed = [
    ...['start', 'reset', 'practice', 'demo', 'wake', 'pause', 'difficulty', 'debug', 'activity'].map((type) => ({ type })),
    { type: 'input', x: NaN }, { type: 'input', x: Infinity }, { type: 'input', y: 1.01 },
    { type: 'input', powerDelta: '-1' }, { type: 'input', stabilize: 1 }, { type: 'input', score: 9000 },
    { type: 'power', value: 101 }, { type: 'power', value: -1 }, { type: 'power', value: '85' },
    { type: 'power', value: 35 }, { type: 'power', mode: 'low', value: 35 },
    { type: 'power', mode: 'off' }, { type: 'power', mode: 'LOW' }, { type: 'power', mode: 35 },
    { type: 'select', id: '__proto__' }, { type: 'select', id: 'missing' }, { type: 'select', id: 'farm', priority: 9000 },
  ];
  for (const command of disallowed) invalid(() => replayRound({ ...options(), ticks: 100, commands: [{ tick: 0, command }] }));
  const result = replayRound({ ...options(), ticks: 100, commands: [
    { tick: 0, command: { type: 'input', x: -1, y: 1, powerDelta: 0, stabilize: true } },
    { tick: 10, command: { type: 'input', x: 0, y: 0, stabilize: false } },
  ], score: { total: 999999 } });
  assert.ok(result.score.total < 1000, 'The server derives score; unsigned client metrics are not used');
});

test('seed and configuration validation bounds replay work without silently changing signed data', () => {
  for (const seed of [-1, 4294967296, 1.5, '1', NaN]) invalid(() => createSeededEngine(options({ seed })));
  for (const roundId of ['', 'contains spaces', 'x'.repeat(101), null]) invalid(() => createSeededEngine(options({ roundId })));
  for (const config of [null, [], { ROUND_DURATION: 181 }, { ROUND_DURATION: Infinity }, { COUNTDOWN_DURATION: 11 },
    { PHYSICS_STEP: 0 }, { INITIAL_STORAGE: 101 }, { DIFFICULTY: '__proto__' }, { ATTRACT_ENABLED: 'true' },
    { UNKNOWN_SETTING: 1 }, { FAILURE_PHASES: [] },
  ]) invalid(() => createSeededEngine(options({ config })));
  for (const seed of [0, 4294967295]) {
    const request = { ...options({ seed }), commands: [], ticks: 100 };
    assert.deepEqual(replayRound(request), replayRound(JSON.parse(JSON.stringify(request))));
  }
});
