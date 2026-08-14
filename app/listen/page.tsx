"use client";

import { ArrowLeft, Rewind, FastForward } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getAudioContext,
  getOutputLatencySec,
  loadAudioBuffer,
} from "@/lib/audio";
import { loadLyrics, type LyricLine } from "@/lib/lyrics";
import { TRACK } from "@/lib/track";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "../coverUnit";
import FruitField from "../FruitField";
import SproutingFruits, { slotFruit, type SproutedFruit } from "../record/SproutingFruits";

const RECORD_SONG_GAIN = 0.35; // duck the backing track under whichever take is sounding

type Take = {
  id: string;
  audio_url: string;
  offset_ms: number | null;
  duration_ms: number | null;
  singer_name: string | null;
  created_at: string | null;
};
type DbLine = {
  id: string;
  idx: number;
  text: string;
  start_ms: number;
  end_ms: number;
  take: Take | null;
};

// The "hear the salad" screen: everyone's contributions layered into one
// playback, with the lyric being sung right now shown large and centered —
// same playback engine as /record's "listen to the song" transport (song +
// every take scheduled at its own point, ducked so vocals cut through), just
// without any of the recording-specific state that page also carries.
export default function ListenPage() {
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [dbLines, setDbLines] = useState<DbLine[]>([]);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackLoading, setPlaybackLoading] = useState(false);
  const [muted, setMuted] = useState(false);

  const songBufferRef = useRef<AudioBuffer | null>(null);
  const activeSourcesRef = useRef<AudioScheduledSourceNode[]>([]);
  const rafRef = useRef<number | null>(null);
  const playAnchorRef = useRef<{ ctxStartTime: number; offsetSec: number } | null>(
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
        /* transport stays disabled if this fails to load */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/renditions/${TRACK.id}`)
      .then((res) => res.json())
      .then((data: { lines: DbLine[] }) => {
        if (!cancelled) setDbLines(data.lines);
      })
      .catch(() => {
        /* best-effort: plays the bare backing track if this fails */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live updates: pick up new takes as people record them elsewhere, so
  // dropping back in here later reflects real progress. Same 4s cadence as
  // the record page's poll.
  useEffect(() => {
    const interval = setInterval(() => {
      fetch(`/api/renditions/${TRACK.id}`)
        .then((res) => res.json())
        .then((data: { lines: DbLine[] }) => setDbLines(data.lines))
        .catch(() => {
          /* transient network error — try again next tick */
        });
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const lines = useMemo(() => lyrics.map((l) => l.text), [lyrics]);

  // Same fruit field as the record page — the salad growing in the
  // background while you listen to it.
  const bgFruits = useMemo<SproutedFruit[]>(() => {
    const total = dbLines.length || lines.length;
    const taken = dbLines.filter((l) => l.take);
    taken.sort((a, b) => {
      const ta = a.take?.created_at ?? "";
      const tb = b.take?.created_at ?? "";
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a.idx - b.idx;
    });
    return taken.map((_, rank) => slotFruit(rank, total));
  }, [dbLines, lines.length]);

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

  const takenBy = useMemo(() => {
    const by: Record<number, string> = {};
    for (const l of dbLines) {
      if (l.take) by[l.idx] = l.take.singer_name || "someone";
    }
    return by;
  }, [dbLines]);

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
      stopAllSources();
    };
  }, [stopAllSources]);

  // Every taken line's committed recording, deduped and placed on the song's
  // timeline — identical grouping logic to the record page's takeWindows
  // (see there for why the same take can show up under several line rows).
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

  const pausePlayback = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    stopAllSources();
    playAnchorRef.current = null;
    backingGainRef.current = null;
    takesGainRef.current = null;
    setIsPlaying(false);
  }, [stopAllSources]);

  // Plays the backing track plus everyone's committed takes layered on top,
  // each scheduled at its own point on the song's timeline, ducking the
  // backing track under whichever take is currently sounding.
  const startPlayback = useCallback(
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
      // full record-to-playback round trip late, so their voice sits that
      // much late in the buffer — shift every take earlier by that latency or
      // the layered vocals lag the backing track.
      const vocalLatency = getOutputLatencySec(ctx);
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
      playAnchorRef.current = { ctxStartTime: startAt, offsetSec: clampedFrom };
      setIsPlaying(true);

      const tick = () => {
        const anchor = playAnchorRef.current;
        if (!anchor) return;
        const pos = anchor.offsetSec + (ctx.currentTime - anchor.ctxStartTime);
        if (pos >= songBuffer.duration) {
          setCurrentTime(songBuffer.duration);
          pausePlayback();
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
    [takeWindows, stopAllSources, pausePlayback]
  );

  const togglePlay = () => {
    if (isPlaying) pausePlayback();
    else void startPlayback(currentTime);
  };
  const skip = (deltaSec: number) => {
    const songBuffer = songBufferRef.current;
    if (!songBuffer) return;
    const target = Math.max(0, Math.min(songBuffer.duration, currentTime + deltaSec));
    if (isPlaying) void startPlayback(target);
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

  const prevLine = currentIndex > 0 ? lines[currentIndex - 1] : null;
  const currentLine = currentIndex >= 0 ? lines[currentIndex] : null;
  const nextLine =
    currentIndex >= 0 && currentIndex < lines.length - 1
      ? lines[currentIndex + 1]
      : null;
  const currentSinger = currentIndex >= 0 ? takenBy[currentIndex] : undefined;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-white dark:bg-black">
      {/* Decorative fruit background only — kept on the app's fixed
          1280x832 canvas (which is what FruitField/SproutingFruits are laid
          out against), sized and centered independent of viewport shape.
          Everything interactive lives in the plain responsive layer below
          instead, so this page (unlike /record's original desktop-only
          layout) works correctly on portrait phones without a separate
          mobile branch. */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
        >
          <div className="opacity-10">
            <FruitField />
          </div>
          <SproutingFruits fruits={bgFruits} />
        </div>
      </div>

      <div className="relative z-10 flex h-full w-full flex-col">
        <div className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-8 sm:pt-6">
          <Link
            href="/salad"
            className="flex shrink-0 items-center gap-3 text-black dark:text-zinc-100"
          >
            <ArrowLeft className="h-5 w-5 shrink-0 sm:h-6 sm:w-6" />
            <span className="font-display min-w-0">
              <span className="block truncate text-lg font-medium leading-tight sm:text-2xl">
                {TRACK.title}
              </span>
              <span className="block truncate text-sm leading-tight text-zinc-500 dark:text-zinc-400 sm:text-base">
                {TRACK.artist}
              </span>
            </span>
          </Link>

          <button
            onClick={toggleMute}
            disabled={takeWindows.length === 0}
            className="font-display shrink-0 rounded-[20px] border border-zinc-300 bg-white px-3 py-1.5 text-sm text-black disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 sm:px-4 sm:py-2 sm:text-base"
          >
            {muted ? "unmute" : "mute others"}
          </button>
        </div>

        {/* Karaoke display: the line playing right now, large and centered,
            with a sliver of what just passed and what's coming next. */}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center sm:gap-4">
          <p className="font-display min-h-[1.4em] text-base text-zinc-300 dark:text-zinc-700 sm:text-xl">
            {prevLine}
          </p>
          <p className="font-display max-w-3xl text-2xl font-medium leading-tight text-black dark:text-zinc-50 sm:text-4xl">
            {currentLine ?? (dbLines.length === 0 && lines.length === 0
              ? "loading…"
              : "tap play to listen")}
          </p>
          {currentSinger && (
            <p className="font-display text-sm text-zinc-500 dark:text-zinc-400 sm:text-base">
              — sung by {currentSinger}
            </p>
          )}
          <p className="font-display min-h-[1.4em] text-base text-zinc-300 dark:text-zinc-700 sm:text-xl">
            {nextLine}
          </p>
        </div>

        <div className="flex flex-col items-center gap-3 px-6 pb-8 sm:gap-4 sm:pb-12">
          <div className="flex items-center justify-center gap-8 sm:gap-14">
            <button
              onClick={() => skip(-10)}
              disabled={playbackLoading}
              className="text-black disabled:opacity-40 dark:text-zinc-100"
            >
              <Rewind className="h-5 w-5 sm:h-6 sm:w-6" />
            </button>
            <button
              onClick={togglePlay}
              disabled={playbackLoading}
              className="relative h-14 w-14 shrink-0 disabled:opacity-40 sm:h-[60px] sm:w-[60px]"
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
              disabled={playbackLoading}
              className="text-black disabled:opacity-40 dark:text-zinc-100"
            >
              <FastForward className="h-5 w-5 sm:h-6 sm:w-6" />
            </button>
          </div>

          <div className="h-[5px] w-full max-w-2xl overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-black dark:bg-white"
              style={{ width: duration ? `${(currentTime / duration) * 100}%` : "0%" }}
            />
          </div>
        </div>
      </div>

      <p className="font-display pointer-events-none absolute bottom-6 right-6 text-5xl font-medium text-black sm:text-6xl md:text-7xl lg:text-8xl dark:text-zinc-50">
        fruit salad
      </p>
    </div>
  );
}
