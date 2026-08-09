import Image from "next/image";
import Link from "next/link";
import AlbumCarousel from "./AlbumCarousel";
import { fetchAlbumArtwork } from "@/lib/itunes";
import { mockCompletionFor, OTHER_TRACKS, TRACK } from "@/lib/track";
import { CANVAS_HEIGHT, CANVAS_WIDTH, cover } from "../coverUnit";

export default async function SaladPage() {
  // Licensed-for-display artwork via Apple's iTunes Search API (lib/itunes.ts)
  // — falls back to the generated halftone pattern below if the lookup fails.
  const coverUrl = await fetchAlbumArtwork(TRACK.artist, TRACK.title);
  const otherCoverUrls = await Promise.all(
    OTHER_TRACKS.map((t) => fetchAlbumArtwork(t.artist, t.title))
  );

  // TRACK sits in the middle of the shelf (not at an end) so there's
  // something to scroll to on both sides.
  const otherTracks = OTHER_TRACKS.map((t, i) => ({
    title: t.title,
    artist: t.artist,
    coverUrl: otherCoverUrls[i],
    completePercent: mockCompletionFor(t.title),
    singable: false,
  }));
  const splitAt = Math.ceil(otherTracks.length / 2);
  const carouselTracks = [
    ...otherTracks.slice(0, splitAt),
    {
      title: TRACK.title,
      artist: TRACK.artist,
      coverUrl,
      completePercent: mockCompletionFor(TRACK.title),
      singable: true,
    },
    ...otherTracks.slice(splitAt),
  ];
  const trackIndex = splitAt;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-white dark:bg-black">
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
      >
        <div
          className="font-display absolute flex items-end"
          style={{ left: cover(11), top: cover(20), gap: cover(64) }}
        >
          {/* "sing" -> this song-picker flow, "salads" -> the gallery of
              finished collaborative songs. Active tab is bold/black, inactive
              is muted — hardcoded per-page since each tab is its own route. */}
          <Link
            href="/salad"
            className="font-medium text-black dark:text-zinc-100"
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
            className="text-zinc-400 dark:text-zinc-600"
            style={{ fontSize: cover(24) }}
          >
            salads
          </Link>
        </div>

        {/* Card + progress + button row share one flex column so later blocks
            always sit below the card's actual rendered height, not a fixed
            coordinate. */}
        <div
          className="absolute left-1/2 flex -translate-x-1/2 flex-col items-center"
          style={{ top: cover(243), gap: cover(20) }}
        >
          {/* Horizontally scrollable shelf of the whole library — TRACK
              starts centered, the rest peek at the edges and are fully
              hidden past that until scrolled into view. Only the centered
              card shows its title/artist (see AlbumCarousel). */}
          <AlbumCarousel tracks={carouselTracks} initialIndex={trackIndex} />
        </div>
      </div>

      <p className="font-display pointer-events-none absolute bottom-6 right-6 text-5xl font-medium text-black sm:text-6xl md:text-7xl lg:text-8xl dark:text-zinc-50">
        fruit salad
      </p>
    </div>
  );
}
