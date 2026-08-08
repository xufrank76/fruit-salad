// Must match scripts/generate-instrumental.mjs output (logged at generation time).
export const SONG = {
  url: "/instrumental.wav",
  line: {
    startMs: 4800,
    endMs: 8400,
  },
  countInMs: 3000,
  tailPaddingMs: 300,
};

export const CLIP_START_IN_SONG_MS = SONG.line.startMs - SONG.countInMs;
export const RECORD_DURATION_MS =
  SONG.countInMs + (SONG.line.endMs - SONG.line.startMs) + SONG.tailPaddingMs;
