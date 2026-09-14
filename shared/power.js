/** Three public intensity choices; numeric levels are internal energy accounting units. */
export const POWER_MODES = Object.freeze(['low', 'medium', 'high']);
export const POWER_LEVELS = Object.freeze({ low: 35, medium: 60, high: 85 });
export const isPowerMode = (mode) => typeof mode === 'string' && POWER_MODES.includes(mode);
export const powerModeFor = (value) => value <= 40 ? 'low' : value <= 65 ? 'medium' : 'high';
export function stepPowerMode(mode, direction) {
  const index = Math.max(0, POWER_MODES.indexOf(mode));
  return POWER_MODES[Math.min(2, Math.max(0, index + Math.sign(direction)))];
}
export const powerSatisfies = (mode, demand) => isPowerMode(mode) && isPowerMode(demand)
  && POWER_MODES.indexOf(mode) >= POWER_MODES.indexOf(demand);
export const powerIsExcess = (mode, demand) => isPowerMode(mode) && isPowerMode(demand)
  && POWER_MODES.indexOf(mode) > POWER_MODES.indexOf(demand);
