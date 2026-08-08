"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  blobToAudioBuffer,
  computeNormalizationGain,
  createImpulseResponse,
  getAudioContext,
  loadAudioBuffer,
} from "@/lib/audio";
import { CLIP_START_IN_SONG_MS, RECORD_DURATION_MS, SONG } from "@/lib/song";

type Phase = "loading" | "headphones" | "ready" | "recording" | "reviewing";

const DEFAULT_NUDGE_MS = -120; // fixed round-trip latency compensation, per plan

export default function SyncTestPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [countdownLabel, setCountdownLabel] = useState("");
  const [nudgeMs, setNudgeMs] = useState(DEFAULT_NUDGE_MS);
  const [error, setError] = useState<string | null>(null);

  const instrumentalBufferRef = useRef<AudioBuffer | null>(null);
  const reverbImpulseRef = useRef<AudioBuffer | null>(null);
  const recordedBufferRef = useRef<AudioBuffer | null>(null);
  const gainFactorRef = useRef(1);
  const rafRef = useRef<number | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  useEffect(() => {
    const ctx = getAudioContext();
    reverbImpulseRef.current = createImpulseResponse(ctx);
    loadAudioBuffer(ctx, SONG.url)
      .then((buf) => {
        instrumentalBufferRef.current = buf;
        setPhase("headphones");
      })
      .catch((e) => setError(String(e)));
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
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

  const startRecording = useCallback(async () => {
    setError(null);
    const ctx = getAudioContext();
    const instrumentalBuffer = instrumentalBufferRef.current;
    if (!instrumentalBuffer) return;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      setError("Microphone access denied or unavailable.");
      return;
    }

    setPhase("recording");

    const mediaRecorder = new MediaRecorder(stream);
    const chunks: BlobPart[] = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const startAt = ctx.currentTime + 0.2; // small lead so scheduling lands cleanly
    const leadMs = (startAt - ctx.currentTime) * 1000;

    // Instrumental starts 3s before the line, at the exact scheduled sample time.
    const instSource = ctx.createBufferSource();
    instSource.buffer = instrumentalBuffer;
    instSource.connect(ctx.destination);
    instSource.start(startAt, CLIP_START_IN_SONG_MS / 1000);
    instSource.stop(startAt + RECORD_DURATION_MS / 1000);
    activeSourcesRef.current.push(instSource);

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
      try {
        const buffer = await blobToAudioBuffer(ctx, blob);
        recordedBufferRef.current = buffer;
        gainFactorRef.current = computeNormalizationGain(buffer);
        setPhase("reviewing");
      } catch (e) {
        setError("Could not decode recording: " + String(e));
      }
    };

    setTimeout(() => mediaRecorder.start(), leadMs);
    setTimeout(() => mediaRecorder.stop(), leadMs + RECORD_DURATION_MS);

    // Visual count-in / status, driven off the audio clock (not setTimeout)
    // so it can't drift relative to what's actually playing.
    const tick = () => {
      const songMs =
        CLIP_START_IN_SONG_MS + (ctx.currentTime - startAt) * 1000;
      if (ctx.currentTime < startAt) {
        setCountdownLabel("Get ready...");
      } else if (songMs < SONG.line.startMs) {
        const secsLeft = Math.ceil((SONG.line.startMs - songMs) / 1000);
        setCountdownLabel(secsLeft > 0 ? String(secsLeft) : "Sing!");
      } else if (songMs < SONG.line.endMs) {
        setCountdownLabel("Sing!");
      } else {
        setCountdownLabel("Got it.");
      }
      if (ctx.currentTime < startAt + RECORD_DURATION_MS / 1000 + 0.1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const playMix = useCallback(() => {
    const ctx = getAudioContext();
    const instrumentalBuffer = instrumentalBufferRef.current;
    const recordedBuffer = recordedBufferRef.current;
    const reverbImpulse = reverbImpulseRef.current;
    if (!instrumentalBuffer || !recordedBuffer || !reverbImpulse) return;

    stopAllSources();
    const startAt = ctx.currentTime + 0.15;

    const instSource = ctx.createBufferSource();
    instSource.buffer = instrumentalBuffer;
    instSource.connect(ctx.destination);
    instSource.start(startAt, 0);
    activeSourcesRef.current.push(instSource);

    const voiceSource = ctx.createBufferSource();
    voiceSource.buffer = recordedBuffer;

    const gainNode = ctx.createGain();
    gainNode.gain.value = gainFactorRef.current;

    const dryGain = ctx.createGain();
    dryGain.gain.value = 0.8;
    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.35;
    const convolver = ctx.createConvolver();
    convolver.buffer = reverbImpulse;

    voiceSource.connect(gainNode);
    gainNode.connect(dryGain).connect(ctx.destination);
    gainNode.connect(convolver).connect(wetGain).connect(ctx.destination);

    // This is the whole trick: instrumental at t=0, this voice clip at
    // t = line.start - countIn, shifted by a manual latency nudge. Both
    // sources share one AudioContext clock, so this is sample-accurate.
    const voiceStartSec =
      startAt + (CLIP_START_IN_SONG_MS + nudgeMs) / 1000;
    voiceSource.start(Math.max(startAt, voiceStartSec));
    activeSourcesRef.current.push(voiceSource);
  }, [nudgeMs, stopAllSources]);

  const playClipSolo = useCallback(() => {
    const ctx = getAudioContext();
    const recordedBuffer = recordedBufferRef.current;
    if (!recordedBuffer) return;
    stopAllSources();
    const source = ctx.createBufferSource();
    source.buffer = recordedBuffer;
    const gainNode = ctx.createGain();
    gainNode.gain.value = gainFactorRef.current;
    source.connect(gainNode).connect(ctx.destination);
    source.start();
    activeSourcesRef.current.push(source);
  }, [stopAllSources]);

  const reRecord = useCallback(() => {
    stopAllSources();
    recordedBufferRef.current = null;
    setPhase("ready");
  }, [stopAllSources]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <div className="w-full max-w-md space-y-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Sync prototype
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          One hardcoded line. Prove that a recorded clip lines back up with
          the instrumental using Web Audio scheduling, not signal processing.
        </p>

        {error && (
          <p className="rounded bg-red-100 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        {phase === "loading" && (
          <p className="text-zinc-500 dark:text-zinc-400">Loading instrumental...</p>
        )}

        {phase === "headphones" && (
          <div className="space-y-4 rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
            <p className="text-black dark:text-zinc-50">
              Put on headphones before recording.
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Instrumental bleeding into the mic is the #1 quality killer.
              Echo cancellation is on as a fallback, but headphones matter
              more.
            </p>
            <button
              className="rounded bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
              onClick={() => setPhase("ready")}
            >
              I have headphones on
            </button>
          </div>
        )}

        {phase === "ready" && (
          <div className="space-y-4 rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              Your line: {SONG.line.startMs}ms &ndash; {SONG.line.endMs}ms.
              You&apos;ll hear a 3s count-in, then sing along.
            </p>
            <button
              className="rounded bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
              onClick={startRecording}
            >
              Record my line
            </button>
          </div>
        )}

        {phase === "recording" && (
          <div className="space-y-2 rounded-lg border border-zinc-200 p-10 dark:border-zinc-800">
            <p className="text-4xl font-bold text-black dark:text-zinc-50">
              {countdownLabel}
            </p>
          </div>
        )}

        {phase === "reviewing" && (
          <div className="space-y-4 rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              Recorded. Play the mix &mdash; your line should land in the
              instrumental with no drift.
            </p>
            <div className="flex justify-center gap-3">
              <button
                className="rounded bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
                onClick={playMix}
              >
                Play mix
              </button>
              <button
                className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-black dark:border-zinc-700 dark:text-zinc-50"
                onClick={playClipSolo}
              >
                Play your clip solo
              </button>
            </div>

            <div className="space-y-1 pt-2 text-left">
              <label className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                <span>Nudge earlier</span>
                <span>{nudgeMs}ms</span>
                <span>Nudge later</span>
              </label>
              <input
                type="range"
                min={-300}
                max={300}
                step={10}
                value={nudgeMs}
                onChange={(e) => setNudgeMs(Number(e.target.value))}
                className="w-full"
              />
            </div>

            <button
              className="text-sm text-zinc-500 underline dark:text-zinc-400"
              onClick={reRecord}
            >
              Re-record
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
