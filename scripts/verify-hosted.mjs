#!/usr/bin/env node
/**
 * Public-host smoke test: node scripts/verify-hosted.mjs [https://your-host]
 * Creates two temporary visitor sessions and only plays/resets those cities.
 * Never logs cookies, attempts administrator login, or submits a score.
 * Protected POST probes deliberately carry invalid data as a second safeguard.
 */
import WebSocket from 'ws';
import { POWER_LEVELS } from '../shared/power.js';

const REQUEST_TIMEOUT = 8000;
const STATE_TIMEOUT = 5000;
const peers = [];
const sockets = new Set();
let keepAlive;
let target;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function checkedTarget(argument) {
  let url;
  try { url = new URL(argument || 'http://127.0.0.1:3003'); }
  catch { throw new Error('Provide a valid HTTP or HTTPS deployment URL.'); }
  requireCondition(['http:', 'https:'].includes(url.protocol), 'Only HTTP and HTTPS deployment URLs are supported.');
  requireCondition(!url.username && !url.password, 'Use a deployment URL without credentials.');
  requireCondition(!url.search && !url.hash, 'Use a deployment URL without query parameters or a fragment.');
  return new URL('/', url);
}

async function request(path, { method = 'GET', cookie, body } = {}) {
  const headers = { Origin: target.origin };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    return await fetch(new URL(path, target), {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
  } catch {
    throw new Error(`${method} ${path} did not complete within the request limit.`);
  }
}

async function json(response, description) {
  requireCondition(response.ok, `${description} returned HTTP ${response.status}.`);
  try { return await response.json(); }
  catch { throw new Error(`${description} did not return valid JSON.`); }
}

async function bootstrap() {
  const response = await request('/api/session');
  const cookies = response.headers.getSetCookie();
  const sessionHeader = cookies.find((header) => header.startsWith('last_light_session='));
  requireCondition(Boolean(sessionHeader), 'Session bootstrap did not issue a visitor cookie.');
  requireCondition(/;\s*HttpOnly(?:;|$)/i.test(sessionHeader), 'The visitor cookie must be HttpOnly.');
  if (target.protocol === 'https:') requireCondition(/;\s*Secure(?:;|$)/i.test(sessionHeader), 'The HTTPS visitor cookie must be Secure.');
  const data = await json(response, 'Session bootstrap');
  requireCondition(data.hosting?.mode === 'online' && data.hosting.admin === false, 'Session bootstrap must identify an ordinary online visitor.');
  return { cookie: sessionHeader.split(';', 1)[0] };
}

function websocketUrl() {
  const url = new URL('/ws', target);
  url.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
  return url;
}

class Visitor {
  constructor(cookie) {
    this.version = 0;
    this.state = null;
    this.resetAllowed = false;
    this.waiters = new Set();
    this.ws = new WebSocket(websocketUrl(), {
      headers: { Cookie: cookie, Origin: target.origin },
      handshakeTimeout: STATE_TIMEOUT,
    });
    sockets.add(this.ws);
    this.ws.on('error', () => this.rejectWaiters('A visitor WebSocket connection failed.'));
    this.ws.on('close', () => this.rejectWaiters('A visitor WebSocket closed before the check completed.'));
    this.ws.on('message', (raw) => {
      let packet;
      try { packet = JSON.parse(raw.toString()); }
      catch { this.rejectWaiters('A visitor WebSocket returned malformed JSON.'); return; }
      if (packet.type === 'error') { this.rejectWaiters('The server rejected a visitor gameplay command.'); return; }
      if (packet.type !== 'state') return;
      this.state = packet.state;
      this.version += 1;
      for (const waiter of [...this.waiters]) waiter.check();
    });
    peers.push(this);
  }

  rejectWaiters(message) {
    for (const waiter of [...this.waiters]) waiter.fail(new Error(message));
  }

  waitFor(predicate, description, { after = -1, timeout = STATE_TIMEOUT } = {}) {
    return new Promise((resolve, reject) => {
      let timer;
      const finish = (error) => {
        clearTimeout(timer);
        this.waiters.delete(waiter);
        if (error) reject(error);
        else resolve(this.state);
      };
      const waiter = {
        fail: finish,
        check: () => {
          if (this.state && this.version > after && predicate(this.state)) finish();
        },
      };
      this.waiters.add(waiter);
      timer = setTimeout(() => finish(new Error(`Timed out waiting for ${description}.`)), timeout);
      waiter.check();
    });
  }

  send(message) {
    requireCondition(this.ws.readyState === WebSocket.OPEN, 'A visitor WebSocket is not connected.');
    this.ws.send(JSON.stringify(message));
  }

  async command(message, predicate, description) {
    const after = this.version;
    this.send(message);
    return this.waitFor(predicate, description, { after });
  }
}

async function requireCrossOriginRejection(cookie) {
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(websocketUrl(), {
      headers: { Cookie: cookie, Origin: 'https://untrusted-smoke-origin.invalid' },
      handshakeTimeout: STATE_TIMEOUT,
    });
    sockets.add(ws);
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error('Cross-origin WebSocket rejection was not confirmed.')), STATE_TIMEOUT);
    ws.on('open', () => finish(new Error('The server accepted a cross-origin WebSocket.')));
    ws.on('unexpected-response', (req, response) => {
      const forbidden = [401, 403].includes(response.statusCode);
      response.resume();
      req.destroy();
      finish(forbidden ? null : new Error(`Cross-origin WebSocket returned unexpected HTTP ${response.statusCode}.`));
    });
    // A generic transport failure is not evidence that the Origin was checked.
    ws.on('error', () => { if (!settled) finish(new Error('Cross-origin WebSocket failed without a confirmed access rejection.')); });
  });
}

async function protectedRoutes(cookie) {
  const probes = [
    ['/api/event/settings', 'POST', { roundDuration: -1 }],
    ['/api/event/new', 'POST', { name: '' }],
    ['/api/event/history', 'GET'],
    ['/api/leaderboard/export.csv', 'GET'],
    ['/api/event/00000000-0000-4000-8000-000000000000/export.csv', 'GET'],
  ];
  const responses = await Promise.all(probes.map(async ([path, method, body]) => {
    const response = await request(path, { method, cookie, body });
    // Do not print or retain any unexpected private response body.
    await response.body?.cancel();
    requireCondition([401, 403].includes(response.status), `${method} ${path} was not protected by administrator access (HTTP ${response.status}).`);
  }));
  return responses.length;
}

function unchangedCity(state, baseline) {
  return state.roundId === baseline.roundId && state.phase === 'ready'
    && state.selectedId === baseline.selectedId && state.cursor.x === baseline.cursor.x
    && state.cursor.y === baseline.cursor.y && state.storage === baseline.storage
    && state.powerMode === baseline.powerMode && state.power === baseline.power && state.score.total === baseline.score.total;
}

async function cleanup() {
  clearInterval(keepAlive);
  // These cookies were created by this process: resetting cannot affect another visitor.
  const resetResults = await Promise.allSettled(peers.map(async (peer) => {
    if (!peer.resetAllowed || peer.ws.readyState !== WebSocket.OPEN) return;
    const after = peer.version;
    peer.send({ type: 'reset' });
    await peer.waitFor((state) => state.phase === 'ready', 'owned visitor cleanup', { after, timeout: 1500 });
  }));
  await Promise.all([...sockets].map((ws) => new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
    const timer = setTimeout(() => { ws.terminate(); resolve(); }, 500);
    ws.once('close', () => { clearTimeout(timer); resolve(); });
    if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'Smoke test complete');
    else ws.terminate();
  })));
  return resetResults.every((result) => result.status === 'fulfilled');
}

async function main() {
  target = checkedTarget(process.argv[2]);
  console.log('Checking LAST LIGHT hosted visitor isolation and access controls…');
  const [healthResponse, pageResponse, sessionA, sessionB] = await Promise.all([
    request('/api/health'), request('/'), bootstrap(), bootstrap(),
  ]);
  const health = await json(healthResponse, 'Health endpoint');
  requireCondition(health.ok === true, 'Health endpoint did not report readiness.');
  requireCondition(pageResponse.ok && pageResponse.headers.get('content-type')?.includes('text/html'), 'The deployment did not serve the built display as HTML.');
  const html = await pageResponse.text();
  requireCondition(/<!doctype html/i.test(html) && /id=["']root["']/i.test(html), 'The HTML response is missing the React display root.');
  requireCondition(sessionA.cookie !== sessionB.cookie, 'Two visitors received the same session cookie.');
  console.log('PASS health, built display, and distinct HttpOnly visitor sessions');

  const a = new Visitor(sessionA.cookie);
  const b = new Visitor(sessionB.cookie);
  await Promise.all([
    a.waitFor((state) => Boolean(state.phase), 'visitor A initial state'),
    b.waitFor((state) => Boolean(state.phase), 'visitor B initial state'),
  ]);
  requireCondition(a.state.roundId !== b.state.roundId, 'Two visitor cookies share one city round.');
  a.resetAllowed = true;
  b.resetAllowed = true;
  keepAlive = setInterval(() => {
    for (const peer of [a, b]) if (peer.ws.readyState === WebSocket.OPEN) peer.send({ type: 'activity' });
  }, 1000);
  await Promise.all([
    a.command({ type: 'reset' }, (state) => state.phase === 'ready', 'visitor A ready state'),
    b.command({ type: 'reset' }, (state) => state.phase === 'ready', 'visitor B ready state'),
  ]);
  const baselineB = structuredClone(b.state);
  requireCondition(a.state.powerMode === 'low' && b.state.powerMode === 'low', 'New cities must start in LOW mode.');
  requireCondition(a.state.stats.failed === 0 && a.state.stats.lossLimit === 27, 'A new city must expose zero losses and the 27-building blackout limit.');

  await Promise.all([protectedRoutes(sessionA.cookie), requireCrossOriginRejection(sessionA.cookie)]);
  console.log('PASS visitor access denied for settings, event reset, history, CSV, and foreign-origin WebSockets');

  await a.command({ type: 'practice' }, (state) => state.phase === 'practice', 'visitor A guided practice');
  const training = structuredClone(a.state.training);
  requireCondition(Boolean(training?.targetId) && training.matchMode === 'medium' && training.releaseMode === 'low', 'Guided practice must teach MEDIUM followed by LOW.');
  await a.command({ type: 'select', id: training.targetId }, (state) => state.selectedId === training.targetId, 'visitor A practice target selection');
  for (const mode of ['low', 'medium', 'high']) {
    await a.command({ type: 'power', mode }, (state) => state.powerMode === mode && state.power === POWER_LEVELS[mode], `visitor A ${mode.toUpperCase()} power mode`);
  }
  await b.waitFor((state) => unchangedCity(state, baselineB), 'visitor B unchanged during A practice', { after: b.version });
  requireCondition(a.state.practice === true, 'Guided practice did not produce an unscored state.');
  await a.command({ type: 'power', mode: training.matchMode }, (state) => state.training?.step === 'release', 'visitor A matching practice mode');
  await a.command({ type: 'power', mode: training.releaseMode }, (state) => state.training?.step === 'complete', 'visitor A returning to LOW');
  await a.command({ type: 'start' }, (state) => ['countdown', 'playing'].includes(state.phase), 'visitor A clean scored start');
  requireCondition(a.state.training === null && a.state.practice === false, 'Skipping practice did not produce a clean scored round.');
  await b.waitFor((state) => unchangedCity(state, baselineB), 'visitor B unchanged during A start', { after: b.version });
  await a.command({ type: 'reset' }, (state) => state.phase === 'ready', 'visitor A final reset');
  console.log('PASS independent visitors, three power modes, complete guided practice, scored start, and reset');
}

try {
  await main();
} catch (error) {
  // Only messages created above are emitted; raw server bodies, URLs, and cookies are never printed.
  console.error(`FAIL ${error instanceof Error ? error.message : 'Hosted smoke test failed.'}`);
  process.exitCode = 1;
} finally {
  if (!await cleanup()) {
    console.error('FAIL Could not confirm every owned city reset; all smoke-test sockets were closed.');
    process.exitCode = 1;
  }
}
if (!process.exitCode) console.log('Hosted smoke test passed. No scores were submitted; owned cities were reset.');
