// Bar/downbeat grid for a song — the self-hosted replacement for Spotify's
// deprecated audio-analysis `bars` array. Produced offline per song by
// scripts/detect-bars.py (madmom) and cached as public/<song>.bars.json.
// When absent, the app falls back to the in-browser beat detector (lib/beat.ts),
// which gets tempo/beat but not the true downbeat.

export type Bar = { start: number; duration: number };
export type BarsData = { beatsPerBar: number; bars: Bar[] };

// Accepts a few shapes so hand-authored or tool-authored files both work:
//   { beatsPerBar, bars: [{ start, duration? }] }
//   [{ start, duration? }]
//   [start, start, ...]           (downbeat times in seconds)
export async function loadBars(url: string): Promise<BarsData | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const raw = await res.json();

    const beatsPerBar =
      !Array.isArray(raw) && Number.isFinite(raw?.beatsPerBar)
        ? Number(raw.beatsPerBar)
        : 4;
    const list: unknown[] = Array.isArray(raw) ? raw : raw?.bars;
    if (!Array.isArray(list) || list.length === 0) return null;

    const starts = list
      .map((b) => (typeof b === "number" ? b : Number((b as Bar).start)))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (starts.length === 0) return null;

    const bars: Bar[] = starts.map((start, i) => {
      const explicit =
        typeof list[i] === "object"
          ? Number((list[i] as Bar).duration)
          : NaN;
      const fromNext = i + 1 < starts.length ? starts[i + 1] - start : NaN;
      // Last bar (no next) inherits the previous bar's duration.
      const prev = i > 0 ? start - starts[i - 1] : NaN;
      const duration = Number.isFinite(explicit)
        ? explicit
        : Number.isFinite(fromNext)
          ? fromNext
          : Number.isFinite(prev)
            ? prev
            : 2;
      return { start, duration };
    });

    return { beatsPerBar, bars };
  } catch {
    return null;
  }
}

// The count-in for a chosen line: one bar starting on a real downbeat, placed
// immediately before the bar the singer enters in.
export function countInForLine(lineStartSec: number, data: BarsData) {
  const { bars, beatsPerBar } = data;
  let i = 0;
  while (i + 1 < bars.length && bars[i + 1].start <= lineStartSec) i++;
  const entranceBar = bars[i];
  const countInBar = bars[i - 1] ?? entranceBar; // guard the very start of the track
  return {
    countInStartSec: countInBar.start, // seek + first click land here (a real "1")
    entranceSec: entranceBar.start, // the downbeat the singer comes in on
    beatSec: entranceBar.duration / beatsPerBar,
  };
}

// Every beat time (song seconds) in [fromSec, toSec], flagged as a downbeat
// when it's the first beat of a bar.
export function barBeats(
  data: BarsData,
  fromSec: number,
  toSec: number
): { songSec: number; accent: boolean }[] {
  const { bars, beatsPerBar } = data;
  const out: { songSec: number; accent: boolean }[] = [];
  for (const bar of bars) {
    if (bar.start + bar.duration < fromSec) continue;
    if (bar.start > toSec) break;
    const beatDur = bar.duration / beatsPerBar;
    for (let b = 0; b < beatsPerBar; b++) {
      const songSec = bar.start + b * beatDur;
      if (songSec >= fromSec - 1e-6 && songSec <= toSec + 1e-6) {
        out.push({ songSec, accent: b === 0 });
      }
    }
  }
  return out;
}
