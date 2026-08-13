"use client";

// Dev-only tool for eyeballing SproutingFruits placement without recording 51
// real takes. Lets you set the song's total line count and step through
// fruits appearing one at a time (or jump straight to "fill all") to check
// spacing/coverage at any fill level.

import { useState } from "react";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "../../coverUnit";
import FruitField from "../../FruitField";
import SproutingFruits, { slotFruit, type SproutedFruit } from "../../record/SproutingFruits";

const DEFAULT_TOTAL = 51; // matches the seeded track's line count

export default function DevFruitsPage() {
  const [total, setTotal] = useState(DEFAULT_TOTAL);
  const [count, setCount] = useState(0);

  const fruits: SproutedFruit[] = Array.from({ length: count }, (_, i) =>
    slotFruit(i, total)
  );

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-white">
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
      >
        <div className="opacity-10">
          <FruitField />
        </div>
        <SproutingFruits fruits={fruits} />
      </div>

      <div className="font-display absolute left-4 top-4 z-10 flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white/90 p-4 text-sm text-black shadow-lg backdrop-blur-sm">
        <p className="font-medium">
          {count} / {total} fruits
        </p>

        <label className="flex items-center gap-2">
          total lines
          <input
            type="number"
            min={1}
            value={total}
            onChange={(e) => {
              const next = Math.max(1, Number(e.target.value) || 1);
              setTotal(next);
              setCount((c) => Math.min(c, next));
            }}
            className="w-20 rounded border border-zinc-300 px-2 py-1"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setCount((c) => Math.min(total, c + 1))}
            disabled={count >= total}
            className="rounded-full bg-black px-4 py-2 text-white disabled:opacity-40"
          >
            + add fruit
          </button>
          <button
            onClick={() => setCount((c) => Math.min(total, c + 5))}
            disabled={count >= total}
            className="rounded-full border border-zinc-300 px-4 py-2 disabled:opacity-40"
          >
            +5
          </button>
          <button
            onClick={() => setCount(total)}
            disabled={count >= total}
            className="rounded-full border border-zinc-300 px-4 py-2 disabled:opacity-40"
          >
            fill all
          </button>
          <button
            onClick={() => setCount(0)}
            disabled={count === 0}
            className="rounded-full border border-zinc-300 px-4 py-2 disabled:opacity-40"
          >
            reset
          </button>
        </div>
      </div>
    </div>
  );
}
