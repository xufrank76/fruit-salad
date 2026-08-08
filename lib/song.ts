// To test with a real song: drop the file in public/, point `url` at it,
// and set startMs/endMs to a line you want to sing (listen to the track and
// note where a phrase starts/ends). startMs must be >= countInMs or the
// count-in has nowhere to play from.
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
