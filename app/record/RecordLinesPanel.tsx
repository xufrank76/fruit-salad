"use client";

import { CircleCheck, CirclePlus, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";

export default function RecordLinesPanel({
  lines,
  currentIndex,
  takenLines,
  takenBy,
  selectedIndices,
  onToggleLine,
  onSeekLine,
  deletableLines,
  onDeleteLine,
  deletingLine,
  disabled,
}: {
  lines: string[];
  currentIndex: number;
  takenLines: Set<number>;
  takenBy: Record<number, string>;
  selectedIndices: Set<number>;
  onToggleLine: (index: number) => void;
  onSeekLine?: (index: number) => void;
  // Lines whose take you recorded on this device, plus a handler to delete
  // one. `deletingLine` is the index currently being deleted (disables it).
  deletableLines?: Set<number>;
  onDeleteLine?: (index: number) => void;
  deletingLine?: number | null;
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
          const deletable = taken && !!onDeleteLine && !!deletableLines?.has(i);
          return (
            <div
              key={i}
              ref={i === currentIndex ? activeRef : null}
              className="flex items-center justify-between gap-3 rounded px-2 py-1"
            >
              <p
                onClick={() => onSeekLine?.(i)}
                className={`font-display min-w-0 flex-1 truncate ${
                  onSeekLine ? "cursor-pointer hover:text-white" : ""
                } ${
                  i === currentIndex
                    ? "text-base font-semibold text-white"
                    : "text-base text-red-200/50"
                }`}
              >
                {line}
              </p>
              {taken ? (
                deletable ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-display whitespace-nowrap text-[11px] text-red-200/40">
                      {takenBy[i] ?? "you"}
                    </span>
                    <button
                      disabled={deletingLine === i}
                      onClick={() => onDeleteLine?.(i)}
                      aria-label="Delete your recording for this line"
                      className="text-red-200/50 hover:text-white disabled:opacity-40"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ) : (
                  <span className="font-display shrink-0 whitespace-nowrap text-[11px] text-red-200/40">
                    {takenBy[i] ?? "taken"}
                  </span>
                )
              ) : selected ? (
                <button
                  disabled={disabled}
                  onClick={() => onToggleLine(i)}
                  aria-label="Remove this line from your selection"
                  className="shrink-0 text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <CircleCheck size={20} />
                </button>
              ) : (
                <button
                  disabled={disabled}
                  onClick={() => onToggleLine(i)}
                  aria-label="Sing this line"
                  className="shrink-0 text-red-200/50 hover:text-white disabled:opacity-40 disabled:hover:text-red-200/50"
                >
                  <CirclePlus size={20} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
