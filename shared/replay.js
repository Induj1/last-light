import { GameEngine } from '../server/engine.js';
import { DIFFICULTIES, GAME_CONFIG, resolveConfig } from './config.js';
import { isPowerMode } from './power.js';

// Bump this identifier whenever a change can alter a scored simulation or input semantics.
export const REPLAY_VERSION = 'last-light-replay-v2-three-modes';
export const REPLAY_STEP = 0.05;
export const MAX_REPLAY_COMMANDS = 20000;

export class ReplayError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReplayError';
    this.status = 400;
    this.code = 'INVALID_REPLAY';
  }
}

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const finiteRange = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const requireReplay = (condition, message) => { if (!condition) throw new ReplayError(message); };

/** Mulberry32 uses defined 32-bit integer operations identically in browsers and Node. */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function checkedConfig(config) {
  requireReplay(record(config), 'Round configuration must be an object.');
  const resolved = resolveConfig(config);
  const phaseFields = ['from', 'interval', 'burst', 'maxWarnings', 'warningScale', 'criticalBias'];
  for (const [key, value] of Object.entries(config)) {
    requireReplay(Object.hasOwn(GAME_CONFIG, key), 'Round configuration contains an unknown setting.');
    if (typeof GAME_CONFIG[key] === 'number') {
      requireReplay(finiteRange(value, 0, Number.MAX_SAFE_INTEGER) && resolved[key] === value, 'Round configuration contains an invalid number.');
    } else if (typeof GAME_CONFIG[key] === 'boolean') {
      requireReplay(typeof value === 'boolean', 'Round configuration contains an invalid flag.');
    } else if (key === 'DIFFICULTY') {
      requireReplay(typeof value === 'string' && Object.hasOwn(DIFFICULTIES, value), 'Round difficulty is invalid.');
    } else if (key === 'FAILURE_PHASES') {
      requireReplay(Array.isArray(value) && value.length > 0 && value.length <= 16, 'Failure phases are invalid.');
      for (const phase of value) {
        requireReplay(record(phase) && Object.keys(phase).every((field) => phaseFields.includes(field))
          && phaseFields.every((field) => finiteRange(phase[field], 0, Number.MAX_SAFE_INTEGER))
          && phase.interval > 0 && phase.warningScale > 0, 'Failure phases are invalid.');
      }
    }
  }
  requireReplay(resolved.ROUND_DURATION <= 180 && resolved.COUNTDOWN_DURATION <= 10, 'Round duration exceeds the replay limit.');
  return resolved;
}

/**
 * Return a fresh, ready engine. The caller sends start exactly once, outside the tape.
 * Do not reuse a practice/demo engine: even captions advance its random generator.
 */
export function createSeededEngine({ seed, roundId, config = {} } = {}) {
  requireReplay(Number.isInteger(seed) && finiteRange(seed, 0, 4294967295), 'Round seed must be an unsigned 32-bit integer.');
  requireReplay(typeof roundId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(roundId), 'Round identifier is invalid.');
  return new GameEngine({ config: checkedConfig(config), random: seededRandom(seed), idFactory: () => roundId });
}

function validateCommand(command, buildingIds) {
  requireReplay(record(command), 'Each replay command must be an object.');
  if (command.type === 'input') {
    requireReplay(Object.keys(command).every((key) => ['type', 'x', 'y', 'powerDelta', 'stabilize'].includes(key)), 'Input contains an unknown field.');
    for (const key of ['x', 'y', 'powerDelta']) {
      requireReplay(!Object.hasOwn(command, key) || finiteRange(command[key], -1, 1), 'Input axis or power change is out of range.');
    }
    requireReplay(!Object.hasOwn(command, 'stabilize') || typeof command.stabilize === 'boolean', 'Stabilization input must be a boolean.');
  } else if (command.type === 'power') {
    requireReplay(Object.keys(command).every((key) => ['type', 'mode'].includes(key)) && isPowerMode(command.mode), 'Power mode must be low, medium, or high.');
  } else if (command.type === 'select') {
    requireReplay(Object.keys(command).every((key) => ['type', 'id'].includes(key)) && typeof command.id === 'string' && buildingIds.has(command.id), 'Selected building is invalid.');
  } else {
    throw new ReplayError('Only movement, targeting, and power commands are allowed in a scored replay.');
  }
}

function finiteResult(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (value && typeof value === 'object') return Object.values(value).every(finiteResult);
  return true;
}

/**
 * Validate a scored tape and derive its result without trusting client scores.
 * tick=0 commands execute before the first 50ms step. Same-tick order is preserved.
 * ticks counts active countdown/playing steps; paused wall time is not represented.
 * The HTTP layer must verify signed tickets, session/event binding, elapsed wall time,
 * request size/rate limits, and atomically claim the round before publishing a score.
 */
export function replayRound({ seed, roundId, config = {}, commands, ticks } = {}) {
  const engine = createSeededEngine({ seed, roundId, config });
  const maximumTicks = Math.ceil((engine.config.COUNTDOWN_DURATION + engine.config.ROUND_DURATION) / REPLAY_STEP) + 2;
  requireReplay(Number.isInteger(ticks) && ticks > 0 && ticks <= maximumTicks, 'Replay tick count is invalid.');
  requireReplay(Array.isArray(commands) && commands.length <= MAX_REPLAY_COMMANDS, 'Replay command count exceeds the limit.');
  const buildingIds = new Set(engine.state.blocks.map((block) => block.id));
  let previousTick = -1;
  for (const item of commands) {
    requireReplay(record(item) && Object.keys(item).every((key) => ['tick', 'command'].includes(key)), 'Replay entry is invalid.');
    requireReplay(Number.isInteger(item.tick) && item.tick >= previousTick && item.tick >= 0 && item.tick < ticks, 'Replay commands must have ordered ticks within the round.');
    validateCommand(item.command, buildingIds);
    previousTick = item.tick;
  }
  engine.command({ type: 'start' });
  let index = 0;
  for (let tick = 0; tick < ticks; tick += 1) {
    while (index < commands.length && commands[index].tick === tick) {
      requireReplay(engine.command(commands[index].command), 'A command is not valid in this round state.');
      index += 1;
    }
    engine.tick(REPLAY_STEP);
    if (engine.state.phase === 'results') {
      requireReplay(tick + 1 === ticks && index === commands.length, 'Replay continues after the round has already ended.');
      const result = engine.snapshot().result;
      requireReplay(result && result.roundId === roundId && result.practice === false && finiteResult(result), 'Replay did not produce a valid scored result.');
      return result;
    }
  }
  throw new ReplayError('Replay ends before the round is complete.');
}
