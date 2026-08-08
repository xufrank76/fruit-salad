// Core Web Audio helpers for the sync prototype.
// Everything here is sample-accurate scheduling via AudioBufferSourceNode —
// no <audio> tags, which drift within seconds when used for multi-track sync.

let sharedCtx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!sharedCtx) {
    sharedCtx = new AudioContext();
  }
  if (sharedCtx.state === "suspended") {
    void sharedCtx.resume();
  }
  return sharedCtx;
}

export async function loadAudioBuffer(
  ctx: AudioContext,
  url: string
): Promise<AudioBuffer> {
  const res = await fetch(url);
  const arrayBuffer = await res.arrayBuffer();
  return ctx.decodeAudioData(arrayBuffer);
}

// Synthetic small-room impulse response (exponentially decaying noise) so we
// don't need to ship a real IR file for the shared reverb bus.
export function createImpulseResponse(
  ctx: AudioContext,
  durationSec = 1.4,
  decay = 3.2
): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * durationSec);
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

// RMS-based loudness normalization. Returns a gain factor to bring `buffer`
// to roughly `targetRms`, clamped so silence doesn't get blown out.
export function computeNormalizationGain(
  buffer: AudioBuffer,
  targetRms = 0.15,
  maxGain = 8
): number {
  const data = buffer.getChannelData(0);
  let sumSq = 0;
  for (let i = 0; i < data.length; i++) {
    sumSq += data[i] * data[i];
  }
  const rms = Math.sqrt(sumSq / data.length);
  if (rms < 1e-6) return 1;
  return Math.min(targetRms / rms, maxGain);
}

export async function blobToAudioBuffer(
  ctx: AudioContext,
  blob: Blob
): Promise<AudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  return ctx.decodeAudioData(arrayBuffer);
}
