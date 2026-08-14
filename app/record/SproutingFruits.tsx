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

// Fixed cycling order (apple, orange, lemon, pear, blueberry). The kind is
// chosen by contribution index, so fruits always come out in this repeating
// sequence rather than at random.
const KIND_ORDER: FruitKind[] = ["apple", "orange", "lemon", "pear", "blueberry"];

// The 1280x832 design canvas. Placement uses the FULL canvas (no inner margin):
// fruits are allowed to jitter past the true edges so the field bleeds off the
// frame the way the hand-scattered homepage FruitField does under cover().
const W = 1280;
const H = 832;

// Vertical span the rows are laid out across. The TOP is above the frame so the
// last (top) row bleeds off the top like the homepage field; the BOTTOM is kept
// inside the frame so the first-filled (bottom) row sits mostly on-screen — with
// big fruits, a center right at the edge would hang half off, so we hold it in.
const Y_TOP = -80;
const Y_BOTTOM = 745;

// Deterministic pseudo-random (mulberry32). slotFruit runs during render
// (fruits are derived from the taken lines), so it must be pure — Math.random()
// would reshuffle positions every poll and risk an SSR/client hydration
// mismatch. Seeding by index/total makes each line's fruit stable across polls.
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

// A jittered grid sized to the song's total lines: enough cells to hold every
// line, in a layout that roughly matches the canvas aspect so coverage stays
// even. Deterministic (seeded only by `total`), so it's identical on server and
// client and stable across polls.
function gridDims(total: number): { cols: number; rows: number } {
  const cols = Math.max(1, Math.round(Math.sqrt(total * (W / H))));
  const rows = Math.max(1, Math.ceil(total / cols));
  return { cols, rows };
}

// Seeded Fisher-Yates permutation of [0..n).
function shuffledCells(n: number, seed: number): number[] {
  const rand = rngFor(seed);
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// The order grid cells are handed out to filling lines: bottom row first, then
// climbing row by row, with the columns *within* each row shuffled so the
// horizontal position is random. So the field fills bottom-to-top as the song
// fills, each new row scattered across the width, and covers the whole canvas
// once every line is sung. Seeded only by `total`, so it's stable and identical
// on server and client.
function cellOrder(cols: number, rows: number): number[] {
  const order: number[] = [];
  for (let row = rows - 1; row >= 0; row--) {
    for (const col of shuffledCells(cols, cols * (row + 1) + 1)) {
      order.push(row * cols + col);
    }
  }
  return order;
}

// Places the fruit for contribution `index` (of `total` lines). Each line takes
// the next cell of a jittered grid in bottom-to-top, random-column order (see
// cellOrder), then is offset within/past its cell by a strong random jitter.
// The result is a loose hand-scattered pile — varied kinds, sizes and rotations,
// bleeding off the frame edges — that rises as the song fills and, once every
// line is sung, covers the whole canvas the way the homepage FruitField does.
// Seeded per index, so positions stay put across polls; edge bleed under
// cover() is fine/expected.
export function slotFruit(index: number, total: number): SproutedFruit {
  const rand = rngFor(index);
  const { cols, rows } = gridDims(total);
  const cell = cellOrder(cols, rows)[index % (cols * rows)];
  const cellW = W / cols;
  // Rows are laid out from Y_TOP to Y_BOTTOM (see their comment above).
  const cellH = (Y_BOTTOM - Y_TOP) / rows;
  const col = cell % cols;
  const row = Math.floor(cell / cols);

  // ±0.55 of a cell of jitter breaks up the grid and lets edge fruits spill
  // off the canvas, so it never reads as a lattice.
  const cx = (col + 0.5) * cellW + (rand() * 2 - 1) * cellW * 0.55;
  const cy = Y_TOP + (row + 0.5) * cellH + (rand() * 2 - 1) * cellH * 0.55;

  return {
    id: index,
    kind: KIND_ORDER[index % KIND_ORDER.length],
    x: cx,
    y: cy,
    size: 160 + rand() * 75,
    rotateDeg: rand() * 30 - 15,
    boilMs: 800 + rand() * 500,
  };
}

// Every fruit falls the same total distance each loop — from FALL_TOP (bleed
// above the 1280x832 design canvas) to bleed below it, 1132 total (832 canvas
// height + 150 top bleed + 150 bottom bleed) — so the loop always re-enters
// fully off-screen at the top. That 1132 is hardcoded as the translateY "to"
// value in globals.css's fruit-fall keyframe (cover(1132)) since it's
// identical for every fruit; keep the two in sync if this changes.
const FALL_TOP = -150;

// Pass `falling` to make every contribution fruit continuously fall
// top-to-bottom in an infinite loop while spinning — only the /listen page
// wants this ambient motion; /record keeps the fruits fixed in their grid
// slots as a progress marker for which lines are actually filled.
export default function SproutingFruits({
  fruits,
  falling = false,
}: {
  fruits: SproutedFruit[];
  falling?: boolean;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {fruits.map((f) => {
        if (!falling) {
          return (
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
          );
        }

        // Deterministic per-fruit variety (not Math.random(), which would
        // mismatch between server and client render): fall speed, spin speed
        // and spin direction all vary so fruits don't move in lockstep.
        const fallDurationSec = 18 + ((f.id * 137) % 130) / 10; // ~18-31s
        const spinDurationSec = 20 + ((f.id * 191) % 150) / 10; // ~20-35s
        const spinLeft = f.id % 2 === 0;
        const spinDelaySec = -(((f.id * 233) % 300) / 10);

        // Deliberately NOT f.x/f.y: those come from the grid-based slotFruit
        // layout above, designed for /record's bottom-to-top progress marker
        // — with few lines taken, that grid confines fruits to whichever
        // narrow band has filled so far. The falling variant is just ambient
        // decoration, so it spreads every fruit across the FULL canvas (both
        // horizontally and in fall-cycle phase) regardless of how many
        // fruits there are or how "full" the song is, seeded independently
        // of slotFruit's own rng so the two don't correlate.
        const spread = rngFor(f.id + 90000);
        const spreadX = f.size / 2 + spread() * (W - f.size);
        const fallDelaySec = -(spread() * fallDurationSec);

        return (
          <div
            key={f.id}
            className="absolute fruit-fall"
            style={{
              left: cover(spreadX - f.size / 2),
              top: cover(FALL_TOP),
              width: cover(f.size),
              height: cover(f.size),
              animationDuration: `${fallDurationSec}s`,
              animationDelay: `${fallDelaySec}s`,
            }}
          >
            {/* Each animation gets its own layer — combining classes that
                each set the animation shorthand/longhand on one element would
                have one clobber the other instead of playing together. */}
            <div className="fruit-sprout h-full w-full">
              <div
                className={`h-full w-full ${spinLeft ? "fruit-spin-left" : "fruit-spin-right"}`}
                style={{
                  animationDuration: `${spinDurationSec}s`,
                  animationDelay: `${spinDelaySec}s`,
                }}
              >
                <div
                  className={`fruit-boil h-full w-full select-none ${FRUIT_BOIL_CLASS[f.kind]}`}
                  style={{ animationDuration: `${f.boilMs}ms` }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
