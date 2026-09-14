import { randomUUID } from 'node:crypto';
import { DEFAULT_EVENT_SETTINGS } from '../settings.js';

export class StoreError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}

/** REST commands use JSON arrays. EVAL performs every dependent write atomically. */
export class RedisRest {
  constructor({ url, token, fetchImpl = fetch }) {
    if (!url || !token) throw new StoreError('Persistent storage is not configured. Add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL and KV_REST_API_TOKEN).');
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'https:') throw new StoreError('The Redis REST endpoint must use HTTPS.');
    this.url = endpoint.href.replace(/\/$/, ''); this.token = token; this.fetch = fetchImpl;
  }
  async command(...command) {
    let response, data;
    try {
      response = await this.fetch(this.url, { method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.timeout(8000) });
      data = await response.json();
    } catch { throw new StoreError('Persistent storage is temporarily unavailable. Please try again.'); }
    if (!response.ok || data.error || !Object.hasOwn(data, 'result')) throw new StoreError('Persistent storage rejected the operation. Check its configuration and quota.');
    return data.result;
  }
}

export const LUA = Object.freeze({
  init: `-- last-light:init
local existing = redis.call('GET', KEYS[1])
if existing then return existing end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('HSET', KEYS[2], ARGV[2], ARGV[3])
return ARGV[1]`,
  view: `-- last-light:view
local raw = redis.call('GET', KEYS[1])
if not raw then return {} end
local meta = cjson.decode(raw)
local base = ARGV[1] .. ':event:' .. meta.event.id
return {raw, tostring(redis.call('HLEN', base .. ':entries')), redis.call('GET', base .. ':top') or '[]'}`,
  settings: `-- last-light:settings
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 'conflict' end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('HSET', KEYS[2], ARGV[3], ARGV[4])
return 'ok'`,
  newEvent: `-- last-light:new-event
local raw = redis.call('GET', KEYS[1])
if raw ~= ARGV[1] then return 'conflict' end
local old = cjson.decode(raw)
local archived = {id=old.event.id, name=old.event.name, startedAt=old.event.startedAt,
  endedAt=ARGV[5], settings=old.settings,
  submissionCount=redis.call('HLEN', ARGV[6] .. ':event:' .. old.event.id .. ':entries')}
redis.call('HSET', KEYS[2], old.event.id, cjson.encode(archived))
redis.call('HSET', KEYS[2], ARGV[3], ARGV[4])
redis.call('SET', KEYS[1], ARGV[2])
return cjson.encode(archived)`,
  submit: `-- last-light:submit
local raw = redis.call('GET', KEYS[1])
if not raw or cjson.decode(raw).event.id ~= ARGV[1] then return 'event-changed' end
if redis.call('HEXISTS', KEYS[3], ARGV[2]) == 1 then return 'duplicate' end
redis.call('HSET', KEYS[2], ARGV[3], ARGV[4])
redis.call('HSET', KEYS[3], ARGV[2], ARGV[3])
redis.call('ZADD', KEYS[4], ARGV[5], ARGV[3])
local top = {}
for _, id in ipairs(redis.call('ZREVRANGE', KEYS[4], 0, 9)) do
  local entry = redis.call('HGET', KEYS[2], id)
  if entry then table.insert(top, entry) end
end
redis.call('SET', KEYS[5], '[' .. table.concat(top, ',') .. ']')
return 'ok'`,
  rate: `-- last-light:rate
local global = redis.call('INCR', KEYS[1])
if global == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
if global > tonumber(ARGV[2]) then return 0 end
local localCount = redis.call('INCR', KEYS[2])
if localCount == 1 then redis.call('EXPIRE', KEYS[2], ARGV[1]) end
if localCount > tonumber(ARGV[3]) then return 0 end
return 1`,
});

export class VercelStore {
  constructor(client, { prefix = '{last-light}:v1', now = Date.now } = {}) {
    this.client = client; this.prefix = prefix; this.now = now; this.initialized = null;
  }
  key(suffix) { return `${this.prefix}:${suffix}`; }
  eval(script, keys, args = []) { return this.client.command('EVAL', script, keys.length, ...keys, ...args.map(String)); }
  async initialize() {
    if (!this.initialized) {
      const event = { id: randomUUID(), name: DEFAULT_EVENT_SETTINGS.eventName, startedAt: new Date(this.now()).toISOString() };
      const meta = { version: 1, revision: 1, event, settings: { ...DEFAULT_EVENT_SETTINGS } };
      this.initialized = this.eval(LUA.init, [this.key('active'), this.key('events')], [JSON.stringify(meta), event.id, JSON.stringify({ ...event, settings: meta.settings })]).catch((error) => { this.initialized = null; throw error; });
    }
    await this.initialized;
  }
  async view() {
    await this.initialize();
    const result = await this.eval(LUA.view, [this.key('active')], [this.prefix]);
    if (!Array.isArray(result) || !result[0]) throw new StoreError('The event record is unavailable. Restore persistent storage before accepting scores.');
    const meta = JSON.parse(result[0]);
    return { meta, raw: result[0], event: { ...meta.event, submissionCount: Number(result[1]) }, settings: meta.settings, leaderboard: JSON.parse(result[2] || '[]') };
  }
  async updateSettings(view, settings) {
    const meta = { ...view.meta, revision: view.meta.revision + 1, settings, event: { ...view.meta.event, name: settings.eventName } };
    return this.eval(LUA.settings, [this.key('active'), this.key('events')], [view.raw, JSON.stringify(meta), meta.event.id, JSON.stringify({ ...meta.event, settings })]);
  }
  async newEvent(view, name) {
    const event = { id: randomUUID(), name, startedAt: new Date(this.now()).toISOString() };
    const settings = { ...view.settings, eventName: name };
    const meta = { version: 1, revision: view.meta.revision + 1, event, settings };
    const result = await this.eval(LUA.newEvent, [this.key('active'), this.key('events')], [view.raw, JSON.stringify(meta), event.id, JSON.stringify({ ...event, settings }), event.startedAt, this.prefix]);
    if (result === 'conflict') throw new StoreError('The event changed while you were editing. Refresh and try again.', 409);
    return JSON.parse(result);
  }
  async submit(eventId, entry) {
    const base = `event:${eventId}`;
    // Integer priority scores dominate the 0–100 storage tiebreaker.
    const rank = entry.finalScore * 1001 + Math.round(entry.storageRemaining * 10);
    const result = await this.eval(LUA.submit, [this.key('active'), this.key(`${base}:entries`), this.key(`${base}:claims`), this.key(`${base}:rank`), this.key(`${base}:top`)], [eventId, entry.roundId, entry.id, JSON.stringify(entry), rank]);
    if (result === 'duplicate') throw new StoreError('This round has already been submitted.', 409);
    if (result === 'event-changed') throw new StoreError('This round belongs to an earlier event. Start a new shift.', 410);
    if (result !== 'ok') throw new StoreError('The score could not be saved.');
    return entry;
  }
  async history() {
    const records = await this.client.command('HVALS', this.key('events'));
    return records.map((record) => JSON.parse(record)).filter((event) => event.endedAt).sort((a, b) => b.endedAt.localeCompare(a.endedAt));
  }
  async archive(id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new StoreError('Invalid event identifier.', 400);
    const raw = await this.client.command('HGET', this.key('events'), id);
    if (!raw) throw new StoreError('Event archive was not found.', 404);
    const event = JSON.parse(raw);
    const entries = (await this.client.command('HVALS', this.key(`event:${id}:entries`))).map((entry) => JSON.parse(entry));
    return { event: { ...event, submissionCount: entries.length }, entries };
  }
  async rate(group, identity, globalLimit, individualLimit, seconds = 60) {
    return (await this.eval(LUA.rate, [this.key(`rate:${group}:all`), this.key(`rate:${group}:${identity}`)], [seconds, globalLimit, individualLimit])) === 1;
  }
  async authorizeAdmin(id, sid, seconds) { await this.client.command('SET', this.key(`admin:${id}`), sid, 'EX', seconds); }
  async adminValid(id, sid) { return (await this.client.command('GET', this.key(`admin:${id}`))) === sid; }
  async logoutAdmin(id) { if (id) await this.client.command('DEL', this.key(`admin:${id}`)); }
}
