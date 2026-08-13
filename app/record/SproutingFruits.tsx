"use client";

import { FRUIT_BOIL_CLASS, type FruitKind } from "../FruitField";
import { cover } from "../coverUnit";

// A single decorative fruit "sprouted" into the record-page background when a
// line is contributed. x/y are the fruit's CENTER, raw design-canvas px
// (1280x832), scaled by cover() at render — matching FruitField. Unlike
// FruitField's ambient scatter, these are placed deliberately (one per line
// slot) so they stay clear of the true canvas edges: the page's cover()
// scaling crops the canvas top/bottom (or left/right) to fill wide/narrow
// viewports, and anything placed near an edge can end up entirely off-screen.
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
// and can land the same kind in adjacent slots) so consecutive fruits always
// read as a varied sequence instead of clustering by chance.
const KIND_ORDER: FruitKind[] = ["apple", "orange", "lemon", "pear", "blueberry"];

// Predetermined placement area fruits fill through, bottom row to top row, as
// lines of the song get filled. Kept well inside the 1280x832 design canvas
// (not flush with the true edges) so slots stay visible even when cover()
// scaling crops the canvas edges on wide/narrow viewports.
const X_MARGIN = 80;
const Y_BOTTOM = 652;
const USABLE_W = 1280 - X_MARGIN * 2;

// Same size range and density as FruitField's own scattered fruit (see
// ../FruitField.tsx's FRUITS list — sizes ~164-234px, packed loosely enough
// to overlap). This field is meant to read as more of that same background,
// not a separate tidy non-overlapping layout.
const SIZE_MIN = 160;
const SIZE_MAX = 235;
const GRID_COLS = 5;
const ROW_HEIGHT = 150;

// Client-only (called from an event handler, never during render) so Math.random
// here can't cause a server/client hydration mismatch.
//
// `index` places this fruit in a fixed bottom-to-top grid: slot 0 (the first
// line filled) sits in the bottom-left cell, later slots snake left-to-right
// then right-to-left up through the rows. Rows wrap back to the bottom once
// the song has filled more lines than fit on screen at this size — like a
// bowl piling fruit on top of itself once full, matching how densely
// FruitField's own fruits already overlap.
export function slotFruit(id: number, index: number): SproutedFruit {
  const cellW = USABLE_W / GRID_COLS;
  const rowIndex = Math.floor(index / GRID_COLS);
  const row = rowIndex % Math.max(1, Math.floor((Y_BOTTOM - 60) / ROW_HEIGHT));
  const rawCol = index % GRID_COLS;
  const col = rowIndex % 2 === 0 ? rawCol : GRID_COLS - 1 - rawCol; // snake for a nicer fill order

  const cx = X_MARGIN + col * cellW + cellW / 2;
  const cy = Y_BOTTOM - row * ROW_HEIGHT;

  const size = SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN);
  const jitterX = (cellW / 2) * 0.5 * (Math.random() * 2 - 1);
  const jitterY = (ROW_HEIGHT / 2) * 0.5 * (Math.random() * 2 - 1);

  return {
    id,
    kind: KIND_ORDER[index % KIND_ORDER.length],
    x: cx + jitterX,
    y: cy + jitterY,
    size,
    rotateDeg: Math.random() * 30 - 15,
    boilMs: 800 + Math.random() * 500,
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
