import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { existsSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { GameEngine } from './engine.js';
import { validCommand } from './index.js';
import { Leaderboard, LeaderboardError, leaderboardCsv } from './leaderboard.js';
import { EventSettings, SettingsError, engineSettings, validateSettings } from './settings.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COOKIE = 'last_light_session';
const KEYBOARD = Object.freeze({ mode: 'keyboard', connected: false, status: 'Online keyboard and touch controls' });
const ZERO_INPUT = Object.freeze({ x: 0, y: 0, powerDelta: 0, stabilize: false });
const PUBLIC_COMMANDS = new Set(['start', 'practice', 'reset', 'pause', 'input', 'power', 'select', 'wake', 'activity']);
const BETWEEN_ROUNDS = new Set(['ready', 'results', 'demo']);
const SESSION_ID = /^[a-f0-9]{64}$/;
const hash = (value) => createHash('sha256').update(value).digest();

function configuredOrigin(value) {
  if (!value) return null;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('LAST_LIGHT_PUBLIC_ORIGIN must be an HTTP(S) origin without a path.');
  return url.origin;
}
function cookieId(request) {
  const cookie = String(request.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  const value = cookie?.slice(COOKIE.length + 1);
  return SESSION_ID.test(value || '') ? value : null;
}

/** Online edition: isolated simulation per cookie, shared authoritative event ledger. */
export async function createHostedServer({
  directory = process.env.LAST_LIGHT_DATA_DIR || path.join(ROOT, 'data'),
  publicOrigin = process.env.LAST_LIGHT_PUBLIC_ORIGIN || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null),
  adminPassword = process.env.LAST_LIGHT_ADMIN_PASSWORD || '', logger = console, now = Date.now,
  maxSessions = 200, maxSessionsPerIp = Math.min(200, Math.max(1, Number(process.env.LAST_LIGHT_MAX_SESSIONS_PER_IP) || 8)), maxSocketsPerSession = 3, sessionTtlMs = 30 * 60 * 1000,
  engineFactory = (settings) => new GameEngine({ config: engineSettings(settings) }),
} = {}) {
  const origin = configuredOrigin(publicOrigin);
  const passwordHash = adminPassword ? hash(adminPassword) : null;
  const leaderboard = await new Leaderboard(directory, { logger }).load();
  const settingsStore = await new EventSettings(directory, { logger }).load(leaderboard.settings);
  await leaderboard.updateSettings(settingsStore.settings);
  await settingsStore.mirror(settingsStore.settings);
  const sessions = new Map();
  const loginAttempts = new Map();
  let globalAttempts = { since: now(), count: 0 };
  let operations = Promise.resolve();
  let organizerBusy = false;
  let tickTimer, heartbeatTimer, cleanupTimer;
  let closing = false;

  const app = express();
  app.disable('x-powered-by');
  // Railway supplies the nearest forwarded address; a global login bound also applies.
  app.set('trust proxy', 1);
  const http = createHttpServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });

  function expectedOrigin(request) {
    if (origin) return origin;
    try {
      const local = new URL(`http://${request.headers.host}`);
      return ['localhost', '127.0.0.1', '[::1]'].includes(local.hostname) ? local.origin : null;
    } catch { return null; }
  }
  function sameOrigin(request, required = false) {
    const expected = expectedOrigin(request);
    if (!expected) return false;
    try {
      if (new URL(expected).host.toLowerCase() !== String(request.headers.host || '').toLowerCase()) return false;
      if (request.headers['sec-fetch-site'] === 'cross-site') return false;
      if (!request.headers.origin) return !required;
      return new URL(request.headers.origin).origin === expected;
    } catch { return false; }
  }
  function setCookie(response, session) {
    // Server-side idle expiry is authoritative; an active WebSocket cannot refresh a cookie.
    response.append('Set-Cookie', `${COOKIE}=${session.id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${origin?.startsWith('https:') ? '; Secure' : ''}`);
  }
  function sessionOf(request) { return sessions.get(cookieId(request)); }
  function touch(session) { session.lastSeenAt = now(); }
  function responseFor(session) {
    return { hosting: { mode: 'online', admin: Boolean(session.admin) }, settings: { ...settingsStore.settings }, event: leaderboard.metadata(), leaderboard: leaderboard.top() };
  }
  function serialize(operation) {
    const task = operations.then(operation);
    operations = task.catch(() => {});
    return task;
  }
  function cacheResult(session, state) {
    if (state.result?.roundId && state.result.roundId !== session.lastResultId) {
      session.lastResultId = state.result.roundId;
      session.results.set(state.result.roundId, { result: structuredClone(state.result), eventId: session.roundEventId, expires: now() + 120000 });
    }
    if (state.result?.practice && session.results.has(state.result.roundId)) session.results.get(state.result.roundId).result.practice = true;
    for (const [id, entry] of session.results) if (entry.expires <= now()) session.results.delete(id);
  }
  function snapshot(session) {
    const state = session.engine.snapshot();
    cacheResult(session, state);
    return { ...state, ...responseFor(session), connection: { ...KEYBOARD } };
  }
  function sendState(session) {
    if (!session.sockets.size) return;
    const message = JSON.stringify({ type: 'state', state: snapshot(session) });
    for (const socket of session.sockets) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (socket.bufferedAmount > 1024 * 1024) { socket.terminate(); continue; }
      socket.send(message);
    }
    session.lastBroadcastAt = now();
  }
  function sendAll() { for (const session of sessions.values()) sendState(session); }
  function socketError(socket, error) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'error', error }));
  }
  function stopInput(session) {
    session.input = { ...ZERO_INPUT }; session.lastInputAt = -Infinity;
    session.engine.command({ type: 'input', ...ZERO_INPUT });
  }
  function applyPending(session) {
    if (!session.pendingSettings || !BETWEEN_ROUNDS.has(session.engine.state.phase)) return;
    session.engine.configure(engineSettings(session.pendingSettings));
    session.pendingSettings = null;
  }
  function resetSession(session) {
    stopInput(session);
    session.engine.command({ type: 'reset' });
    session.engine.configure(engineSettings(settingsStore.settings));
    session.pendingSettings = null;
    session.roundEventId = leaderboard.event.id;
    session.lastHumanAt = now();
    session.lastPhase = session.engine.state.phase;
  }
  function requireAdmin(session) {
    if (!session?.admin) throw new SettingsError('Organizer sign-in is required.', 403);
  }
  async function saveSettings(session, update) {
    return serialize(async () => {
      requireAdmin(session);
      if (!BETWEEN_ROUNDS.has(session.engine.state.phase)) throw new SettingsError('Finish or reset your round before changing event settings.', 409);
      organizerBusy = true;
      try {
        const settings = validateSettings(update, settingsStore.settings);
        await leaderboard.updateSettings(settings);
        await settingsStore.mirror(settings);
        for (const visitor of sessions.values()) {
          visitor.pendingSettings = settings;
          applyPending(visitor);
          visitor.lastHumanAt = now();
        }
        sendAll();
        return responseFor(session);
      } finally { organizerBusy = false; }
    });
  }
  function processCommand(session, socket, message) {
    if (!validCommand(message)) { socketError(socket, 'Invalid game command.'); return; }
    if (!session.admin && !PUBLIC_COMMANDS.has(message.type)) { socketError(socket, 'Organizer sign-in is required for this command.'); return; }
    const active = message.type !== 'input' || Boolean(message.x || message.y || message.powerDelta || message.stabilize);
    if (active) session.lastHumanAt = now();
    if (organizerBusy && active && message.type !== 'activity') { socketError(socket, 'Event settings are being saved. Try again in a moment.'); return; }
    if (session.engine.state.phase === 'demo') {
      if (active) { session.engine.command({ type: 'wake' }); stopInput(session); applyPending(session); sendState(session); }
      return;
    }
    if (message.type === 'activity') return;
    if (message.type === 'difficulty') { saveSettings(session, { difficulty: message.value }).catch((error) => socketError(socket, error.message)); return; }
    if (message.type === 'input') {
      session.input = { x: message.x || 0, y: message.y || 0, powerDelta: message.powerDelta || 0, stabilize: Boolean(message.stabilize) };
      session.lastInputAt = now();
      return;
    }
    if (message.type === 'reset') resetSession(session);
    else {
      if (message.type === 'start' && session.pendingSettings && ['practice', 'paused'].includes(session.engine.state.phase)) resetSession(session);
      applyPending(session);
      session.engine.command(message);
      if (['start', 'practice'].includes(message.type)) session.roundEventId = leaderboard.event.id;
    }
    if (!['power', 'select'].includes(message.type)) sendState(session);
  }
  function cleanup() {
    for (const [id, session] of sessions) {
      if (!session.sockets.size && now() - session.lastSeenAt >= sessionTtlMs) sessions.delete(id);
    }
    for (const [ip, attempt] of loginAttempts) if (now() - attempt.since >= 60000) loginAttempts.delete(ip);
  }
  function createSession(request) {
    cleanup();
    const ip = request.ip || request.socket.remoteAddress || 'unknown';
    if (sessions.size >= maxSessions) throw new SettingsError('The exhibition is busy. Please try again shortly.', 503);
    if ([...sessions.values()].filter((session) => session.ip === ip).length >= maxSessionsPerIp) throw new SettingsError('Too many browser sessions from this connection. Reuse an existing game tab or try again later.', 429);
    const session = {
      id: randomBytes(32).toString('hex'), ip, admin: false,
      engine: engineFactory(settingsStore.settings), sockets: new Set(), results: new Map(), lastResultId: null,
      createdAt: now(), lastSeenAt: now(), lastHumanAt: now(), lastPhase: 'ready', lastBroadcastAt: -Infinity,
      input: { ...ZERO_INPUT }, lastInputAt: -Infinity, pendingSettings: null, roundEventId: leaderboard.event.id,
    };
    sessions.set(session.id, session);
    return session;
  }

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss:; img-src 'self' data:; media-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (origin?.startsWith('https:')) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'private, no-store');
    next();
  });
  // Health contains no user or organizer data and works for internal platform probes.
  app.get('/api/health', (req, res) => res.json({ ok: true, name: 'LAST LIGHT', mode: 'online' }));
  app.use((req, res, next) => {
    if (!sameOrigin(req, !['GET', 'HEAD', 'OPTIONS'].includes(req.method))) return res.status(403).json({ error: 'Only same-origin access is allowed.' });
    next();
  });
  app.use(express.json({ limit: '2kb', strict: true }));
  app.get('/api/session', (req, res) => {
    const session = sessionOf(req) || createSession(req);
    touch(session); session.lastHumanAt = now();
    setCookie(res, session);
    res.json(responseFor(session));
  });
  app.use('/api', (req, res, next) => {
    const session = sessionOf(req);
    if (!session) return res.status(401).json({ error: 'Your browser session expired. Refresh the page to reconnect.' });
    touch(session); req.gameSession = session;
    next();
  });
  app.post('/api/admin/login', (req, res) => {
    if (!passwordHash) return res.status(503).json({ error: 'Organizer sign-in is not configured on this server.' });
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (now() - globalAttempts.since >= 60000) globalAttempts = { since: now(), count: 0 };
    if (globalAttempts.count >= 30) return res.status(429).json({ error: 'Too many sign-in attempts. Please wait a minute and try again.' });
    let attempt = loginAttempts.get(ip);
    if (!attempt || now() - attempt.since >= 60000) {
      if (!attempt && loginAttempts.size >= 512) return res.status(429).json({ error: 'Too many sign-in attempts. Please wait a minute and try again.' });
      attempt = { since: now(), count: 0 }; loginAttempts.set(ip, attempt);
    }
    if (attempt.count >= 5) return res.status(429).json({ error: 'Too many sign-in attempts. Please wait a minute and try again.' });
    attempt.count += 1; globalAttempts.count += 1;
    const password = req.body?.password;
    if (typeof password !== 'string' || !timingSafeEqual(hash(password), passwordHash)) return res.status(401).json({ error: 'Incorrect organizer password.' });
    loginAttempts.delete(ip);
    const session = req.gameSession;
    sessions.delete(session.id);
    session.id = randomBytes(32).toString('hex'); session.admin = true;
    sessions.set(session.id, session); setCookie(res, session);
    sendState(session);
    // Existing connections used the pre-login cookie. Reconnect with the rotated one.
    for (const socket of session.sockets) socket.close(1000, 'Organizer sign-in refreshed the session. Reconnect.');
    res.json(responseFor(session));
  });
  app.post('/api/admin/logout', (req, res) => {
    const session = req.gameSession;
    session.admin = false;
    if (session.engine.state.debug) session.engine.command({ type: 'debug', action: 'toggle' });
    sendState(session); res.json(responseFor(session));
  });
  app.get('/api/leaderboard', (req, res) => res.json({ leaderboard: leaderboard.top() }));
  app.get('/api/event/settings', (req, res) => res.json(responseFor(req.gameSession)));
  app.post('/api/leaderboard', async (req, res) => {
    const session = req.gameSession;
    const entry = await serialize(async () => {
      snapshot(session);
      const { roundId, name } = req.body || {};
      if (typeof roundId !== 'string' || roundId.length > 100) throw new LeaderboardError('A valid roundId is required.');
      const cached = session.results.get(roundId);
      if (!cached || cached.eventId !== leaderboard.event.id) throw new LeaderboardError('This completed round is not available in your browser session.', 410);
      return leaderboard.submit(name, cached.result, cached.eventId);
    });
    sendAll(); res.status(201).json({ entry, leaderboard: leaderboard.top() });
  });
  app.post('/api/event/settings', async (req, res) => res.json(await saveSettings(req.gameSession, req.body)));
  app.post('/api/event/new', async (req, res) => {
    const response = await serialize(async () => {
      const session = req.gameSession; requireAdmin(session);
      if (!BETWEEN_ROUNDS.has(session.engine.state.phase)) throw new SettingsError('Finish or reset your round before starting a new event.', 409);
      organizerBusy = true;
      try {
        const previousEvent = await leaderboard.startEvent(req.body?.name, settingsStore.settings);
        await settingsStore.mirror(leaderboard.settings);
        for (const visitor of sessions.values()) { visitor.results.clear(); visitor.lastResultId = null; resetSession(visitor); }
        sendAll();
        return { ...responseFor(session), previousEvent };
      } finally { organizerBusy = false; }
    });
    res.status(201).json(response);
  });
  app.get('/api/event/history', async (req, res) => { requireAdmin(req.gameSession); res.json({ events: await leaderboard.history() }); });
  app.get('/api/leaderboard/export.csv', (req, res) => {
    requireAdmin(req.gameSession);
    res.setHeader('Content-Disposition', `attachment; filename="last-light-${leaderboard.event.id}.csv"`);
    res.type('text/csv').send(leaderboard.csv());
  });
  app.get('/api/event/:id/export.csv', async (req, res) => {
    requireAdmin(req.gameSession);
    const archive = await leaderboard.archive(req.params.id);
    res.setHeader('Content-Disposition', `attachment; filename="last-light-${archive.event.id}.csv"`);
    res.type('text/csv').send(leaderboardCsv(archive.entries, archive.event));
  });
  app.get('/api/config', (req, res) => { requireAdmin(req.gameSession); res.json({ config: req.gameSession.engine.config, calibration: null, hosting: { mode: 'online', admin: true } }); });
  app.get('/api/serial/ports', (req, res) => { requireAdmin(req.gameSession); res.json({ ports: [], connection: { ...KEYBOARD } }); });
  app.post('/api/serial/:action', (req, res) => { requireAdmin(req.gameSession); res.status(400).json({ error: 'Arduino controls are available in the local exhibition edition.' }); });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));
  const dist = path.join(ROOT, 'dist');
  if (existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get('/{*path}', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else app.get('/', (req, res) => res.type('text').send('LAST LIGHT online server is ready. Build the frontend with npm run build.'));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || 500;
    if (status >= 500) logger.error(`Hosted operation failed: ${error.message}`);
    res.status(status).json({ error: status >= 500 ? 'The server could not complete this operation. Please try again.' : error.message });
  });

  http.on('upgrade', (request, socket, head) => {
    const session = sessionOf(request);
    const status = request.url !== '/ws' || !sameOrigin(request, true) ? 403 : !session ? 401 : session.sockets.size >= maxSocketsPerSession ? 429 : 0;
    if (status) { socket.write(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`); socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, (client) => {
      const authenticatedId = session.id;
      session.sockets.add(client); touch(session);
      client.alive = true; client.window = now(); client.messageCount = 0;
      client.on('error', () => {});
      client.on('pong', () => { client.alive = true; touch(session); });
      client.on('message', (data, binary) => {
        if (authenticatedId !== session.id) { client.terminate(); return; }
        if (client.readyState !== WebSocket.OPEN) return;
        touch(session);
        if (now() - client.window >= 1000) { client.window = now(); client.messageCount = 0; }
        client.messageCount += 1;
        if (client.messageCount > 100) { client.close(1008, 'Input rate too high'); return; }
        if (binary) { socketError(client, 'Commands must be JSON text.'); return; }
        let message;
        try { message = JSON.parse(data.toString()); }
        catch { socketError(client, 'Malformed JSON command.'); return; }
        processCommand(session, client, message);
      });
      client.on('close', () => {
        session.sockets.delete(client); touch(session);
        if (!session.sockets.size) {
          stopInput(session);
          if (['playing', 'countdown', 'practice'].includes(session.engine.state.phase)) session.engine.command({ type: 'pause' });
        }
      });
      sendState(session);
    });
  });
  function tick() {
    for (const session of sessions.values()) {
      if (!session.sockets.size) continue;
      const phase = session.engine.state.phase;
      if (phase === 'ready' && session.lastPhase !== 'ready') session.lastHumanAt = now();
      if (phase !== 'demo') {
        if (now() - session.lastInputAt > 500) session.input = { ...ZERO_INPUT };
        session.engine.command({ type: 'input', ...session.input });
        if (phase === 'ready' && !organizerBusy && settingsStore.settings.attractEnabled
          && now() - session.lastHumanAt >= settingsStore.settings.attractIdleSeconds * 1000) {
          stopInput(session); session.engine.command({ type: 'demo' });
        }
      }
      session.engine.tick(0.05);
      if (session.engine.state.phase !== phase) {
        if (session.engine.state.phase === 'ready') session.lastHumanAt = now();
        applyPending(session);
        cacheResult(session, session.engine.state);
      }
      session.lastPhase = session.engine.state.phase;
      if (now() - session.lastBroadcastAt >= 100) sendState(session);
    }
  }

  return {
    app, http, wss, sessions, leaderboard, settingsStore, snapshot, tick, cleanup,
    async listen(port = Number(process.env.PORT) || 3001, host = '0.0.0.0') {
      await new Promise((resolve, reject) => { http.once('error', reject); http.listen(port, host, () => { http.off('error', reject); resolve(); }); });
      tickTimer = setInterval(tick, 50);
      cleanupTimer = setInterval(cleanup, 60000);
      heartbeatTimer = setInterval(() => {
        for (const client of wss.clients) {
          if (!client.alive) { client.terminate(); continue; }
          client.alive = false; client.ping();
        }
      }, 5000);
      return http.address();
    },
    async close() {
      if (closing) return;
      closing = true;
      clearInterval(tickTimer); clearInterval(cleanupTimer); clearInterval(heartbeatTimer);
      for (const client of wss.clients) client.terminate();
      await new Promise((resolve) => wss.close(resolve));
      await operations; await leaderboard.queue;
      if (http.listening) await new Promise((resolve) => http.close(resolve));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const server = await createHostedServer();
  const address = await server.listen();
  console.log(`LAST LIGHT online server ready on port ${address.port}.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0); });
}
