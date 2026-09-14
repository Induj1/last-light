import { POWER_LEVELS, powerModeFor } from './power.js';

/** The data, not the engine, defines service priority and electricity demand. */
export const BLOCK_TYPES = {
  hospital: { name: 'CIVIL HOSPITAL', type: 'critical', priority: 100, powerRequirement: 85, tolerance: 5, powerConsumption: 1.5, failureWeight: 0.9, npcId: 'hospital_worker', critical: true },
  water: { name: 'WATER PUMP', type: 'critical', priority: 95, powerRequirement: 75, tolerance: 6, powerConsumption: 1.35, failureWeight: 0.95, npcId: 'water_worker', critical: true },
  fire: { name: 'FIRE STATION', type: 'critical', priority: 90, powerRequirement: 70, tolerance: 6, powerConsumption: 1.25, failureWeight: 0.85, npcId: 'firefighter', critical: true },
  school: { name: 'PRIMARY SCHOOL', type: 'critical', priority: 75, powerRequirement: 55, tolerance: 7, powerConsumption: 0.95, failureWeight: 0.95, npcId: 'teacher', critical: true },
  rail: { name: 'RAILWAY STATION', type: 'transport', priority: 80, powerRequirement: 80, tolerance: 6, powerConsumption: 1.4, failureWeight: 0.85, npcId: 'rail_worker', critical: false },
  farm: { name: 'FARM', type: 'essential', priority: 70, powerRequirement: 35, tolerance: 7, powerConsumption: 0.8, failureWeight: 1.05, npcId: 'farmer', critical: false },
  residential: { name: 'RESIDENTIAL AREA', type: 'residential', priority: 65, powerRequirement: 45, tolerance: 7, powerConsumption: 1, failureWeight: 1.05, npcId: 'resident', critical: false },
  data: { name: 'DATA CENTRE', type: 'commercial', priority: 50, powerRequirement: 80, tolerance: 5, powerConsumption: 1.45, failureWeight: 0.95, npcId: 'technician', critical: false },
  factory: { name: 'FACTORY', type: 'industrial', priority: 45, powerRequirement: 65, tolerance: 6, powerConsumption: 1.3, failureWeight: 1.1, npcId: 'factory_worker', critical: false },
  market: { name: 'MARKET', type: 'commercial', priority: 30, powerRequirement: 40, tolerance: 8, powerConsumption: 0.85, failureWeight: 1.05, npcId: 'shopkeeper', critical: false },
  mall: { name: 'SHOPPING MALL', type: 'commercial', priority: 15, powerRequirement: 25, tolerance: 7, powerConsumption: 1, failureWeight: 1.2, npcId: 'shopkeeper', critical: false },
  lights: { name: 'STREET LIGHTING', type: 'public', priority: 10, powerRequirement: 25, tolerance: 8, powerConsumption: 0.55, failureWeight: 1.2, npcId: 'resident', critical: false },
};

// Keep each original service's demand class while aligning its supply to a detent.
for (const spec of Object.values(BLOCK_TYPES)) {
  spec.powerMode = powerModeFor(spec.powerRequirement);
  spec.powerRequirement = POWER_LEVELS[spec.powerMode];
  spec.tolerance = 0;
}

// The four critical services are recognizable landmarks near the city centre.
export const CITY_LAYOUT = [
  ['farm', 'residential', 'market', 'rail', 'factory', 'lights'],
  ['residential', 'school', 'residential', 'water', 'market', 'farm'],
  ['lights', 'residential', 'hospital', 'market', 'factory', 'data'],
  ['market', 'fire', 'residential', 'rail', 'mall', 'lights'],
  ['factory', 'farm', 'market', 'residential', 'data', 'mall'],
  ['lights', 'mall', 'factory', 'lights', 'residential', 'lights'],
];

export function createBlocks({ POWER_TOLERANCE = 5 } = {}) {
  const counts = {};
  return CITY_LAYOUT.flatMap((row, rowIndex) => row.map((kind, col) => {
    counts[kind] = (counts[kind] ?? 0) + 1;
    const spec = BLOCK_TYPES[kind];
    return {
      ...spec,
      id: counts[kind] === 1 ? kind : `${kind}-${counts[kind]}`,
      kind,
      district: `${String.fromCharCode(65 + rowIndex)}${col + 1}`,
      tolerance: spec.tolerance ?? POWER_TOLERANCE,
      row: rowIndex,
      col,
      status: 'powered',
      warningRemaining: 0,
      warningDuration: 0,
      stabilization: 0,
      saves: 0,
      lastSavedAt: -1000,
      warningStartedAt: 0,
      lastFailedAt: -1000,
      // A building only yields priority points on its first successful rescue.
      scored: false,
    };
  }));
}
