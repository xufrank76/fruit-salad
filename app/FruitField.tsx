import { cover } from "./coverUnit";

// Each kind cycles between two redraws of itself (see globals.css'
// boil-* keyframes) for a hand-drawn stop-motion wobble instead of a smooth
// tween.
export const FRUIT_BOIL_CLASS = {
  apple: "boil-apple",
  blueberry: "boil-blueberry",
  lemon: "boil-lemon",
  orange: "boil-orange",
  pear: "boil-pear",
};

export type FruitKind = keyof typeof FRUIT_BOIL_CLASS;

// Scattered decorative fruit illustrations from the Figma homepage design
// (node 56:157). x/y/size are the design's raw px values (from get_design_context,
// which already accounts for each rotated wrapper's bounding box) — scaled
// uniformly at render time via cover(), not stretched per-axis. Purely
// decorative, so edge-cropping under cover scaling is expected/fine.
const FRUITS: {
  kind: FruitKind;
  x: number;
  y: number;
  size: number;
  rotateDeg: number;
}[] = [
  { kind: "blueberry", x: 1146.88, y: 708.88, size: 187.267, rotateDeg: -8.85 },
  { kind: "orange", x: 559, y: -5, size: 221.985, rotateDeg: -10.7 },
  { kind: "orange", x: 954, y: 240, size: 234.143, rotateDeg: 15.62 },
  { kind: "lemon", x: 758, y: 427, size: 195, rotateDeg: 0 },
  { kind: "lemon", x: -50, y: 643, size: 195, rotateDeg: 0 },
  { kind: "lemon", x: 145, y: -70, size: 195, rotateDeg: 0 },
  { kind: "pear", x: 376.89, y: 120.89, size: 216.21, rotateDeg: 8.58 },
  { kind: "pear", x: -106, y: 6, size: 216.21, rotateDeg: 8.58 },
  { kind: "pear", x: 892, y: 0, size: 221.77, rotateDeg: -10.62 },
  { kind: "pear", x: 652.96, y: 621.96, size: 216.079, rotateDeg: -8.53 },
  { kind: "blueberry", x: 485, y: 525, size: 164, rotateDeg: 0 },
  { kind: "orange", x: 200, y: 499, size: 190, rotateDeg: 0 },
  { kind: "blueberry", x: 774, y: 153, size: 183.018, rotateDeg: 7.1 },
  { kind: "blueberry", x: 364, y: -128, size: 198.426, rotateDeg: -13.82 },
  { kind: "blueberry", x: -78, y: 382, size: 183.018, rotateDeg: 7.1 },
  { kind: "apple", x: 86, y: 223, size: 193, rotateDeg: 0 },
  { kind: "apple", x: 1134, y: -5, size: 197.897, rotateDeg: -1.47 },
  { kind: "apple", x: 1014.31, y: 501.31, size: 222.39, rotateDeg: 9.57 },
  { kind: "apple", x: 303.66, y: 693.66, size: 219.078, rotateDeg: -8.38 },
];

export default function FruitField() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {FRUITS.map((fruit, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left: cover(fruit.x),
            top: cover(fruit.y),
            width: cover(fruit.size),
            height: cover(fruit.size),
            transform: `rotate(${fruit.rotateDeg}deg)`,
          }}
        >
          <div
            className={`fruit-boil h-full w-full select-none ${FRUIT_BOIL_CLASS[fruit.kind]}`}
            style={{
              // Deterministic per-instance stagger (not Math.random(), which
              // would mismatch between server and client render) so same-kind
              // fruits don't all wobble in lockstep.
              animationDuration: `${800 + ((i * 173) % 500)}ms`,
              animationDelay: `-${(i * 211) % 900}ms`,
            }}
          />
        </div>
      ))}
    </div>
  );
}
