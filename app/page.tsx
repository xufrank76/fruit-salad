import Link from "next/link";
import { CANVAS_HEIGHT, CANVAS_WIDTH, cover } from "./coverUnit";
import FruitField from "./FruitField";

export default function Home() {
  return (
    <div className="relative h-dvh w-full overflow-hidden bg-white dark:bg-black">
      {/* Fixed 1280x832 design canvas, scaled uniformly ("cover") to fill the
          viewport with no letterbox margins, cropping whichever axis has
          extra scale — same treatment as the fruit bleed at the frame edges. */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
      >
        <FruitField />

        <p
          className="font-display absolute font-medium leading-none whitespace-nowrap text-black dark:text-zinc-100"
          style={{ left: cover(485), top: cover(374), fontSize: cover(24) }}
        >
          add a fruit, hear the fruit salad.
        </p>

        <Link
          href="/salad"
          className="font-display absolute flex items-center justify-center whitespace-nowrap border border-[rgba(253,137,2,0.2)] bg-[#ffefdc] font-normal text-black"
          style={{
            left: cover(514),
            top: cover(417),
            width: cover(247),
            height: cover(57),
            borderRadius: cover(20),
            fontSize: cover(24),
          }}
        >
          sing with strangers &rarr;
        </Link>
      </div>

      {/* Pinned to the real viewport corner, outside the cover-scaled canvas —
          on a window shape far from 1280:832, cover crops more off the canvas
          than any margin inside it can compensate for. This guarantees the
          wordmark is always visible regardless of window aspect ratio. */}
      <p className="font-display pointer-events-none absolute bottom-6 right-6 text-5xl font-medium text-black sm:text-6xl md:text-7xl lg:text-8xl dark:text-zinc-50">
        fruit salad
      </p>
    </div>
  );
}
