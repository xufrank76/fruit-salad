"use client";

import { useEffect, useRef } from "react";

export default function LyricsPanel({
  lines,
  currentIndex,
  selectedLines,
  onToggleLine,
  recordedLines,
}: {
  lines: string[];
  currentIndex: number;
  selectedLines?: Set<number>;
  onToggleLine?: (index: number) => void;
  recordedLines?: Set<number>;
}) {
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentIndex]);

  if (lines.length === 0) {
    return (
      <div className="flex h-80 w-full max-w-md items-center justify-center rounded-lg bg-red-950 px-6 text-sm text-red-200/70">
        No lyrics yet &mdash; add lines to {"public/beautyandabeat.txt"}.
      </div>
    );
  }

  return (
    <div className="h-80 w-full max-w-md overflow-y-auto rounded-lg bg-red-950 px-3 py-8">
      <div className="space-y-1">
        {lines.map((line, i) => {
          const selected = selectedLines?.has(i) ?? false;
          const recorded = recordedLines?.has(i) ?? false;
          return (
            <div
              key={i}
              ref={i === currentIndex ? activeRef : null}
              onClick={() => onToggleLine?.(i)}
              className={`flex items-center gap-2 rounded px-2 py-1 ${
                onToggleLine ? "cursor-pointer" : ""
              } ${selected ? "bg-red-800/70" : "hover:bg-red-900/40"}`}
            >
              {onToggleLine && (
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggleLine(i)}
                  onClick={(e) => e.stopPropagation()}
                  className="h-3.5 w-3.5 shrink-0"
                />
              )}
              <p
                className={
                  i === currentIndex
                    ? "text-base font-semibold text-white"
                    : "text-base text-red-200/50"
                }
              >
                {line}
              </p>
              {recorded && (
                <span
                  className="ml-auto shrink-0 text-xs text-emerald-400"
                  title="Already recorded"
                >
                  &#9679;
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
