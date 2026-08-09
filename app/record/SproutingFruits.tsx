"use client";

import { FRUIT_BOIL_CLASS, type FruitKind } from "../FruitField";
import { cover } from "../coverUnit";

// A single decorative fruit "sprouted" into the record-page background when a
// line is contributed. Positions/sizes are raw design-canvas px (1280x832),
// scaled by cover() at render — matching FruitField. Edge bleed is intentional.
export type SproutedFruit = {
  id: number;
  kind: FruitKind;
  x: number;
  y: number;
  size: number;
  rotateDeg: number;
  boilMs: number;
};

const KINDS = Object.keys(FRUIT_BOIL_CLASS) as FruitKind[];

// Client-only (called from an event handler, never during render) so Math.random
// here can't cause a server/client hydration mismatch.
export function randomFruit(id: number): SproutedFruit {
  return {
    id,
    kind: KINDS[Math.floor(Math.random() * KINDS.length)],
    x: Math.random() * 1360 - 120, // allow bleed past both edges
    y: Math.random() * 912 - 120,
    size: 130 + Math.random() * 110,
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
            left: cover(f.x),
            top: cover(f.y),
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
