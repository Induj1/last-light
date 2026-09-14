import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Original procedural sounds: no samples, licensed recordings, or network access.
// Regenerate with: node scripts/generate-audio.mjs
const directory = fileURLToPath(new URL('../public/audio/', import.meta.url));
mkdirSync(directory, { recursive: true });
const sampleRate = 22050;

function writeSound(name, duration, notes) {
  const frames = Math.ceil(duration * sampleRate);
  const samples = new Float64Array(frames);
  for (const { start = 0, length, frequency, endFrequency = frequency, volume = .2, wave = 'sine' } of notes) {
    const first = Math.floor(start * sampleRate);
    const count = Math.floor(length * sampleRate);
    let phase = 0;
    for (let n = 0; n < count && first + n < frames; n++) {
      const t = n / count;
      const envelope = Math.min(1, t / .04) * Math.min(1, (1 - t) / .2);
      const pitch = frequency + (endFrequency - frequency) * t;
      phase += 2 * Math.PI * pitch / sampleRate;
      const tone = wave === 'triangle' ? 2 / Math.PI * Math.asin(Math.sin(phase)) : Math.sin(phase);
      samples[first + n] += tone * envelope * volume;
    }
  }
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + frames * 2, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) wav.writeInt16LE(Math.round(Math.max(-.95, Math.min(.95, samples[i])) * 32767), 44 + i * 2);
  writeFileSync(`${directory}/${name}.wav`, wav);
  console.log(`${name}.wav — ${duration}s, mono PCM 16-bit, ${sampleRate}Hz`);
}

writeSound('warning', .25, [{ frequency: 740, endFrequency: 620, length: .12, volume: .11 }, { start: .16, frequency: 740, length: .07, volume: .09 }]);
writeSound('save', .46, [523, 659, 784].map((frequency, i) => ({ frequency, start: i * .09, length: .25, volume: .14 })));
writeSound('waste', .35, [{ frequency: 260, endFrequency: 190, length: .22, wave: 'triangle', volume: .11 }]);
writeSound('fail', .55, [{ frequency: 190, endFrequency: 70, length: .5, wave: 'triangle', volume: .22 }]);
writeSound('critical', .85, [0, .27, .54].map(start => ({ start, frequency: 430, endFrequency: 270, length: .22, wave: 'triangle', volume: .18 })));
writeSound('storage', .75, [0, .2, .4].map((start, i) => ({ start, frequency: 370 - i * 65, length: .18, volume: .16 })));
writeSound('countdown', .16, [{ frequency: 880, length: .12, volume: .1 }]);
writeSound('result-success', 2.3, [261.63, 329.63, 392, 523.25].map((frequency, i) => ({ frequency, start: i * .17, length: 1.7, volume: .1 })));
writeSound('result-fail', 2, [196, 155.56, 130.81].map((frequency, i) => ({ frequency, start: i * .23, length: 1.5, volume: .12 })));
