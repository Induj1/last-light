import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../server/engine.js';
import { resolveConfig } from '../shared/config.js';
import { createBlocks } from '../shared/blocks.js';
import { POWER_LEVELS, POWER_MODES } from '../shared/power.js';
import { createSeededEngine, replayRound, REPLAY_STEP } from '../shared/replay.js';

function game(config = {}) {
  return new GameEngine({ config: { COUNTDOWN_DURATION: 0, MAX_ACTIVE_WARNINGS: 0, ...config }, random: () => 0.5 });
}
function startDebug(engine) {
  engine.command({ type: 'start' });
  engine.command({ type: 'debug', action: 'toggle' });
}
function warn(engine, id) {
  engine.command({ type: 'debug', action: 'warn', value: id });
  engine.command({ type: 'select', id });
}
function selected(engine, id) {
  return engine.snapshot().blocks.find((block) => block.id === id);
}

test('city has 36 unique positions, configured services, and isolated snapshots', () => {
  const engine = game();
  const state = engine.snapshot();
  assert.equal(state.phase, 'ready');
  assert.equal(state.storage, 100);
  assert.equal(state.powerMode, 'low');
  assert.equal(state.power, 35);
  assert.equal(state.stats.failed, 0);
  assert.equal(state.stats.lossLimit, 27);
  assert.equal(state.blocks.length, 36);
  assert.equal(new Set(state.blocks.map((block) => block.id)).size, 36);
  assert.equal(new Set(state.blocks.map((block) => `${block.row}/${block.col}`)).size, 36);
  assert.equal(state.blocks.filter((block) => block.critical).length, 4);
  state.blocks[0].priority = -200;
  state.cursor.x = 99;
  assert.notEqual(engine.snapshot().blocks[0].priority, -200);
  assert.equal(engine.snapshot().cursor.x, 2);
  assert.equal(createBlocks().length, 36);
  const modes = Object.fromEntries(state.blocks.map((block) => [block.kind, block.powerMode]));
  assert.deepEqual(modes, { farm: 'low', residential: 'medium', market: 'low', rail: 'high', factory: 'medium', lights: 'low', school: 'medium', water: 'high', hospital: 'high', data: 'high', fire: 'high', mall: 'low' });
  assert.ok(state.blocks.every((block) => block.powerRequirement === POWER_LEVELS[block.powerMode]));
});

test('countdown and pause freeze the reserve and round time', () => {
  const engine = game({ COUNTDOWN_DURATION: 3 });
  engine.command({ type: 'start' });
  engine.tick(1);
  assert.equal(engine.snapshot().phase, 'countdown');
  assert.equal(engine.snapshot().storage, 100);
  engine.command({ type: 'pause' });
  const paused = engine.snapshot();
  engine.tick(8);
  assert.deepEqual(engine.snapshot(), paused);
  engine.command({ type: 'pause' });
  engine.tick(2.5);
  assert.equal(engine.snapshot().phase, 'playing');
  assert.ok(Math.abs(engine.snapshot().elapsed - 0.5) < 0.001);
});

test('movement stays continuous while held power intent steps through only three detents', () => {
  const engine = game();
  engine.command({ type: 'start' });
  engine.command({ type: 'input', x: 1, y: 1, powerDelta: 1 });
  engine.tick(0.1);
  const cursor = engine.snapshot().cursor;
  assert.ok(cursor.x > 2 && cursor.x < 2.5);
  assert.ok(Math.abs(Math.hypot(cursor.x - 2, cursor.y - 2) - 0.31) < 0.00001);
  assert.equal(engine.snapshot().powerMode, 'medium');
  assert.equal(engine.snapshot().power, 60);
  engine.command({ type: 'input', powerDelta: 1 });
  engine.tick(0.1);
  assert.equal(engine.snapshot().powerMode, 'medium', 'Repeated intent packets do not retrigger an edge');
  engine.tick(4);
  assert.deepEqual(engine.snapshot().cursor, { x: 5, y: 5 });
  assert.equal(engine.snapshot().power, 85);
  engine.command({ type: 'input', powerDelta: -1 });
  engine.tick(0.05);
  assert.equal(engine.snapshot().powerMode, 'medium');
  engine.command({ type: 'input', powerDelta: 0 });
  engine.tick(1);
  assert.equal(engine.snapshot().powerMode, 'medium');
  engine.command({ type: 'input', powerDelta: -1 });
  engine.tick(1);
  assert.equal(engine.snapshot().powerMode, 'low');
  assert.equal(engine.snapshot().power, 35);
});

test('first natural demand is a low-power green building and later waves compete', () => {
  const engine = new GameEngine({ config: { COUNTDOWN_DURATION: 0 }, random: () => 0.5 });
  engine.command({ type: 'start' });
  engine.tick(2.1);
  const first = engine.snapshot().blocks.filter((block) => block.status === 'warning');
  assert.equal(first.length, 1);
  assert.equal(first[0].id, 'farm');
  assert.ok(first[0].powerRequirement <= 40);
  engine.tick(12.1);
  assert.ok(['warning', 'stabilizing'].includes(selected(engine, 'hospital').status));
  assert.ok(['warning', 'stabilizing'].includes(selected(engine, 'school').status));
  engine.tick(29);
  assert.ok(engine.snapshot().stats.warnings >= 4);
  assert.ok(engine.snapshot().crisisStage >= 3);
});

test('a lower power mode cannot rescue a higher demand and breaks the stabilization hold', () => {
  const engine = game();
  startDebug(engine);
  warn(engine, 'hospital');
  engine.command({ type: 'power', mode: 'high' });
  engine.tick(0.6);
  assert.equal(selected(engine, 'hospital').status, 'stabilizing');
  assert.ok(selected(engine, 'hospital').stabilization > 0.5);
  engine.command({ type: 'power', mode: 'medium' });
  engine.tick(0.1);
  assert.equal(selected(engine, 'hospital').status, 'warning');
  assert.equal(selected(engine, 'hospital').stabilization, 0);
  engine.command({ type: 'power', mode: 'high' });
  engine.tick(1.2);
  assert.equal(selected(engine, 'hospital').status, 'stabilized');
  assert.equal(engine.snapshot().score.priority, 100);
  assert.equal(engine.snapshot().score.criticalBonus, 25);
});

test('overpower still stabilizes but uses materially more reserve', () => {
  const exact = game();
  const excess = game();
  for (const engine of [exact, excess]) { startDebug(engine); warn(engine, 'farm'); }
  exact.command({ type: 'power', mode: 'low' });
  excess.command({ type: 'power', mode: 'high' });
  exact.tick(4);
  excess.tick(4);
  assert.equal(selected(exact, 'farm').saves, 1);
  assert.equal(selected(excess, 'farm').saves, 1);
  assert.ok(exact.snapshot().storage - excess.snapshot().storage > 8);
  assert.equal(excess.snapshot().energyWaste, true);
  assert.equal(exact.snapshot().energyWaste, false);
});

test('repeat rescues cannot farm points; losing a critical service removes its preservation bonus', () => {
  const engine = game();
  startDebug(engine);
  warn(engine, 'hospital');
  engine.command({ type: 'power', mode: 'high' });
  engine.tick(1.2);
  const initialScore = engine.snapshot().score.total;
  warn(engine, 'hospital');
  engine.tick(1.2);
  assert.equal(selected(engine, 'hospital').saves, 2);
  assert.equal(engine.snapshot().stats.saved, 1);
  assert.equal(engine.snapshot().score.total, initialScore);
  engine.command({ type: 'debug', action: 'fail', value: 'hospital' });
  assert.equal(engine.snapshot().score.priority, 100);
  assert.equal(engine.snapshot().score.criticalBonus, 0);
  assert.equal(engine.snapshot().stats.criticalLost, 1);
});

test('an expired warning fails permanently even if high power is applied later', () => {
  const engine = game({ WARNING_DURATION: 1, STABILIZATION_DURATION: 1.3 });
  startDebug(engine);
  warn(engine, 'farm');
  engine.command({ type: 'power', mode: 'low' });
  engine.tick(1.3);
  assert.equal(selected(engine, 'farm').status, 'failed');
  assert.equal(engine.snapshot().score.priority, 0);
  engine.command({ type: 'power', mode: 'high' });
  engine.tick(2);
  assert.equal(selected(engine, 'farm').status, 'failed');
  assert.equal(engine.command({ type: 'debug', action: 'restore', value: 'farm' }), false);
  assert.equal(engine.command({ type: 'debug', action: 'warn', value: 'farm' }), false);
  assert.equal(engine._save(engine.state.blocks.find((block) => block.id === 'farm')), false);
  assert.equal(selected(engine, 'farm').status, 'failed');
  engine.command({ type: 'reset' });
  assert.equal(selected(engine, 'farm').status, 'powered', 'Only a fresh city can replace a failed building');
});

test('empty reserve immediately collapses the city and denies survival/efficiency bonuses', () => {
  const engine = game({ INITIAL_STORAGE: 0.1 });
  engine.command({ type: 'start' });
  engine.tick(1);
  const state = engine.snapshot();
  assert.equal(state.phase, 'results');
  assert.equal(state.result.outcome, 'collapse');
  assert.equal(state.result.endReason, 'reserve_empty');
  assert.equal(state.result.storage, 0);
  assert.equal(state.result.score.survival, 0);
  assert.equal(state.result.score.efficiency, 0);
  assert.equal(state.result.stats.criticalLost, 4);
  assert.equal(state.result.stats.online, 0);
  assert.ok(state.result.survivalTime < 1);
  assert.ok(state.result.reactions.every((reaction) => reaction.tone === 'lost'));
});

test('26 failed buildings can finish the shift, but the 27th ends it immediately with reserve and nine survivors intact', () => {
  const safeConfig = { ROUND_DURATION: 1, INITIAL_STORAGE: 73, STORAGE_DRAIN_RATE: 0, POWER_OUTPUT_DRAIN: 0, OVERPOWER_PENALTY: 0 };
  for (const failed of [26, 27]) {
    const engine = game(safeConfig);
    startDebug(engine);
    const ids = engine.snapshot().blocks.map((block) => block.id);
    for (const id of ids.slice(0, failed)) assert.equal(engine.command({ type: 'debug', action: 'fail', value: id }), true);
    assert.equal(engine.snapshot().stats.failed, failed);
    assert.equal(engine.snapshot().stats.lossLimit, 27);
    if (failed === 26) {
      assert.equal(engine.snapshot().phase, 'playing');
      assert.equal(engine.snapshot().result, null);
      engine.tick(1);
    } else assert.equal(engine.snapshot().phase, 'results', 'The final failure requires no additional engine tick');
    const result = engine.snapshot().result;
    assert.equal(result.endReason, failed === 26 ? 'shift_complete' : 'city_blackout');
    assert.equal(result.stats.failed, failed);
    assert.equal(result.stats.online, 36 - failed);
    assert.equal(result.storage, 73);
    assert.equal(result.score.survival, failed === 26 ? 100 : 0);
    assert.equal(result.score.efficiency, failed === 26 ? 44 : 0);
    assert.equal(result.decisionReport.energyUsed, 0);
    assert.equal(result.decisionReport.storageRemaining, 73);
    assert.equal(result.practice, true);
    if (failed === 27) {
      assert.equal(engine.snapshot().caption.tone, 'cityBlackout');
      assert.match(engine.snapshot().caption.text, /Twenty-seven buildings/);
      assert.doesNotMatch(engine.snapshot().caption.text, /reserve is empty/i);
    }
  }
});

test('the 27th expired warning wins over a simultaneous shift deadline and stops further failures in that step', () => {
  const engine = game({ ROUND_DURATION: 1, INITIAL_STORAGE: 73, STORAGE_DRAIN_RATE: 0, POWER_OUTPUT_DRAIN: 0, OVERPOWER_PENALTY: 0 });
  startDebug(engine);
  engine.tick(0.95);
  for (const block of engine.state.blocks.slice(0, 26)) engine.command({ type: 'debug', action: 'fail', value: block.id });
  for (const block of engine.state.blocks.slice(26, 28)) {
    engine.command({ type: 'debug', action: 'warn', value: block.id });
    block.warningRemaining = 0.05;
  }
  engine.tick(0.05);
  const state = engine.snapshot();
  assert.equal(state.result.endReason, 'city_blackout');
  assert.equal(state.result.survived, false);
  assert.equal(state.stats.failed, 27);
  assert.equal(state.blocks[26].status, 'failed');
  assert.equal(state.blocks[27].status, 'warning', 'The round stops at the threshold, preserving exactly nine remaining buildings');
  assert.equal(state.stats.online, 9);
  assert.equal(state.storage, 73);
  assert.equal(state.score.survival, 0);
  assert.equal(state.score.efficiency, 0);
});

test('full survival gives bounded secondary bonuses and automatically resets for the next player', () => {
  const engine = game({ ROUND_DURATION: 5, AUTO_RESET_DURATION: 2 });
  engine.command({ type: 'start' });
  engine.tick(5);
  const state = engine.snapshot();
  assert.equal(state.phase, 'results');
  assert.equal(state.result.survived, true);
  assert.equal(state.result.endReason, 'shift_complete');
  assert.equal(state.result.survivalTime, 5);
  assert.equal(state.score.priority, 0);
  assert.equal(state.score.survival, 100);
  assert.ok(state.score.efficiency <= 60);
  assert.equal(state.score.total, state.score.priority + state.score.criticalBonus + state.score.survival + state.score.efficiency);
  engine.tick(2.1);
  assert.equal(engine.snapshot().phase, 'ready');
  assert.notEqual(engine.snapshot().roundId, state.roundId);
  assert.equal(engine.snapshot().storage, 100);
});

test('NPC warnings are contextual and immediate critical messages override normal cadence', () => {
  const engine = game();
  startDebug(engine);
  warn(engine, 'hospital');
  engine.tick(4.1);
  assert.equal(engine.snapshot().caption.npcId, 'hospital_worker');
  assert.equal(engine.snapshot().caption.tone, 'ignored');
  engine.command({ type: 'debug', action: 'fail', value: 'hospital' });
  engine.tick(0.05);
  assert.equal(engine.snapshot().caption.tone, 'lost');
  assert.equal(engine.snapshot().caption.npcId, 'hospital_worker');
  engine.command({ type: 'debug', action: 'storage', value: 15 });
  engine.tick(0.05);
  assert.equal(engine.snapshot().caption.tone, 'storageCritical');
});

test('malformed inputs/config cannot introduce nonfinite state and debug mutations flag practice', () => {
  const config = resolveConfig({ DIFFICULTY: '__proto__', ROUND_DURATION: NaN, PHYSICS_STEP: 0 });
  assert.equal(config.DIFFICULTY, 'normal');
  assert.equal(config.ROUND_DURATION, 60);
  assert.ok(config.PHYSICS_STEP > 0);
  const engine = game();
  for (const command of [null, [], { type: 'power', value: NaN }, { type: 'power', value: Infinity },
    { type: 'power', value: 35 }, { type: 'power', mode: 'low', value: 35 },
    { type: 'power', mode: 'off' }, { type: 'power', mode: 'LOW' }, { type: 'power', mode: 35 },
    { type: 'input', x: '1' }, { type: 'select', id: 'missing' }, { type: 'difficulty', value: '__proto__' }]) {
    assert.equal(engine.command(command), false);
  }
  engine.tick(NaN);
  engine.tick(Infinity);
  assert.equal(engine.snapshot().elapsed, 0);
  assert.equal(engine.command({ type: 'debug', action: 'storage', value: 10 }), false);
  engine.command({ type: 'debug', action: 'toggle' });
  assert.equal(engine.snapshot().practice, false);
  engine.command({ type: 'debug', action: 'npc', value: '__proto__' });
  assert.equal(engine.snapshot().practice, true);
  engine.command({ type: 'reset' });
  assert.equal(engine.snapshot().practice, false);
});

test('a frame-rate change does not change rescue, failure, or energy outcomes', () => {
  const a = game();
  const b = game();
  for (const engine of [a, b]) {
    startDebug(engine); warn(engine, 'hospital'); engine.command({ type: 'power', mode: 'high' });
  }
  a.tick(2);
  for (let index = 0; index < 40; index += 1) b.tick(0.05);
  assert.equal(a.snapshot().score.total, b.snapshot().score.total);
  assert.equal(selected(a, 'hospital').status, selected(b, 'hospital').status);
  assert.ok(Math.abs(a.snapshot().storage - b.snapshot().storage) < 0.00001);
});

test('post-round diagnostics also disqualify the frozen result from a leaderboard submission', () => {
  const engine = game({ ROUND_DURATION: 1 });
  engine.command({ type: 'start' });
  engine.tick(1);
  assert.equal(engine.snapshot().result.practice, false);
  engine.command({ type: 'debug', action: 'toggle' });
  assert.equal(engine.snapshot().result.practice, false);
  engine.command({ type: 'debug', action: 'storage', value: 42 });
  assert.equal(engine.snapshot().practice, true);
  assert.equal(engine.snapshot().result.practice, true);
  assert.notEqual(engine.snapshot().result.storage, 42);
});

test('leaving maximum output on a low-demand block collapses early, careful power preserves reserve', () => {
  const maximum = game();
  const matched = game();
  for (const engine of [maximum, matched]) {
    engine.command({ type: 'start' });
    engine.command({ type: 'select', id: 'farm' });
  }
  maximum.command({ type: 'power', mode: 'high' });
  matched.command({ type: 'power', mode: 'low' });
  maximum.tick(35);
  matched.tick(60);
  assert.equal(maximum.snapshot().result?.outcome, 'collapse');
  assert.ok(maximum.snapshot().result.survivalTime < 35);
  assert.equal(matched.snapshot().result.outcome, 'survived');
  assert.ok(matched.snapshot().result.storage > 30);
});

test('120 consecutive exhibition rounds tolerate variable ticks, random inputs, pauses, and resets', () => {
  let seed = 20260910;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const engine = new GameEngine({ config: { COUNTDOWN_DURATION: 0.1 }, random });
  let collapses = 0;
  let survivals = 0;
  const roundIds = new Set();

  function verifyNumbers(value, location = 'state') {
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${location} must be finite`);
    else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) verifyNumbers(child, `${location}.${key}`);
    }
  }

  for (let round = 0; round < 120; round += 1) {
    engine.command({ type: 'difficulty', value: ['easy', 'normal', 'hard'][round % 3] });
    assert.equal(engine.command({ type: 'start' }), true);
    let state = engine.snapshot();
    assert.ok(!roundIds.has(state.roundId));
    roundIds.add(state.roundId);
    let steps = 0;
    while (state.phase !== 'results' && steps < 1000) {
      steps += 1;
      if (steps % 37 === 0) {
        assert.equal(engine.command({ type: 'pause' }), true);
        const paused = engine.snapshot();
        engine.tick(0.1 + random() * 4);
        assert.deepEqual(engine.snapshot(), paused);
        engine.command({ type: 'pause' });
      }
      assert.equal(engine.command(steps % 2 ? { type: 'input', x: Infinity } : { type: 'power', value: 'invalid' }), false);
      if (round % 7 === 0) {
        engine.command({ type: 'select', id: 'farm' });
        engine.command({ type: 'power', mode: 'high' });
      } else if (round % 11 === 0) {
        engine.command({ type: 'input', x: 0, y: 0, powerDelta: 0 });
        engine.command({ type: 'power', mode: 'low' });
      } else {
        engine.command({ type: 'input', x: random() * 2 - 1, y: random() * 2 - 1, powerDelta: random() * 2 - 1, stabilize: random() > 0.5 });
        if (steps % 4 === 0) engine.command({ type: 'select', id: state.blocks[Math.floor(random() * 36)].id });
        if (steps % 3 === 0) engine.command({ type: 'power', mode: ['low', 'medium', 'high'][Math.floor(random() * 3)] });
      }
      engine.tick(steps % 29 === 0 ? 1.2 : 0.01 + random() * 0.65);
      state = engine.snapshot();
      assert.ok(state.storage >= 0 && state.storage <= 100);
      assert.ok(POWER_MODES.includes(state.powerMode));
      assert.equal(state.power, POWER_LEVELS[state.powerMode]);
      assert.ok(state.cursor.x >= 0 && state.cursor.x <= 5 && state.cursor.y >= 0 && state.cursor.y <= 5);
      assert.ok(state.elapsed >= 0 && state.elapsed <= 60);
      assert.equal(state.blocks.length, 36);
      assert.ok(state.events.length <= 12);
      if (steps % 20 === 0) verifyNumbers(state);
    }
    assert.equal(state.phase, 'results', `Round ${round} must end`);
    verifyNumbers(state);
    assert.equal(state.result.score.total, state.result.score.priority + state.result.score.criticalBonus + state.result.score.efficiency + state.result.score.survival);
    assert.equal(state.result.roundId, state.roundId);
    const report = state.result.decisionReport;
    assert.ok(Math.abs(report.initialStorage - report.storageRemaining - report.energyUsed) < 0.000001, 'Every round conserves reserve units');
    assert.ok(report.idleOutputEnergy <= report.outputDelivery + 0.000001);
    assert.ok(report.reducibleIdleOutputEnergy <= report.idleOutputEnergy + 0.000001);
    assert.ok(report.matchedRescues <= report.totalRescues);
    if (state.result.survived) survivals += 1;
    else collapses += 1;
    engine.tick(15.1);
    const reset = engine.snapshot();
    assert.equal(reset.phase, 'ready');
    assert.equal(reset.storage, 100);
    assert.equal(reset.elapsed, 0);
    assert.equal(reset.score.total, 0);
    assert.equal(reset.result, null);
    assert.equal(reset.practice, false);
    assert.equal(reset.blocks.filter((block) => block.status === 'powered').length, 36);
    assert.equal(reset.events.length, 0);
  }
  assert.ok(collapses > 0 && survivals > 0, 'Soak must exercise both result paths');
});

test('guided practice is self-paced, requires efficient matching, and teaches release without scoring', () => {
  const engine = game();
  assert.equal(engine.command({ type: 'practice' }), true);
  engine.tick(180);
  assert.equal(engine.snapshot().phase, 'practice');
  assert.equal(engine.snapshot().training.step, 'select');
  assert.equal(engine.snapshot().storage, 100);
  assert.equal(engine.snapshot().elapsed, 0);
  assert.equal(engine.snapshot().stats.online, 36);
  assert.equal(engine.snapshot().result, null);
  engine.command({ type: 'select', id: engine.snapshot().training.targetId });
  engine.tick(0.05);
  assert.equal(engine.snapshot().training.step, 'match');
  engine.command({ type: 'power', mode: 'high' });
  engine.tick(2);
  assert.equal(engine.snapshot().training.step, 'match');
  assert.equal(engine.snapshot().training.progress, 0);
  assert.equal(engine.snapshot().storage, 100);
  engine.command({ type: 'power', mode: 'medium' });
  engine.tick(1.15);
  assert.equal(engine.snapshot().training.step, 'release');
  engine.tick(3);
  assert.equal(engine.snapshot().training.step, 'release');
  engine.command({ type: 'power', mode: 'low' });
  engine.tick(0.75);
  assert.equal(engine.snapshot().training.step, 'complete');
  assert.equal(engine.snapshot().training.progress, 1);
  engine.tick(20);
  assert.equal(engine.snapshot().score.total, 0);
  assert.equal(engine.snapshot().stats.saved, 0);
  assert.equal(engine.snapshot().energy.totalRescues, 0);
  assert.equal(engine.snapshot().blocks.some((block) => block.scored), false);
  assert.equal(engine.snapshot().practice, true);
});

test('practice can pause or be skipped into a clean, scored countdown at any step', () => {
  for (const complete of [false, true]) {
    const engine = game({ COUNTDOWN_DURATION: 3 });
    engine.command({ type: 'practice' });
    engine.command({ type: 'select', id: engine.snapshot().training.targetId });
    engine.tick(0.1);
    engine.command({ type: 'pause' });
    const paused = engine.snapshot();
    engine.tick(15);
    assert.deepEqual(engine.snapshot(), paused);
    engine.command({ type: 'pause' });
    if (complete) {
      engine.command({ type: 'power', mode: 'medium' }); engine.tick(1.2);
      engine.command({ type: 'power', mode: 'low' }); engine.tick(0.8);
      assert.equal(engine.snapshot().training.step, 'complete');
    }
    const trainingRound = engine.snapshot().roundId;
    assert.equal(engine.command({ type: 'start' }), true);
    const started = engine.snapshot();
    assert.equal(started.phase, 'countdown');
    assert.equal(started.practice, false);
    assert.equal(started.training, null);
    assert.equal(started.storage, 100);
    assert.equal(started.powerMode, 'low');
    assert.equal(started.power, 35);
    assert.equal(started.score.total, 0);
    assert.equal(started.energy.totalRescues, 0);
    assert.ok(started.blocks.every((block) => block.status === 'powered'));
    assert.notEqual(started.roundId, trainingRound);
  }
});

test('attract demo shows real saves, waste, consequences, and smooth movement across unranked loops', () => {
  const engine = new GameEngine({ random: () => 0.5 });
  engine.command({ type: 'demo' });
  const types = new Set();
  let previous = engine.snapshot();
  for (let step = 0; step < 1500; step += 1) {
    engine.tick(0.05);
    const state = engine.snapshot();
    assert.equal(state.phase, 'demo');
    assert.equal(state.practice, true);
    assert.equal(state.result, null);
    if (state.demo.loop === previous.demo.loop) {
      assert.ok(Math.hypot(state.cursor.x - previous.cursor.x, state.cursor.y - previous.cursor.y) <= engine.config.CURSOR_SPEED * 0.05 + 0.000001);
    }
    state.events.forEach((event) => types.add(event.type));
    previous = state;
  }
  assert.ok(engine.snapshot().demo.loop >= 2);
  for (const type of ['warning', 'saved', 'overpower', 'critical_failure', 'survived']) assert.ok(types.has(type), `Demo should show ${type}`);
});

test('the first active demo input only wakes the display, while neutral input does not interrupt it', () => {
  const engine = game();
  for (const input of [{ type: 'wake' }, { type: 'start' }, { type: 'practice' }, { type: 'select', id: 'farm' },
    { type: 'power', mode: 'high' }, { type: 'input', x: 1 }, { type: 'input', stabilize: true }]) {
    engine.command({ type: 'demo' });
    engine.command({ type: 'input', x: 0, y: 0, powerDelta: 0, stabilize: false });
    assert.equal(engine.snapshot().phase, 'demo');
    assert.equal(engine.command(input), true);
    assert.equal(engine.snapshot().phase, 'ready');
    assert.equal(engine.snapshot().practice, false);
    assert.equal(engine.snapshot().powerMode, 'low');
    assert.equal(engine.snapshot().power, 35);
    assert.equal(engine.snapshot().result, null);
  }
});

test('energy report conserves reserve through collapse including a partially funded rescue', () => {
  const engine = game({ INITIAL_STORAGE: 0.05, STORAGE_DRAIN_RATE: 0, POWER_OUTPUT_DRAIN: 0, OVERPOWER_PENALTY: 0, RESCUE_ENERGY_COST: 1 });
  startDebug(engine);
  warn(engine, 'farm');
  engine.command({ type: 'power', mode: 'low' });
  engine.tick(1.2);
  const report = engine.snapshot().result.decisionReport;
  assert.equal(engine.snapshot().result.outcome, 'collapse');
  assert.ok(Math.abs(report.energyUsed - 0.05) < 0.0000001);
  assert.equal(report.rescueEnergy, report.energyUsed);
  assert.equal(report.totalRescues, 1);
  assert.equal(report.matchedRescues, 1);
  assert.equal(report.storageRemaining, 0);
  assert.equal(report.normalDemand + report.outputDelivery + report.overpowerWaste + report.rescueEnergy, report.energyUsed);
});

test('idle delivery is a subset, while excess waste and debug reserve adjustments remain separately accounted', () => {
  const engine = game({ ROUND_DURATION: 5 });
  startDebug(engine);
  engine.command({ type: 'select', id: 'farm' });
  engine.command({ type: 'power', mode: 'high' });
  engine.tick(1);
  const energy = engine.snapshot().energy;
  assert.ok(energy.outputDelivery > 0);
  assert.equal(energy.idleOutputEnergy, energy.outputDelivery);
  assert.ok(energy.overpowerWaste > 0);
  assert.ok(Math.abs(energy.excessSeconds - 1) < 0.000001);
  engine.command({ type: 'debug', action: 'storage', value: 50 });
  engine.command({ type: 'debug', action: 'storage', value: 80 });
  engine.tick(4);
  const report = engine.snapshot().result.decisionReport;
  const balance = report.initialStorage + report.storageAddedByDebug - report.storageRemovedByDebug - report.storageRemaining;
  assert.ok(Math.abs(balance - report.energyUsed) < 0.000001);
  assert.equal(report.energyWasted, report.overpowerWaste);
  assert.ok(report.idleOutputEnergy <= report.outputDelivery + 0.000001);
  assert.equal(report.tip.id, 'match_power');
  engine.command({ type: 'debug', action: 'storage', value: 0 });
  assert.deepEqual(engine.snapshot().result.decisionReport, report, 'Completed report stays frozen');
});

test('decision tips reflect missed critical services and efficient rescued outcomes', () => {
  for (const loseHospital of [false, true]) {
    const engine = game({ ROUND_DURATION: 3 });
    startDebug(engine);
    warn(engine, 'farm');
    engine.command({ type: 'power', mode: 'low' });
    engine.tick(1.2);
    engine.command({ type: 'power', mode: 'low' });
    if (loseHospital) engine.command({ type: 'debug', action: 'fail', value: 'hospital' });
    engine.tick(1.8);
    const report = engine.snapshot().result.decisionReport;
    assert.equal(report.totalRescues, 1);
    assert.equal(report.matchedRescues, 1);
    assert.equal(report.energyWasted, 0);
    assert.equal(report.tip.id, loseHospital ? 'protect_critical' : 'strong_shift');
    assert.equal(report.criticalLost.length, loseHospital ? 1 : 0);
    assert.equal(report.criticalSaved.length, loseHospital ? 3 : 4);
  }
});

test('dominant idle output takes coaching priority over one overpowered rescue', () => {
  const engine = game({ ROUND_DURATION: 20 });
  startDebug(engine);
  warn(engine, 'farm');
  // One MEDIUM rescue of a LOW demand is inefficient, but idle HIGH output dominates.
  engine.command({ type: 'power', mode: 'medium' });
  engine.tick(1.2);
  engine.command({ type: 'select', id: 'hospital' });
  engine.command({ type: 'power', mode: 'high' });
  engine.tick(18.8);
  const report = engine.snapshot().result.decisionReport;
  assert.equal(report.totalRescues, 1);
  assert.equal(report.matchedRescues, 0);
  assert.ok(report.energyWasted > 0);
  assert.ok(report.idleOutputEnergy > report.energyWasted * 2);
  assert.ok(report.idleOutputEnergy > report.energyUsed * 0.15);
  assert.ok(report.reducibleIdleOutputEnergy > 5);
  assert.ok(report.reducibleIdleOutputEnergy < report.idleOutputEnergy);
  assert.equal(report.tip.id, 'release_power');
});

test('a LOW-only hard blackout recommends protecting the city and never asks for an impossible lower output', () => {
  const settings = { seed: 0, roundId: 'low-only-blackout', config: { DIFFICULTY: 'hard' } };
  const engine = createSeededEngine(settings);
  engine.command({ type: 'start' });
  let ticks = 0;
  while (engine.state.phase !== 'results' && ticks < 1300) {
    engine.tick(REPLAY_STEP);
    ticks += 1;
    assert.equal(engine.state.powerMode, 'low');
  }
  const result = engine.snapshot().result;
  const report = result.decisionReport;
  assert.equal(result.endReason, 'city_blackout');
  assert.equal(result.stats.failed, 27);
  assert.ok(report.idleOutputEnergy > 5, 'The normal LOW baseline still records actual idle delivery');
  assert.equal(report.reducibleIdleOutputEnergy, 0);
  assert.equal(report.tip.id, 'protect_city');
  assert.doesNotMatch(report.tip.text, /return to low|turn down/i);
  assert.deepEqual(replayRound({ ...settings, commands: [], ticks }), result, 'The entire corrected report remains authoritative and deterministic');
});

test('between-shift configuration updates preserve results and apply to the next round', () => {
  const engine = game({ ROUND_DURATION: 1 });
  engine.command({ type: 'difficulty', value: 'hard' });
  assert.equal(engine.configure({ ATTRACT_ENABLED: false }), true);
  assert.equal(engine.snapshot().difficulty, 'hard');
  assert.equal(engine.config.ATTRACT_ENABLED, false);
  engine.command({ type: 'start' });
  assert.equal(engine.configure({ ROUND_DURATION: 10 }), false);
  engine.tick(1);
  const completed = engine.snapshot().result;
  assert.equal(engine.configure({ ROUND_DURATION: 10, AUTO_RESET_DURATION: 5, DIFFICULTY: 'easy' }), true);
  assert.deepEqual(engine.snapshot().result, completed);
  engine.command({ type: 'start' });
  assert.equal(engine.snapshot().remaining, 10);
  assert.equal(engine.snapshot().difficulty, 'easy');
  engine.command({ type: 'reset' });
  engine.command({ type: 'demo' });
  engine.configure({ ATTRACT_ENABLED: false });
  assert.equal(engine.snapshot().phase, 'ready');
});
