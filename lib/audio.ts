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

export type MicCapture = {
  // Stops capture and returns the raw samples plus the AudioContext time that
  // sample 0 corresponds to, so callers can slice out an exact time window.
  stop: () => { samples: Float32Array; anchorCtxTime: number; sampleRate: number };
};

// Captures mic audio as a node on `ctx` — the same AudioContext clock used to
// schedule playback — instead of MediaRecorder, which runs on its own
// independent (wall-clock/event-loop) timeline with unpredictable startup
// latency. Because both live on one clock, a captured sample's true position
// can be computed exactly (see sliceCaptureToBuffer) instead of relying on
// *when* recording happened to start.
export function startMicCapture(
  ctx: AudioContext,
  stream: MediaStream,
  bufferSize = 2048
): MicCapture {
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessorNode is deprecated but universally supported; it only
  // fires 'audioprocess' while connected through to a destination, so route
  // it through a silent gain node rather than actually playing the mic back.
  const processor = ctx.createScriptProcessor(bufferSize, 1, 1);
  const silence = ctx.createGain();
  silence.gain.value = 0;

  const chunks: Float32Array[] = [];
  let anchorCtxTime: number | null = null;

  processor.onaudioprocess = (e) => {
    if (anchorCtxTime === null) {
      // This callback fires once `bufferSize` samples have been gathered;
      // back-date to when the first of those samples actually arrived.
      anchorCtxTime = ctx.currentTime - bufferSize / ctx.sampleRate;
    }
    chunks.push(e.inputBuffer.getChannelData(0).slice());
  };

  source.connect(processor);
  processor.connect(silence).connect(ctx.destination);

  return {
    stop: () => {
      processor.onaudioprocess = null;
      processor.disconnect();
      source.disconnect();
      silence.disconnect();

      let total = 0;
      for (const c of chunks) total += c.length;
      const samples = new Float32Array(total);
      let offset = 0;
      for (const c of chunks) {
        samples.set(c, offset);
        offset += c.length;
      }
      return {
        samples,
        anchorCtxTime: anchorCtxTime ?? ctx.currentTime,
        sampleRate: ctx.sampleRate,
      };
    },
  };
}

// Slice a [fromCtxTime, toCtxTime) window out of a mic capture and wrap it as
// a playable AudioBuffer, sample-aligned to the AudioContext clock.
export function sliceCaptureToBuffer(
  ctx: AudioContext,
  capture: { samples: Float32Array; anchorCtxTime: number; sampleRate: number },
  fromCtxTime: number,
  toCtxTime: number
): AudioBuffer {
  const { samples, anchorCtxTime, sampleRate } = capture;
  const startIdx = Math.max(
    0,
    Math.round((fromCtxTime - anchorCtxTime) * sampleRate)
  );
  const endIdx = Math.min(
    samples.length,
    Math.round((toCtxTime - anchorCtxTime) * sampleRate)
  );
  const length = Math.max(1, endIdx - startIdx);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  buffer.copyToChannel(Float32Array.from(samples.subarray(startIdx, endIdx)), 0);
  return buffer;
}
