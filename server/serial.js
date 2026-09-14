import { EventEmitter } from 'node:events';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isPowerMode } from '../shared/power.js';

export const DEFAULT_CALIBRATION = Object.freeze({ centerX: 512, centerY: 512, deadzone: 80, minPot: 0, maxPot: 1023, invertY: false });
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function validateCalibration(update, current = DEFAULT_CALIBRATION) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) throw new Error('Calibration must be an object.');
  const value = { ...current };
  for (const key of Object.keys(update)) {
    if (!Object.hasOwn(DEFAULT_CALIBRATION, key)) throw new Error(`Unknown calibration field: ${key}`);
    if (key === 'invertY') {
      if (typeof update[key] !== 'boolean') throw new Error('invertY must be true or false.');
    } else if (!Number.isFinite(update[key])) throw new Error(`${key} must be a number.`);
    value[key] = update[key];
  }
  if (value.centerX < 100 || value.centerX > 923 || value.centerY < 100 || value.centerY > 923) throw new Error('Joystick centers must be between 100 and 923.');
  if (value.deadzone < 0 || value.deadzone > 250) throw new Error('Deadzone must be between 0 and 250.');
  if (value.deadzone >= Math.min(value.centerX, 1023 - value.centerX, value.centerY, 1023 - value.centerY)) throw new Error('Deadzone must leave usable travel on both sides of each joystick axis.');
  if (value.minPot < 0 || value.maxPot > 1023 || value.maxPot - value.minPot < 100) throw new Error('Potentiometer range must be within 0–1023 and at least 100 units wide.');
  return value;
}

export function parsePacket(line) {
  if (typeof line !== 'string' || line.length > 256) return null;
  try {
    const packet = JSON.parse(line);
    if (!packet || Array.isArray(packet) || typeof packet.button !== 'boolean') return null;
    if (!['joystickX', 'joystickY', 'potentiometer'].every((key) => Number.isInteger(packet[key]) && packet[key] >= 0 && packet[key] <= 1023)) return null;
    return { joystickX: packet.joystickX, joystickY: packet.joystickY, potentiometer: packet.potentiometer, button: packet.button };
  } catch { return null; }
}

/** Equal thirds of calibrated knob travel; hysteresis prevents boundary chatter. */
export function potentiometerMode(position, previousMode = null) {
  const lower = 100 / 3, upper = 200 / 3, margin = 3;
  if (!isPowerMode(previousMode)) return position < lower ? 'low' : position < upper ? 'medium' : 'high';
  if (previousMode === 'low') return position > upper + margin ? 'high' : position > lower + margin ? 'medium' : 'low';
  if (previousMode === 'high') return position < lower - margin ? 'low' : position < upper - margin ? 'medium' : 'high';
  return position < lower - margin ? 'low' : position > upper + margin ? 'high' : 'medium';
}

export function normalizePacket(packet, calibration = DEFAULT_CALIBRATION, previousMode = null) {
  const axis = (raw, center) => {
    const delta = raw - center;
    if (Math.abs(delta) <= calibration.deadzone) return 0;
    const range = (delta < 0 ? center : 1023 - center) - calibration.deadzone;
    return Math.sign(delta) * clamp((Math.abs(delta) - calibration.deadzone) / Math.max(1, range), 0, 1);
  };
  const knob = clamp((packet.potentiometer - calibration.minPot) / (calibration.maxPot - calibration.minPot) * 100, 0, 100);
  return {
    x: axis(packet.joystickX, calibration.centerX),
    y: axis(packet.joystickY, calibration.centerY) * (calibration.invertY ? -1 : 1),
    knob, powerMode: potentiometerMode(knob, previousMode),
  };
}

/** The bridge never owns game rules. Missing hardware or malformed lines only disable input. */
export class SerialBridge extends EventEmitter {
  constructor({ directory, logger = console, now = Date.now, loadSerial = () => import('serialport') } = {}) {
    super();
    this.directory = directory;
    this.logger = logger;
    this.now = now;
    this.loadSerial = loadSerial;
    this.calibration = { ...DEFAULT_CALIBRATION };
    this.port = null;
    this.desiredPath = null;
    this.status = 'Keyboard mode — connect a controller when ready.';
    this.latest = null;
    this.powerMode = null;
    this.lastPacketAt = -Infinity;
    this.lastStorageAt = -Infinity;
    this.lastLcdAt = -Infinity;
    this.buttonDown = false;
    this.buttonPending = false;
    this.buffer = '';
    this.dropping = false;
    this.opening = false;
    this.generation = 0;
    this.retry = null;
    this.badPackets = 0;
    this.writePending = false;
    this.ledTest = null;
    this.calibrationQueue = Promise.resolve();
  }

  async initialize() {
    if (this.directory) {
      await mkdir(this.directory, { recursive: true });
      const file = path.join(this.directory, 'controller.json');
      try { this.calibration = validateCalibration(JSON.parse(await readFile(file, 'utf8'))); }
      catch (error) {
        if (error.code !== 'ENOENT') {
          this.logger.warn(`Controller calibration unavailable: ${error.message}. Using defaults.`);
          if (error instanceof SyntaxError || !error.code) await rename(file, `${file}.corrupt-${this.now()}`).catch(() => {});
        }
      }
    }
    this.retry = setInterval(() => {
      if (this.desiredPath && !this.port && !this.opening) this.openSelected().catch(() => {});
    }, 2000);
    this.retry.unref?.();
    return this;
  }

  async listPorts() {
    try {
      const { SerialPort } = await this.loadSerial();
      return await SerialPort.list();
    } catch (error) {
      this.status = `Serial unavailable: ${error.message}. Keyboard controls are ready.`;
      return [];
    }
  }

  connection() {
    const connected = Boolean(this.port?.isOpen && this.latest && this.now() - this.lastPacketAt <= 1000);
    return {
      mode: connected ? 'hardware' : 'keyboard', connected, path: this.desiredPath,
      status: this.port?.isOpen && !connected ? 'Controller data paused — keyboard fallback active.' : this.status,
      raw: this.latest ? { ...this.latest } : null,
      calibration: { ...this.calibration }, badPackets: this.badPackets,
    };
  }

  async connect(portPath) {
    if (typeof portPath !== 'string' || !portPath.trim() || portPath.length > 256 || /[\r\n\0]/.test(portPath)) throw new Error('Choose a valid serial port.');
    await this.disconnect();
    this.desiredPath = portPath;
    await this.openSelected();
    return this.connection();
  }

  async openSelected() {
    if (!this.desiredPath || this.opening || this.port) return;
    this.opening = true;
    const generation = this.generation;
    const requestedPath = this.desiredPath;
    try {
      const { SerialPort } = await this.loadSerial();
      if (generation !== this.generation) return;
      // Only an enumerated hardware port may be opened, never an arbitrary file path.
      const available = await SerialPort.list();
      if (!available.some((entry) => entry.path === requestedPath)) throw new Error('Selected serial port is not currently available.');
      if (generation !== this.generation) return;
      const port = new SerialPort({ path: requestedPath, baudRate: 115200, autoOpen: false });
      this.port = port;
      port.on('data', (chunk) => { if (this.port === port) this.acceptChunk(chunk); });
      port.on('error', (error) => {
        if (this.port === port) {
          this.port = null;
          this.clearInput();
          this.status = `Controller disconnected: ${error.message}. Retrying; keyboard is ready.`;
          if (port.isOpen) port.close(() => {});
        }
      });
      port.on('close', () => {
        if (this.port === port) {
          this.port = null;
          this.clearInput();
          this.status = 'Controller disconnected — keyboard fallback active. Reconnecting…';
        }
      });
      await new Promise((resolve, reject) => port.open((error) => error ? reject(error) : resolve()));
      if (generation !== this.generation) {
        if (port.isOpen) port.close(() => {});
        return;
      }
      this.status = `Controller connected on ${requestedPath}. Waiting for input…`;
    } catch (error) {
      if (generation === this.generation) {
        this.port = null;
        this.clearInput();
        this.status = `${error.message} Retrying; keyboard controls are ready.`;
      }
      throw error;
    } finally { this.opening = false; }
  }

  clearInput() {
    this.latest = null;
    this.powerMode = null;
    this.lastPacketAt = -Infinity;
    this.buttonDown = false;
    this.buttonPending = false;
    this.buffer = '';
    this.dropping = false;
    this.writePending = false;
  }

  async disconnect() {
    this.generation += 1;
    this.desiredPath = null;
    const port = this.port;
    this.port = null;
    this.clearInput();
    this.status = 'Controller disconnected — keyboard controls are ready.';
    if (port?.isOpen) await new Promise((resolve) => port.close(() => resolve()));
  }

  acceptChunk(chunk) {
    // Bound the buffer even if a damaged device never terminates a line.
    for (const character of chunk.toString('utf8')) {
      if (character === '\n') {
        if (!this.dropping && this.buffer.trim()) {
          const packet = parsePacket(this.buffer.trim());
          if (packet) {
            if (packet.button && !this.buttonDown) this.buttonPending = true;
            this.buttonDown = packet.button;
            this.latest = packet;
            this.lastPacketAt = this.now();
            this.status = `Controller live on ${this.desiredPath || 'serial'}`;
          } else this.badPackets += 1;
        }
        this.buffer = '';
        this.dropping = false;
      } else if (!this.dropping) {
        if (this.buffer.length >= 256) { this.buffer = ''; this.dropping = true; this.badPackets += 1; }
        else this.buffer += character;
      }
    }
  }

  input() {
    if (!this.connection().connected) { this.buttonPending = false; this.powerMode = null; return null; }
    const input = { ...normalizePacket(this.latest, this.calibration, this.powerMode), pressed: this.buttonPending };
    this.powerMode = input.powerMode;
    this.buttonPending = false;
    return input;
  }

  async calibrate(update) {
    const task = this.calibrationQueue.then(async () => {
      const value = validateCalibration(update, this.calibration);
      if (this.directory) {
        const file = path.join(this.directory, 'controller.json');
        const temporary = `${file}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
        await rename(temporary, file);
      }
      this.calibration = value;
      this.powerMode = null;
      return { ...value };
    });
    this.calibrationQueue = task.catch(() => {});
    return task;
  }

  write(line) {
    if (!this.port?.isOpen || this.writePending || this.port.writableLength > 1024) return false;
    this.writePending = true;
    const port = this.port;
    try {
      port.write(`${line}\n`, (error) => {
        if (this.port !== port) return;
        this.writePending = false;
        if (error && this.port === port) this.status = `Controller output error: ${error.message}`;
      });
      return true;
    } catch (error) {
      this.writePending = false;
      this.status = `Controller output error: ${error.message}`;
      return false;
    }
  }

  testStorage(value) {
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error('LED test must be between 0 and 100.');
    if (!this.port?.isOpen) throw new Error('Connect a controller before testing the LED bar.');
    this.ledTest = { value: Math.round(value), until: this.now() + 3000 };
    this.lastStorageAt = -Infinity;
    this.sendStorage(value);
  }

  sendStorage(value) {
    if (!Number.isFinite(value) || this.now() - this.lastStorageAt < 100) return;
    if (this.ledTest?.until > this.now()) value = this.ledTest.value;
    else this.ledTest = null;
    if (this.write(`STORAGE:${Math.round(clamp(value, 0, 100))}`)) this.lastStorageAt = this.now();
  }

  sendLcd(line1, line2) {
    if (this.now() - this.lastLcdAt < 1000) return;
    const clean = (line) => String(line).replace(/[^\x20-\x7e]/g, '').replace(/\|/g, ' ').slice(0, 16);
    if (this.write(`LCD:${clean(line1)}|${clean(line2)}`)) this.lastLcdAt = this.now();
  }

  async close() { clearInterval(this.retry); await this.disconnect(); await this.calibrationQueue; }
}
