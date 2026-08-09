"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getAudioContext,
  loadAudioBuffer,
  sliceCaptureToBuffer,
  startMicCapture,
  type MicCapture,
} from "@/lib/audio";
import { loadLyrics, type LyricLine } from "@/lib/lyrics";
import { TRACK } from "@/lib/track";
import LyricsPanel from "./LyricsPanel";

const RECORD_SONG_GAIN = 0.35; // duck the backing track while you sing over it
const MIN_LEAD_IN_SEC = 2; // guaranteed minimum pre-roll, even if the previous line is very short
const TAIL_PADDING_SEC = 0.6; // buffer past the next line's timestamp so trailing words aren't clipped

type RecordingState = "idle" | "recording" | "hasRecording";
type CueKind = "wait" | "countin" | "sing" | "done";

function formatTime(sec: number): string {
  if (!Number.isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
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
  const [cueLabel, setCueLabel] = useState("");
  const [cueKind, setCueKind] = useState<CueKind>("wait");

  const songBufferRef = useRef<AudioBuffer | null>(null);
  const recordedBufferRef = useRef<AudioBuffer | null>(null);
  const recordStartSecRef = useRef(0);
  const micCaptureRef = useRef<MicCapture | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const recordWindowRef = useRef<{ startAt: number; endAt: number } | null>(
    null
  );
  const activeSourcesRef = useRef<AudioScheduledSourceNode[]>([]);
  const rafRef = useRef<number | null>(null);
  const autoStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  useEffect(() => {
    loadLyrics(TRACK.lyricsUrl).then(setLyrics);
  }, []);

  // Decode the track up front so recording/playback don't stall on first use.
  useEffect(() => {
    let cancelled = false;
    const ctx = getAudioContext();
    loadAudioBuffer(ctx, TRACK.audioUrl)
      .then((buf) => {
        if (!cancelled) songBufferRef.current = buf;
      })
      .catch(() => {
        /* loaded lazily on first record instead */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      micCaptureRef.current?.stop();
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
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

  // Ends capture (auto-stop timer or manual Stop) and slices the exact
  // recorded window out of the continuously-captured mic samples.
  const finishRecording = useCallback(() => {
    if (autoStopTimeoutRef.current) {
      clearTimeout(autoStopTimeoutRef.current);
      autoStopTimeoutRef.current = null;
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setCueKind("wait");
    setCueLabel("");

    const capture = micCaptureRef.current;
    const stream = micStreamRef.current;
    const window = recordWindowRef.current;
    micCaptureRef.current = null;
    micStreamRef.current = null;
    recordWindowRef.current = null;
    stream?.getTracks().forEach((t) => t.stop());

    if (!capture || !window) {
      setRecordingState("idle");
      return;
    }

    const ctx = getAudioContext();
    try {
      const raw = capture.stop();
      recordedBufferRef.current = sliceCaptureToBuffer(
        ctx,
        raw,
        window.startAt,
        window.endAt
      );
      setRecordingState("hasRecording");
    } catch (e) {
      setMicError("Could not process recording: " + String(e));
      setRecordingState("idle");
    }
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

    // Pre-roll: start playback at the previous line so there's a natural
    // lead-in (you hear how the song flows into your line), then come in
    // exactly where the chosen line starts. If that previous line is very
    // short (or there isn't one), fall back further to guarantee at least
    // MIN_LEAD_IN_SEC of prep time.
    const prevIdx = startIdx - 1;
    const floorSec = Math.max(0, lineStartSec - MIN_LEAD_IN_SEC);
    const recordFromSec =
      prevIdx >= 0 ? Math.min(lineTimes[prevIdx].start, floorSec) : floorSec;
    const comeInSec = lineStartSec;
    // Extend past the line's nominal end (the next line's LRC timestamp,
    // which is only where the NEXT line starts, not where this one actually
    // finishes) so a trailing word or breath doesn't get clipped.
    const recordEndSec = endSec + TAIL_PADDING_SEC;

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
    const endAt = startAt + (recordEndSec - recordFromSec);

    // Backing track, ducked, on the shared clock.
    const songSource = ctx.createBufferSource();
    songSource.buffer = songBuffer;
    const songGain = ctx.createGain();
    songGain.gain.value = RECORD_SONG_GAIN;
    songSource.connect(songGain).connect(ctx.destination);
    songSource.start(startAt, recordFromSec);
    songSource.stop(endAt + 0.1);
    activeSourcesRef.current.push(songSource);

    // Capture mic audio continuously on this same AudioContext clock (see
    // lib/audio.ts) rather than timing a MediaRecorder start — that's what
    // makes the recorded voice land exactly on the song position it was sung
    // at, with no drift-prone "when did recording actually begin" guess.
    const capture = startMicCapture(ctx, stream);
    micCaptureRef.current = capture;
    micStreamRef.current = stream;
    recordWindowRef.current = { startAt, endAt };

    setRecordingState("recording");
    setCueKind("wait");
    setCueLabel("Get ready");

    autoStopTimeoutRef.current = setTimeout(
      finishRecording,
      Math.max(0, (endAt - ctx.currentTime) * 1000) + 150
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
        const secsLeft = Math.max(1, Math.ceil(comeInSec - pos));
        setCueKind("countin");
        setCueLabel(String(secsLeft));
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
  }, [selectedLines, lineTimes, stopAllSources, finishRecording]);

  const stopRecording = useCallback(() => {
    stopAllSources();
    finishRecording();
  }, [stopAllSources, finishRecording]);

  const playBack = useCallback(() => {
    const ctx = getAudioContext();
    const songBuffer = songBufferRef.current;
    const voiceBuffer = recordedBufferRef.current;
    if (!songBuffer || !voiceBuffer) return;

    audioRef.current?.pause();
    stopAllSources();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const startAt = ctx.currentTime + 0.15;
    const playFromSec = recordStartSecRef.current;
    const endAt = startAt + voiceBuffer.duration;

    // Same trick as the sync-test prototype: song and voice share one
    // AudioContext clock, scheduled from the same startAt, so they can't drift.
    const songSource = ctx.createBufferSource();
    songSource.buffer = songBuffer;
    songSource.connect(ctx.destination);
    songSource.start(startAt, playFromSec);
    activeSourcesRef.current.push(songSource);

    const voiceSource = ctx.createBufferSource();
    voiceSource.buffer = voiceBuffer;
    voiceSource.connect(ctx.destination);
    // Voice clip starts at the same instant the backing track resumes from
    // recordFromSec, so the take lands exactly where it was sung.
    voiceSource.start(startAt);
    activeSourcesRef.current.push(voiceSource);

    // Keep the lyric highlight following the actual playback position —
    // without this it stays frozen wherever recording left it, which makes
    // the panel look out of sync with what's audibly playing.
    const tick = () => {
      const pos = playFromSec + (ctx.currentTime - startAt);
      setCurrentTime(Math.max(0, pos));
      if (ctx.currentTime < endAt) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stopAllSources]);

  const reRecord = useCallback(() => {
    stopAllSources();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
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
          Tap lines above to pick which ones to sing, then record &mdash;
          playback starts at the previous line for a natural lead-in
          {hasTimestamps ? "" : " (approx: this song has no synced timing yet)"},
          then it&apos;s your turn. Playback layers your take back on the
          track to check the sync.
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
