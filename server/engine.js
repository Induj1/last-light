import { resolveConfig, DIFFICULTIES } from '../shared/config.js';
import { createBlocks } from '../shared/blocks.js';
import { NPCS } from '../shared/npcs.js';
import { POWER_LEVELS, isPowerMode, stepPowerMode, powerSatisfies, powerIsExcess } from '../shared/power.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const warning = (block) => block.status === 'warning' || block.status === 'stabilizing';
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Authoritative, deterministic (apart from injected randomness) game simulation.
 * Inputs change intent; only tick() advances the city. No browser or serial I/O.
 */
export class GameEngine {
  constructor({ config = {}, random = Math.random, idFactory = () => globalThis.crypto.randomUUID() } = {}) {
    this.config = resolveConfig(config);
    this.random = typeof random === 'function' ? random : Math.random;
    this.idFactory = idFactory;
    this.sequence = 0;
    this.reset();
  }

  reset() {
    const previousDebug = this.state?.debug ?? false;
    const difficulty = this.state?.difficulty ?? this.config.DIFFICULTY;
    this.state = {
      phase: 'ready', roundId: this.idFactory(), elapsed: 0,
      remaining: this.config.ROUND_DURATION, countdown: this.config.COUNTDOWN_DURATION,
      storage: this.config.INITIAL_STORAGE, powerMode: 'low', power: POWER_LEVELS.low,
      cursor: { x: 2, y: 2 }, selectedId: 'hospital', blocks: createBlocks(this.config),
      score: { priority: 0, criticalBonus: 0, efficiency: 0, survival: 0, total: 0 },
      stats: { saved: 0, criticalSaved: 0, criticalLost: 0, online: 36, failed: 0, lossLimit: 27, warnings: 0, gridLoad: 0 },
      caption: null, events: [], result: null, difficulty, debug: previousDebug,
      practice: false, autoResetRemaining: this.config.AUTO_RESET_DURATION,
      roundDuration: this.config.ROUND_DURATION, drainPerSecond: 0, energyWaste: false,
      crisisStage: 0,
      training: null, demo: null,
      energy: {
        initialStorage: this.config.INITIAL_STORAGE, normalDemand: 0, outputDelivery: 0,
        overpowerWaste: 0, rescueEnergy: 0, excessSeconds: 0, idleOutputEnergy: 0, reducibleIdleOutputEnergy: 0,
        matchedRescues: 0, totalRescues: 0, storageAddedByDebug: 0, storageRemovedByDebug: 0,
      },
    };
    this.input = { x: 0, y: 0, powerDelta: 0, stabilize: false };
    this.powerRepeatRemaining = 0;
    this.nextWave = 2 * this.config.ROUND_DURATION / 60;
    this.waveCount = 0;
    this.teachingCriticalTriggered = false;
    this.nextCaption = 0;
    this.lowStorageAnnounced = false;
    this.criticalStorageAnnounced = false;
    this.lastOverpowerEvent = -10;
    this.lastCountdownSecond = 11;
    this.pendingCriticalFailures = [];
    this.lastNpcTimes = {};
    this.resumePhase = 'playing';
    this.demoTargetId = null;
    this.demoRestUntil = 0;
    this.demoWasteTarget = null;
    this._caption('operator', 'ready');
    this._metrics();
  }

  /** Event settings take effect between shifts; completed results remain immutable. */
  configure(overrides = {}) {
    if (!['ready', 'results', 'demo'].includes(this.state.phase)) return false;
    this.config = resolveConfig({ ...this.config, DIFFICULTY: this.state.difficulty, ...overrides });
    this.state.difficulty = this.config.DIFFICULTY;
    if (this.state.phase === 'demo' && this.config.ATTRACT_ENABLED) this._beginDemo();
    else if (this.state.phase === 'demo') this.reset();
    else if (this.state.phase === 'ready') this.reset();
    return true;
  }

  command(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
    const state = this.state;
    // The first human action wakes an attract display. It never starts a scored shift.
    if (state.phase === 'demo') {
      const activeInput = message.type === 'input' && ['x', 'y', 'powerDelta'].some((key) => finite(message[key]) && message[key] !== 0)
        || message.type === 'input' && message.stabilize === true;
      if (['wake', 'start', 'practice', 'select', 'reset', 'restart'].includes(message.type)
        || message.type === 'power' && isPowerMode(message.mode) && !Object.hasOwn(message, 'value') || activeInput) {
        this.reset();
        return true;
      }
      if (message.type === 'input' || message.type === 'demo') return true;
      return false;
    }
    switch (message.type) {
      case 'practice':
        if (!['ready', 'results', 'practice'].includes(state.phase) && !(state.phase === 'paused' && this.resumePhase === 'practice')) return false;
        this._beginPractice();
        return true;
      case 'demo':
        if (!['ready', 'results'].includes(state.phase)) return false;
        this._beginDemo();
        return true;
      case 'wake':
        return false;
      case 'start':
        if (!['ready', 'results', 'practice'].includes(state.phase) && !(state.phase === 'paused' && this.resumePhase === 'practice')) return false;
        if (state.phase !== 'ready') this.reset();
        this.state.phase = this.config.COUNTDOWN_DURATION > 0 ? 'countdown' : 'playing';
        this.input = { x: 0, y: 0, powerDelta: 0, stabilize: false };
        this.powerRepeatRemaining = 0;
        this._event('start', 'GRID CONTROL TRANSFERRED');
        this._caption('operator', 'start');
        this.nextCaption = this.config.NPC_MESSAGE_INTERVAL;
        return true;
      case 'reset':
      case 'restart':
        this.reset();
        return true;
      case 'pause':
        if (state.phase === 'paused') state.phase = this.resumePhase;
        else if (['playing', 'countdown', 'practice'].includes(state.phase)) {
          this.resumePhase = state.phase;
          state.phase = 'paused';
        } else return false;
        this.input = { x: 0, y: 0, powerDelta: 0, stabilize: false };
        this.powerRepeatRemaining = 0;
        return true;
      case 'input': {
        for (const key of ['x', 'y', 'powerDelta']) {
          if (key in message && !finite(message[key])) return false;
        }
        for (const key of ['x', 'y', 'powerDelta']) {
          if (key in message) {
            if (key === 'powerDelta' && Math.sign(message[key]) !== Math.sign(this.input.powerDelta)) this.powerRepeatRemaining = 0;
            this.input[key] = clamp(message[key], -1, 1);
          }
        }
        if (typeof message.stabilize === 'boolean') this.input.stabilize = message.stabilize;
        return true;
      }
      case 'select': {
        if (!['ready', 'countdown', 'playing', 'practice'].includes(state.phase)) return false;
        const block = state.blocks.find((item) => item.id === message.id);
        if (!block) return false;
        state.cursor = { x: block.col, y: block.row };
        state.selectedId = block.id;
        return true;
      }
      case 'power':
        if (!isPowerMode(message.mode) || !Object.keys(message).every((key) => ['type', 'mode'].includes(key))) return false;
        this._setPowerMode(message.mode);
        return true;
      case 'difficulty':
        if (!Object.hasOwn(DIFFICULTIES, message.value) || !['ready', 'results'].includes(state.phase)) return false;
        state.difficulty = message.value;
        return true;
      case 'debug':
        return this._debug(message);
      default:
        return false;
    }
  }

  /** Substeps prevent warning/stabilization deadlines changing with frame rate. */
  tick(dt) {
    if (!finite(dt) || dt <= 0) return;
    let remaining = Math.min(dt, 3600);
    while (remaining > 0.0000001) {
      const step = Math.min(this.config.PHYSICS_STEP, remaining);
      this._step(step);
      remaining -= step;
    }
  }

  snapshot() {
    return structuredClone(this.state);
  }

  _step(dt) {
    const state = this.state;
    if (state.phase === 'ready' || state.phase === 'paused') return;
    if (state.phase === 'practice') {
      this._practice(dt);
      return;
    }
    if (state.phase === 'demo') {
      state.demo.elapsed += dt;
      if (state.demo.holdRemaining > 0) {
        state.demo.holdRemaining = Math.max(0, state.demo.holdRemaining - dt);
        if (state.demo.holdRemaining <= 0.000001) this._beginDemo(state.demo.loop + 1);
        return;
      }
      this._demoInput(dt);
    }
    if (state.phase === 'results') {
      state.autoResetRemaining = Math.max(0, state.autoResetRemaining - dt);
      if (state.autoResetRemaining <= 0.000001) this.reset();
      return;
    }
    if (state.phase === 'countdown') {
      this._movePowerControls(dt);
      const leftover = Math.max(0, dt - state.countdown);
      state.countdown = Math.max(0, state.countdown - dt);
      if (state.countdown <= 0.000001) {
        state.countdown = 0;
        state.phase = 'playing';
        this._event('playing', 'CITY RESERVE ONLINE');
        if (leftover > 0.000001) this._step(leftover);
      }
      return;
    }

    dt = Math.min(dt, state.remaining);
    state.elapsed = Math.min(this.config.ROUND_DURATION, state.elapsed + dt);
    state.remaining = Math.max(0, this.config.ROUND_DURATION - state.elapsed);
    this._moveControls(dt);

    // PHASE 1: advance warning and building states.
    this._failures();
    const difficulty = DIFFICULTIES[state.difficulty];
    for (const block of state.blocks) {
      if (block.status === 'stabilized' && state.elapsed - block.lastSavedAt >= this.config.STABILIZED_DISPLAY_DURATION) block.status = 'powered';
      if (!warning(block)) continue;
      const targeted = block.id === state.selectedId;
      const sufficient = powerSatisfies(state.powerMode, block.powerMode);

      // PHASE 2: sufficient power is held automatically, including inefficient excess.
      const stabilizationTime = this.config.STABILIZATION_DURATION * difficulty.holdMultiplier;
      const timeToSave = targeted && sufficient ? (1 - block.stabilization) * stabilizationTime : Infinity;
      // Resolve whichever deadline occurs first, even when both cross in one substep.
      if (timeToSave <= dt + 0.0000001 && timeToSave <= block.warningRemaining + 0.0000001) {
        this._save(block);
        continue;
      }
      block.warningRemaining = Math.max(0, block.warningRemaining - dt);
      if (block.warningRemaining <= 0.0000001) {
        this._fail(block);
        if (state.phase === 'results' || state.demo?.holdRemaining > 0) return;
        continue;
      }
      if (targeted && sufficient) {
        block.status = 'stabilizing';
        block.stabilization = Math.min(1, block.stabilization + dt / stabilizationTime);
      } else {
        block.status = 'warning';
        // Breaking the hold requires a fresh stable connection.
        block.stabilization = 0;
      }
    }

    // PHASE 3: the city and continuously routed output draw from one reserve.
    this._storage(dt);
    this._metrics();
    if (state.storage <= 0) {
      this._finish(false, 'reserve_empty');
      return;
    }
    if (state.remaining <= 0.000001) {
      state.remaining = 0;
      state.elapsed = this.config.ROUND_DURATION;
      this._finish(true, 'shift_complete');
      return;
    }
    // PHASE 5: consequence captions use the actual current city state.
    this._npc();
    const second = Math.ceil(state.remaining);
    if (second <= 10 && second < this.lastCountdownSecond) {
      this.lastCountdownSecond = second;
      this._event('countdown', `${second} SECONDS OF RESERVE CONTROL`);
    }
  }

  _phase() {
    const normalized = this.state.elapsed / this.config.ROUND_DURATION * 60;
    const phases = this.config.FAILURE_PHASES;
    let phase = phases[0];
    for (let index = 0; index < phases.length; index += 1) {
      if (normalized >= phases[index].from) {
        phase = phases[index];
        this.state.crisisStage = index;
      }
    }
    return phase;
  }

  _moveControls(dt) {
    const state = this.state;
    const speed = this.config.CURSOR_SPEED;
    const length = Math.max(1, Math.hypot(this.input.x, this.input.y));
    state.cursor.x = clamp(state.cursor.x + this.input.x / length * speed * dt, 0, 5);
    state.cursor.y = clamp(state.cursor.y + this.input.y / length * speed * dt, 0, 5);
    state.selectedId = state.blocks[Math.round(state.cursor.y) * 6 + Math.round(state.cursor.x)].id;
    this._movePowerControls(dt);
  }

  _setPowerMode(mode) {
    this.state.powerMode = mode;
    this.state.power = POWER_LEVELS[mode];
  }

  _movePowerControls(dt) {
    const direction = Math.sign(this.input.powerDelta);
    if (!direction) { this.powerRepeatRemaining = 0; return; }
    this.powerRepeatRemaining -= dt;
    if (this.powerRepeatRemaining <= 0.000001) {
      this._setPowerMode(stepPowerMode(this.state.powerMode, direction));
      this.powerRepeatRemaining += this.config.POWER_REPEAT_INTERVAL;
    }
  }

  _beginPractice() {
    this.reset();
    const state = this.state;
    state.phase = 'practice';
    state.practice = true;
    state.training = { step: 'select', targetId: 'residential', matchMode: 'medium', releaseMode: 'low', elapsed: 0, progress: 0, message: 'Move the spotlight to the RESIDENTIAL AREA. Take your time.' };
    const target = state.blocks.find((block) => block.id === state.training.targetId);
    target.status = 'warning';
    // A training demand has no deadline. The display hides the normal failure timer.
    target.warningDuration = 0;
    target.warningRemaining = 0;
    this._trainingCaption(state.training.message);
    this._metrics();
  }

  _trainingCaption(text) {
    this._caption('operator', 'ready');
    this.state.caption.text = text;
    this.state.caption.tone = 'training';
  }

  _practice(dt) {
    const state = this.state;
    const training = state.training;
    const target = state.blocks.find((block) => block.id === training.targetId);
    training.elapsed += dt;
    this._moveControls(dt);
    state.energyWaste = powerIsExcess(state.powerMode, target.powerMode);
    const change = (step, message) => {
      training.step = step;
      training.progress = 0;
      training.message = message;
      this._trainingCaption(message);
    };
    if (training.step === 'select' && state.selectedId === target.id) {
      change('match', `Match the ${target.name}: choose MEDIUM power and hold the spotlight steady.`);
    } else if (training.step === 'match') {
      const matched = state.selectedId === target.id && state.powerMode === target.powerMode;
      training.progress = matched ? Math.min(1, training.progress + dt / this.config.PRACTICE_MATCH_DURATION) : 0;
      target.status = matched ? 'stabilizing' : 'warning';
      target.stabilization = training.progress;
      if (training.progress >= 1 - 0.000001) {
        target.status = 'stabilized';
        target.stabilization = 1;
        this._event('saved', 'PRACTICE — POWER MATCHED', target.id);
        change('release', 'Connection steady! Return to LOW between rescues to protect the reserve.');
      }
    } else if (training.step === 'release') {
      training.progress = state.powerMode === 'low' ? Math.min(1, training.progress + dt / this.config.PRACTICE_RELEASE_DURATION) : 0;
      if (training.progress >= 1 - 0.000001) {
        change('complete', 'You are ready: choose a demand, match its power, then turn down. Begin your scored shift when you are ready.');
        training.progress = 1;
        this._event('practice_complete', 'OPERATOR TRAINING COMPLETE');
      }
    }
    this._metrics();
  }

  _beginDemo(loop = 1) {
    this.reset();
    this.state.phase = 'demo';
    this.state.practice = true;
    this.state.demo = {
      stage: 'intro', message: 'A city needs an operator. Touch a control to take over.',
      elapsed: 0, loop, holdRemaining: 0, outcome: null,
    };
    this.nextCaption = this.config.NPC_MESSAGE_INTERVAL;
    this._caption('operator', 'start');
  }

  _demoInput(dt) {
    const state = this.state;
    const demo = state.demo;
    let target = state.blocks.find((block) => block.id === this.demoTargetId && warning(block));
    if (!target && state.elapsed >= this.demoRestUntil) {
      // The unattended school makes the human consequence of a competing demand visible.
      target = state.blocks.filter((block) => warning(block) && block.id !== 'school')
        .sort((a, b) => (b.priority + (b.critical ? 60 : 0)) - (a.priority + (a.critical ? 60 : 0)))[0];
      this.demoTargetId = target?.id ?? null;
    }
    let desiredMode = 'low';
    this.input = { x: 0, y: 0, powerDelta: 0, stabilize: false };
    if (!target || state.elapsed < this.demoRestUntil) {
      demo.stage = state.elapsed < 2 ? 'intro' : 'release';
      demo.message = state.elapsed < 2 ? 'Watch the city. A blinking block needs power.' : 'Lower output between rescues. Every unit of reserve matters.';
    } else {
      const dx = target.col - state.cursor.x;
      const dy = target.row - state.cursor.y;
      const distance = Math.hypot(dx, dy);
      const movement = Math.min(1, distance / Math.max(0.00001, this.config.CURSOR_SPEED * dt));
      this.input.x = distance > 0 ? dx / distance * movement : 0;
      this.input.y = distance > 0 ? dy / distance * movement : 0;
      if (distance > 0.2) {
        demo.stage = 'select';
        demo.message = `Move the spotlight to ${target.name}. Its colour shows the power it needs.`;
      } else {
        if (!this.demoWasteTarget && state.elapsed >= 7 && !target.critical && target.powerMode !== 'high') this.demoWasteTarget = target.id;
        const showingWaste = target.id === this.demoWasteTarget;
        desiredMode = showingWaste ? 'high' : target.powerMode;
        demo.stage = showingWaste ? 'waste' : 'match';
        demo.message = showingWaste ? 'Excess power still works, but drains the reserve faster.' : `Choose ${target.powerMode.toUpperCase()} to stabilize ${target.name}.`;
      }
    }
    this._setPowerMode(desiredMode);
    if (state.blocks.some((block) => block.critical && state.elapsed - block.lastFailedAt < 2)) {
      demo.stage = 'consequences';
      demo.message = 'A service went dark. Every power decision affects people in the city.';
    }
  }

  _failures() {
    const state = this.state;
    const phase = this._phase();
    if (state.elapsed + 0.000001 < this.nextWave) return;
    const maximum = Math.min(this.config.MAX_ACTIVE_WARNINGS, phase.maxWarnings);
    const capacity = Math.max(0, maximum - state.blocks.filter(warning).length);
    let burst = Math.min(capacity, phase.burst);
    const normalized = state.elapsed / this.config.ROUND_DURATION * 60;

    // An approachable first green demand, followed by the recognizable hospital/school choice.
    if (this.waveCount === 0 && burst > 0) {
      this._warn(state.blocks.find((block) => block.id === 'farm'), phase);
      burst -= 1;
    } else if (normalized >= 10 && !this.teachingCriticalTriggered && burst > 0) {
      for (const id of ['hospital', 'school']) {
        if (burst <= 0) break;
        const block = state.blocks.find((item) => item.id === id);
        if (this._warn(block, phase)) burst -= 1;
      }
      this.teachingCriticalTriggered = true;
    }

    for (let index = 0; index < burst; index += 1) {
      const candidates = state.blocks.filter((block) =>
        !warning(block) && block.status !== 'failed' && state.elapsed - block.lastSavedAt >= this.config.SAVE_GRACE_DURATION
        && (normalized >= 10 || (!block.critical && block.powerRequirement <= 40)));
      if (!candidates.length) break;
      const weights = candidates.map((block) => {
        const peripheral = block.row === 0 || block.col === 0 || block.row === 5 || block.col === 5;
        const recent = state.elapsed - block.lastSavedAt < this.config.RECENTLY_SAVED_WINDOW;
        return block.failureWeight * (peripheral ? 1.12 : 1) * (recent ? this.config.RECENTLY_SAVED_WEIGHT : 1)
          * (block.critical ? 1 + phase.criticalBias : 1);
      });
      let position = this._random() * weights.reduce((total, value) => total + value, 0);
      let selected = candidates.at(-1);
      for (let item = 0; item < candidates.length; item += 1) {
        position -= weights[item];
        if (position <= 0) { selected = candidates[item]; break; }
      }
      this._warn(selected, phase);
    }
    this.waveCount += 1;
    const variation = 0.9 + this._random() * 0.2;
    this.nextWave = state.elapsed + phase.interval * DIFFICULTIES[state.difficulty].waveMultiplier
      / this.config.FAILURE_ACCELERATION * variation * this.config.ROUND_DURATION / 60;
  }

  _warn(block, phase = this._phase()) {
    if (!block || warning(block) || block.status === 'failed') return false;
    block.status = 'warning';
    block.warningDuration = this.config.WARNING_DURATION * phase.warningScale * DIFFICULTIES[this.state.difficulty].warningMultiplier;
    block.warningRemaining = block.warningDuration;
    block.warningStartedAt = this.state.elapsed;
    block.stabilization = 0;
    this._event('warning', `${block.name} NEEDS ${block.powerMode.toUpperCase()} POWER`, block.id);
    if (this.waveCount === 0) this._caption(block.npcId, 'warning');
    return true;
  }

  _save(block) {
    if (!block || block.status === 'failed') return false;
    const firstSave = !block.scored;
    block.status = 'stabilized';
    block.stabilization = 1;
    block.warningRemaining = 0;
    block.lastSavedAt = this.state.elapsed;
    block.saves += 1;
    block.scored = true;
    this.state.energy.totalRescues += 1;
    if (this.state.powerMode === block.powerMode) this.state.energy.matchedRescues += 1;
    this._consumeEnergy({ rescueEnergy: block.powerConsumption * block.powerRequirement / 100
      * this.config.RESCUE_ENERGY_COST * DIFFICULTIES[this.state.difficulty].drainMultiplier });
    if (this.state.phase === 'demo') this.demoRestUntil = this.state.elapsed + 0.8;
    this._event('saved', firstSave ? `${block.name} STABILIZED +${block.priority}` : `${block.name} CONNECTION RESTORED`, block.id);
    // A thank-you may occupy the scheduled caption slot, without a caption on every rescue.
    if (this.state.elapsed >= this.nextCaption) {
      this._caption(block.npcId, 'saved');
      this.nextCaption = this.state.elapsed + this._captionInterval();
    }
  }

  _fail(block) {
    if (!block || block.status === 'failed') return false;
    block.status = 'failed';
    block.warningRemaining = 0;
    block.stabilization = 0;
    block.lastFailedAt = this.state.elapsed;
    this._event(block.critical ? 'critical_failure' : 'failure', `${block.name} — OFFLINE`, block.id);
    if (block.critical) this.pendingCriticalFailures.push(block);
    if (['playing', 'demo', 'paused'].includes(this.state.phase)
      && this.state.blocks.filter((item) => item.status === 'failed').length >= Math.ceil(this.state.blocks.length * this.config.CITY_LOSS_RATIO)) {
      this._finish(false, 'city_blackout');
    }
    return true;
  }

  _storage(dt) {
    const state = this.state;
    const target = state.blocks.find((block) => block.id === state.selectedId);
    const demand = state.blocks.reduce((total, block) => total + (block.status === 'failed' ? 0
      : block.powerConsumption * block.powerRequirement / 100 * (warning(block) ? 0.8 : 1)), 0);
    const supply = state.power / 100;
    const excess = powerIsExcess(state.powerMode, target.powerMode) ? (state.power - target.powerRequirement) / 100 : 0;
    const delivery = this.config.POWER_OUTPUT_DRAIN * Math.pow(supply, 3) * target.powerConsumption;
    const waste = this.config.OVERPOWER_PENALTY * Math.pow(excess, 1.35);
    const multiplier = DIFFICULTIES[state.difficulty].drainMultiplier;
    state.drainPerSecond = (demand * this.config.STORAGE_DRAIN_RATE + delivery + waste) * multiplier;
    const amounts = { normalDemand: demand * this.config.STORAGE_DRAIN_RATE * multiplier * dt,
      outputDelivery: delivery * multiplier * dt, overpowerWaste: waste * multiplier * dt };
    const actualFraction = this._consumeEnergy(amounts);
    if (!warning(target)) {
      state.energy.idleOutputEnergy += amounts.outputDelivery * actualFraction;
      if (state.powerMode !== 'low') {
        const lowDelivery = this.config.POWER_OUTPUT_DRAIN * Math.pow(POWER_LEVELS.low / 100, 3) * target.powerConsumption;
        // LOW is unavoidable. Only delivery above that baseline can be reduced.
        state.energy.reducibleIdleOutputEnergy += Math.max(0, delivery - lowDelivery) * multiplier * dt * actualFraction;
      }
    }
    if (excess > 0) state.energy.excessSeconds += dt * actualFraction;
    state.energyWaste = excess > 0;
    state.stats.gridLoad = demand + supply * target.powerConsumption;
    if (excess > 0.05 && state.elapsed - this.lastOverpowerEvent > 5) {
      this.lastOverpowerEvent = state.elapsed;
      this._event('overpower', 'ENERGY WASTE — REDUCE EXCESS OUTPUT', target.id);
    }
  }

  /** Allocate only electricity actually available, including the final partial step at collapse. */
  _consumeEnergy(amounts) {
    const requested = Object.values(amounts).reduce((sum, value) => sum + value, 0);
    if (requested <= 0) return this.state.storage > 0 ? 1 : 0;
    const available = this.state.storage;
    const used = Math.min(available, requested);
    const fraction = used / requested;
    this.state.storage = Math.max(0, available - used);
    for (const [category, amount] of Object.entries(amounts)) this.state.energy[category] += amount * fraction;
    return fraction;
  }

  _decisionReport(survived, criticalOutcomes, endReason) {
    const energy = this.state.energy;
    const energyUsed = energy.normalDemand + energy.outputDelivery + energy.overpowerWaste + energy.rescueEnergy;
    const wastePercent = energyUsed > 0 ? energy.overpowerWaste / energyUsed * 100 : 0;
    const criticalLost = criticalOutcomes.filter((block) => !block.saved).map(({ id, name }) => ({ id, name }));
    const criticalSaved = criticalOutcomes.filter((block) => block.saved).map(({ id, name, activelySaved }) => ({ id, name, activelySaved }));
    const reducibleIdle = energy.reducibleIdleOutputEnergy;
    const shouldLowerOutput = reducibleIdle > 5 && reducibleIdle > energyUsed * 0.15;
    const idleDominates = shouldLowerOutput && reducibleIdle > energy.overpowerWaste * 2;
    let tip;
    if (!idleDominates && (wastePercent >= 12 || energy.totalRescues > 0 && energy.matchedRescues / energy.totalRescues < 0.6)) {
      tip = { id: 'match_power', title: 'Match the demand', text: `${energy.overpowerWaste.toFixed(1)} reserve units went to excess power. Choose the target’s LOW, MEDIUM, or HIGH mode to keep more energy for the next call.` };
    } else if (shouldLowerOutput) {
      tip = { id: 'release_power', title: 'Turn down between rescues', text: `${reducibleIdle.toFixed(1)} reserve units went to output above LOW while no rescue was needed. Return to LOW while choosing your next building.` };
    } else if (endReason === 'city_blackout') {
      tip = { id: 'protect_city', title: 'Keep the city connected', text: 'The shift ended when 27 buildings went dark. Rescue blinking buildings before their final flash; failed buildings stay offline for the rest of the shift.' };
    } else if (energy.totalRescues === 0) {
      tip = { id: 'follow_warnings', title: 'Follow the blinking blocks', text: 'Move the spotlight onto a warning, then hold the required power briefly. Each first rescue earns that building’s priority points.' };
    } else if (criticalLost.length) {
      tip = { id: 'protect_critical', title: 'Protect essential services', text: `${criticalLost.map((block) => block.name).join(', ')} ended offline. Watch their deadlines and prioritize critical services when several demands compete.` };
    } else if (survived) {
      tip = { id: 'strong_shift', title: 'A careful shift', text: 'Every critical service finished online. Keep matching the demand, then return to LOW so the next emergency has a reserve.' };
    } else {
      tip = { id: 'reserve_first', title: 'Watch the reserve', text: 'The reserve ran out before the shift ended. Match the required mode and return to LOW whenever no target needs rescue.' };
    }
    return {
      ...energy, energyUsed, energyWasted: energy.overpowerWaste, wastePercent,
      storageRemaining: this.state.storage, criticalLost, criticalSaved, tip,
      // Idle and reducible idle are nested subsets of outputDelivery, never extra costs to add.
      accounting: 'normalDemand + outputDelivery + overpowerWaste + rescueEnergy = energyUsed',
    };
  }

  // PHASE 4: unique priority rescues dominate the small, bounded reserve bonus.
  _metrics() {
    const state = this.state;
    state.stats.saved = state.blocks.filter((block) => block.scored).length;
    state.stats.criticalSaved = state.blocks.filter((block) => block.critical && block.scored && block.status !== 'failed').length;
    state.stats.criticalLost = state.blocks.filter((block) => block.critical && block.status === 'failed').length;
    state.stats.online = state.blocks.filter((block) => block.status !== 'failed').length;
    state.stats.failed = state.blocks.length - state.stats.online;
    state.stats.lossLimit = Math.ceil(state.blocks.length * this.config.CITY_LOSS_RATIO);
    state.stats.warnings = state.blocks.filter(warning).length;
    state.score.priority = state.blocks.reduce((total, block) => total + (block.scored ? block.priority : 0), 0);
    state.score.criticalBonus = state.stats.criticalSaved * this.config.CRITICAL_BONUS;
    state.score.total = state.score.priority + state.score.criticalBonus + state.score.efficiency + state.score.survival;
  }

  _finish(survived, endReason = survived ? 'shift_complete' : 'reserve_empty') {
    const state = this.state;
    const demo = state.phase === 'demo';
    state.phase = demo ? 'demo' : 'results';
    this.input = { x: 0, y: 0, powerDelta: 0, stabilize: false };
    if (endReason === 'reserve_empty') {
      state.storage = 0;
      for (const block of state.blocks) {
        block.status = 'failed';
        block.warningRemaining = 0;
        block.stabilization = 0;
      }
    }
    this._metrics();
    state.score.efficiency = survived ? Math.round(state.storage * this.config.EFFICIENCY_MULTIPLIER) : 0;
    state.score.survival = survived ? this.config.SURVIVAL_BONUS : 0;
    this._metrics();
    const criticalBlocks = state.blocks.filter((block) => block.critical).sort((a, b) => b.priority - a.priority);
    const criticalOutcomes = criticalBlocks.map((block) => ({
      id: block.id, name: block.name, saved: block.status !== 'failed',
      activelySaved: block.scored, status: block.status === 'failed' ? 'lost' : 'saved',
    }));
    const reactions = criticalBlocks.map((block) => {
      const person = NPCS[block.npcId];
      const context = block.status === 'failed' ? 'lost' : 'survived';
      return { npcId: person.id, name: person.name, role: person.role, text: person.captions[context][0], tone: context };
    });
    if (state.blocks.filter((block) => block.kind === 'residential' && block.status !== 'failed').length >= 3) {
      const person = NPCS.resident;
      reactions.push({ npcId: person.id, name: person.name, role: person.role, text: person.captions.survived[0], tone: 'survived' });
    }
    this._event(survived ? 'survived' : 'collapse', survived ? 'CITY SURVIVED' : endReason === 'city_blackout' ? 'CITY BLACKOUT — 75% OFFLINE' : 'GRID COLLAPSE — RESERVE EMPTY');
    this._caption('operator', survived ? 'survived' : endReason === 'city_blackout' ? 'cityBlackout' : 'collapse');
    if (demo) {
      state.demo.stage = 'outcome';
      state.demo.outcome = survived ? 'survived' : 'collapse';
      state.demo.endReason = endReason;
      state.demo.message = survived ? 'The city survived, but not every service did. Touch a control to take your shift.' : endReason === 'city_blackout' ? 'Three quarters of the city went dark. A new city is waiting for an operator.' : 'The reserve ran out. A new city is waiting for an operator.';
      state.demo.holdRemaining = this.config.DEMO_OUTCOME_DURATION;
      state.result = null;
      return;
    }
    state.result = {
      roundId: state.roundId, outcome: survived ? 'survived' : 'collapse', survived, endReason,
      score: { ...state.score }, stats: { ...state.stats }, storage: Math.round(state.storage * 10) / 10,
      survivalTime: Math.round(state.elapsed * 10) / 10, criticalOutcomes, reactions,
      difficulty: state.difficulty, practice: state.practice,
      decisionReport: this._decisionReport(survived, criticalOutcomes, endReason),
    };
    state.autoResetRemaining = this.config.AUTO_RESET_DURATION;
  }

  _npc() {
    const state = this.state;
    if (state.storage <= this.config.CRITICAL_STORAGE_THRESHOLD && !this.criticalStorageAnnounced) {
      this.criticalStorageAnnounced = true;
      this.lowStorageAnnounced = true;
      this._caption('operator', 'storageCritical');
      this._event('storage_critical', 'STORAGE CRITICAL');
      this.nextCaption = state.elapsed + this._captionInterval();
      return;
    }
    if (this.pendingCriticalFailures.length) {
      const block = this.pendingCriticalFailures.sort((a, b) => b.priority - a.priority)[0];
      this.pendingCriticalFailures = [];
      this._caption(block.npcId, 'lost');
      this.nextCaption = state.elapsed + this._captionInterval();
      return;
    }
    if (state.storage <= this.config.LOW_STORAGE_THRESHOLD && !this.lowStorageAnnounced) {
      this.lowStorageAnnounced = true;
      this._caption('operator', 'storageLow');
      this._event('storage_low', 'STORAGE BELOW SAFE RESERVE');
      this.nextCaption = state.elapsed + this._captionInterval();
      return;
    }
    if (state.elapsed < this.nextCaption) return;
    const activeDemands = state.blocks.filter(warning);
    const demands = activeDemands.map((block) => ({
      block,
      urgency: (1 - block.warningRemaining / block.warningDuration) * 3 + block.priority / 100 * (activeDemands.length >= 4 ? 1.4 : 1)
        + (state.elapsed - block.warningStartedAt) * 0.04
        - (state.elapsed - (this.lastNpcTimes[block.npcId] ?? -100) < 5 ? 1.7 : 0),
    })).sort((a, b) => b.urgency - a.urgency);
    if (demands.length) {
      const block = demands[0].block;
      const fraction = block.warningRemaining / block.warningDuration;
      this._caption(block.npcId, fraction < 0.3 ? 'critical' : fraction < 0.65 ? 'ignored' : 'warning');
    } else {
      const recentFailure = state.blocks.filter((block) => state.elapsed - block.lastFailedAt < 5)
        .sort((a, b) => b.lastFailedAt - a.lastFailedAt)[0];
      if (recentFailure) this._caption(recentFailure.npcId, 'lost');
      else this._caption('operator', 'warning');
    }
    this.nextCaption = state.elapsed + this._captionInterval();
  }

  _captionInterval() {
    return this.state.remaining <= 20 / 60 * this.config.ROUND_DURATION ? this.config.NPC_FINAL_INTERVAL : this.config.NPC_MESSAGE_INTERVAL;
  }

  _caption(npcId, context) {
    const npc = Object.hasOwn(NPCS, npcId) ? NPCS[npcId] : NPCS.operator;
    const lines = npc.captions[context] ?? npc.captions.warning;
    this.state.caption = {
      id: `caption-${++this.sequence}`, npcId: npc.id, name: npc.name, role: npc.role,
      text: lines[Math.floor(this._random() * lines.length)], tone: context,
      time: this.state.elapsed, duration: this.config.NPC_CAPTION_DURATION,
    };
    this.lastNpcTimes[npc.id] = this.state.elapsed;
  }

  _event(type, text, blockId = null) {
    this.state.events.push({ id: `event-${++this.sequence}`, type, text, time: this.state.elapsed, blockId });
    this.state.events = this.state.events.slice(-12);
  }

  _random() {
    const value = this.random();
    return finite(value) ? clamp(value, 0, 0.999999999) : 0.5;
  }

  _debug(message) {
    const state = this.state;
    if (message.action === 'toggle') {
      state.debug = !state.debug;
      return true;
    }
    if (!state.debug) return false;
    if (state.training) return false;
    const block = state.blocks.find((item) => item.id === (typeof message.value === 'string' ? message.value : state.selectedId));
    if (['fail', 'warn', 'restore'].includes(message.action) && (!block || !['playing', 'paused'].includes(state.phase))) return false;
    switch (message.action) {
      case 'fail': if (!this._fail(block)) return false; break;
      case 'warn': if (!this._warn(block)) return false; break;
      case 'restore':
        if (block.status === 'failed') return false;
        block.status = 'powered'; block.warningRemaining = 0; block.stabilization = 0;
        block.lastSavedAt = state.elapsed; block.lastFailedAt = -1000;
        break;
      case 'storage':
        if (!finite(message.value)) return false;
        {
          const value = clamp(message.value, 0, 100);
          if (value > state.storage) state.energy.storageAddedByDebug += value - state.storage;
          else state.energy.storageRemovedByDebug += state.storage - value;
          state.storage = value;
        }
        break;
      case 'npc': this._caption(typeof message.value === 'string' && Object.hasOwn(NPCS, message.value) ? message.value : block?.npcId ?? 'operator', 'warning'); break;
      default: return false;
    }
    state.practice = true;
    if (state.result) state.result.practice = true;
    this._metrics();
    return true;
  }
}
