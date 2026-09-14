/** Organizer tuning. Percentages are 0–100; all durations are seconds. */
export const GAME_CONFIG = Object.freeze({
  ROUND_DURATION: 60,
  COUNTDOWN_DURATION: 3,
  AUTO_RESET_DURATION: 15,
  ATTRACT_ENABLED: true,
  ATTRACT_IDLE_SECONDS: 45,
  PRACTICE_MATCH_DURATION: 1.1,
  PRACTICE_RELEASE_DURATION: 0.7,
  DEMO_OUTCOME_DURATION: 4,
  INITIAL_STORAGE: 100,
  INITIAL_POWER: 35,
  CITY_LOSS_RATIO: 0.75,
  WARNING_DURATION: 9,
  MAX_ACTIVE_WARNINGS: 8,
  FAILURE_ACCELERATION: 1,
  POWER_TOLERANCE: 5,
  STABILIZATION_DURATION: 1.15,
  STABILIZED_DISPLAY_DURATION: 1.2,
  RECENTLY_SAVED_WINDOW: 13,
  RECENTLY_SAVED_WEIGHT: 2.3,
  SAVE_GRACE_DURATION: 3,
  STORAGE_DRAIN_RATE: 0.034,
  POWER_OUTPUT_DRAIN: 1.8,
  OVERPOWER_PENALTY: 3.8,
  RESCUE_ENERGY_COST: 0.65,
  CRITICAL_BONUS: 25,
  EFFICIENCY_MULTIPLIER: 0.6,
  SURVIVAL_BONUS: 100,
  DIFFICULTY: 'normal',
  NPC_MESSAGE_INTERVAL: 4,
  NPC_FINAL_INTERVAL: 2.5,
  NPC_CAPTION_DURATION: 3.2,
  CRITICAL_STORAGE_THRESHOLD: 20,
  LOW_STORAGE_THRESHOLD: 35,
  CURSOR_SPEED: 3.1,
  POWER_REPEAT_INTERVAL: 0.3,
  PHYSICS_STEP: 0.05,
  // Waves scale to the configured round length; a 120-second round keeps its arc.
  FAILURE_PHASES: [
    { from: 0, interval: 6, burst: 1, maxWarnings: 2, warningScale: 1.15, criticalBias: 0 },
    { from: 10, interval: 5, burst: 2, maxWarnings: 3, warningScale: 1, criticalBias: 0.5 },
    { from: 25, interval: 3.8, burst: 2, maxWarnings: 6, warningScale: 0.85, criticalBias: 1 },
    { from: 40, interval: 2.8, burst: 3, maxWarnings: 8, warningScale: 0.75, criticalBias: 1.8 },
    { from: 55, interval: 1.6, burst: 4, maxWarnings: 8, warningScale: 0.66, criticalBias: 3 },
  ],
});

export const DIFFICULTIES = Object.freeze({
  easy: { label: 'FIRST SHIFT', warningMultiplier: 1.3, waveMultiplier: 1.2, drainMultiplier: 0.8, holdMultiplier: 0.9 },
  normal: { label: 'CITY OPERATOR', warningMultiplier: 1, waveMultiplier: 1, drainMultiplier: 1, holdMultiplier: 1 },
  hard: { label: 'NIGHT CRISIS', warningMultiplier: 0.8, waveMultiplier: 0.82, drainMultiplier: 1.15, holdMultiplier: 1.1 },
});

/** Invalid numeric overrides never enter the real-time simulation. */
export function resolveConfig(overrides = {}) {
  const result = { ...GAME_CONFIG, FAILURE_PHASES: GAME_CONFIG.FAILURE_PHASES.map((phase) => ({ ...phase })) };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (key === 'DIFFICULTY' && typeof value === 'string' && Object.hasOwn(DIFFICULTIES, value)) result[key] = value;
    else if (typeof GAME_CONFIG[key] === 'boolean' && typeof value === 'boolean') result[key] = value;
    else if (typeof GAME_CONFIG[key] === 'number' && Number.isFinite(value) && value >= 0) result[key] = value;
    else if (key === 'FAILURE_PHASES' && Array.isArray(value) && value.length && value.every((phase) =>
      ['from', 'interval', 'burst', 'maxWarnings', 'warningScale', 'criticalBias'].every((field) => Number.isFinite(phase[field]) && phase[field] >= 0)
      && phase.interval > 0 && phase.warningScale > 0)) {
      result[key] = value.map((phase) => ({ ...phase })).sort((a, b) => a.from - b.from);
    }
  }
  result.ROUND_DURATION = Math.max(1, result.ROUND_DURATION);
  result.PHYSICS_STEP = Math.min(0.1, Math.max(0.01, result.PHYSICS_STEP));
  result.STABILIZATION_DURATION = Math.max(0.1, result.STABILIZATION_DURATION);
  result.PRACTICE_MATCH_DURATION = Math.max(0.1, result.PRACTICE_MATCH_DURATION);
  result.PRACTICE_RELEASE_DURATION = Math.max(0.1, result.PRACTICE_RELEASE_DURATION);
  result.DEMO_OUTCOME_DURATION = Math.max(0.1, result.DEMO_OUTCOME_DURATION);
  result.WARNING_DURATION = Math.max(0.2, result.WARNING_DURATION);
  result.FAILURE_ACCELERATION = Math.max(0.1, result.FAILURE_ACCELERATION);
  result.NPC_MESSAGE_INTERVAL = Math.max(1, result.NPC_MESSAGE_INTERVAL);
  result.NPC_FINAL_INTERVAL = Math.max(1, result.NPC_FINAL_INTERVAL);
  result.INITIAL_STORAGE = Math.min(100, result.INITIAL_STORAGE);
  // A new city always begins at LOW; neither off nor intermediate output exists.
  result.INITIAL_POWER = 35;
  result.CITY_LOSS_RATIO = 0.75;
  result.POWER_REPEAT_INTERVAL = Math.max(0.1, result.POWER_REPEAT_INTERVAL);
  result.MAX_ACTIVE_WARNINGS = Math.min(36, Math.floor(result.MAX_ACTIVE_WARNINGS));
  return result;
}
