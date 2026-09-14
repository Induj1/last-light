import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { GameEngine } from './engine.js';
import { Leaderboard, LeaderboardError, leaderboardCsv } from './leaderboard.js';
import { SerialBridge } from './serial.js';
import { EventSettings, SettingsError, engineSettings, validateSettings } from './settings.js';
import { isPowerMode } from '../shared/power.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TICK_MS = 50;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

export function validCommand(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  switch (message.type) {
    case 'start': case 'reset': case 'pause': case 'practice': case 'demo': case 'wake': case 'activity': return true;
    case 'input': return ['x', 'y', 'powerDelta'].every((key) => message[key] === undefined || finite(message[key], -1, 1))
      && (message.stabilize === undefined || typeof message.stabilize === 'boolean');
    case 'power': return isPowerMode(message.mode) && Object.keys(message).every((key) => ['type', 'mode'].includes(key));
    case 'select': return typeof message.id === 'string' && message.id.length > 0 && message.id.length <= 80;
    case 'difficulty': return ['easy', 'normal', 'hard'].includes(message.value);
    case 'debug': return ['toggle', 'fail', 'warn', 'restore', 'storage', 'npc'].includes(message.action)
      && (message.action !== 'storage' || finite(message.value, 0, 100))
      && (message.value === undefined || (typeof message.value === 'string' && message.value.length <= 80) || finite(message.value, 0, 100));
    default: return false;
  }
}

export function permittedOrigin(origin, host) {
  try {
    if (host && !LOOPBACK.has(new URL(`http://${host}`).hostname)) return false;
    return !origin || LOOPBACK.has(new URL(origin).hostname);
  } catch { return false; }
}

export async function createLastLightServer({
  engine = new GameEngine(), directory = process.env.LAST_LIGHT_DATA_DIR || path.join(ROOT, 'data'),
  serial, leaderboard, logger = console, now = Date.now, tickMs = TICK_MS,
} = {}) {
  leaderboard ??= await new Leaderboard(directory, { logger }).load();
  serial ??= await new SerialBridge({ directory, logger, now }).initialize();
  const eventSettings = await new EventSettings(directory, { logger }).load(leaderboard.settings);
  if (eventSettings.persisted) engine.configure?.(engineSettings(eventSettings.settings));
  await leaderboard.updateSettings(eventSettings.settings);
  await eventSettings.mirror(eventSettings.settings);
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!permittedOrigin(req.headers.origin, req.headers.host)) return res.status(403).json({ error: 'Only local exhibition access is allowed.' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.json({ limit: '2kb', strict: true }));
  const http = createHttpServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
  const clients = new Map();
  const results = new Map();
  let owner = null;
  let keyboardInput = { x: 0, y: 0, powerDelta: 0, stabilize: false };
  let lastKeyboardAt = -Infinity;
  let lastKeyboardActiveAt = -Infinity;
  let tickTimer;
  let heartbeat;
  let lastResultId = null;
  let lastHumanAt = now();
  let lastPhase = engine.snapshot().phase;
  let hardwarePowerBaseline = null;
  let operationQueue = Promise.resolve();
  let organizerBusy = false;

  function serialize(operation) {
    const task = operationQueue.then(operation);
    operationQueue = task.catch(() => {});
    return task;
  }
  function eventResponse() {
    return { settings: { ...eventSettings.settings }, event: leaderboard.metadata(), ...(eventSettings.warning ? { warning: eventSettings.warning } : {}) };
  }
  function requireBetweenRounds() {
    if (!['ready', 'demo', 'results'].includes(engine.snapshot().phase)) throw new SettingsError('Finish or reset the current round before changing event settings.', 409);
  }
  async function saveSettings(update) {
    return serialize(async () => {
      requireBetweenRounds(); organizerBusy = true;
      try {
        const settings = validateSettings(update, eventSettings.settings);
        await leaderboard.updateSettings(settings);
        await eventSettings.mirror(settings);
        engine.configure?.(engineSettings(settings));
        if (!settings.attractEnabled && engine.snapshot().phase === 'demo') engine.command({ type: 'wake' });
        lastHumanAt = now();
        broadcast();
        return eventResponse();
      } finally { organizerBusy = false; }
    });
  }

  function cacheResult(state) {
    if (state.result?.roundId && state.result.roundId !== lastResultId) {
      lastResultId = state.result.roundId;
      results.set(state.result.roundId, { result: structuredClone(state.result), expires: now() + 120000, eventId: leaderboard.event.id });
    }
    if (state.result?.practice && results.has(state.result.roundId)) results.get(state.result.roundId).result.practice = true;
    for (const [id, entry] of results) if (entry.expires < now()) results.delete(id);
  }
  function snapshot() {
    const state = engine.snapshot();
    cacheResult(state);
    return { ...state, connection: serial.connection(), leaderboard: leaderboard.top(), ...eventResponse() };
  }
  function broadcast(state = snapshot()) {
    const data = JSON.stringify({ type: 'state', state });
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      // A slow browser cannot grow the process queue throughout the exhibition.
      if (client.bufferedAmount > 1024 * 1024) { client.terminate(); continue; }
      client.send(data);
    }
  }
  function errorMessage(client, error) {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'error', error }));
  }
  function stopKeyboard() {
    keyboardInput = { x: 0, y: 0, powerDelta: 0, stabilize: false };
    lastKeyboardAt = -Infinity;
    lastKeyboardActiveAt = -Infinity;
    engine.command({ type: 'input', ...keyboardInput });
  }
  function applyCommand(client, message) {
    const activeInput = message.type !== 'input' || Boolean(message.x || message.y || message.powerDelta || message.stabilize);
    if (activeInput) lastHumanAt = now();
    if (organizerBusy) { if (activeInput && message.type !== 'activity') errorMessage(client, 'Event settings are being saved. Try again in a moment.'); return; }
    if (engine.snapshot().phase === 'demo') {
      if (activeInput) { owner = null; engine.command({ type: 'wake' }); stopKeyboard(); broadcast(); }
      return;
    }
    if (message.type === 'activity') return;
    // Merely watching the game, including sending neutral key state, never takes controls.
    if (!owner && activeInput) owner = client;
    if (owner !== client) {
      if (activeInput) errorMessage(client, 'Another display has control. Close that display to transfer controls.');
      return;
    }
    if (message.type === 'input') {
      keyboardInput = { x: message.x || 0, y: message.y || 0, powerDelta: message.powerDelta || 0, stabilize: Boolean(message.stabilize) };
      lastKeyboardAt = now();
      if (activeInput) lastKeyboardActiveAt = now();
    } else {
      if (message.type === 'difficulty') {
        saveSettings({ difficulty: message.value }).catch((error) => errorMessage(client, error.message));
        return;
      }
      if (message.type === 'power' || message.type === 'select') lastKeyboardActiveAt = now();
      engine.command(message);
      broadcast();
    }
  }

  wss.on('connection', (client) => {
    const state = { alive: true, window: now(), messages: 0 };
    clients.set(client, state);
    client.on('pong', () => { state.alive = true; });
    client.on('error', () => {});
    client.on('message', (data, binary) => {
      if (now() - state.window >= 1000) { state.window = now(); state.messages = 0; }
      state.messages += 1;
      if (state.messages > 100) { client.close(1008, 'Input rate too high'); return; }
      if (binary) { errorMessage(client, 'Commands must be JSON text.'); return; }
      let message;
      try { message = JSON.parse(data.toString()); }
      catch { errorMessage(client, 'Malformed JSON command.'); return; }
      if (!validCommand(message)) { errorMessage(client, 'Invalid game command.'); return; }
      applyCommand(client, message);
    });
    client.on('close', () => {
      clients.delete(client);
      if (owner === client) {
        owner = null;
        stopKeyboard();
        if (!serial.connection().connected && ['playing', 'countdown', 'practice'].includes(engine.snapshot().phase)) engine.command({ type: 'pause' });
      }
    });
    client.send(JSON.stringify({ type: 'state', state: snapshot() }));
  });
  http.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws' || !permittedOrigin(req.headers.origin, req.headers.host)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
    }
    wss.handleUpgrade(req, socket, head, (client) => wss.emit('connection', client, req));
  });

  app.get('/api/health', (req, res) => res.json({ ok: true, name: 'LAST LIGHT', phase: engine.snapshot().phase, connection: serial.connection(), persistenceWarning: leaderboard.warning }));
  app.get('/api/session', (req, res) => res.json({ hosting: { mode: 'local', admin: true } }));
  app.get('/api/leaderboard', (req, res) => res.json({ leaderboard: leaderboard.top() }));
  app.post('/api/leaderboard', async (req, res) => {
    const entry = await serialize(async () => {
      snapshot();
      const { roundId, name } = req.body || {};
      if (typeof roundId !== 'string' || roundId.length > 100) throw new LeaderboardError('A valid roundId is required.');
      const cached = results.get(roundId);
      if (!cached || cached.eventId !== leaderboard.event.id) throw new LeaderboardError('This result has expired. Finish a new round to submit a score.', 410);
      return leaderboard.submit(name, cached.result, cached.eventId);
    });
    res.status(201).json({ entry, leaderboard: leaderboard.top() });
    broadcast();
  });
  app.get('/api/event/settings', (req, res) => res.json(eventResponse()));
  app.post('/api/event/settings', async (req, res) => res.json(await saveSettings(req.body)));
  app.get('/api/leaderboard/export.csv', (req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="last-light-${leaderboard.event.id}.csv"`);
    res.type('text/csv').send(leaderboard.csv());
  });
  app.get('/api/event/history', async (req, res) => res.json({ events: await leaderboard.history() }));
  app.get('/api/event/:id/export.csv', async (req, res) => {
    const archive = await leaderboard.archive(req.params.id);
    res.setHeader('Content-Disposition', `attachment; filename="last-light-${archive.event.id}.csv"`);
    res.type('text/csv').send(leaderboardCsv(archive.entries, archive.event));
  });
  app.post('/api/event/new', async (req, res) => {
    const response = await serialize(async () => {
      requireBetweenRounds(); organizerBusy = true;
      try {
        const previousEvent = await leaderboard.startEvent(req.body?.name, eventSettings.settings);
        await eventSettings.mirror(leaderboard.settings);
        results.clear(); lastResultId = null; stopKeyboard();
        engine.command({ type: 'reset' });
        engine.configure?.(engineSettings(eventSettings.settings));
        lastHumanAt = now();
        broadcast();
        return { ...eventResponse(), previousEvent, leaderboard: [] };
      } finally { organizerBusy = false; }
    });
    res.status(201).json(response);
  });
  app.get('/api/config', (req, res) => res.json({ config: engine.config || {}, calibration: { ...serial.calibration } }));
  app.get('/api/serial/ports', async (req, res) => res.json({ ports: await serial.listPorts(), connection: serial.connection() }));
  app.post('/api/serial/connect', async (req, res) => {
    try { res.json({ connection: await serial.connect(req.body?.path) }); }
    catch (error) { res.status(503).json({ error: error.message, connection: serial.connection() }); }
  });
  app.post('/api/serial/disconnect', async (req, res) => { await serial.disconnect(); res.json({ connection: serial.connection() }); });
  app.post('/api/serial/calibrate', async (req, res) => {
    try { res.json({ calibration: await serial.calibrate(req.body) }); }
    catch (error) { res.status(error.code ? 500 : 400).json({ error: error.message }); }
  });
  app.post('/api/serial/test', (req, res) => {
    try { serial.testStorage(req.body?.value); res.json({ ok: true, value: Math.round(req.body.value), duration: 3 }); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));
  const dist = path.join(ROOT, 'dist');
  if (existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get('/{*path}', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    app.get('/', (req, res) => res.type('text').send('LAST LIGHT server is ready. Run npm run dev for the display, or npm run build then npm start.'));
  }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || (error.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) logger.error(error);
    res.status(status).json({ error: status >= 500 ? 'The local server could not complete this operation. Check the terminal.' : error.message });
  });

  function tick() {
    const hardware = serial.input();
    let phase = engine.snapshot().phase;
    if (phase === 'ready' && lastPhase !== 'ready') lastHumanAt = now();
    const powerMoved = Boolean(hardware && hardwarePowerBaseline !== null && Math.abs(hardware.knob - hardwarePowerBaseline) >= 2);
    const hardwareActive = Boolean(hardware && (hardware.x || hardware.y || powerMoved || hardware.pressed));
    if (!hardware) hardwarePowerBaseline = null;
    else if (hardwarePowerBaseline === null || powerMoved) hardwarePowerBaseline = hardware.knob;
    if (hardwareActive) lastHumanAt = now();
    if (now() - lastKeyboardAt > 500) keyboardInput = { x: 0, y: 0, powerDelta: 0, stabilize: false };
    const wakingDemo = phase === 'demo' && hardwareActive && !organizerBusy;
    if (wakingDemo) { owner = null; engine.command({ type: 'wake' }); stopKeyboard(); }
    else if (phase !== 'demo' && !organizerBusy) {
      if (hardware?.pressed) {
        const state = engine.snapshot();
        if (phase === 'ready' || phase === 'results') engine.command({ type: 'practice' });
        else if (phase === 'practice' && state.training?.step === 'complete') engine.command({ type: 'start' });
        else if (phase === 'paused') engine.command({ type: 'pause' });
      }
      if (hardware && now() - lastKeyboardActiveAt > 350) {
        engine.command({ type: 'input', x: hardware.x, y: hardware.y, powerDelta: 0, stabilize: false });
        engine.command({ type: 'power', mode: hardware.powerMode });
      } else engine.command({ type: 'input', ...keyboardInput });
      if (phase === 'ready' && engine.snapshot().phase === 'ready' && eventSettings.settings.attractEnabled
        && now() - lastHumanAt >= eventSettings.settings.attractIdleSeconds * 1000) {
        stopKeyboard(); owner = null;
        engine.command({ type: 'demo' });
      }
    }
    engine.tick(tickMs / 1000);
    const state = snapshot();
    if (state.phase === 'ready' && phase !== 'ready') lastHumanAt = now();
    lastPhase = state.phase;
    serial.sendStorage(state.storage);
    serial.sendLcd(state.phase === 'playing' ? `TIME ${Math.ceil(state.remaining)}s ${String(state.powerMode || 'low').toUpperCase()}` : `LAST LIGHT ${state.phase}`, `STORAGE ${Math.round(state.storage)}%`);
    broadcast(state);
  }

  return {
    app, http, wss, engine, serial, leaderboard, eventSettings, snapshot, tick,
    async listen(port = Number(process.env.PORT) || 3001, host = '127.0.0.1') {
      await new Promise((resolve, reject) => { http.once('error', reject); http.listen(port, host, () => { http.off('error', reject); resolve(); }); });
      tickTimer = setInterval(tick, tickMs);
      heartbeat = setInterval(() => {
        for (const [client, state] of clients) {
          if (!state.alive) { client.terminate(); continue; }
          state.alive = false;
          client.ping();
        }
      }, 5000);
      return http.address();
    },
    async close() {
      clearInterval(tickTimer); clearInterval(heartbeat);
      for (const client of wss.clients) client.terminate();
      await new Promise((resolve) => wss.close(() => resolve()));
      await serial.close();
      await operationQueue;
      await leaderboard.queue;
      if (http.listening) await new Promise((resolve) => http.close(() => resolve()));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const server = await createLastLightServer();
  const address = await server.listen();
  console.log(`LAST LIGHT ready at http://127.0.0.1:${address.port} — keyboard mode available offline.`);
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    await server.close();
    process.exit(0);
  });
}
