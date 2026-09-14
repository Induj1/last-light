import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { LUA, RedisRest, VercelStore } from '../server/vercel/store.js';
import { leaderboardCsv } from '../server/leaderboard.js';

if (!process.argv.includes('--confirm-isolated-redis-test')) throw new Error('Add --confirm-isolated-redis-test to authorize a temporary, isolated Redis verification namespace.');
const prefix = `{last-light-qa-${randomUUID()}}:v1`;
const rawClient = new RedisRest({ url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN });
const tracked = new Set();
const scripts = new Set(Object.values(LUA));
const client = {
  async command(operation, ...args) {
    let keys;
    if (operation === 'EVAL') {
      assert.ok(scripts.has(args[0]), 'Only application scripts may run in this check.');
      keys = args.slice(2, 2 + Number(args[1]));
    } else {
      assert.ok(['GET', 'SET', 'DEL', 'HGET', 'HVALS', 'TTL'].includes(operation), 'Unexpected Redis command.');
      keys = [args[0]];
    }
    for (const key of keys) { assert.ok(typeof key === 'string' && key.startsWith(`${prefix}:`), 'A key escaped the isolated QA namespace.'); tracked.add(key); }
    return rawClient.command(operation, ...args);
  },
};
function entry(index) {
  return { id: `qa-entry-${index}`, roundId: `qa-round-${index}`, name: index === 1 ? '=SUM(1,2)' : `QA ${index}`, finalScore: index,
    priorityScore: index, criticalBonus: 0, efficiencyBonus: 0, survivalBonus: 0, storageRemaining: 10, buildingsSaved: 1,
    criticalSaved: 0, criticalLost: 0, survivalTime: 60, difficulty: 'normal', survived: true, createdAt: new Date().toISOString() };
}

let failure;
try {
  const first = new VercelStore(client, { prefix });
  const second = new VercelStore(client, { prefix });
  const views = await Promise.all([first.view(), second.view()]);
  assert.equal(views[0].event.id, views[1].event.id); assert.equal(views[0].event.submissionCount, 0);
  console.log('PASS: concurrent initialization creates one isolated event.');

  const changes = await Promise.all([
    first.updateSettings(views[0], { ...views[0].settings, difficulty: 'hard' }),
    second.updateSettings(views[1], { ...views[1].settings, roundDuration: 90 }),
  ]);
  assert.deepEqual(changes.sort(), ['conflict', 'ok']);
  const changed = await first.view(); assert.equal(changed.meta.revision, views[0].meta.revision + 1);
  console.log('PASS: real Lua compare-and-swap rejects stale settings.');

  const duplicate = await Promise.allSettled([first.submit(changed.event.id, entry(0)), second.submit(changed.event.id, entry(0))]);
  assert.equal(duplicate.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(duplicate.find((result) => result.status === 'rejected').reason.status, 409);
  await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? first : second).submit(changed.event.id, entry(index + 1))));
  const populated = await first.view(); assert.equal(populated.event.submissionCount, 13); assert.equal(populated.leaderboard.length, 10);
  assert.deepEqual(populated.leaderboard.map((item) => item.finalScore), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  console.log('PASS: duplicate claim saves once; 13 scores persist with a cached top ten.');

  const archive = await first.newEvent(populated, 'Isolated QA replacement');
  assert.equal(archive.id, populated.event.id); assert.equal(archive.submissionCount, 13);
  const next = await second.view(); assert.notEqual(next.event.id, archive.id); assert.equal(next.event.submissionCount, 0); assert.deepEqual(next.leaderboard, []);
  await assert.rejects(first.submit(archive.id, entry(100)), (error) => error.status === 410);
  assert.equal((await first.history()).length, 1);
  const saved = await first.archive(archive.id); assert.equal(saved.entries.length, 13);
  const csv = leaderboardCsv(saved.entries, saved.event); assert.equal(csv.trim().split('\r\n').length, 14); assert.ok(csv.includes('"\'=SUM(1,2)"'));
  console.log('PASS: full event archive survives replacement; old-event scores fail and CSV remains safe.');

  const rates = await Promise.all([first.rate('qa-rate', 'visitor', 100, 2), second.rate('qa-rate', 'visitor', 100, 2), first.rate('qa-rate', 'visitor', 100, 2)]);
  assert.equal(rates.filter(Boolean).length, 2);
  const ttl = await client.command('TTL', first.key('rate:qa-rate:visitor')); assert.ok(ttl > 0 && ttl <= 60);
  await first.authorizeAdmin('qa-admin', 'qa-visitor', 60); assert.equal(await second.adminValid('qa-admin', 'qa-visitor'), true);
  assert.equal(await second.adminValid('qa-admin', 'other-visitor'), false);
  await second.logoutAdmin('qa-admin'); assert.equal(await first.adminValid('qa-admin', 'qa-visitor'), false);
  console.log('PASS: concurrent rate limits, TTLs, admin binding, and logout revocation work across instances.');
} catch (error) { failure = error; }
finally {
  const keys = [...tracked];
  assert.ok(keys.every((key) => key.startsWith(`${prefix}:`)), 'Cleanup refused an unexpected key.');
  if (keys.length) {
    try {
      await rawClient.command('DEL', ...keys);
      assert.equal(await rawClient.command('EXISTS', ...keys), 0);
      console.log(`CLEANUP: removed and verified only ${keys.length} exact tracked QA keys. No production namespace was read or initialized.`);
    } catch (error) { console.error(`QA cleanup failed for isolated namespace ${prefix}; retry its exact-key cleanup before rerunning.`); failure ??= error; }
  }
}
if (failure) { console.error(`FAIL: ${failure.message}`); process.exitCode = 1; }
else console.log('All live Redis integration checks passed.');
