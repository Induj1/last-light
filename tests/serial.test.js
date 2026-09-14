import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CALIBRATION, normalizePacket, parsePacket, potentiometerMode, SerialBridge, validateCalibration } from '../server/serial.js';

class FakePort extends EventEmitter {
  static async list() { return [{ path: 'COM_TEST', manufacturer: 'Test Arduino' }]; }
  constructor(options) { super(); this.options = options; this.isOpen = false; this.output = []; }
  open(callback) { this.isOpen = true; callback(); }
  close(callback) { this.isOpen = false; this.emit('close'); callback(); }
  write(line, callback) { this.output.push(line); callback(); }
}
const packet = (extra = {}) => ({ joystickX: 512, joystickY: 512, potentiometer: 512, button: false, ...extra });

test('serial parser rejects malformed, missing, out-of-range, non-integer and oversized packets', () => {
  assert.deepEqual(parsePacket(JSON.stringify(packet())), packet());
  for (const value of ['{broken', 'null', '[]', '{}', JSON.stringify(packet({ button: 1 })), JSON.stringify(packet({ joystickX: 1024 })), JSON.stringify(packet({ potentiometer: '3' })), JSON.stringify(packet({ joystickY: 4.3 })), ' '.repeat(257)]) {
    assert.equal(parsePacket(value), null);
  }
});

test('calibration removes joystick noise, normalizes full range, inverts Y and clamps pot', () => {
  assert.deepEqual(normalizePacket(packet()), { x: 0, y: 0, knob: 512 / 1023 * 100, powerMode: 'medium' });
  assert.equal(normalizePacket(packet({ joystickX: 0 })).x, -1);
  assert.equal(normalizePacket(packet({ joystickX: 1023 })).x, 1);
  assert.equal(normalizePacket(packet({ joystickX: 580 })).x, 0);
  const calibrated = validateCalibration({ minPot: 100, maxPot: 900, invertY: true });
  assert.equal(normalizePacket(packet({ joystickY: 1023, potentiometer: 1000 }), calibrated).y, -1);
  assert.equal(normalizePacket(packet({ potentiometer: 0 }), calibrated).knob, 0);
  assert.equal(normalizePacket(packet({ potentiometer: 0 }), calibrated).powerMode, 'low');
  assert.equal(normalizePacket(packet({ potentiometer: 1000 }), calibrated).knob, 100);
  assert.equal(normalizePacket(packet({ potentiometer: 1000 }), calibrated).powerMode, 'high');
  for (const invalid of [{ centerX: 0 }, { deadzone: 300 }, { centerX: 100, deadzone: 100 }, { minPot: 950 }, { maxPot: 99 }, { invertY: 1 }, { centerY: NaN }, { secret: true }, { constructor: 1 }]) {
    assert.throws(() => validateCalibration(invalid));
  }
  assert.deepEqual(DEFAULT_CALIBRATION, { centerX: 512, centerY: 512, deadzone: 80, minPot: 0, maxPot: 1023, invertY: false });
});

test('three knob zones retain a detent through boundary noise and allow a full sweep', () => {
  assert.deepEqual([0, 33, 34, 66, 67, 100].map((value) => potentiometerMode(value)), ['low', 'low', 'medium', 'medium', 'high', 'high']);
  let mode = 'low';
  for (const value of [33, 34, 32, 35, 36]) { mode = potentiometerMode(value, mode); assert.equal(mode, 'low'); }
  mode = potentiometerMode(37, mode); assert.equal(mode, 'medium');
  for (const value of [34, 32, 31, 65, 68, 69]) { mode = potentiometerMode(value, mode); assert.equal(mode, 'medium'); }
  mode = potentiometerMode(70, mode); assert.equal(mode, 'high');
  for (const value of [68, 66, 65, 64]) { mode = potentiometerMode(value, mode); assert.equal(mode, 'high'); }
  assert.equal(potentiometerMode(63, mode), 'medium');
  assert.equal(potentiometerMode(0, 'high'), 'low');
  assert.equal(potentiometerMode(100, 'low'), 'high');
});

test('serial bridge retains knob hysteresis between packets and resets it after calibration', async () => {
  const bridge = new SerialBridge({ loadSerial: async () => ({ SerialPort: FakePort }) });
  await bridge.connect('COM_TEST');
  const input = (potentiometer) => { bridge.acceptChunk(Buffer.from(`${JSON.stringify(packet({ potentiometer }))}\n`)); return bridge.input(); };
  assert.equal(input(0).powerMode, 'low');
  assert.equal(input(350).powerMode, 'low');
  assert.equal(input(390).powerMode, 'medium');
  assert.equal(input(330).powerMode, 'medium');
  await bridge.calibrate({ minPot: 100, maxPot: 900 });
  assert.equal(bridge.input().powerMode, 'low');
  await bridge.close();
});

test('serial bridge safely frames partial NDJSON, uses rising button edges and falls back on stale input', async () => {
  let time = 1000;
  const bridge = new SerialBridge({ now: () => time, loadSerial: async () => ({ SerialPort: FakePort }) });
  await bridge.connect('COM_TEST');
  const line = JSON.stringify(packet({ button: true }));
  bridge.acceptChunk(Buffer.from(line.slice(0, 20)));
  assert.equal(bridge.input(), null);
  bridge.acceptChunk(Buffer.from(`${line.slice(20)}\r\n`));
  assert.equal(bridge.connection().connected, true);
  assert.equal(bridge.input().pressed, true);
  assert.equal(bridge.input().pressed, false);
  bridge.acceptChunk(Buffer.from(`${line}\n`));
  assert.equal(bridge.input().pressed, false);
  bridge.acceptChunk(Buffer.from(`${'x'.repeat(10000)}\nBROKEN\n${JSON.stringify(packet())}\n`));
  assert.equal(bridge.buffer.length, 0);
  assert.equal(bridge.badPackets, 2);
  assert.equal(bridge.input().pressed, false);
  time += 1001;
  assert.equal(bridge.connection().mode, 'keyboard');
  assert.equal(bridge.input(), null);
  await bridge.close();
});

test('storage output is rate limited and LED test lasts three seconds without changing engine storage', async () => {
  let time = 0;
  const bridge = new SerialBridge({ now: () => time, loadSerial: async () => ({ SerialPort: FakePort }) });
  await bridge.connect('COM_TEST');
  const port = bridge.port;
  bridge.sendStorage(77.6);
  bridge.sendStorage(20);
  assert.deepEqual(port.output, ['STORAGE:78\n']);
  time = 100;
  bridge.sendStorage(75);
  bridge.testStorage(25);
  time = 500;
  bridge.sendStorage(90);
  assert.equal(port.output.at(-1), 'STORAGE:25\n');
  time = 3101;
  bridge.sendStorage(90);
  assert.equal(port.output.at(-1), 'STORAGE:90\n');
  bridge.sendLcd('STORAGE\n100%', 'READY|GO');
  assert.equal(port.output.at(-1), 'LCD:STORAGE100%|READY GO\n');
  await bridge.close();
});

test('calibration persists, arbitrary paths are rejected and missing serialport stays recoverable', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'last-light-serial-'));
  const bridge = new SerialBridge({ directory, loadSerial: async () => ({ SerialPort: FakePort }) });
  try {
    await bridge.initialize();
    await bridge.calibrate({ centerX: 520, minPot: 20, maxPot: 1000 });
    assert.equal(JSON.parse(await readFile(path.join(directory, 'controller.json'), 'utf8')).centerX, 520);
    await assert.rejects(bridge.connect('/tmp/not-a-port'), /not currently available/);
    const unavailable = new SerialBridge({ loadSerial: async () => { throw new Error('Module unavailable'); } });
    assert.deepEqual(await unavailable.listPorts(), []);
    assert.equal(unavailable.connection().mode, 'keyboard');
    assert.match(unavailable.connection().status, /Keyboard/);
  } finally { await bridge.close(); await rm(directory, { recursive: true, force: true }); }
});

test('a held button does not produce another rising edge after a stale packet gap', async () => {
  let time = 0;
  const bridge = new SerialBridge({ now: () => time, loadSerial: async () => ({ SerialPort: FakePort }) });
  await bridge.connect('COM_TEST');
  const held = `${JSON.stringify(packet({ button: true }))}\n`;
  bridge.acceptChunk(Buffer.from(held));
  assert.equal(bridge.input().pressed, true);
  time = 1200;
  assert.equal(bridge.input(), null);
  bridge.acceptChunk(Buffer.from(held));
  assert.equal(bridge.input().pressed, false);
  bridge.acceptChunk(Buffer.from(`${JSON.stringify(packet())}\n${held}`));
  assert.equal(bridge.input().pressed, true);
  await bridge.close();
});

test('overlapping calibration saves merge their fields and retain atomic persistence', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'last-light-calibration-'));
  const bridge = new SerialBridge({ directory });
  try {
    await bridge.initialize();
    await Promise.all([bridge.calibrate({ centerX: 520 }), bridge.calibrate({ centerY: 500 }), bridge.calibrate({ minPot: 20, maxPot: 1000 })]);
    assert.deepEqual(bridge.calibration, { centerX: 520, centerY: 500, deadzone: 80, minPot: 20, maxPot: 1000, invertY: false });
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'controller.json'), 'utf8')), bridge.calibration);
  } finally { await bridge.close(); await rm(directory, { recursive: true, force: true }); }
});

test('serial errors immediately clear input and allow reconnection without an OS close event', async () => {
  const bridge = new SerialBridge({ loadSerial: async () => ({ SerialPort: FakePort }) });
  await bridge.connect('COM_TEST');
  const brokenPort = bridge.port;
  bridge.acceptChunk(Buffer.from(`${JSON.stringify(packet({ joystickX: 1023 }))}\n`));
  assert.equal(bridge.input().x, 1);
  brokenPort.emit('error', new Error('USB cable removed'));
  assert.equal(bridge.port, null);
  assert.equal(bridge.input(), null);
  assert.match(bridge.connection().status, /USB cable removed/);
  await bridge.openSelected();
  assert.notEqual(bridge.port, brokenPort);
  assert.equal(bridge.port.isOpen, true);
  await bridge.close();
});
