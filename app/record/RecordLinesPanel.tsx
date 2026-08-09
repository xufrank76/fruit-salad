"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

export default function RecordLinesPanel({
  lines,
  currentIndex,
  takenLines,
  takenBy,
  selectedIndices,
  onToggleLine,
  disabled,
}: {
  lines: string[];
  currentIndex: number;
  takenLines: Set<number>;
  takenBy: Record<number, string>;
  selectedIndices: Set<number>;
  onToggleLine: (index: number) => void;
  disabled: boolean;
}) {
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentIndex]);

  if (lines.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-[20px] bg-red-950 px-6 text-sm text-red-200/70">
        No lyrics yet.
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto rounded-[20px] bg-red-950 px-3 py-6">
      <div className="space-y-1">
        {lines.map((line, i) => {
          const taken = takenLines.has(i);
          const selected = selectedIndices.has(i);
          return (
            <div
              key={i}
              ref={i === currentIndex ? activeRef : null}
              className="flex items-center justify-between gap-3 rounded px-2 py-1"
            >
              <p
                className={`font-display min-w-0 flex-1 truncate ${
                  i === currentIndex
                    ? "text-base font-semibold text-white"
                    : "text-base text-red-200/50"
                }`}
              >
                {line}
              </p>
              {taken ? (
                <span className="font-display shrink-0 whitespace-nowrap text-[11px] text-red-200/40">
                  {takenBy[i] ?? "taken"}
                </span>
              ) : selected ? (
                <button
                  onClick={() => onToggleLine(i)}
                  className="font-display flex shrink-0 items-center gap-1 whitespace-nowrap rounded-[5px] bg-black px-2 py-1 text-xs text-white"
                >
                  sing this!
                  <X size={10} />
                </button>
              ) : (
                <button
                  disabled={disabled}
                  onClick={() => onToggleLine(i)}
                  className="font-display shrink-0 whitespace-nowrap rounded-[5px] bg-zinc-300/80 px-2 py-1 text-xs text-black disabled:opacity-40"
                >
                  sing this!
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
