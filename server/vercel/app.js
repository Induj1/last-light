import express from 'express';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { RedisRest, StoreError, VercelStore } from './store.js';
import { engineSettings, eventName, validateSettings } from '../settings.js';
import { cleanName, leaderboardCsv } from '../leaderboard.js';
import { resolveConfig } from '../../shared/config.js';
import { REPLAY_STEP, REPLAY_VERSION, replayRound } from '../../shared/replay.js';

const VISITOR_COOKIE = 'last_light_visitor';
const ADMIN_COOKIE = 'last_light_organizer';
const WEEK = 7 * 24 * 60 * 60;
const ADMIN_SECONDS = 3600;
const ROUND_MS = 10 * 60 * 1000;
const digest = (value) => createHash('sha256').update(value).digest();
const validId = (value) => typeof value === 'string' && /^[a-f0-9]{48}$/.test(value);

export function signToken(secret, purpose, payload) {
  const text = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${purpose}.${text}`).digest('base64url');
  return `${text}.${signature}`;
}
export function verifyToken(secret, purpose, token, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 32000) return null;
  const pieces = token.split('.');
  if (pieces.length !== 2) return null;
  const expected = createHmac('sha256', secret).update(`${purpose}.${pieces[0]}`).digest();
  let signature;
  try { signature = Buffer.from(pieces[1], 'base64url'); } catch { return null; }
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(pieces[0], 'base64url').toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isFinite(value.exp) || value.exp <= now) return null;
    return value;
  } catch { return null; }
}
function readCookie(request, name) {
  return String(request.headers.cookie || '').split(';').map((value) => value.trim()).find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
}
function makeEntry(name, result, now) {
  return { id: randomUUID(), roundId: result.roundId, name,
    finalScore: result.score.total, priorityScore: result.score.priority, criticalBonus: result.score.criticalBonus,
    efficiencyBonus: result.score.efficiency, survivalBonus: result.score.survival, storageRemaining: result.storage,
    buildingsSaved: result.stats.saved, criticalSaved: result.stats.criticalSaved, criticalLost: result.stats.criticalLost,
    survivalTime: result.survivalTime, difficulty: result.difficulty, survived: result.survived,
    createdAt: new Date(now).toISOString(), decisionReport: result.decisionReport };
}

export function createVercelApp({ env = process.env, store: suppliedStore, secret = env.LAST_LIGHT_SESSION_SECRET,
  adminPassword = env.LAST_LIGHT_ADMIN_PASSWORD || '', publicOrigin = env.LAST_LIGHT_PUBLIC_ORIGIN,
  buildId = env.VERCEL_DEPLOYMENT_ID || env.VERCEL_GIT_COMMIT_SHA || 'development', now = Date.now, logger = console } = {}) {
  let store = suppliedStore, setupError = null;
  try {
    if (typeof secret !== 'string' || secret.length < 32) throw new StoreError('Server security is not configured. Add a LAST_LIGHT_SESSION_SECRET containing at least 32 characters.');
    if (adminPassword && adminPassword.length < 16) throw new StoreError('LAST_LIGHT_ADMIN_PASSWORD must contain at least 16 characters.');
    if (publicOrigin && !['https:', 'http:'].includes(new URL(publicOrigin).protocol)) throw new StoreError('LAST_LIGHT_PUBLIC_ORIGIN must be an HTTP(S) origin.');
    store ??= new VercelStore(new RedisRest({ url: env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL, token: env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN }), { prefix: env.LAST_LIGHT_REDIS_PREFIX || '{last-light}:v1', now });
  } catch (error) { setupError = error.status ? error : new StoreError('Server configuration is invalid. Check the required environment variables.'); }
  const app = express();
  app.disable('x-powered-by'); app.set('trust proxy', 1);
  const passwordHash = adminPassword ? digest(adminPassword) : null;

  function originFor(request) {
    try {
      const host = String(request.headers.host || '').toLowerCase();
      if (publicOrigin) { const url = new URL(publicOrigin); return url.host.toLowerCase() === host ? url.origin : null; }
      const local = new URL(`http://${host}`);
      if (['localhost', '127.0.0.1', '[::1]'].includes(local.hostname)) return local.origin;
      const allowedHosts = [env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).map((value) => value.toLowerCase());
      if (allowedHosts.includes(host) || (env.VERCEL && local.hostname.endsWith('.vercel.app'))) return `https://${host}`;
      return null;
    } catch { return null; }
  }
  function cookie(response, request, name, value, seconds) {
    response.append('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${originFor(request)?.startsWith('https:') ? '; Secure' : ''}`);
  }
  function visitor(request) {
    const payload = verifyToken(secret, 'visitor', readCookie(request, VISITOR_COOKIE), now());
    return payload && validId(payload.sid) ? payload : null;
  }
  async function admin(request, sid) {
    const payload = verifyToken(secret, 'admin', readCookie(request, ADMIN_COOKIE), now());
    if (!payload || payload.sid !== sid || !validId(payload.jti) || payload.role !== 'admin') return null;
    return await store.adminValid(payload.jti, sid) ? payload : null;
  }
  async function responseFor(request, view) {
    view ??= await store.view();
    return { hosting: { mode: 'online', transport: 'replay', admin: Boolean(request.organizer) }, settings: view.settings, event: view.event,
      leaderboard: view.leaderboard, config: resolveConfig(engineSettings(view.settings)) };
  }
  function requireAdmin(request) { if (!request.organizer) throw new StoreError('Organizer sign-in is required.', 403); }
  function rateIdentity(request) { return createHmac('sha256', secret).update(request.ip || request.socket?.remoteAddress || 'unknown').digest('hex').slice(0, 24); }

  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('X-Frame-Options', 'DENY');
    if (setupError) return res.status(503).json({ error: setupError.message, hosting: { mode: 'online', transport: 'replay', admin: false } });
    const expected = originFor(req);
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    let validOrigin = true;
    try { validOrigin = req.headers.origin ? new URL(req.headers.origin).origin === expected : !unsafe; } catch { validOrigin = false; }
    if (!expected || !validOrigin || req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Only same-origin access is allowed.' });
    next();
  });
  app.use('/api/leaderboard', express.json({ limit: '256kb', strict: true }));
  app.use(express.json({ limit: '2kb', strict: true }));
  app.use(async (req, res, next) => {
    const limit = req.path === '/api/leaderboard' ? 256 * 1024 : 2048;
    if (req.body && Buffer.byteLength(JSON.stringify(req.body)) > limit) return res.status(413).json({ error: 'The request exceeds the permitted size.' });
    await store.initialize(); next();
  });
  app.get('/api/health', async (req, res) => { await store.view(); res.json({ ok: true, mode: 'online', transport: 'replay', version: REPLAY_VERSION }); });
  app.get('/api/session', async (req, res) => {
    req.visitor = visitor(req);
    if (!req.visitor) req.visitor = { sid: randomBytes(24).toString('hex'), iat: now(), exp: now() + WEEK * 1000 };
    req.organizer = await admin(req, req.visitor.sid);
    cookie(res, req, VISITOR_COOKIE, signToken(secret, 'visitor', req.visitor), WEEK);
    res.json(await responseFor(req));
  });
  app.use('/api', async (req, res, next) => {
    req.visitor = visitor(req);
    if (!req.visitor) return res.status(401).json({ error: 'Your browser session expired. Refresh the page to reconnect.' });
    req.organizer = await admin(req, req.visitor.sid); next();
  });
  app.get('/api/status', async (req, res) => res.json(await responseFor(req)));
  app.get('/api/leaderboard', async (req, res) => res.json({ leaderboard: (await store.view()).leaderboard }));
  app.get('/api/event/settings', async (req, res) => res.json(await responseFor(req)));
  app.post('/api/round/start', async (req, res) => {
    if (!await store.rate('round-start', rateIdentity(req), 600, 60)) throw new StoreError('Too many new shifts. Wait a minute and try again.', 429);
    const view = await store.view();
    const config = resolveConfig(engineSettings(view.settings));
    const payload = { version: REPLAY_VERSION, buildId, roundId: randomUUID(), sid: req.visitor.sid, eventId: view.event.id,
      seed: randomBytes(4).readUInt32BE(), config, issuedAt: now(), exp: now() + ROUND_MS };
    res.json({ ticket: signToken(secret, 'round', payload), seed: payload.seed, roundId: payload.roundId, config, version: REPLAY_VERSION });
  });
  app.post('/api/leaderboard', async (req, res) => {
    const payload = verifyToken(secret, 'round', req.body?.ticket, now());
    if (!payload || payload.sid !== req.visitor.sid) throw new StoreError('This round ticket is invalid or expired for your browser. Start a new shift.', 410);
    if (payload.version !== REPLAY_VERSION || payload.buildId !== buildId) throw new StoreError('The game was updated during this round. Refresh and start a new shift.', 410);
    if (!await store.rate('score-submit', rateIdentity(req), 600, 60)) throw new StoreError('Too many score requests. Wait a minute and try again.', 429);
    const name = cleanName(req.body?.name);
    const view = await store.view();
    if (view.event.id !== payload.eventId) throw new StoreError('This round belongs to an earlier event. Start a new shift.', 410);
    const maximumTicks = Math.ceil((payload.config.COUNTDOWN_DURATION + payload.config.ROUND_DURATION) / REPLAY_STEP) + 2;
    if (!Number.isInteger(req.body?.ticks) || req.body.ticks <= 0 || req.body.ticks > maximumTicks) throw new StoreError('Replay tick count is invalid.', 400);
    if (!Number.isFinite(payload.issuedAt) || payload.issuedAt > now() || now() - payload.issuedAt + 1000 < req.body.ticks * REPLAY_STEP * 1000) throw new StoreError('This shift cannot finish before its playing time has elapsed.', 409);
    const result = replayRound({ seed: payload.seed, roundId: payload.roundId, config: payload.config, commands: req.body?.commands, ticks: req.body?.ticks });
    const entry = await store.submit(payload.eventId, makeEntry(name, result, now()));
    res.status(201).json({ entry, leaderboard: (await store.view()).leaderboard, result });
  });
  app.post('/api/admin/login', async (req, res) => {
    if (!passwordHash) throw new StoreError('Organizer sign-in is not configured on this server.');
    if (!await store.rate('admin-login', rateIdentity(req), 30, 5)) throw new StoreError('Too many sign-in attempts. Wait a minute and try again.', 429);
    const password = req.body?.password;
    if (typeof password !== 'string' || password.length > 1024 || !timingSafeEqual(digest(password), passwordHash)) throw new StoreError('Incorrect organizer password.', 401);
    if (req.organizer) await store.logoutAdmin(req.organizer.jti);
    req.organizer = { sid: req.visitor.sid, jti: randomBytes(24).toString('hex'), role: 'admin', iat: now(), exp: now() + ADMIN_SECONDS * 1000 };
    await store.authorizeAdmin(req.organizer.jti, req.visitor.sid, ADMIN_SECONDS);
    cookie(res, req, ADMIN_COOKIE, signToken(secret, 'admin', req.organizer), ADMIN_SECONDS);
    res.json(await responseFor(req));
  });
  app.post('/api/admin/logout', async (req, res) => {
    if (req.organizer) await store.logoutAdmin(req.organizer.jti);
    req.organizer = null; cookie(res, req, ADMIN_COOKIE, '', 0); res.json(await responseFor(req));
  });
  app.post('/api/event/settings', async (req, res) => {
    requireAdmin(req);
    for (let retry = 0; retry < 3; retry += 1) {
      const view = await store.view();
      const settings = validateSettings(req.body, view.settings);
      if (await store.updateSettings(view, settings) === 'ok') return res.json(await responseFor(req));
    }
    throw new StoreError('Settings changed while you were editing. Refresh and try again.', 409);
  });
  app.post('/api/event/new', async (req, res) => {
    requireAdmin(req);
    const view = await store.view();
    const previousEvent = await store.newEvent(view, eventName(req.body?.name));
    res.status(201).json({ ...await responseFor(req), previousEvent });
  });
  app.get('/api/event/history', async (req, res) => { requireAdmin(req); res.json({ events: await store.history() }); });
  async function exportEvent(req, res, id) {
    requireAdmin(req);
    const archive = await store.archive(id);
    res.setHeader('Content-Disposition', `attachment; filename="last-light-${archive.event.id}.csv"`);
    res.type('text/csv').send(leaderboardCsv(archive.entries, archive.event));
  }
  app.get('/api/leaderboard/export.csv', async (req, res) => { requireAdmin(req); await exportEvent(req, res, (await store.view()).event.id); });
  app.get('/api/event/:id/export.csv', async (req, res) => exportEvent(req, res, req.params.id));
  app.get('/api/config', async (req, res) => { requireAdmin(req); res.json({ config: resolveConfig(engineSettings((await store.view()).settings)), calibration: null, hosting: { mode: 'online', transport: 'replay', admin: true } }); });
  app.get('/api/serial/ports', (req, res) => { requireAdmin(req); res.json({ ports: [], connection: { mode: 'keyboard', connected: false } }); });
  app.post('/api/serial/:action', (req, res) => { requireAdmin(req); res.status(400).json({ error: 'Arduino controls are available in the local exhibition edition.' }); });
  app.use((req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || 500;
    if (status >= 500) logger.error(`Vercel API operation failed (${status}).`);
    res.status(status).json({ error: status === 500 ? 'The server could not complete this operation. Please try again.' : error.message });
  });
  return app;
}
