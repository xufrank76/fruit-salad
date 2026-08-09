"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cover } from "../coverUnit";

export type CarouselTrack = {
  title: string;
  artist: string;
  coverUrl: string | null;
  completePercent: number;
  // Only TRACK has audio/lyrics wired up (see lib/track.ts) — everything
  // else can be browsed here but can't actually be recorded yet.
  singable: boolean;
};

const CARD_SIZE = 274;
const GAP = 16;
// Narrower than the card itself so only a sliver of the immediate neighbors
// peeks past the edges — the rest of the shelf is fully clipped until
// scrolled into view.
const VIEWPORT = 330;

// Coverflow falloff: each card's scale/opacity is a continuous function of
// its distance from the centered slot (in units of one card-width + gap),
// recomputed on every scroll event — so cards visibly size up approaching
// center and size down leaving it, instead of a binary center/not-center swap.
const MIN_SCALE = 0.42;
const MIN_OPACITY = 0.35;
const SCALE_FALLOFF = 0.3;
const OPACITY_FALLOFF = 0.35;

export default function AlbumCarousel({
  tracks,
  initialIndex = 0,
}: {
  tracks: CarouselTrack[];
  initialIndex?: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [centerIndex, setCenterIndex] = useState(initialIndex);
  const [metrics, setMetrics] = useState<{ scale: number; opacity: number }[]>(
    () =>
      tracks.map((_, i) => ({
        scale: i === initialIndex ? 1 : MIN_SCALE,
        opacity: i === initialIndex ? 1 : MIN_OPACITY,
      }))
  );

  const recompute = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const mid = el.scrollLeft + el.clientWidth / 2;
    const slot = CARD_SIZE + GAP;
    let closest = 0;
    let closestDist = Infinity;
    const next = cardRefs.current.map((card, i) => {
      if (!card) return { scale: MIN_SCALE, opacity: MIN_OPACITY };
      const cardMid = card.offsetLeft + card.offsetWidth / 2;
      const dist = Math.abs(cardMid - mid) / slot;
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
      return {
        scale: Math.max(MIN_SCALE, 1 - dist * SCALE_FALLOFF),
        opacity: Math.max(MIN_OPACITY, 1 - dist * OPACITY_FALLOFF),
      };
    });
    setMetrics(next);
    setCenterIndex(closest);
  }, []);

  // Open with the given track centered instead of the start of the shelf.
  useLayoutEffect(() => {
    cardRefs.current[initialIndex]?.scrollIntoView({
      inline: "center",
      block: "nearest",
    });
    recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", recompute, { passive: true });
    return () => el.removeEventListener("scroll", recompute);
  }, [recompute]);

  const centeredTrack = tracks[centerIndex];

  return (
    <div className="flex flex-col items-center" style={{ gap: cover(20) }}>
      <div
        ref={scrollRef}
        className="flex items-center snap-x snap-mandatory overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          width: cover(VIEWPORT),
          gap: cover(GAP),
          paddingLeft: cover((VIEWPORT - CARD_SIZE) / 2),
          paddingRight: cover((VIEWPORT - CARD_SIZE) / 2),
        }}
      >
        {tracks.map((track, i) => {
        const isCenter = i === centerIndex;
        const { scale, opacity } = metrics[i] ?? {
          scale: MIN_SCALE,
          opacity: MIN_OPACITY,
        };
        return (
          <div
            key={track.title}
            ref={(el) => {
              cardRefs.current[i] = el;
            }}
            className="relative flex shrink-0 snap-center items-end overflow-hidden rounded-[20px] bg-[#7a2020] shadow-xl"
            style={{
              width: cover(CARD_SIZE),
              height: cover(CARD_SIZE),
              transform: `scale(${scale})`,
              opacity,
            }}
          >
            {track.coverUrl ? (
              <Image
                src={track.coverUrl}
                alt=""
                fill
                className="object-cover"
                sizes="30vw"
              />
            ) : (
              <div
                className="absolute"
                style={{
                  inset: "-30%",
                  backgroundImage:
                    "radial-gradient(circle, rgba(255,239,220,0.5) 1.6px, transparent 1.6px)",
                  backgroundSize: "10px 10px",
                  transform: "rotate(45deg)",
                }}
              />
            )}
            {isCenter && (
              <>
                <div className="absolute inset-0 bg-gradient-to-br from-transparent to-black/40" />
                <div className="absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
                <div className="relative z-10 w-full" style={{ padding: cover(20) }}>
                  <p
                    className="font-display font-medium text-white"
                    style={{ fontSize: cover(24) }}
                  >
                    {track.title}
                  </p>
                  <p
                    className="font-display text-zinc-200"
                    style={{ fontSize: cover(16) }}
                  >
                    {track.artist}
                  </p>
                </div>
              </>
            )}
          </div>
        );
        })}
      </div>

      <div style={{ width: cover(239) }}>
        <p
          className="font-display text-center text-black dark:text-zinc-100"
          style={{ fontSize: cover(16) }}
        >
          {centeredTrack.completePercent}% complete
        </p>
        <div
          className="mt-1 w-full overflow-hidden rounded-[20px] bg-zinc-300 dark:bg-zinc-700"
          style={{ height: cover(5) }}
        >
          <div
            className="h-full rounded-[20px] bg-black dark:bg-white"
            style={{ width: `${centeredTrack.completePercent}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-center" style={{ gap: cover(20) }}>
        {centeredTrack.singable ? (
          <Link
            href="/record"
            className="font-display flex items-center justify-center border border-[rgba(253,137,2,0.2)] bg-[#ffefdc] text-black"
            style={{
              width: cover(182),
              height: cover(57),
              borderRadius: cover(20),
              gap: cover(8),
              fontSize: cover(24),
            }}
          >
            <span
              className="relative shrink-0"
              style={{ width: cover(47), height: cover(47) }}
            >
              <Image
                src="/fruit/apple-slice.png"
                alt=""
                fill
                draggable={false}
                className="select-none object-contain"
              />
            </span>
            add a fruit
          </Link>
        ) : (
          // Not TRACK — no audio/lyrics wired up for this song yet, so
          // there's nothing to record. Same shape, dimmed and inert.
          <span
            aria-disabled="true"
            className="font-display flex cursor-not-allowed items-center justify-center border border-[rgba(253,137,2,0.2)] bg-[#ffefdc] text-black opacity-40"
            style={{
              width: cover(182),
              height: cover(57),
              borderRadius: cover(20),
              gap: cover(8),
              fontSize: cover(24),
            }}
          >
            <span
              className="relative shrink-0"
              style={{ width: cover(47), height: cover(47) }}
            >
              <Image
                src="/fruit/apple-slice.png"
                alt=""
                fill
                draggable={false}
                className="select-none object-contain"
              />
            </span>
            add a fruit
          </span>
        )}

        {/* No read-path against assembled takes yet (see README schema) —
            disabled everywhere until that's wired up. */}
        <span
          aria-disabled="true"
          className="font-display flex cursor-not-allowed items-center justify-center border border-[#ffefdc] bg-white text-black opacity-40 dark:bg-zinc-900 dark:text-zinc-50"
          style={{
            width: cover(182),
            height: cover(57),
            borderRadius: cover(20),
            fontSize: cover(24),
          }}
        >
          hear the salad
        </span>
      </div>
    </div>
  );
}
