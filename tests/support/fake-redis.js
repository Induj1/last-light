import { LUA, StoreError } from '../../server/vercel/store.js';

/** Test-only atomic model of the application's Redis scripts, not a Lua interpreter. */
export class FakeRedis {
  constructor({ now = Date.now } = {}) { this.now = now; this.values = new Map(); this.expiry = new Map(); this.queue = Promise.resolve(); this.failScript = null; this.calls = []; }
  command(...args) {
    const run = this.queue.then(() => {
      this.calls.push(args);
      if (args[0] === 'EVAL' && this.failScript === args[1]) throw new StoreError('Injected storage failure.');
      return this.execute(...args);
    });
    this.queue = run.catch(() => {}); return run;
  }
  value(key) {
    if (this.expiry.has(key) && this.expiry.get(key) <= this.now()) { this.values.delete(key); this.expiry.delete(key); }
    return this.values.get(key);
  }
  hash(key) { let value = this.value(key); if (!value) { value = new Map(); this.values.set(key, value); } return value; }
  execute(operation, ...args) {
    const [key, field, value] = args;
    switch (operation) {
      case 'GET': return this.value(key) ?? null;
      case 'SET': {
        if (args.includes('NX') && this.value(key) !== undefined) return null;
        this.values.set(key, String(field)); this.expiry.delete(key);
        const ex = args.indexOf('EX'); if (ex >= 0) this.expiry.set(key, this.now() + Number(args[ex + 1]) * 1000);
        return 'OK';
      }
      case 'DEL': return Number(this.values.delete(key));
      case 'HSET': { const hash = this.hash(key), fresh = !hash.has(field); hash.set(field, String(value)); return Number(fresh); }
      case 'HGET': return this.value(key)?.get(field) ?? null;
      case 'HVALS': return [...(this.value(key)?.values() ?? [])];
      case 'HLEN': return this.value(key)?.size ?? 0;
      case 'HEXISTS': return Number(this.value(key)?.has(field) ?? false);
      case 'ZADD': this.hash(key).set(value, Number(field)); return 1;
      case 'ZREVRANGE': return [...(this.value(key)?.entries() ?? [])].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0])).slice(Number(field), Number(value) + 1).map(([member]) => member);
      case 'INCR': { const next = Number(this.value(key) ?? 0) + 1; this.values.set(key, String(next)); return next; }
      case 'EXPIRE': this.expiry.set(key, this.now() + Number(field) * 1000); return 1;
      case 'EVAL': return this.script(args[0], args.slice(2, 2 + Number(args[1])), args.slice(2 + Number(args[1])));
      default: throw new Error(`Unsupported fake Redis command: ${operation}`);
    }
  }
  script(source, keys, args) {
    const call = (...command) => this.execute(...command);
    if (source === LUA.init) {
      const raw = call('GET', keys[0]); if (raw) return raw;
      call('SET', keys[0], args[0]); call('HSET', keys[1], args[1], args[2]); return args[0];
    }
    if (source === LUA.view) {
      const raw = call('GET', keys[0]); if (!raw) return [];
      const base = `${args[0]}:event:${JSON.parse(raw).event.id}`;
      return [raw, String(call('HLEN', `${base}:entries`)), call('GET', `${base}:top`) || '[]'];
    }
    if (source === LUA.settings) {
      if (call('GET', keys[0]) !== args[0]) return 'conflict';
      call('SET', keys[0], args[1]); call('HSET', keys[1], args[2], args[3]); return 'ok';
    }
    if (source === LUA.newEvent) {
      const raw = call('GET', keys[0]); if (raw !== args[0]) return 'conflict';
      const old = JSON.parse(raw);
      const archived = { ...old.event, endedAt: args[4], settings: old.settings, submissionCount: call('HLEN', `${args[5]}:event:${old.event.id}:entries`) };
      call('HSET', keys[1], old.event.id, JSON.stringify(archived)); call('HSET', keys[1], args[2], args[3]); call('SET', keys[0], args[1]); return JSON.stringify(archived);
    }
    if (source === LUA.submit) {
      const raw = call('GET', keys[0]); if (!raw || JSON.parse(raw).event.id !== args[0]) return 'event-changed';
      if (call('HEXISTS', keys[2], args[1])) return 'duplicate';
      call('HSET', keys[1], args[2], args[3]); call('HSET', keys[2], args[1], args[2]); call('ZADD', keys[3], args[4], args[2]);
      const top = call('ZREVRANGE', keys[3], 0, 9).map((id) => call('HGET', keys[1], id)).filter(Boolean);
      call('SET', keys[4], `[${top.join(',')}]`); return 'ok';
    }
    if (source === LUA.rate) {
      const global = call('INCR', keys[0]); if (global === 1) call('EXPIRE', keys[0], args[0]); if (global > Number(args[1])) return 0;
      const local = call('INCR', keys[1]); if (local === 1) call('EXPIRE', keys[1], args[0]); return Number(local <= Number(args[2]));
    }
    throw new Error('Unrecognized application Lua script.');
  }
  fetch = async (url, options) => {
    if (url !== 'https://redis.test' || options.headers.Authorization !== 'Bearer test-token') return new Response(JSON.stringify({ error: 'Invalid test Redis credentials.' }), { status: 401 });
    try { return new Response(JSON.stringify({ result: await this.command(...JSON.parse(options.body)) }), { status: 200 }); }
    catch (error) { return new Response(JSON.stringify({ error: error.message }), { status: 503 }); }
  };
}
