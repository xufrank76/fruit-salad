#!/usr/bin/env python3
"""Detect bar downbeats for a song and write public/<song>.bars.json.

This is the self-hosted replacement for Spotify's deprecated audio-analysis
`bars` array. It uses madmom's DBN downbeat tracker, which finds the true bar
"1" even on four-on-the-floor pop where energy-based detection can't (a kick on
every beat flattens the per-beat contrast).

Output shape (consumed by lib/bars.ts):
    { "beatsPerBar": 4, "bars": [ { "start": 0.313, "duration": 1.875 }, ... ] }

Usage:
    python3 scripts/detect-bars.py \
        "public/Justin Bieber - Beauty And A Beat ...(128k).mp3" \
        public/beautyandabeat.bars.json

Requirements (madmom is unmaintained and does NOT build on Python 3.12+):
    - Use Python 3.9-3.11 (a venv or Docker), then:
        pip install "numpy<1.24" cython madmom
    - Alternatively swap in BeatNet (modern, PyTorch) — same output shape.
"""
import json
import sys

from madmom.features.downbeats import (
    RNNDownBeatProcessor,
    DBNDownBeatTrackingProcessor,
)


def detect_bars(audio_path: str, beats_per_bar: int = 4):
    act = RNNDownBeatProcessor()(audio_path)
    proc = DBNDownBeatTrackingProcessor(beats_per_bar=[beats_per_bar], fps=100)
    beats = proc(act)  # rows of [time_sec, beat_position]; position 1.0 == downbeat

    downbeats = [float(t) for t, pos in beats if int(round(pos)) == 1]
    bars = []
    for i, start in enumerate(downbeats):
        if i + 1 < len(downbeats):
            duration = downbeats[i + 1] - start
        elif bars:
            duration = bars[-1]["duration"]  # last bar inherits previous length
        else:
            duration = 60.0 / 128 * beats_per_bar
        bars.append({"start": round(start, 4), "duration": round(duration, 4)})
    return {"beatsPerBar": beats_per_bar, "bars": bars}


def main():
    if len(sys.argv) < 3:
        print("usage: detect-bars.py <audio_in> <bars_json_out> [beatsPerBar]")
        sys.exit(1)
    audio_path, out_path = sys.argv[1], sys.argv[2]
    beats_per_bar = int(sys.argv[3]) if len(sys.argv) > 3 else 4

    data = detect_bars(audio_path, beats_per_bar)
    with open(out_path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"✓ {len(data['bars'])} bars ({beats_per_bar}/bar) → {out_path}")


if __name__ == "__main__":
    main()
