"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  blobToAudioBuffer,
  getAudioContext,
  loadAudioBuffer,
} from "@/lib/audio";
import {
  barBeats,
  countInForLine,
  loadBars,
  type BarsData,
} from "@/lib/bars";
import { detectBeat, type BeatInfo } from "@/lib/beat";
import { loadLyrics, type LyricLine } from "@/lib/lyrics";
import { TRACK } from "@/lib/track";
import LyricsPanel from "./LyricsPanel";

const COUNT_IN_BEATS = 4; // fallback count-in length when there's no bars file
const RECORD_SONG_GAIN = 0.35; // duck the backing track while you sing over it

type RecordingState = "idle" | "recording" | "hasRecording";
type CueKind = "wait" | "countin" | "sing" | "done";

function formatTime(sec: number): string {
  if (!Number.isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// A short metronome tick scheduled on the AudioContext clock. `accent` marks
// the downbeat where the singer should come in.
function scheduleClick(
  ctx: AudioContext,
  destination: AudioNode,
  time: number,
  accent: boolean
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = accent ? 1600 : 900;
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(accent ? 0.6 : 0.32, time + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
  osc.connect(gain).connect(destination);
  osc.start(time);
  osc.stop(time + 0.07);
  return osc;
}

export default function SongPage() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [micError, setMicError] = useState<string | null>(null);
  const [selectedLines, setSelectedLines] = useState<Set<number>>(new Set());
  const [metronomeWhileSinging, setMetronomeWhileSinging] = useState(true);
  const [cueLabel, setCueLabel] = useState("");
  const [cueKind, setCueKind] = useState<CueKind>("wait");
  const [beat, setBeat] = useState<BeatInfo | null>(null);
  const [bars, setBars] = useState<BarsData | null>(null);

  const songBufferRef = useRef<AudioBuffer | null>(null);
  const beatRef = useRef<BeatInfo | null>(null);
  const barsRef = useRef<BarsData | null>(null);
  const recordedBufferRef = useRef<AudioBuffer | null>(null);
  const recordStartSecRef = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const activeSourcesRef = useRef<AudioScheduledSourceNode[]>([]);
  const rafRef = useRef<number | null>(null);
  const autoStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  useEffect(() => {
    loadLyrics(TRACK.lyricsUrl).then(setLyrics);
    loadBars(TRACK.barsUrl).then((b) => {
      barsRef.current = b;
      setBars(b);
    });
  }, []);

  // Decode the track up front and detect its beat grid so the metronome can
  // lock to the real beats. Kept in a ref for scheduling, plus state for UI.
  useEffect(() => {
    let cancelled = false;
    const ctx = getAudioContext();
    loadAudioBuffer(ctx, TRACK.audioUrl)
      .then((buf) => {
        if (cancelled) return;
        songBufferRef.current = buf;
        const info = detectBeat(buf);
        beatRef.current = info;
        setBeat(info);
      })
      .catch(() => {
        /* falls back to TRACK.bpm below */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop();
      if (autoStopTimeoutRef.current) clearTimeout(autoStopTimeoutRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      for (const src of activeSourcesRef.current) {
        try {
          src.stop();
        } catch {
          // already stopped
        }
      }
    };
  }, []);

  const lines = useMemo(() => lyrics.map((l) => l.text), [lyrics]);

  // Real per-line timing when the lyrics file is LRC-timestamped (e.g. fetched
  // from LRCLIB via scripts/fetch-lyrics.mjs): each line's start is its own
  // timestamp, its end is the next line's start. Falls back to an even split
  // across the track only for songs with no synced lyrics.
  const hasTimestamps =
    lyrics.length > 0 && lyrics.every((l) => l.timeMs != null);

  const lineTimes = useMemo(() => {
    if (lyrics.length === 0) return [];
    if (hasTimestamps) {
      return lyrics.map((l, i) => ({
        start: (l.timeMs as number) / 1000,
        end:
          i < lyrics.length - 1
            ? (lyrics[i + 1].timeMs as number) / 1000
            : duration || (l.timeMs as number) / 1000 + 4,
      }));
    }
    if (duration <= 0) return [];
    return lyrics.map((_, i) => ({
      start: (i / lyrics.length) * duration,
      end: ((i + 1) / lyrics.length) * duration,
    }));
  }, [lyrics, hasTimestamps, duration]);

  // Highlight the last line whose start time we've passed.
  const currentIndex = useMemo(() => {
    if (lineTimes.length === 0) return -1;
    let idx = 0;
    for (let i = 0; i < lineTimes.length; i++) {
      if (currentTime >= lineTimes[i].start) idx = i;
      else break;
    }
    return idx;
  }, [lineTimes, currentTime]);

  const toggleLine = useCallback((index: number) => {
    setSelectedLines((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  };

  const stopAllSources = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // already stopped
      }
    }
    activeSourcesRef.current = [];
  }, []);

  const startRecording = useCallback(async () => {
    if (selectedLines.size === 0 || lineTimes.length === 0) return;
    setMicError(null);
    const audio = audioRef.current;
    if (!audio) return;

    const indices = [...selectedLines];
    const startIdx = Math.min(...indices);
    const endIdx = Math.max(...indices);
    const lineStartSec = lineTimes[startIdx].start;
    const endSec = lineTimes[endIdx].end;

    // Plan the count-in. Preferred path: a real bar grid (madmom → bars.json),
    // which puts the count-in on an actual downbeat. Fallback: the in-browser
    // beat detector, which gets tempo/beat but not the true "1".
    let recordFromSec: number;
    let comeInSec: number;
    let countdownBeatSec: number;
    let beatClicks: { songSec: number; accent: boolean }[];

    const barsData = barsRef.current;
    if (barsData && barsData.bars.length > 0) {
      const ci = countInForLine(lineStartSec, barsData);
      recordFromSec = ci.countInStartSec;
      comeInSec = ci.entranceSec;
      countdownBeatSec = ci.beatSec;
      beatClicks = barBeats(barsData, recordFromSec, endSec);
    } else {
      const info = beatRef.current;
      const beatSec = info?.beatSec ?? 60 / TRACK.bpm;
      const beatOffsetSec = info?.offsetSec ?? 0;
      const comeInIdx = Math.round((lineStartSec - beatOffsetSec) / beatSec);
      comeInSec = beatOffsetSec + comeInIdx * beatSec;
      recordFromSec = Math.max(0, comeInSec - COUNT_IN_BEATS * beatSec);
      countdownBeatSec = beatSec;
      const firstBeatIdx = Math.ceil((recordFromSec - beatOffsetSec) / beatSec);
      const lastBeatIdx = Math.floor((endSec - beatOffsetSec) / beatSec);
      beatClicks = [];
      for (let n = firstBeatIdx; n <= lastBeatIdx; n++) {
        beatClicks.push({
          songSec: beatOffsetSec + n * beatSec,
          accent: n === comeInIdx,
        });
      }
    }

    const ctx = getAudioContext();
    if (!songBufferRef.current) {
      try {
        songBufferRef.current = await loadAudioBuffer(ctx, TRACK.audioUrl);
      } catch (e) {
        setMicError("Could not load the track for sync testing: " + String(e));
        return;
      }
    }
    const songBuffer = songBufferRef.current;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      setMicError("Microphone access denied or unavailable.");
      return;
    }

    audio.pause(); // we drive the backing track through Web Audio while recording
    recordStartSecRef.current = recordFromSec;
    stopAllSources();

    const startAt = ctx.currentTime + 0.3; // small lead so scheduling lands cleanly
    const endAt = startAt + (endSec - recordFromSec);

    // Backing track, ducked, on the shared clock.
    const songSource = ctx.createBufferSource();
    songSource.buffer = songBuffer;
    const songGain = ctx.createGain();
    songGain.gain.value = RECORD_SONG_GAIN;
    songSource.connect(songGain).connect(ctx.destination);
    songSource.start(startAt, recordFromSec);
    songSource.stop(endAt + 0.1);
    activeSourcesRef.current.push(songSource);

    // Metronome: a click on every beat in the window, accenting downbeats.
    // Count-in beats (before the entrance) always play; the beats during the
    // line respect the toggle.
    const clickBus = ctx.createGain();
    clickBus.gain.value = 1;
    clickBus.connect(ctx.destination);
    for (const { songSec, accent } of beatClicks) {
      const beatCtxTime = startAt + (songSec - recordFromSec);
      if (beatCtxTime < ctx.currentTime) continue;
      const duringLine = songSec > comeInSec + 1e-6;
      if (duringLine && !metronomeWhileSinging) continue;
      activeSourcesRef.current.push(
        scheduleClick(ctx, clickBus, beatCtxTime, accent)
      );
    }

    const mediaRecorder = new MediaRecorder(stream);
    const chunks: BlobPart[] = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      if (autoStopTimeoutRef.current) {
        clearTimeout(autoStopTimeoutRef.current);
        autoStopTimeoutRef.current = null;
      }
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setCueKind("wait");
      setCueLabel("");
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
      try {
        recordedBufferRef.current = await blobToAudioBuffer(ctx, blob);
        setRecordingState("hasRecording");
      } catch (e) {
        setMicError("Could not decode recording: " + String(e));
        setRecordingState("idle");
      }
    };

    mediaRecorderRef.current = mediaRecorder;
    const leadMs = (startAt - ctx.currentTime) * 1000;
    setTimeout(() => mediaRecorder.start(), leadMs);
    setRecordingState("recording");
    setCueKind("wait");
    setCueLabel("Get ready");

    autoStopTimeoutRef.current = setTimeout(
      () => mediaRecorderRef.current?.stop(),
      leadMs + (endSec - recordFromSec) * 1000
    );

    // Visual cue + lyric scroll, driven off the audio clock so it can't drift
    // from what's actually playing.
    const tick = () => {
      const pos = recordFromSec + (ctx.currentTime - startAt);
      setCurrentTime(Math.max(0, pos));
      if (ctx.currentTime < startAt) {
        setCueKind("wait");
        setCueLabel("Get ready");
      } else if (pos < comeInSec) {
        const beatsLeft = Math.max(
          1,
          Math.ceil((comeInSec - pos) / countdownBeatSec)
        );
        setCueKind("countin");
        setCueLabel(String(beatsLeft));
      } else if (pos < endSec) {
        setCueKind("sing");
        setCueLabel("Sing!");
      } else {
        setCueKind("done");
        setCueLabel("Nice.");
      }
      if (ctx.currentTime < endAt + 0.15) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [selectedLines, lineTimes, metronomeWhileSinging, stopAllSources]);

  const stopRecording = useCallback(() => {
    if (autoStopTimeoutRef.current) {
      clearTimeout(autoStopTimeoutRef.current);
      autoStopTimeoutRef.current = null;
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    stopAllSources();
    setCueKind("wait");
    setCueLabel("");
    mediaRecorderRef.current?.stop();
  }, [stopAllSources]);

  const playBack = useCallback(() => {
    const ctx = getAudioContext();
    const songBuffer = songBufferRef.current;
    const voiceBuffer = recordedBufferRef.current;
    if (!songBuffer || !voiceBuffer) return;

    audioRef.current?.pause();
    stopAllSources();
    const startAt = ctx.currentTime + 0.15;

    // Same trick as the sync-test prototype: song and voice share one
    // AudioContext clock, scheduled from the same startAt, so they can't drift.
    const songSource = ctx.createBufferSource();
    songSource.buffer = songBuffer;
    songSource.connect(ctx.destination);
    songSource.start(startAt, recordStartSecRef.current);
    activeSourcesRef.current.push(songSource);

    const voiceSource = ctx.createBufferSource();
    voiceSource.buffer = voiceBuffer;
    voiceSource.connect(ctx.destination);
    // Voice clip starts at the same instant the backing track resumes from
    // recordFromSec, so the take lands exactly where it was sung.
    voiceSource.start(startAt);
    activeSourcesRef.current.push(voiceSource);
  }, [stopAllSources]);

  const reRecord = useCallback(() => {
    stopAllSources();
    recordedBufferRef.current = null;
    setRecordingState("idle");
  }, [stopAllSources]);

  const selectedCount = selectedLines.size;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <Link
        href="/"
        className="text-xs text-zinc-500 underline dark:text-zinc-400"
      >
        &larr; back
      </Link>

      <div className="text-center">
        <h1 className="text-xl font-semibold tracking-tight text-black dark:text-zinc-50">
          {TRACK.title}
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {TRACK.artist}
        </p>
      </div>

      <LyricsPanel
        lines={lines}
        currentIndex={currentIndex}
        selectedLines={selectedLines}
        onToggleLine={toggleLine}
      />

      <div className="w-full max-w-md space-y-2">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          onChange={(e) => {
            const audio = audioRef.current;
            if (!audio) return;
            audio.currentTime = Number(e.target.value);
          }}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <button
        className="rounded bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
        onClick={togglePlay}
      >
        {isPlaying ? "Pause" : "Play"}
      </button>

      <div className="w-full max-w-md space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Tap lines above to pick which ones to sing, then record &mdash; the
          track seeks to exactly where those lines start
          {hasTimestamps ? "" : " (approx: this song has no synced timing yet)"}.
          Playback layers your take back on the track to check the sync.
        </p>

        <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            {selectedCount === 0
              ? "No lines selected"
              : `${selectedCount} line${selectedCount === 1 ? "" : "s"} selected`}
          </span>
          {selectedCount > 0 && recordingState !== "recording" && (
            <button
              className="underline"
              onClick={() => setSelectedLines(new Set())}
            >
              Clear
            </button>
          )}
        </div>

        <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={metronomeWhileSinging}
            onChange={(e) => setMetronomeWhileSinging(e.target.checked)}
            disabled={recordingState === "recording"}
            className="h-3.5 w-3.5"
          />
          Metronome while singing (a one-bar count-in always plays)
          {bars
            ? ` · bar-accurate downbeats (${bars.bars.length} bars)`
            : beat
              ? ` · ~${Math.round(beat.bpm)} BPM, on-beat grid (no downbeat file)`
              : " · detecting beat…"}
        </label>

        {micError && (
          <p className="text-xs text-red-600 dark:text-red-400">{micError}</p>
        )}

        {recordingState === "recording" && (
          <div className="flex flex-col items-center gap-2 py-2">
            <div
              className={`flex h-24 w-24 items-center justify-center rounded-full text-3xl font-bold tabular-nums transition-colors ${
                cueKind === "sing"
                  ? "animate-pulse bg-red-600 text-white"
                  : cueKind === "countin"
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-black"
                    : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              {cueLabel}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {cueKind === "sing"
                ? "Sing your line"
                : cueKind === "countin"
                  ? "Get ready to come in…"
                  : cueKind === "done"
                    ? "Wrapping up…"
                    : "Starting…"}
            </p>
          </div>
        )}

        <div className="flex justify-center gap-3">
          {recordingState === "recording" ? (
            <button
              className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white"
              onClick={stopRecording}
            >
              Stop
            </button>
          ) : (
            <button
              disabled={selectedCount === 0}
              className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-50"
              onClick={startRecording}
            >
              {recordingState === "hasRecording" ? "Re-record" : "Record"}
            </button>
          )}
          {recordingState === "hasRecording" && (
            <button
              className="rounded bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
              onClick={playBack}
            >
              Play back my take
            </button>
          )}
        </div>

        {recordingState === "hasRecording" && (
          <div className="pt-1 text-center">
            <button
              className="text-xs text-zinc-500 underline dark:text-zinc-400"
              onClick={reRecord}
            >
              Discard take
            </button>
          </div>
        )}
      </div>

      <audio
        ref={audioRef}
        src={TRACK.audioUrl}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />
    </div>
  );
}
