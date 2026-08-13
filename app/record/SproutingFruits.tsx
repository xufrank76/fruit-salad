"use client";

import { FRUIT_BOIL_CLASS, type FruitKind } from "../FruitField";
import { cover } from "../coverUnit";

// A single decorative fruit for one filled line of the song. x/y are the
// fruit's CENTER in raw design-canvas px (1280x832), scaled by cover() at
// render — matching FruitField. There's exactly one per taken line (whoever
// sang it), laid out on a grid sized to the song's total line count so the
// field fills evenly and, when every line is sung, covers the whole canvas.
export type SproutedFruit = {
  id: number;
  kind: FruitKind;
  x: number;
  y: number;
  size: number;
  rotateDeg: number;
  boilMs: number;
};

// Fixed cycling order (not Object.keys(FRUIT_BOIL_CLASS), which is alphabetical
// and can land the same kind in adjacent slots) so neighbouring fruits always
// read as a varied sequence instead of clustering by chance.
const KIND_ORDER: FruitKind[] = ["apple", "orange", "lemon", "pear", "blueberry"];

// Placement area, kept inside the 1280x832 design canvas (not flush with the
// true edges) so slots stay visible even when cover() scaling crops the canvas
// edges on wide/narrow viewports.
const X_MARGIN = 70;
const Y_TOP = 110;
const Y_BOTTOM = 720;
const USABLE_W = 1280 - X_MARGIN * 2;
const USABLE_H = Y_BOTTOM - Y_TOP;

// Deterministic per-index pseudo-random (mulberry32). slotFruit runs during
// render now (fruits are derived from the taken lines), so it must be pure —
// Math.random() would reshuffle positions every poll and risk an SSR/client
// hydration mismatch. Seeding by line index makes each line's fruit stable.
function rngFor(seed: number): () => number {
  let a = (seed + 1) * 0x6d2b79f5;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A near-square grid sized to `total` lines, so the fruits spread across the
// whole placement area and end up evenly covering it once every line is sung.
function gridFor(total: number) {
  const n = Math.max(1, total);
  const cols = Math.max(1, Math.round(Math.sqrt((n * USABLE_W) / USABLE_H)));
  const rows = Math.ceil(n / cols);
  return { cols, rows, cellW: USABLE_W / cols, cellH: USABLE_H / rows };
}

// Places the fruit for line `index` (of `total` lines) in its own grid cell,
// filling bottom row to top so the field grows upward as lines get sung.
export function slotFruit(index: number, total: number): SproutedFruit {
  const rand = rngFor(index);
  const { cols, cellW, cellH } = gridFor(total);
  const row = Math.floor(index / cols);
  const col = index % cols;

  const cx = X_MARGIN + col * cellW + cellW / 2;
  const cy = Y_BOTTOM - (row * cellH + cellH / 2); // row 0 = bottom

  // Slightly larger than a cell so neighbours overlap into a full, bowl-like
  // field rather than a tidy checkerboard.
  const base = Math.min(cellW, cellH);
  const size = base * (1.2 + rand() * 0.5);
  const jitterX = cellW * 0.16 * (rand() * 2 - 1);
  const jitterY = cellH * 0.16 * (rand() * 2 - 1);

  return {
    id: index,
    kind: KIND_ORDER[index % KIND_ORDER.length],
    x: cx + jitterX,
    y: cy + jitterY,
    size,
    rotateDeg: rand() * 30 - 15,
    boilMs: 800 + rand() * 500,
  };
}

export default function SproutingFruits({ fruits }: { fruits: SproutedFruit[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {fruits.map((f) => (
        <div
          key={f.id}
          className="absolute"
          style={{
            left: cover(f.x - f.size / 2),
            top: cover(f.y - f.size / 2),
            width: cover(f.size),
            height: cover(f.size),
            transform: `rotate(${f.rotateDeg}deg)`,
          }}
        >
          {/* Separate layer for the pop-in scale so it doesn't fight the
              wrapper's rotate or the inner boil frame-swap. */}
          <div className="fruit-sprout h-full w-full">
            <div
              className={`fruit-boil h-full w-full select-none ${FRUIT_BOIL_CLASS[f.kind]}`}
              style={{ animationDuration: `${f.boilMs}ms` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
