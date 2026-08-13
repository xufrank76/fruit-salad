"use client";

import { ArrowLeft, Rewind, FastForward } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  audioBufferToWavBlob,
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
import SproutingFruits, { slotFruit, type SproutedFruit } from "./SproutingFruits";
import RecordControlPanel from "./RecordControlPanel";

// The fixed cover-canvas desktop layout puts the lyrics and record panels
// side by side — unusable on a portrait phone, where it scales by height and
// runs off both edges. Below this width we render a stacked mobile layout
// instead. useSyncExternalStore keeps it SSR-safe (server assumes desktop).
const MOBILE_QUERY = "(max-width: 1023px)";
function subscribeMobile(cb: () => void) {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

const RECORD_SONG_GAIN = 0.35; // duck the backing track while you sing over it
const MIN_LEAD_IN_SEC = 2; // guaranteed minimum pre-roll
const TAIL_PADDING_SEC = 1.5; // buffer past the next line's timestamp — singers lag the reference vocal
const AUTO_STOP_SAFETY_MS = 400; // extra margin so the stop timer never fires before the window ends
const WAVE_BARS = 14;
// ctx.outputLatency only reports the *output* half of the record-to-playback
// round trip; the mic's input latency plus the acoustic/singer lag aren't
// exposed by the browser, so compensating for output alone leaves takes a bit
// late. This amount is added on top of the measured output latency to pull the
// vocal earlier onto the beat — 140ms is a good starting point, and the review
// panel's slider lets the singer fine-tune it by ear (persisted per device).
const DEFAULT_SYNC_NUDGE_MS = 140;
const SYNC_NUDGE_MIN_MS = -50;
const SYNC_NUDGE_MAX_MS = 400;

// "idle" covers both the empty prompt and the pre-record "ready" view — which
// one shows is just whether selectedIndices is empty, not a separate state.
// The 3-2-1 count-in isn't its own state: it happens *during* the "recording"
// pre-roll (mic already capturing), tracked by the `cue` value below.
type PanelState = "idle" | "recording" | "review" | "success";
type CueMode = "wait" | "countin" | "sing" | "wrap";

// Rows returned by /api/renditions/[songId] — the persisted, cross-user
// source of truth for which lines are already sung.
type Take = {
  id: string;
  audio_url: string;
  offset_ms: number | null;
  duration_ms: number | null;
  singer_name: string | null;
};
type DbLine = {
  id: string;
  idx: number;
  text: string;
  start_ms: number;
  end_ms: number;
  take: Take | null;
};

export default function RecordPage() {
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [playbackLoading, setPlaybackLoading] = useState(false);

  // Persisted, cross-user state loaded from the backend: the rendition id and
  // every line with whatever take already fills it. This is what makes "taken"
  // lines survive refresh and show up for everyone.
  const [renditionId, setRenditionId] = useState<string | null>(null);
  const [dbLines, setDbLines] = useState<DbLine[]>([]);
  const [singerName, setSingerName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Vocal-earlier compensation (ms) added on top of the measured output
  // latency. Adjustable by ear via the review slider; read live from a ref
  // inside the playback callbacks so each looped pass picks up the new value.
  const [syncNudgeMs, setSyncNudgeMs] = useState(DEFAULT_SYNC_NUDGE_MS);
  const syncNudgeRef = useRef(DEFAULT_SYNC_NUDGE_MS);

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
  const [isReviewPlaying, setIsReviewPlaying] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const reviewPlayAnchorRef = useRef<{ ctxStartTime: number; offsetSec: number } | null>(
    null
  );
  // Holds the latest startReviewPlayback so the playback loop can restart
  // itself without referencing the callback before it's declared.
  const startReviewPlaybackRef = useRef<((fromPos: number) => void) | null>(null);
  const reviewBarRef = useRef<HTMLDivElement>(null);

  // Decorative fruits that accumulate in the background — one sprouts per line
  // contributed. nextFruitIdRef gives each a stable React key.
  const [bgFruits, setBgFruits] = useState<SproutedFruit[]>([]);
  const nextFruitIdRef = useRef(0);
  // How many of the song's lines have a fruit slot filled so far — seeded
  // from already-taken lines on load, then advanced by one per line recorded.
  const filledSlotsRef = useRef(0);
  const initialFruitsSeededRef = useRef(false);

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

  // Web Audio graph for the "listen to the song" transport (separate from
  // the record/review graphs above) — <audio> tags drift too much for
  // sample-accurate multi-track sync once other people's takes get layered
  // in (see lib/audio.ts).
  const mainPlayAnchorRef = useRef<{ ctxStartTime: number; offsetSec: number } | null>(
    null
  );
  const backingGainRef = useRef<GainNode | null>(null);
  const takesGainRef = useRef<GainNode | null>(null);
  const takeBufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const mutedRef = useRef(false);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    loadLyrics(TRACK.lyricsUrl).then(setLyrics);
  }, []);

  // Restore any saved name so takes stay attributed across visits. Read in an
  // effect (not useState's initializer) because localStorage doesn't exist
  // during SSR — initializing from it there would cause a hydration mismatch.
  useEffect(() => {
    const saved = localStorage.getItem("fruitsalad:singerName");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setSingerName(saved);
    const savedNudge = localStorage.getItem("fruitsalad:syncNudgeMs");
    if (savedNudge != null && savedNudge !== "" && !Number.isNaN(Number(savedNudge))) {
      const clamped = Math.max(
        SYNC_NUDGE_MIN_MS,
        Math.min(SYNC_NUDGE_MAX_MS, Number(savedNudge))
      );
      syncNudgeRef.current = clamped;
      setSyncNudgeMs(clamped);
    }
  }, []);

  // Resume the one global public rendition for this song: which lines already
  // have a take, so the page opens showing real cross-user progress.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/renditions/${TRACK.id}`)
      .then((res) => res.json())
      .then((data: { renditionId: string; lines: DbLine[] }) => {
        if (cancelled) return;
        setRenditionId(data.renditionId);
        setDbLines(data.lines);
      })
      .catch(() => {
        /* best-effort: recording still works without persistence */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const takenLines = useMemo(
    () => new Set(dbLines.filter((l) => l.take).map((l) => l.idx)),
    [dbLines]
  );
  const takenBy = useMemo(() => {
    const by: Record<number, string> = {};
    for (const l of dbLines) {
      if (l.take) by[l.idx] = l.take.singer_name || "someone";
    }
    return by;
  }, [dbLines]);

  useEffect(() => {
    let cancelled = false;
    const ctx = getAudioContext();
    loadAudioBuffer(ctx, TRACK.audioUrl)
      .then((buf) => {
        if (cancelled) return;
        songBufferRef.current = buf;
        setDuration(buf.duration);
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

  // Every taken line's committed recording, deduped and placed on the song's
  // timeline. A multi-line take uploads the same recording once per line it
  // covers, but offset_ms is computed per-line relative to one shared
  // recordFromSec (see submit() below), so every row from the same take
  // resolves to the identical startSec — grouping on (startSec, duration)
  // collapses those duplicate rows back into a single scheduled source.
  const takeWindows = useMemo(() => {
    const byKey = new Map<string, { take: Take; startSec: number; endSec: number }>();
    for (const line of dbLines) {
      if (!line.take) continue;
      const startSec = line.start_ms / 1000 + (line.take.offset_ms ?? 0) / 1000;
      const durSec = (line.take.duration_ms ?? line.end_ms - line.start_ms) / 1000;
      const key = `${Math.round(startSec * 1000)}:${line.take.duration_ms ?? "x"}`;
      if (!byKey.has(key)) {
        byKey.set(key, { take: line.take, startSec, endSec: startSec + durSec });
      }
    }
    return [...byKey.values()];
  }, [dbLines]);

  const pauseMainPlayback = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    stopAllSources();
    mainPlayAnchorRef.current = null;
    backingGainRef.current = null;
    takesGainRef.current = null;
    setIsPlaying(false);
  }, [stopAllSources]);

  // Plays the backing track plus everyone's committed takes layered on top,
  // each scheduled at its own point on the song's timeline. The backing
  // track ducks (same gain as while recording) under whichever take is
  // currently sounding, so contributed vocals are actually audible instead
  // of fighting the original mix. "mute others" is just this take bus's
  // gain switched to 0.
  const startMainPlayback = useCallback(
    async (fromSec: number) => {
      const ctx = getAudioContext();
      const songBuffer = songBufferRef.current;
      if (!songBuffer) return;

      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stopAllSources();

      setPlaybackLoading(true);
      try {
        await Promise.all(
          takeWindows.map(async ({ take }) => {
            if (takeBufferCacheRef.current.has(take.id)) return;
            const buf = await loadAudioBuffer(ctx, take.audio_url);
            takeBufferCacheRef.current.set(take.id, buf);
          })
        );
      } catch {
        /* best-effort: the song still plays even if a take fails to load */
      }
      setPlaybackLoading(false);

      // Takes were captured while the singer sang along to audio they heard a
      // full record-to-playback round trip late, so their voice sits that much
      // late in the buffer. Shift every take earlier by the same total here
      // (matching reviewGeometry's voiceOffset correction) or the layered vocals
      // lag the backing track on playback.
      const vocalLatency =
        getOutputLatencySec(ctx) + syncNudgeRef.current / 1000;
      const windows = takeWindows.map((w) => ({
        ...w,
        startSec: w.startSec - vocalLatency,
        endSec: w.endSec - vocalLatency,
      }));

      const clampedFrom = Math.max(0, Math.min(songBuffer.duration, fromSec));
      const startAt = ctx.currentTime + 0.1;

      const backingGain = ctx.createGain();
      backingGain.gain.value = 1;
      backingGain.connect(ctx.destination);
      const songSource = ctx.createBufferSource();
      songSource.buffer = songBuffer;
      songSource.connect(backingGain);
      songSource.start(startAt, clampedFrom);
      activeSourcesRef.current.push(songSource);

      const takesGain = ctx.createGain();
      takesGain.gain.value = mutedRef.current ? 0 : 1;
      takesGain.connect(ctx.destination);

      for (const { take, startSec, endSec } of windows) {
        if (endSec <= clampedFrom) continue;
        const buf = takeBufferCacheRef.current.get(take.id);
        if (!buf) continue;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(takesGain);
        const offsetIntoTake = Math.max(0, clampedFrom - startSec);
        const when = startAt + Math.max(0, startSec - clampedFrom);
        src.start(when, offsetIntoTake);
        activeSourcesRef.current.push(src);
      }

      backingGainRef.current = backingGain;
      takesGainRef.current = takesGain;
      mainPlayAnchorRef.current = { ctxStartTime: startAt, offsetSec: clampedFrom };
      setIsPlaying(true);

      const tick = () => {
        const anchor = mainPlayAnchorRef.current;
        if (!anchor) return;
        const pos = anchor.offsetSec + (ctx.currentTime - anchor.ctxStartTime);
        if (pos >= songBuffer.duration) {
          setCurrentTime(songBuffer.duration);
          pauseMainPlayback();
          return;
        }
        setCurrentTime(pos);
        const ducked =
          !mutedRef.current &&
          windows.some((w) => pos >= w.startSec && pos < w.endSec);
        backingGain.gain.setTargetAtTime(
          ducked ? RECORD_SONG_GAIN : 1,
          ctx.currentTime,
          0.08
        );
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [takeWindows, stopAllSources, pauseMainPlayback]
  );

  const lines = useMemo(() => lyrics.map((l) => l.text), [lyrics]);

  // Seed the background with fruits for lines that were already filled before
  // this visit (by anyone), so the field reflects real progress instead of
  // restarting from the bottom every time the page loads. Runs once, the
  // first time dbLines actually has rows.
  useEffect(() => {
    if (initialFruitsSeededRef.current || dbLines.length === 0) return;
    initialFruitsSeededRef.current = true;
    const already = dbLines.filter((l) => l.take).length;
    filledSlotsRef.current = already;
    if (already > 0) {
      const seeded = Array.from({ length: already }, (_, i) =>
        slotFruit(nextFruitIdRef.current++, i)
      );
      setBgFruits((prev) => [...prev, ...seeded]);
    }
  }, [dbLines]);

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
      const time = lineTimes[index];
      if (!time) return;
      if (isPlaying) {
        void startMainPlayback(time.start);
      } else {
        setCurrentTime(time.start);
      }
    },
    [lineTimes, isPlaying, startMainPlayback]
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
      setPlaybackPct(0);
      setIsReviewPlaying(false);
      reviewPlayAnchorRef.current = null;
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

    pauseMainPlayback();
    recordFromSecRef.current = recordFromSec;
    lineStartSecRef.current = lineStartSec;
    stopAllSources();

    // Bigger lead so the "get ready" beat is visible before the pre-roll plays.
    const startAt = ctx.currentTime + 0.4;
    // The singer hears the backing track `outputLatency` after it's scheduled,
    // so their singing of the final line trails the nominal window end by that
    // much. Extend the capture tail by it, or TAIL_PADDING_SEC effectively
    // shrinks to (tail - latency) and the end of the last line gets clipped.
    const captureTailLatency = getOutputLatencySec(ctx);
    const endAt = startAt + (recordEndSec - recordFromSec) + captureTailLatency;

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
  }, [selectedIndices, lineTimes, stopAllSources, finishRecording, pauseMainPlayback]);

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

  // Skip the pickup pre-roll on playback: start the song at the line, and
  // offset into the voice buffer by the same amount (the buffer starts at
  // recordFromSec). The take then plays only from where you actually sang.
  // The voice buffer was captured on the raw AudioContext clock, but the
  // singer sang along to what they *heard* — which lagged that clock by the
  // full record-to-playback round trip (output latency + the input/acoustic
  // lag the browser can't report, i.e. the sync nudge) — so their singing
  // lands this much later in the capture than a naive offset assumes.
  const reviewGeometry = useCallback(() => {
    const voiceBuffer = recordedBufferRef.current;
    if (!voiceBuffer) return null;
    const ctx = getAudioContext();
    const lineStartSec = lineStartSecRef.current;
    const vocalLatency = getOutputLatencySec(ctx) + syncNudgeRef.current / 1000;
    const voiceOffset = Math.max(
      0,
      lineStartSec - recordFromSecRef.current + vocalLatency
    );
    const playDur = Math.max(0.1, voiceBuffer.duration - voiceOffset);
    return { lineStartSec, voiceOffset, playDur, voiceBuffer };
  }, []);

  const pauseReviewPlayback = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    stopAllSources();
    reviewPlayAnchorRef.current = null;
    setIsReviewPlaying(false);
  }, [stopAllSources]);

  // Starts (or resumes) review playback at `fromPos` seconds into the take
  // (0..playDur) — used for play, resume-after-pause, and scrubbing alike.
  const startReviewPlayback = useCallback(
    (fromPos: number) => {
      const songBuffer = songBufferRef.current;
      const geom = reviewGeometry();
      if (!songBuffer || !geom) return;
      const { lineStartSec, voiceOffset, playDur, voiceBuffer } = geom;

      const ctx = getAudioContext();
      stopAllSources();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      const clampedFrom = Math.max(0, Math.min(playDur, fromPos));
      const startAt = ctx.currentTime + 0.1;
      const endAt = startAt + (playDur - clampedFrom);

      const songSource = ctx.createBufferSource();
      songSource.buffer = songBuffer;
      songSource.connect(ctx.destination);
      songSource.start(startAt, lineStartSec + clampedFrom);
      songSource.stop(endAt);
      activeSourcesRef.current.push(songSource);

      const voiceSource = ctx.createBufferSource();
      voiceSource.buffer = voiceBuffer;
      voiceSource.connect(ctx.destination);
      voiceSource.start(startAt, voiceOffset + clampedFrom);
      activeSourcesRef.current.push(voiceSource);

      reviewPlayAnchorRef.current = { ctxStartTime: startAt, offsetSec: clampedFrom };
      setPlaybackPct(clampedFrom / playDur);
      setIsReviewPlaying(true);

      const tick = () => {
        const anchor = reviewPlayAnchorRef.current;
        if (!anchor) return;
        const pos = anchor.offsetSec + (ctx.currentTime - anchor.ctxStartTime);
        if (pos >= playDur) {
          // Loop back to the top so the singer can keep dragging the sync
          // slider and hear each change on the next pass without re-pressing
          // play — the restart re-reads syncNudgeRef via reviewGeometry().
          startReviewPlaybackRef.current?.(0);
          return;
        }
        setPlaybackPct(pos / playDur);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [reviewGeometry, stopAllSources]
  );

  useEffect(() => {
    startReviewPlaybackRef.current = startReviewPlayback;
  }, [startReviewPlayback]);

  const toggleReviewPlayback = useCallback(() => {
    if (isReviewPlaying) {
      pauseReviewPlayback();
      return;
    }
    // Restart from the top if playback already ran to the end; otherwise
    // resume from wherever it was paused/scrubbed to.
    startReviewPlayback(playbackPct >= 0.999 ? 0 : playbackPct * (reviewGeometry()?.playDur ?? 0));
  }, [isReviewPlaying, playbackPct, pauseReviewPlayback, startReviewPlayback, reviewGeometry]);

  // Scrubs to the position under `clientX` on the review progress bar. While
  // paused this just moves the displayed position; while playing it
  // reschedules playback to start from there.
  const seekReview = useCallback(
    (clientX: number) => {
      const el = reviewBarRef.current;
      const geom = reviewGeometry();
      if (!el || !geom) return;
      const rect = el.getBoundingClientRect();
      const frac = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
      const clampedFrac = Math.max(0, Math.min(1, frac));
      if (isReviewPlaying) {
        startReviewPlayback(clampedFrac * geom.playDur);
      } else {
        setPlaybackPct(clampedFrac);
      }
    },
    [reviewGeometry, isReviewPlaying, startReviewPlayback]
  );

  // Live slider value change: update the compensation immediately (the looping
  // review take will pick it up on its next pass). Kept cheap so dragging stays
  // smooth — the actual reschedule happens on release via commitSync.
  const applySync = useCallback((valueMs: number) => {
    const clamped = Math.max(
      SYNC_NUDGE_MIN_MS,
      Math.min(SYNC_NUDGE_MAX_MS, Math.round(valueMs))
    );
    syncNudgeRef.current = clamped;
    setSyncNudgeMs(clamped);
    localStorage.setItem("fruitsalad:syncNudgeMs", String(clamped));
  }, []);

  // On release, if a take is playing, restart it from the current spot so the
  // new offset is heard right away instead of only on the next loop.
  const commitSync = useCallback(() => {
    if (!isReviewPlaying) return;
    const geom = reviewGeometry();
    if (geom) startReviewPlayback(Math.min(playbackPct, 0.999) * geom.playDur);
  }, [isReviewPlaying, reviewGeometry, startReviewPlayback, playbackPct]);

  const resetSync = useCallback(() => {
    applySync(DEFAULT_SYNC_NUDGE_MS);
    commitSync();
  }, [applySync, commitSync]);

  const retake = useCallback(() => {
    stopAllSources();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setPlaybackPct(0);
    setIsReviewPlaying(false);
    reviewPlayAnchorRef.current = null;
    recordedBufferRef.current = null;
    setPanelState("idle");
  }, [stopAllSources]);

  const sproutAndFinish = useCallback(
    (count: number) => {
      const startSlot = filledSlotsRef.current;
      const sprouted = Array.from({ length: count }, (_, i) =>
        slotFruit(nextFruitIdRef.current++, startSlot + i)
      );
      filledSlotsRef.current += count;
      setBgFruits((prev) => [...prev, ...sprouted]);
      recordedBufferRef.current = null;
      setPanelState("success");
      successTimeoutRef.current = setTimeout(() => {
        setPanelState("idle");
        setSelectedIndices(new Set());
      }, 1400);
    },
    []
  );

  const submit = useCallback(async () => {
    if (selectedIndices.size === 0) return;
    stopAllSources();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setPlaybackPct(0);
    setIsReviewPlaying(false);
    reviewPlayAnchorRef.current = null;
    setSubmitError(null);

    const buffer = recordedBufferRef.current;
    const indices = [...selectedIndices].sort((a, b) => a - b);

    // Persist to the backend when we can; otherwise fall back to a local-only
    // "success" so recording still works if the API is unreachable.
    if (!buffer || !renditionId || dbLines.length === 0) {
      sproutAndFinish(indices.length);
      return;
    }

    setIsSubmitting(true);
    try {
      const name = singerName.trim() || "Anonymous";
      const wav = audioBufferToWavBlob(buffer);
      const durationMs = Math.round(buffer.duration * 1000);

      // One take row per selected line. All lines in a multi-line take share
      // the same audio file; each row's offset_ms locates the file's start
      // (recordFromSec) relative to that line — the same geometry the review
      // playback uses — so "hear the salad" can place each line correctly.
      for (const i of indices) {
        const dbLine = dbLines.find((l) => l.idx === i);
        if (!dbLine) continue;
        const offsetMs = Math.round(
          (recordFromSecRef.current - lineTimes[i].start) * 1000
        );
        const formData = new FormData();
        formData.append("audio", wav, `${dbLine.id}-take.wav`);
        formData.append("rendition_id", renditionId);
        formData.append("line_id", dbLine.id);
        formData.append("singer_name", name);
        formData.append("offset_ms", String(offsetMs));
        formData.append("duration_ms", String(durationMs));

        const res = await fetch("/api/takes", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Upload failed (${res.status})`);
        }
        const { take } = (await res.json()) as { take: Take };
        setDbLines((prev) =>
          prev.map((l) => (l.id === dbLine.id ? { ...l, take } : l))
        );
      }
      sproutAndFinish(indices.length);
    } catch (e) {
      setSubmitError("Could not save your take: " + String(e));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    selectedIndices,
    stopAllSources,
    renditionId,
    dbLines,
    lineTimes,
    singerName,
    sproutAndFinish,
  ]);

  const isMobile = useSyncExternalStore(
    subscribeMobile,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false
  );

  const handleSingerNameChange = useCallback((value: string) => {
    setSingerName(value);
    localStorage.setItem("fruitsalad:singerName", value);
  }, []);

  const togglePlay = () => {
    if (panelState !== "idle") return;
    if (isPlaying) pauseMainPlayback();
    else void startMainPlayback(currentTime);
  };
  const skip = (deltaSec: number) => {
    const songBuffer = songBufferRef.current;
    if (!songBuffer) return;
    const target = Math.max(0, Math.min(songBuffer.duration, currentTime + deltaSec));
    if (isPlaying) void startMainPlayback(target);
    else setCurrentTime(target);
  };
  const toggleMute = () => {
    setMuted((prev) => {
      const next = !prev;
      takesGainRef.current?.gain.setTargetAtTime(
        next ? 0 : 1,
        getAudioContext().currentTime,
        0.08
      );
      return next;
    });
  };

  // Everything the control panel needs except `sz` (the sizing function) —
  // desktop passes cover(), mobile passes plain px, same markup either way.
  const controlPanelProps = {
    micError,
    panelState,
    selectedList,
    lines,
    cue,
    waveLevels,
    onBeginRecording: () => void beginRecording(),
    onClearSelection: clearSelection,
    onCancel: cancelFlow,
    isReviewPlaying,
    playbackPct,
    reviewBarRef,
    onToggleReviewPlayback: toggleReviewPlayback,
    onSeekReview: seekReview,
    syncNudgeMs,
    syncMin: SYNC_NUDGE_MIN_MS,
    syncMax: SYNC_NUDGE_MAX_MS,
    onApplySync: applySync,
    onCommitSync: commitSync,
    onResetSync: resetSync,
    singerName,
    onSingerNameChange: handleSingerNameChange,
    submitError,
    isSubmitting,
    onRetake: retake,
    onSubmit: () => void submit(),
  };

  const transportDisabled = panelState !== "idle" || playbackLoading;

  if (isMobile) {
    return (
      <div className="relative h-dvh w-full overflow-hidden bg-white">
        {/* Same dimmed decorative fruit field as the desktop layout, sized to
            the design canvas and centered so it fills the phone background. */}
        <div className="pointer-events-none absolute inset-0 opacity-10">
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
          >
            <FruitField />
          </div>
        </div>

        <div className="relative z-10 flex h-full w-full flex-col">
        {/* Header: back, title/artist, mute */}
        <div className="flex items-center gap-3 px-4 pt-4">
          <Link href="/salad" className="shrink-0 text-black dark:text-zinc-100">
            <ArrowLeft size={24} />
          </Link>
          <div className="font-display min-w-0 flex-1">
            <p className="truncate text-lg font-medium leading-tight text-black dark:text-zinc-50">
              {TRACK.title}
            </p>
            <p className="truncate text-sm leading-tight text-zinc-500 dark:text-zinc-400">
              {TRACK.artist}
            </p>
          </div>
          <button
            onClick={toggleMute}
            disabled={takeWindows.length === 0}
            className="font-display shrink-0 rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-sm text-black disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            {muted ? "unmute" : "mute others"}
          </button>
        </div>

        {/* Transport + progress */}
        <div className="flex items-center justify-center gap-10 px-4 pt-3">
          <button
            onClick={() => skip(-10)}
            disabled={transportDisabled}
            className="text-black disabled:opacity-40 dark:text-zinc-100"
          >
            <Rewind size={22} />
          </button>
          <button
            onClick={togglePlay}
            disabled={transportDisabled}
            className="relative h-14 w-14 shrink-0 disabled:opacity-40"
          >
            <Image
              src={isPlaying ? "/fruit/pause-button.png" : "/fruit/play-button.png"}
              alt={isPlaying ? "Pause" : "Play"}
              fill
              className="select-none object-contain"
              draggable={false}
            />
          </button>
          <button
            onClick={() => skip(10)}
            disabled={transportDisabled}
            className="text-black disabled:opacity-40 dark:text-zinc-100"
          >
            <FastForward size={22} />
          </button>
        </div>
        <div className="mx-4 mt-3 h-[5px] overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-black dark:bg-white"
            style={{ width: duration ? `${(currentTime / duration) * 100}%` : "0%" }}
          />
        </div>

        {/* Lyrics — fills remaining space, scrolls internally */}
        <div className="min-h-0 flex-1 px-4 py-3">
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

        {/* Record control panel — pinned at the bottom, scrolls if tall */}
        <div className="flex max-h-[46vh] shrink-0 flex-col items-center justify-center overflow-y-auto border-t border-zinc-200 bg-white/70 px-6 py-4 text-center backdrop-blur-sm">
          <RecordControlPanel sz={(n) => `${n}px`} {...controlPanelProps} />
        </div>
        </div>
      </div>
    );
  }

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
          disabled={takeWindows.length === 0}
          className="font-display absolute flex items-center justify-center rounded-[20px] border border-zinc-300 bg-white text-black disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
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
          <button
            onClick={() => skip(-10)}
            disabled={panelState !== "idle" || playbackLoading}
            className="text-black disabled:opacity-40 dark:text-zinc-100"
          >
            <Rewind style={{ width: cover(24), height: cover(24) }} />
          </button>
          <button
            onClick={togglePlay}
            disabled={panelState !== "idle" || playbackLoading}
            className="relative shrink-0 disabled:opacity-40"
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
          <button
            onClick={() => skip(10)}
            disabled={panelState !== "idle" || playbackLoading}
            className="text-black disabled:opacity-40 dark:text-zinc-100"
          >
            <FastForward style={{ width: cover(24), height: cover(24) }} />
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
          <RecordControlPanel sz={cover} {...controlPanelProps} />
        </div>

      </div>

      <p className="font-display pointer-events-none absolute bottom-6 right-6 text-5xl font-medium text-black sm:text-6xl md:text-7xl lg:text-8xl dark:text-zinc-50">
        fruit salad
      </p>
    </div>
  );
}
