export type LyricLine = {
  text: string;
  // Start time in ms when timestamped (LRC-style), else null.
  timeMs: number | null;
};

// Matches an LRC-style timestamp prefix like "[01:23.45] some words".
const LRC_RE = /^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/;

export function parseLyrics(text: string): LyricLine[] {
  return text
    .split(/\r?\n/)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const m = raw.match(LRC_RE);
      if (m) {
        const min = parseInt(m[1], 10);
        const sec = parseFloat(m[2]);
        return { text: m[3], timeMs: (min * 60 + sec) * 1000 };
      }
      return { text: raw, timeMs: null };
    });
}

export async function loadLyrics(url: string): Promise<LyricLine[]> {
  const res = await fetch(url);
  const text = await res.text();
  return parseLyrics(text);
}

// Serialize lines + per-line start times (ms) back into an LRC-style file
// like "[00:12.34]line". Save this into public/beautyandabeat.txt to persist
// the timing; parseLyrics reads it straight back.
export function formatLrc(lines: string[], timesMs: number[]): string {
  return lines
    .map((text, i) => {
      const ms = Math.max(0, timesMs[i] ?? 0);
      const totalCs = Math.round(ms / 10);
      const min = Math.floor(totalCs / 6000);
      const sec = Math.floor((totalCs % 6000) / 100);
      const cs = totalCs % 100;
      const stamp = `${String(min).padStart(2, "0")}:${String(sec).padStart(
        2,
        "0"
      )}.${String(cs).padStart(2, "0")}`;
      return `[${stamp}]${text}`;
    })
    .join("\n");
}
