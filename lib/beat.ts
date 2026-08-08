// Automatic beat detection so the metronome lands on the song's real beats
// instead of a guessed grid. Onset-energy envelope -> autocorrelation for
// tempo -> phase search for the beat grid. Runs on the already-decoded
// AudioBuffer, so it works for any track with no manual tapping.
//
// Note: this finds the beat pulse, NOT the bar downbeat. Energy-based downbeat
// detection was tried and proved unreliable on four-on-the-floor pop (a kick
// on every beat flattens the per-beat energy contrast), so the metronome's
// count-in is a fixed number of beats on this grid rather than a true bar "1".

export type BeatInfo = {
  bpm: number;
  beatSec: number;
  offsetSec: number; // time of the first beat on the grid
};

// Works on raw mono samples too (used by the offline validation script).
export function detectBeatFromSamples(
  samples: Float32Array,
  sampleRate: number,
  minBpm = 90,
  maxBpm = 180
): BeatInfo {
  const hop = 512;
  const frames = Math.floor(samples.length / hop);
  const fps = sampleRate / hop; // onset frames per second

  // Energy per frame.
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const start = f * hop;
    const end = Math.min(start + hop, samples.length);
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    energy[f] = sum / hop;
  }

  // Onset envelope: half-wave-rectified energy increase, mean-removed so the
  // autocorrelation isn't dominated by a DC offset.
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    const d = energy[f] - energy[f - 1];
    onset[f] = d > 0 ? d : 0;
  }
  let mean = 0;
  for (let f = 0; f < frames; f++) mean += onset[f];
  mean /= frames || 1;
  for (let f = 0; f < frames; f++) onset[f] -= mean;

  // Tempo: autocorrelation peak within the BPM range.
  const minLag = Math.max(2, Math.round((fps * 60) / maxBpm));
  const maxLag = Math.round((fps * 60) / minBpm);
  const ac = new Float64Array(maxLag + 2);
  let bestLag = minLag;
  let bestVal = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let f = lag; f < frames; f++) s += onset[f] * onset[f - lag];
    ac[lag] = s;
    if (s > bestVal) {
      bestVal = s;
      bestLag = lag;
    }
  }

  // Parabolic interpolation around the integer peak for sub-frame tempo
  // resolution (the frame hop is too coarse otherwise, e.g. 129 vs 128 BPM).
  const y0 = ac[bestLag - 1] ?? bestVal;
  const y1 = bestVal;
  const y2 = ac[bestLag + 1] ?? bestVal;
  const denom = y0 - 2 * y1 + y2;
  const delta = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
  const refinedLag = bestLag + Math.max(-1, Math.min(1, delta));
  const beatSec = refinedLag / fps;

  // Beat phase: pick the grid offset whose beats collect the most onset energy.
  let bestPhase = 0;
  let bestPhaseVal = -Infinity;
  for (let p = 0; p < bestLag; p++) {
    let s = 0;
    for (let f = p; f < frames; f += bestLag) s += onset[f];
    if (s > bestPhaseVal) {
      bestPhaseVal = s;
      bestPhase = p;
    }
  }
  const offsetSec = bestPhase / fps;

  return {
    bpm: 60 / beatSec,
    beatSec,
    offsetSec,
  };
}

export function detectBeat(buffer: AudioBuffer): BeatInfo {
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  let mono: Float32Array;
  if (ch1) {
    mono = new Float32Array(ch0.length);
    for (let i = 0; i < ch0.length; i++) mono[i] = (ch0[i] + ch1[i]) * 0.5;
  } else {
    mono = ch0;
  }
  return detectBeatFromSamples(mono, buffer.sampleRate);
}
