import Image from "next/image";
import Link from "next/link";
import { CANVAS_HEIGHT, CANVAS_WIDTH, cover } from "../coverUnit";
import FruitField from "../FruitField";

// No renditions/gallery data exists yet (see README's `renditions` table —
// nothing writes to it until a song's lines are fully sung and assembled).
// This is a placeholder shell for that view, not real data.

export default function GalleryPage() {
  return (
    <div className="relative h-dvh w-full overflow-hidden bg-white dark:bg-black">
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
      >
        {/* Same decorative field as the homepage, dimmed so it stays
            background texture instead of competing with this page's content. */}
        <div className="opacity-10">
          <FruitField />
        </div>

        <div
          className="font-display absolute flex items-end"
          style={{ left: cover(11), top: cover(20), gap: cover(64) }}
        >
          <Link
            href="/salad"
            className="text-zinc-400 dark:text-zinc-600"
            style={{ fontSize: cover(24) }}
          >
            sing
          </Link>
          <span
            className="relative shrink-0"
            style={{ width: cover(27), height: cover(27) }}
          >
            <Image
              src="/fruit/orange-slice.png"
              alt=""
              fill
              draggable={false}
              className="select-none object-contain"
            />
          </span>
          <Link
            href="/gallery"
            className="font-medium text-black dark:text-zinc-100"
            style={{ fontSize: cover(24) }}
          >
            salads
          </Link>
        </div>

        <div
          className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center"
          style={{ gap: cover(8) }}
        >
          <p
            className="font-display font-medium text-black dark:text-zinc-50"
            style={{ fontSize: cover(24) }}
          >
            no finished salads yet
          </p>
          <p
            className="font-display max-w-xs text-zinc-500 dark:text-zinc-400"
            style={{ fontSize: cover(16) }}
          >
            once every line of a song is sung by someone, it&apos;ll show up here.
          </p>
          <Link
            href="/salad"
            className="font-display mt-2 rounded-[20px] border border-[rgba(253,137,2,0.2)] bg-[#ffefdc] text-black"
            style={{
              paddingLeft: cover(24),
              paddingRight: cover(24),
              paddingTop: cover(12),
              paddingBottom: cover(12),
              fontSize: cover(16),
            }}
          >
            go sing something
          </Link>
        </div>
      </div>

      <p className="font-display pointer-events-none absolute bottom-6 right-6 text-5xl font-medium text-black sm:text-6xl md:text-7xl lg:text-8xl dark:text-zinc-50">
        fruit salad
      </p>
    </div>
  );
}
