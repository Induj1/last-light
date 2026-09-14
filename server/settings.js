import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const DEFAULT_EVENT_SETTINGS = Object.freeze({ eventName: 'LAST LIGHT — Engineers’ Day', difficulty: 'normal', roundDuration: 60, resetSeconds: 15, attractEnabled: true, attractIdleSeconds: 45 });
export class SettingsError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function eventName(value) {
  if (typeof value !== 'string') throw new SettingsError('Enter an event name.');
  const name = value.normalize('NFKC').replace(/[<>\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim();
  if (!name || name.length > 80) throw new SettingsError('Event name must contain 1–80 characters.');
  return name;
}
export function validateSettings(update, current = DEFAULT_EVENT_SETTINGS) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) throw new SettingsError('Settings must be an object.');
  const settings = { ...current };
  for (const [key, value] of Object.entries(update)) {
    if (!Object.hasOwn(DEFAULT_EVENT_SETTINGS, key)) throw new SettingsError(`Unknown event setting: ${key}`);
    if (key === 'eventName') settings[key] = eventName(value);
    else if (key === 'difficulty') {
      if (!['easy', 'normal', 'hard'].includes(value)) throw new SettingsError('Difficulty must be easy, normal, or hard.');
      settings[key] = value;
    } else if (key === 'attractEnabled') {
      if (typeof value !== 'boolean') throw new SettingsError('attractEnabled must be true or false.');
      settings[key] = value;
    } else {
      const [min, max] = { roundDuration: [30, 180], resetSeconds: [10, 60], attractIdleSeconds: [15, 300] }[key];
      if (!Number.isInteger(value) || value < min || value > max) throw new SettingsError(`${key} must be a whole number between ${min} and ${max}.`);
      settings[key] = value;
    }
  }
  return settings;
}
export function engineSettings(settings) {
  return { ROUND_DURATION: settings.roundDuration, AUTO_RESET_DURATION: settings.resetSeconds, DIFFICULTY: settings.difficulty, ATTRACT_ENABLED: settings.attractEnabled, ATTRACT_IDLE_SECONDS: settings.attractIdleSeconds };
}
export async function atomicJson(file, data) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2), 'utf8');
  await rename(temporary, file);
}

/** The event ledger carries a matching snapshot for interrupted two-file writes. */
export class EventSettings {
  constructor(directory, { logger = console } = {}) {
    this.directory = directory; this.file = path.join(directory, 'event-settings.json'); this.logger = logger;
    this.settings = { ...DEFAULT_EVENT_SETTINGS }; this.persisted = false; this.warning = null;
  }
  async load(authoritative = null) {
    await mkdir(this.directory, { recursive: true });
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      if (!saved || saved.version !== 1) throw new SettingsError('Unknown settings format.');
      this.settings = validateSettings(saved.settings); this.persisted = true;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        if (error.code) throw error;
        await rename(this.file, `${this.file}.corrupt-${Date.now()}`);
        this.warning = 'Invalid event settings were preserved; defaults have been restored.';
        this.logger.warn(this.warning);
      }
    }
    if (authoritative) { this.settings = validateSettings(authoritative); this.persisted = true; }
    return this;
  }
  async mirror(settings) {
    this.settings = { ...settings };
    try { await atomicJson(this.file, { version: 1, settings }); this.persisted = true; this.warning = null; }
    catch (error) {
      this.warning = 'Settings are saved in the event ledger; the separate settings file could not be updated.';
      this.logger.warn(`${this.warning} ${error.message}`);
    }
  }
}
