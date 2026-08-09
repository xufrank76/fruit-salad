"use client";

import { ArrowLeft, Check, Mic, Play, SkipBack, SkipForward } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getAudioContext,
  getOutputLatencySec,
  loadAudioBuffer,
  sliceCaptureToBuffer,
  startMicCapture,
  type MicCapture,
} from "@/lib/audio";
import { loadLyrics, type LyricLine } from "@/lib/lyrics";
import { TRACK } from "@/lib/track";
import { CANVAS_HEIGHT, CANVAS_WIDTH, cover } from "../coverUnit";
import FruitField from "../FruitField";
import RecordLinesPanel from "./RecordLinesPanel";
import SproutingFruits, { randomFruit, type SproutedFruit } from "./SproutingFruits";

const RECORD_SONG_GAIN = 0.35; // duck the backing track while you sing over it
const MIN_LEAD_IN_SEC = 2; // guaranteed minimum pre-roll
const TAIL_PADDING_SEC = 1.5; // buffer past the next line's timestamp — singers lag the reference vocal
const AUTO_STOP_SAFETY_MS = 400; // extra margin so the stop timer never fires before the window ends
const WAVE_BARS = 14;

// "idle" covers both the empty prompt and the pre-record "ready" view — which
// one shows is just whether selectedIndices is empty, not a separate state.
// The 3-2-1 count-in isn't its own state: it happens *during* the "recording"
// pre-roll (mic already capturing), tracked by the `cue` value below.
type PanelState = "idle" | "recording" | "review" | "success";
type CueMode = "wait" | "countin" | "sing" | "wrap";

export default function RecordPage() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(false);

  // Lines submitted this session — no backend to persist to yet, so this is
  // the only source of "taken" lines (no mock/hardcoded claims).
  const [submittedLines, setSubmittedLines] = useState<Set<number>>(new Set());

  const [panelState, setPanelState] = useState<PanelState>("idle");
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [cue, setCue] = useState<{ mode: CueMode; label: string }>({
    mode: "wait",
    label: "",
  });
  const [waveLevels, setWaveLevels] = useState<number[]>(
    Array(WAVE_BARS).fill(0.05)
  );
  const [playbackPct, setPlaybackPct] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);

  // Decorative fruits that accumulate in the background — one sprouts per line
  // contributed. nextFruitIdRef gives each a stable React key.
  const [bgFruits, setBgFruits] = useState<SproutedFruit[]>([]);
  const nextFruitIdRef = useRef(0);

  const songBufferRef = useRef<AudioBuffer | null>(null);
  const recordedBufferRef = useRef<AudioBuffer | null>(null);
  const recordFromSecRef = useRef(0); // window start (includes the pickup pre-roll)
  const lineStartSecRef = useRef(0); // where the chosen line actually begins
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
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  useEffect(() => {
    loadLyrics(TRACK.lyricsUrl).then(setLyrics);
  }, []);

  const takenLines = submittedLines;
  const takenBy = useMemo(() => {
    const by: Record<number, string> = {};
    submittedLines.forEach((i) => {
      by[i] = "you";
    });
    return by;
  }, [submittedLines]);

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

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (autoStopTimeoutRef.current) clearTimeout(autoStopTimeoutRef.current);
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
      micCaptureRef.current?.stop();
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      stopAllSources();
    };
  }, [stopAllSources]);

  const lines = useMemo(() => lyrics.map((l) => l.text), [lyrics]);

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

  const currentIndex = useMemo(() => {
    if (lineTimes.length === 0) return -1;
    let idx = 0;
    for (let i = 0; i < lineTimes.length; i++) {
      if (currentTime >= lineTimes[i].start) idx = i;
      else break;
    }
    return idx;
  }, [lineTimes, currentTime]);

  const seekToLine = useCallback(
    (index: number) => {
      const audio = audioRef.current;
      const time = lineTimes[index];
      if (!audio || !time) return;
      audio.currentTime = time.start;
    },
    [lineTimes]
  );

  const selectedList = useMemo(
    () => [...selectedIndices].sort((a, b) => a - b),
    [selectedIndices]
  );

  // Ends capture (auto-stop or a future manual stop) and slices the exact
  // recorded window out of the continuously-captured mic samples.
  const finishRecording = useCallback(() => {
    if (autoStopTimeoutRef.current) {
      clearTimeout(autoStopTimeoutRef.current);
      autoStopTimeoutRef.current = null;
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setCue({ mode: "wait", label: "" });
    stopAllSources(); // stop the backing track the moment the take ends
    const capture = micCaptureRef.current;
    const stream = micStreamRef.current;
    const window = recordWindowRef.current;
    micCaptureRef.current = null;
    micStreamRef.current = null;
    recordWindowRef.current = null;
    stream?.getTracks().forEach((t) => t.stop());

    if (!capture || !window) {
      setPanelState("idle");
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
      setPanelState("review");
    } catch (e) {
      setMicError("Could not process recording: " + String(e));
      setPanelState("idle");
    }
  }, [stopAllSources]);

  const beginRecording = useCallback(async () => {
    const indices = [...selectedIndices];
    if (indices.length === 0 || lineTimes.length === 0) return;
    setMicError(null);

    const startIdx = Math.min(...indices);
    const endIdx = Math.max(...indices);
    const lineStartSec = lineTimes[startIdx].start;
    const endSec = lineTimes[endIdx].end;
    const prevIdx = startIdx - 1;
    const floorSec = Math.max(0, lineStartSec - MIN_LEAD_IN_SEC);
    const recordFromSec =
      prevIdx >= 0 ? Math.min(lineTimes[prevIdx].start, floorSec) : floorSec;
    const recordEndSec = endSec + TAIL_PADDING_SEC;

    const ctx = getAudioContext();
    if (!songBufferRef.current) {
      try {
        songBufferRef.current = await loadAudioBuffer(ctx, TRACK.audioUrl);
      } catch (e) {
        setMicError("Could not load the track: " + String(e));
        setPanelState("idle");
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
      setPanelState("idle");
      return;
    }

    audioRef.current?.pause();
    recordFromSecRef.current = recordFromSec;
    lineStartSecRef.current = lineStartSec;
    stopAllSources();

    // Bigger lead so the "get ready" beat is visible before the pre-roll plays.
    const startAt = ctx.currentTime + 0.4;
    const endAt = startAt + (recordEndSec - recordFromSec);

    const songSource = ctx.createBufferSource();
    songSource.buffer = songBuffer;
    const songGain = ctx.createGain();
    songGain.gain.value = RECORD_SONG_GAIN;
    songSource.connect(songGain).connect(ctx.destination);
    songSource.start(startAt, recordFromSec);
    songSource.stop(endAt + 0.1);
    activeSourcesRef.current.push(songSource);

    setWaveLevels(Array(WAVE_BARS).fill(0.05));
    const capture = startMicCapture(ctx, stream, 2048, (rms) => {
      setWaveLevels((prev) => [...prev.slice(1), Math.min(1, rms * 6)]);
    });
    micCaptureRef.current = capture;
    micStreamRef.current = stream;
    recordWindowRef.current = { startAt, endAt };

    setPanelState("recording");
    setCue({ mode: "wait", label: "get ready" });

    autoStopTimeoutRef.current = setTimeout(
      finishRecording,
      Math.max(0, (endAt - ctx.currentTime) * 1000) + AUTO_STOP_SAFETY_MS
    );

    // The 3-2-1 count-in runs DURING the pickup pre-roll (song already playing,
    // mic already capturing), driven off the audio clock so "sing!" lands
    // exactly when the chosen line starts.
    const tick = () => {
      const pos = recordFromSec + (ctx.currentTime - startAt);
      if (ctx.currentTime < startAt) {
        setCue({ mode: "wait", label: "get ready" });
      } else if (pos < lineStartSec) {
        setCue({
          mode: "countin",
          label: String(Math.max(1, Math.ceil(lineStartSec - pos))),
        });
      } else if (pos < endSec) {
        setCue({ mode: "sing", label: "sing!" });
      } else {
        setCue({ mode: "wrap", label: "" });
      }
      if (ctx.currentTime < endAt + 0.15) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [selectedIndices, lineTimes, stopAllSources, finishRecording]);

  const toggleLine = useCallback((idx: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
    setMicError(null);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIndices(new Set());
  }, []);

  const cancelFlow = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (autoStopTimeoutRef.current) {
      clearTimeout(autoStopTimeoutRef.current);
      autoStopTimeoutRef.current = null;
    }
    stopAllSources();
    micCaptureRef.current?.stop();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micCaptureRef.current = null;
    micStreamRef.current = null;
    recordWindowRef.current = null;
    recordedBufferRef.current = null;
    setCue({ mode: "wait", label: "" });
    setSelectedIndices(new Set());
    setPanelState("idle");
  }, [stopAllSources]);

  const playBackTake = useCallback(() => {
    const ctx = getAudioContext();
    const songBuffer = songBufferRef.current;
    const voiceBuffer = recordedBufferRef.current;
    if (!songBuffer || !voiceBuffer) return;
    stopAllSources();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const startAt = ctx.currentTime + 0.15;
    // Skip the pickup pre-roll on playback: start the song at the line, and
    // offset into the voice buffer by the same amount (the buffer starts at
    // recordFromSec). The take then plays only from where you actually sang.
    // The voice buffer was captured on the raw AudioContext clock, but the
    // singer reacted to what they *heard* — which lagged that clock by the
    // device's output latency — so their singing actually lands this much
    // later in the capture than a naive offset assumes.
    const lineStartSec = lineStartSecRef.current;
    const outputLatency = getOutputLatencySec(ctx);
    const voiceOffset = Math.max(
      0,
      lineStartSec - recordFromSecRef.current + outputLatency
    );
    const playDur = Math.max(0.1, voiceBuffer.duration - voiceOffset);
    const endAt = startAt + playDur;

    const songSource = ctx.createBufferSource();
    songSource.buffer = songBuffer;
    songSource.connect(ctx.destination);
    songSource.start(startAt, lineStartSec);
    songSource.stop(endAt); // fix: previously ran to the end of the whole track
    activeSourcesRef.current.push(songSource);

    const voiceSource = ctx.createBufferSource();
    voiceSource.buffer = voiceBuffer;
    voiceSource.connect(ctx.destination);
    voiceSource.start(startAt, voiceOffset);
    activeSourcesRef.current.push(voiceSource);

    // Visual response: drive a progress fill off the audio clock, reset at end.
    setPlaybackPct(0);
    const tick = () => {
      const p = (ctx.currentTime - startAt) / playDur;
      setPlaybackPct(Math.min(1, Math.max(0, p)));
      if (ctx.currentTime < endAt) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setPlaybackPct(0);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stopAllSources]);

  const retake = useCallback(() => {
    stopAllSources();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setPlaybackPct(0);
    recordedBufferRef.current = null;
    setPanelState("idle");
  }, [stopAllSources]);

  const submit = useCallback(() => {
    if (selectedIndices.size === 0) return;
    stopAllSources();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setPlaybackPct(0);
    setSubmittedLines((prev) => {
      const next = new Set(prev);
      selectedIndices.forEach((i) => next.add(i));
      return next;
    });
    // Sprout one background fruit per contributed line.
    const sprouted = [...selectedIndices].map(() =>
      randomFruit(nextFruitIdRef.current++)
    );
    setBgFruits((prev) => [...prev, ...sprouted]);
    recordedBufferRef.current = null;
    setPanelState("success");
    successTimeoutRef.current = setTimeout(() => {
      setPanelState("idle");
      setSelectedIndices(new Set());
    }, 1400);
  }, [selectedIndices, stopAllSources]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };
  const skip = (deltaSec: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(duration, audio.currentTime + deltaSec));
  };
  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setMuted(audio.muted);
  };

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-white dark:bg-black">
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
      >
        {/* Same decorative field as the homepage, dimmed so it stays
            background texture instead of competing with this page's content. */}
        <div className="opacity-10">
          <FruitField />
        </div>

        <SproutingFruits fruits={bgFruits} />

        <div
          className="absolute flex items-center"
          style={{ left: cover(147), top: cover(122), gap: cover(12) }}
        >
          <Link href="/salad" className="shrink-0 text-black dark:text-zinc-100">
            <ArrowLeft style={{ width: cover(24), height: cover(24) }} />
          </Link>
          <div className="font-display">
            <p
              className="font-medium leading-tight text-black dark:text-zinc-50"
              style={{ fontSize: cover(24) }}
            >
              {TRACK.title}
            </p>
            <p
              className="leading-tight text-zinc-500 dark:text-zinc-400"
              style={{ fontSize: cover(16) }}
            >
              {TRACK.artist}
            </p>
          </div>
        </div>

        <button
          onClick={toggleMute}
          className="font-display absolute flex items-center justify-center rounded-[20px] border border-zinc-300 bg-white text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          style={{
            left: cover(445),
            top: cover(124),
            width: cover(121),
            height: cover(41),
            fontSize: cover(16),
          }}
        >
          {muted ? "unmute" : "mute others"}
        </button>

        <div
          className="absolute"
          style={{
            left: cover(147),
            top: cover(184),
            width: cover(423),
            height: cover(389),
          }}
        >
          <RecordLinesPanel
            lines={lines}
            currentIndex={currentIndex}
            takenLines={takenLines}
            takenBy={takenBy}
            selectedIndices={selectedIndices}
            onToggleLine={toggleLine}
            onSeekLine={seekToLine}
            disabled={panelState !== "idle"}
          />
        </div>

        <div
          className="absolute flex items-center justify-center"
          style={{ left: cover(147), top: cover(578), width: cover(423), gap: cover(60) }}
        >
          <button onClick={() => skip(-10)} className="text-black dark:text-zinc-100">
            <SkipBack style={{ width: cover(24), height: cover(24) }} fill="currentColor" />
          </button>
          <button
            onClick={togglePlay}
            className="relative shrink-0"
            style={{ width: cover(60), height: cover(60) }}
          >
            <Image
              src={isPlaying ? "/fruit/pause-button.png" : "/fruit/play-button.png"}
              alt={isPlaying ? "Pause" : "Play"}
              fill
              className="select-none object-contain"
              draggable={false}
            />
          </button>
          <button onClick={() => skip(10)} className="text-black dark:text-zinc-100">
            <SkipForward style={{ width: cover(24), height: cover(24) }} fill="currentColor" />
          </button>
        </div>

        <div
          className="absolute overflow-hidden rounded-[20px] bg-zinc-200 dark:bg-zinc-800"
          style={{ left: cover(147), top: cover(655), width: cover(421), height: cover(5) }}
        >
          <div
            className="h-full rounded-[20px] bg-black dark:bg-white"
            style={{ width: duration ? `${(currentTime / duration) * 100}%` : "0%" }}
          />
        </div>

        {/* Record panel — Figma only mocks the empty state; the rest of the
            flow is built from the attached HTML prototype's flow, wired to
            real mic recording instead of its setTimeout/Math.random() sim,
            and extended to record multiple selected lines in one take. */}
        <div
          className="absolute flex flex-col items-center justify-center overflow-hidden rounded-[20px] border border-zinc-200 bg-white px-8 text-center dark:border-zinc-800 dark:bg-zinc-950"
          style={{ left: cover(660), top: cover(179), width: cover(473), height: cover(394) }}
        >
          {micError && (
            <p
              className="font-display mb-3 text-red-600 dark:text-red-400"
              style={{ fontSize: cover(14) }}
            >
              {micError}
            </p>
          )}

          {panelState === "idle" && selectedList.length === 0 && (
            <>
              <Mic
                className="text-zinc-400 dark:text-zinc-600"
                style={{ width: cover(48), height: cover(48) }}
              />
              <p
                className="font-display mt-3 text-zinc-500 dark:text-zinc-400"
                style={{ fontSize: cover(16) }}
              >
                tap open lines on the left to contribute
              </p>
            </>
          )}

          {panelState === "idle" && selectedList.length > 0 && (
            <>
              <p
                className="font-display text-zinc-500 dark:text-zinc-400"
                style={{ fontSize: cover(13) }}
              >
                your line{selectedList.length > 1 ? "s" : ""}
              </p>
              <div
                className="mb-4 mt-1 max-w-xs overflow-y-auto"
                style={{ maxHeight: cover(90) }}
              >
                {selectedList.map((i) => (
                  <p
                    key={i}
                    className="font-display font-medium text-black dark:text-zinc-50"
                    style={{ fontSize: cover(16) }}
                  >
                    &quot;{lines[i]}&quot;
                  </p>
                ))}
              </div>
              <button
                onClick={() => void beginRecording()}
                className="mb-2 flex items-center justify-center rounded-full bg-black text-white"
                style={{ width: cover(60), height: cover(60) }}
              >
                <Mic style={{ width: cover(24), height: cover(24) }} />
              </button>
              <p
                className="font-display text-zinc-500 dark:text-zinc-400"
                style={{ fontSize: cover(12) }}
              >
                tap when ready
              </p>
              <button
                onClick={clearSelection}
                className="font-display mt-3 text-zinc-400 underline dark:text-zinc-600"
                style={{ fontSize: cover(12) }}
              >
                clear selection
              </button>
            </>
          )}

          {panelState === "recording" && (
            <>
              {cue.mode === "sing" ? (
                <>
                  <p
                    className="font-display mb-4 font-medium text-red-600 dark:text-red-400"
                    style={{ fontSize: cover(20) }}
                  >
                    sing!
                  </p>
                  <div
                    className="mb-4 flex items-end justify-center"
                    style={{ gap: cover(3), height: cover(48) }}
                  >
                    {waveLevels.map((lvl, i) => (
                      <div
                        key={i}
                        className="w-1 rounded-full bg-red-500"
                        style={{ height: `${Math.max(8, lvl * 48)}px` }}
                      />
                    ))}
                  </div>
                  <div
                    className="max-w-xs overflow-y-auto"
                    style={{ maxHeight: cover(70) }}
                  >
                    {selectedList.map((i) => (
                      <p
                        key={i}
                        className="font-display text-zinc-500 dark:text-zinc-400"
                        style={{ fontSize: cover(12) }}
                      >
                        &quot;{lines[i]}&quot;
                      </p>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p
                    className="font-display mb-2 text-zinc-500 dark:text-zinc-400"
                    style={{ fontSize: cover(13) }}
                  >
                    get ready
                  </p>
                  <p
                    className="font-display font-medium text-black dark:text-zinc-50"
                    style={{ fontSize: cover(56) }}
                  >
                    {cue.mode === "countin" ? cue.label : ""}
                  </p>
                </>
              )}
              <button
                onClick={cancelFlow}
                className="font-display mt-3 text-zinc-400 underline dark:text-zinc-600"
                style={{ fontSize: cover(12) }}
              >
                cancel
              </button>
            </>
          )}

          {panelState === "review" && (
            <div className="w-full max-w-[280px]">
              <p
                className="font-display text-zinc-500 dark:text-zinc-400"
                style={{ fontSize: cover(12) }}
              >
                nice take
              </p>
              <div
                className="mb-4 mt-1 overflow-y-auto"
                style={{ maxHeight: cover(80) }}
              >
                {selectedList.map((i) => (
                  <p
                    key={i}
                    className="font-display font-medium text-black dark:text-zinc-50"
                    style={{ fontSize: cover(16) }}
                  >
                    &quot;{lines[i]}&quot;
                  </p>
                ))}
              </div>
              <button
                onClick={playBackTake}
                className="font-display relative mb-4 flex w-full items-center justify-center gap-2 overflow-hidden rounded-[20px] border border-zinc-300 py-2 text-black dark:border-zinc-700 dark:text-zinc-50"
                style={{ fontSize: cover(14) }}
              >
                {/* Visual response: fill sweeps across the button as the take plays. */}
                <span
                  className="absolute inset-y-0 left-0 bg-zinc-200 dark:bg-zinc-800"
                  style={{ width: `${playbackPct * 100}%` }}
                />
                <span className="relative flex items-center gap-2">
                  <Play size={14} fill="currentColor" />
                  {playbackPct > 0 ? "playing…" : "play it back"}
                </span>
              </button>
              <div className="flex w-full gap-2">
                <button
                  onClick={retake}
                  className="font-display flex-1 rounded-[20px] border border-zinc-300 py-2 text-black dark:border-zinc-700 dark:text-zinc-50"
                  style={{ fontSize: cover(14) }}
                >
                  retake
                </button>
                <button
                  onClick={submit}
                  className="font-display flex-1 rounded-[20px] bg-black py-2 text-white"
                  style={{ fontSize: cover(14) }}
                >
                  submit
                </button>
              </div>
            </div>
          )}

          {panelState === "success" && (
            <>
              <Check
                className="text-green-600 dark:text-green-400"
                style={{ width: cover(32), height: cover(32) }}
              />
              <p
                className="font-display mt-2 text-zinc-500 dark:text-zinc-400"
                style={{ fontSize: cover(14) }}
              >
                added to the salad
              </p>
            </>
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

      <p className="font-display pointer-events-none absolute bottom-6 right-6 text-5xl font-medium text-black sm:text-6xl md:text-7xl lg:text-8xl dark:text-zinc-50">
        fruit salad
      </p>
    </div>
  );
}
