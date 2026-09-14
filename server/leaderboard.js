import { copyFile, mkdir, readFile, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson, DEFAULT_EVENT_SETTINGS, eventName, validateSettings } from './settings.js';

export class LeaderboardError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function cleanName(value) {
  if (typeof value !== 'string') throw new LeaderboardError('Enter a player name.');
  const name = value.normalize('NFKC').replace(/[<>\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  if (!name) throw new LeaderboardError('Enter a player name.');
  return name;
}

const metric = (value) => Number.isFinite(value) ? Math.max(0, Math.round(value * 100) / 100) : 0;
const compare = (a, b) => b.finalScore - a.finalScore || b.storageRemaining - a.storageRemaining || a.createdAt.localeCompare(b.createdAt);
const METRICS = ['finalScore', 'priorityScore', 'criticalBonus', 'efficiencyBonus', 'survivalBonus', 'storageRemaining', 'buildingsSaved', 'criticalSaved', 'criticalLost', 'survivalTime'];
const validEntry = (entry) => entry && typeof entry === 'object'
  && ['id', 'roundId', 'name', 'createdAt', 'difficulty'].every((key) => typeof entry[key] === 'string' && entry[key].length > 0)
  && METRICS.every((key) => Number.isFinite(entry[key]) && entry[key] >= 0)
  && typeof entry.survived === 'boolean';
const safeId = (value) => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
const newEvent = (name) => ({ id: randomUUID(), name: eventName(name), startedAt: new Date().toISOString() });
const columns = ['eventId', 'eventName', 'name', ...METRICS, 'difficulty', 'survived', 'createdAt', 'roundId', 'energyUsed', 'energyWasted', 'wastePercent'];
function csvCell(value) {
  let text = String(value ?? '');
  // Quoting alone does not prevent a spreadsheet from evaluating formulas.
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function leaderboardCsv(entries, event) {
  const rows = entries.map((entry) => ({ ...entry, eventId: event.id, eventName: event.name,
    energyUsed: entry.decisionReport?.energyUsed, energyWasted: entry.decisionReport?.energyWasted, wastePercent: entry.decisionReport?.wastePercent }));
  return '\uFEFF' + [columns.map(csvCell).join(','), ...rows.map((row) => columns.map((key) => csvCell(row[key])).join(','))].join('\r\n') + '\r\n';
}

/** A queued atomic file replacement makes refreshes and simultaneous submissions safe. */
export class Leaderboard {
  constructor(directory, { logger = console } = {}) {
    this.directory = directory;
    this.file = path.join(directory, 'leaderboard.json');
    this.archiveDirectory = path.join(directory, 'events');
    this.logger = logger;
    this.entries = [];
    this.submittedRounds = new Set();
    this.queue = Promise.resolve();
    this.warning = null;
    this.event = newEvent(DEFAULT_EVENT_SETTINGS.eventName);
    this.settings = null;
  }

  enqueue(operation) {
    const task = this.queue.then(operation);
    this.queue = task.catch(() => {});
    return task;
  }
  document(overrides = {}) {
    return { version: 2, event: this.event, settings: this.settings, entries: this.entries, submittedRounds: [...this.submittedRounds], ...overrides };
  }

  async load() {
    await mkdir(this.directory, { recursive: true });
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (!data || ![1, 2].includes(data.version) || !Array.isArray(data.entries) || !Array.isArray(data.submittedRounds)
        || data.entries.some((entry) => !validEntry(entry))
        || (data.version === 2 && (!safeId(data.event?.id) || typeof data.event?.name !== 'string' || typeof data.event?.startedAt !== 'string'))) {
        throw new Error('Unrecognized leaderboard format');
      }
      this.entries = data.entries;
      this.submittedRounds = new Set([...data.submittedRounds.filter((id) => typeof id === 'string'), ...this.entries.map((entry) => entry.roundId)]);
      if (data.version === 2) {
        this.event = data.event;
        if (data.settings) {
          try { this.settings = validateSettings(data.settings); }
          catch (error) { this.logger.warn(`Invalid event settings in the ledger: ${error.message}. Scores were preserved.`); }
        }
      } else {
        await copyFile(this.file, `${this.file}.v1-backup-${randomUUID()}`);
        if (this.entries.length) this.event.startedAt = this.entries.map((entry) => entry.createdAt).sort()[0];
        await atomicJson(this.file, this.document());
      }
    } catch (error) {
      if (error.code === 'ENOENT') return this;
      if (error instanceof SyntaxError || error.message === 'Unrecognized leaderboard format') {
        const preserved = `${this.file}.corrupt-${Date.now()}`;
        await rename(this.file, preserved);
        this.warning = `Invalid leaderboard preserved as ${path.basename(preserved)}; a fresh board will be used.`;
        this.logger.warn(this.warning);
      } else {
        throw error;
      }
    }
    return this;
  }

  top() { return [...this.entries].sort(compare).slice(0, 10).map((entry) => ({ ...entry })); }
  metadata() { return { ...this.event, submissionCount: this.entries.length }; }
  csv() { return leaderboardCsv(this.entries, this.event); }
  async updateSettings(settings) {
    return this.enqueue(async () => {
      const validated = validateSettings(settings);
      const event = { ...this.event, name: validated.eventName };
      await atomicJson(this.file, this.document({ settings: validated, event }));
      this.settings = validated; this.event = event;
      return { ...validated };
    });
  }

  async submit(name, result, expectedEventId = this.event.id) {
    name = cleanName(name);
    if (!result?.roundId || !result.score || !result.stats) throw new LeaderboardError('This round is unavailable.', 410);
    if (result.practice) throw new LeaderboardError('Practice rounds cannot enter the leaderboard.');
    const task = this.queue.then(async () => {
      if (expectedEventId !== this.event.id) throw new LeaderboardError('This round belongs to an earlier event.', 410);
      // A result can be disqualified while an earlier atomic write is pending.
      if (result.practice) throw new LeaderboardError('Practice rounds cannot enter the leaderboard.');
      if (this.submittedRounds.has(result.roundId)) throw new LeaderboardError('This round has already been submitted.', 409);
      const entry = {
        id: randomUUID(), roundId: result.roundId, name,
        finalScore: metric(result.score.total), priorityScore: metric(result.score.priority),
        criticalBonus: metric(result.score.criticalBonus), efficiencyBonus: metric(result.score.efficiency),
        survivalBonus: metric(result.score.survival), storageRemaining: metric(result.storage),
        buildingsSaved: metric(result.stats.saved), criticalSaved: metric(result.stats.criticalSaved),
        criticalLost: metric(result.stats.criticalLost), survivalTime: metric(result.survivalTime),
        difficulty: result.difficulty, survived: Boolean(result.survived), createdAt: new Date().toISOString(),
        ...(result.decisionReport ? { decisionReport: structuredClone(result.decisionReport) } : {}),
      };
      const entries = [...this.entries, entry];
      const submittedRounds = [...this.submittedRounds, result.roundId];
      await atomicJson(this.file, this.document({ entries, submittedRounds }));
      this.entries = entries;
      this.submittedRounds = new Set(submittedRounds);
      return { ...entry };
    });
    // Keep later writes usable even after a validation or disk failure.
    this.queue = task.catch(() => {});
    return task;
  }

  async startEvent(name, settings) {
    const next = newEvent(name);
    return this.enqueue(async () => {
      const updated = validateSettings({ ...settings, eventName: next.name });
      const previousEvent = { ...this.metadata(), endedAt: new Date().toISOString() };
      const archive = this.document({ event: previousEvent });
      await mkdir(this.archiveDirectory, { recursive: true });
      const archiveFile = path.join(this.archiveDirectory, `${this.event.id}.json`);
      await atomicJson(archiveFile, archive);
      const verified = JSON.parse(await readFile(archiveFile, 'utf8'));
      if (verified.event.id !== this.event.id || verified.entries.length !== this.entries.length) throw new Error('Event archive verification failed.');
      await atomicJson(this.file, this.document({ event: next, entries: [], submittedRounds: [], settings: updated }));
      this.event = next; this.entries = []; this.submittedRounds = new Set(); this.settings = updated;
      return previousEvent;
    });
  }
  async archive(id) {
    if (!safeId(id)) throw new LeaderboardError('Invalid event identifier.', 400);
    try {
      const data = JSON.parse(await readFile(path.join(this.archiveDirectory, `${id}.json`), 'utf8'));
      if (data.version !== 2 || data.event?.id !== id || !Array.isArray(data.entries) || data.entries.some((entry) => !validEntry(entry))) throw new Error('Event archive is damaged.');
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') throw new LeaderboardError('Event archive was not found.', 404);
      throw error;
    }
  }
  async history() {
    let files;
    try { files = await readdir(this.archiveDirectory); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const events = [];
    for (const file of files.filter((name) => name.endsWith('.json'))) {
      try {
        const archived = await this.archive(file.slice(0, -5));
        if (archived.event.id === this.event.id) continue;
        events.push({ ...archived.event, submissionCount: archived.entries.length });
      } catch (error) { this.logger.warn(`Could not read event archive ${file}: ${error.message}`); }
    }
    return events.sort((a, b) => String(b.endedAt).localeCompare(String(a.endedAt)));
  }
}
