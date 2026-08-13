"use client";

import { Check, Mic, Pause, Play } from "lucide-react";
import type { RefObject } from "react";

// The record panel's inner content — the whole idle → recording → review →
// success state machine. Shared by the desktop (fixed cover-canvas) and mobile
// (stacked) layouts of the record page: every size is expressed through `sz`,
// so desktop passes `cover` (viewport-scaled design px) and mobile passes a
// plain-px function, and the exact same markup renders correctly in both.
// Purely presentational — all state and audio logic stays in the page.

type PanelState = "idle" | "recording" | "review" | "success";
type Cue = { mode: "wait" | "countin" | "sing" | "wrap"; label: string };

export default function RecordControlPanel({
  sz,
  micError,
  panelState,
  selectedList,
  lines,
  cue,
  waveLevels,
  onBeginRecording,
  onClearSelection,
  onCancel,
  isReviewPlaying,
  playbackPct,
  reviewBarRef,
  onToggleReviewPlayback,
  onSeekReview,
  syncNudgeMs,
  syncMin,
  syncMax,
  onApplySync,
  onCommitSync,
  onResetSync,
  singerName,
  onSingerNameChange,
  submitError,
  isSubmitting,
  onRetake,
  onSubmit,
}: {
  sz: (n: number) => string;
  micError: string | null;
  panelState: PanelState;
  selectedList: number[];
  lines: string[];
  cue: Cue;
  waveLevels: number[];
  onBeginRecording: () => void;
  onClearSelection: () => void;
  onCancel: () => void;
  isReviewPlaying: boolean;
  playbackPct: number;
  reviewBarRef: RefObject<HTMLDivElement | null>;
  onToggleReviewPlayback: () => void;
  onSeekReview: (clientX: number) => void;
  syncNudgeMs: number;
  syncMin: number;
  syncMax: number;
  onApplySync: (ms: number) => void;
  onCommitSync: () => void;
  onResetSync: () => void;
  singerName: string;
  onSingerNameChange: (value: string) => void;
  submitError: string | null;
  isSubmitting: boolean;
  onRetake: () => void;
  onSubmit: () => void;
}) {
  return (
    <>
      {micError && (
        <p
          className="font-display mb-3 text-red-600 dark:text-red-400"
          style={{ fontSize: sz(14) }}
        >
          {micError}
        </p>
      )}

      {panelState === "idle" && selectedList.length === 0 && (
        <>
          <Mic
            className="text-zinc-400 dark:text-zinc-600"
            style={{ width: sz(48), height: sz(48) }}
          />
          <p
            className="font-display mt-3 text-zinc-500 dark:text-zinc-400"
            style={{ fontSize: sz(16) }}
          >
            add open lines to contribute
          </p>
        </>
      )}

      {panelState === "idle" && selectedList.length > 0 && (
        <>
          <p
            className="font-display text-zinc-500 dark:text-zinc-400"
            style={{ fontSize: sz(13) }}
          >
            your line{selectedList.length > 1 ? "s" : ""}
          </p>
          <div
            className="mb-4 mt-1 max-w-xs overflow-y-auto"
            style={{ maxHeight: sz(90) }}
          >
            {selectedList.map((i) => (
              <p
                key={i}
                className="font-display font-medium text-black dark:text-zinc-50"
                style={{ fontSize: sz(16) }}
              >
                &quot;{lines[i]}&quot;
              </p>
            ))}
          </div>
          <button
            onClick={onBeginRecording}
            className="mb-2 flex items-center justify-center rounded-full bg-black text-white"
            style={{ width: sz(60), height: sz(60) }}
          >
            <Mic style={{ width: sz(24), height: sz(24) }} />
          </button>
          <p
            className="font-display text-zinc-500 dark:text-zinc-400"
            style={{ fontSize: sz(12) }}
          >
            tap when ready
          </p>
          <button
            onClick={onClearSelection}
            className="font-display mt-3 text-zinc-400 underline dark:text-zinc-600"
            style={{ fontSize: sz(12) }}
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
                style={{ fontSize: sz(20) }}
              >
                sing!
              </p>
              <div
                className="mb-4 flex items-end justify-center"
                style={{ gap: sz(3), height: sz(48) }}
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
                style={{ maxHeight: sz(70) }}
              >
                {selectedList.map((i) => (
                  <p
                    key={i}
                    className="font-display text-zinc-500 dark:text-zinc-400"
                    style={{ fontSize: sz(12) }}
                  >
                    &quot;{lines[i]}&quot;
                  </p>
                ))}
              </div>
            </>
          ) : cue.mode === "wrap" ? (
            <>
              <Check
                className="mb-2 text-green-600 dark:text-green-400"
                style={{ width: sz(32), height: sz(32) }}
              />
              <p
                className="font-display font-medium text-black dark:text-zinc-50"
                style={{ fontSize: sz(16) }}
              >
                nice take!
              </p>
            </>
          ) : (
            <>
              <p
                className="font-display mb-2 text-zinc-500 dark:text-zinc-400"
                style={{ fontSize: sz(13) }}
              >
                get ready
              </p>
              <p
                className="font-display font-medium text-black dark:text-zinc-50"
                style={{ fontSize: sz(56) }}
              >
                {cue.mode === "countin" ? cue.label : ""}
              </p>
            </>
          )}
          {cue.mode !== "wrap" && (
            <button
              onClick={onCancel}
              className="font-display mt-3 text-zinc-400 underline dark:text-zinc-600"
              style={{ fontSize: sz(12) }}
            >
              cancel
            </button>
          )}
        </>
      )}

      {panelState === "review" && (
        <div className="w-full max-w-[280px]">
          <p
            className="font-display font-medium text-black dark:text-zinc-50"
            style={{ fontSize: sz(16) }}
          >
            nice take!
          </p>
          <div
            className="mb-4 mt-1 overflow-y-auto"
            style={{ maxHeight: sz(80) }}
          >
            {selectedList.map((i) => (
              <p
                key={i}
                className="font-display font-medium text-black dark:text-zinc-50"
                style={{ fontSize: sz(16) }}
              >
                &quot;{lines[i]}&quot;
              </p>
            ))}
          </div>
          <div
            className="font-display mb-4 flex w-full items-center gap-2 rounded-[20px] border border-zinc-300 py-2 pl-3 pr-4 text-black dark:border-zinc-700 dark:text-zinc-50"
            style={{ fontSize: sz(14) }}
          >
            <button
              onClick={onToggleReviewPlayback}
              aria-label={isReviewPlaying ? "Pause" : "Play"}
              className="flex shrink-0 items-center justify-center"
            >
              {isReviewPlaying ? (
                <Pause size={14} fill="currentColor" />
              ) : (
                <Play size={14} fill="currentColor" />
              )}
            </button>
            {/* Scrubbable: click or drag to seek, whether paused or playing. */}
            <div
              ref={reviewBarRef}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                onSeekReview(e.clientX);
              }}
              onPointerMove={(e) => {
                if (e.buttons !== 1) return;
                onSeekReview(e.clientX);
              }}
              className="relative h-2 flex-1 cursor-pointer touch-none overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
            >
              <span
                className="absolute inset-y-0 left-0 bg-black dark:bg-white"
                style={{ width: `${playbackPct * 100}%` }}
              />
            </div>
            <span className="shrink-0 text-zinc-500 dark:text-zinc-400">
              {isReviewPlaying ? "looping…" : playbackPct > 0 ? "paused" : "play it back"}
            </span>
          </div>
          {/* Sync calibration: play the take (it loops) and drag until your
              voice lands on the beat. The end labels tell you which way to
              drag based on what you hear, so no mental math. */}
          <div className="font-display mb-3 w-full">
            <div
              className="mb-1 flex items-center justify-between text-zinc-500 dark:text-zinc-400"
              style={{ fontSize: sz(12) }}
            >
              <span>voice off the beat?</span>
              <button
                onClick={onResetSync}
                className="underline hover:text-black dark:hover:text-zinc-50"
              >
                reset
              </button>
            </div>
            <input
              type="range"
              min={syncMin}
              max={syncMax}
              step={5}
              value={syncNudgeMs}
              onChange={(e) => onApplySync(Number(e.target.value))}
              onPointerUp={onCommitSync}
              onKeyUp={onCommitSync}
              aria-label="voice timing"
              className="w-full cursor-pointer accent-black dark:accent-white"
            />
            <div
              className="flex items-center justify-between text-zinc-400 dark:text-zinc-600"
              style={{ fontSize: sz(11) }}
            >
              <span>← drag if voice is early</span>
              <span>drag if voice is late →</span>
            </div>
          </div>
          <input
            value={singerName}
            onChange={(e) => onSingerNameChange(e.target.value)}
            placeholder="your name (optional)"
            maxLength={30}
            className="font-display mb-2 w-full rounded-[20px] border border-zinc-300 bg-transparent px-3 py-2 text-center text-black placeholder:text-zinc-400 dark:border-zinc-700 dark:text-zinc-50"
            style={{ fontSize: sz(14) }}
          />
          {submitError && (
            <p
              className="font-display mb-2 text-red-600 dark:text-red-400"
              style={{ fontSize: sz(12) }}
            >
              {submitError}
            </p>
          )}
          <div className="flex w-full gap-2">
            <button
              onClick={onRetake}
              disabled={isSubmitting}
              className="font-display flex-1 rounded-[20px] border border-zinc-300 py-2 text-black disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-50"
              style={{ fontSize: sz(14) }}
            >
              retake
            </button>
            <button
              onClick={onSubmit}
              disabled={isSubmitting}
              className="font-display flex-1 rounded-[20px] bg-black py-2 text-white disabled:opacity-40"
              style={{ fontSize: sz(14) }}
            >
              {isSubmitting ? "submitting…" : "submit"}
            </button>
          </div>
        </div>
      )}

      {panelState === "success" && (
        <>
          <Check
            className="text-green-600 dark:text-green-400"
            style={{ width: sz(32), height: sz(32) }}
          />
          <p
            className="font-display mt-2 text-zinc-500 dark:text-zinc-400"
            style={{ fontSize: sz(14) }}
          >
            added to the salad
          </p>
        </>
      )}
    </>
  );
}
