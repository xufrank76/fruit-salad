// Generates a synthetic backing track (public/instrumental.wav) for the sync
// prototype. Steady 100bpm click/bass loop so timing drift is audibly obvious.
// No licensed audio needed to prove the scheduling technique.

import { writeFileSync } from "fs";

const SAMPLE_RATE = 44100;
const BPM = 100;
const BEAT_MS = 60000 / BPM; // 600ms
const DURATION_MS = 14000;
const numSamples = Math.floor((DURATION_MS / 1000) * SAMPLE_RATE);

const left = new Float32Array(numSamples);
const right = new Float32Array(numSamples);

function kick(startMs) {
  const freq = 60;
  const durMs = 180;
  const startSample = Math.floor((startMs / 1000) * SAMPLE_RATE);
  const durSamples = Math.floor((durMs / 1000) * SAMPLE_RATE);
  for (let n = 0; n < durSamples; n++) {
    const i = startSample + n;
    if (i < 0 || i >= numSamples) continue;
    const tt = n / SAMPLE_RATE;
    const env = Math.exp(-tt * 18);
    const v = Math.sin(2 * Math.PI * freq * tt) * env * 0.6;
    left[i] += v;
    right[i] += v;
  }
}

function hat(startMs) {
  const durMs = 40;
  const startSample = Math.floor((startMs / 1000) * SAMPLE_RATE);
  const durSamples = Math.floor((durMs / 1000) * SAMPLE_RATE);
  for (let n = 0; n < durSamples; n++) {
    const i = startSample + n;
    if (i < 0 || i >= numSamples) continue;
    const tt = n / SAMPLE_RATE;
    const env = Math.exp(-tt * 60);
    const v = (Math.random() * 2 - 1) * env * 0.15;
    left[i] += v;
    right[i] += v;
  }
}

function pad(startMs, durMs, freqs, amp) {
  const startSample = Math.floor((startMs / 1000) * SAMPLE_RATE);
  const durSamples = Math.floor((durMs / 1000) * SAMPLE_RATE);
  const attack = 0.05 * SAMPLE_RATE;
  const release = 0.15 * SAMPLE_RATE;
  for (let n = 0; n < durSamples; n++) {
    const i = startSample + n;
    if (i < 0 || i >= numSamples) continue;
    let env = 1;
    if (n < attack) env = n / attack;
    else if (n > durSamples - release) env = (durSamples - n) / release;
    const tt = n / SAMPLE_RATE;
    let v = 0;
    for (const f of freqs) v += Math.sin(2 * Math.PI * f * tt);
    v = (v / freqs.length) * env * amp;
    left[i] += v;
    right[i] += v;
  }
}

// Steady beat + hats for the whole track.
const totalBeats = Math.floor(DURATION_MS / BEAT_MS);
for (let b = 0; b < totalBeats; b++) {
  const t = b * BEAT_MS;
  kick(t);
  hat(t + BEAT_MS / 2);
}

// Chord progression, 2 bars (4 beats) per chord, 4 beats per bar @ BEAT_MS.
const barMs = BEAT_MS * 4;
const chords = [
  [220, 277.18, 329.63], // Am
  [174.61, 220, 261.63], // F
  [196, 246.94, 293.66], // G
  [220, 261.63, 329.63], // Am(maj-ish)
];
for (let bar = 0; bar * barMs < DURATION_MS; bar++) {
  const chord = chords[bar % chords.length];
  pad(bar * barMs, barMs * 0.95, chord, 0.12);
}

// The demo "line" window: bar boundaries so it's clean to sing over.
// bar length = 4 * 600ms = 2400ms. Line = bars 2-3 (ms 4800 - 7200).
const LINE_START_MS = Math.round(2 * barMs);
const LINE_END_MS = Math.round(3.5 * barMs);

// Marker chime just before the line starts, so the singer has an audible cue
// in addition to the on-screen count-in.
pad(LINE_START_MS - 300, 250, [880], 0.2);

console.log(`LINE_START_MS=${LINE_START_MS} LINE_END_MS=${LINE_END_MS}`);

// --- WAV encode (16-bit PCM stereo) ---
function floatTo16(sample) {
  const s = Math.max(-1, Math.min(1, sample));
  return s < 0 ? s * 0x8000 : s * 0x7fff;
}

const numChannels = 2;
const bytesPerSample = 2;
const blockAlign = numChannels * bytesPerSample;
const dataSize = numSamples * blockAlign;
const buffer = Buffer.alloc(44 + dataSize);

buffer.write("RIFF", 0);
buffer.writeUInt32LE(36 + dataSize, 4);
buffer.write("WAVE", 8);
buffer.write("fmt ", 12);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20); // PCM
buffer.writeUInt16LE(numChannels, 22);
buffer.writeUInt32LE(SAMPLE_RATE, 24);
buffer.writeUInt32LE(SAMPLE_RATE * blockAlign, 28);
buffer.writeUInt16LE(blockAlign, 32);
buffer.writeUInt16LE(16, 34);
buffer.write("data", 36);
buffer.writeUInt32LE(dataSize, 40);

let offset = 44;
for (let i = 0; i < numSamples; i++) {
  buffer.writeInt16LE(floatTo16(left[i]), offset);
  offset += 2;
  buffer.writeInt16LE(floatTo16(right[i]), offset);
  offset += 2;
}

writeFileSync(new URL("../public/instrumental.wav", import.meta.url), buffer);
console.log("Wrote public/instrumental.wav");
