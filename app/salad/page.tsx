import Image from "next/image";
import Link from "next/link";
import AlbumCarousel from "./AlbumCarousel";
import { fetchAlbumArtwork } from "@/lib/itunes";
import { OTHER_TRACKS, TRACK } from "@/lib/track";
import { supabaseServer } from "@/lib/supabase-server";
import { CANVAS_HEIGHT, CANVAS_WIDTH, cover } from "../coverUnit";
import FruitField from "../FruitField";

// Live completion, not a cached snapshot — recompute per request so the shelf
// reflects real progress. (Album art fetches keep their own 1-day cache.)
export const dynamic = "force-dynamic";

// Real completion = distinct lines with a take / total lines, for the song's
// public rendition. Read-only (never creates a rendition); 0 if none/error.
async function getCompletion(songId: string): Promise<number> {
  try {
    const { data: lines } = await supabaseServer
      .from("lines")
      .select("id")
      .eq("song_id", songId);
    const total = lines?.length ?? 0;
    if (total === 0) return 0;

    const { data: rendition } = await supabaseServer
      .from("renditions")
      .select("id")
      .eq("song_id", songId)
      .eq("mode", "public")
      .maybeSingle();
    if (!rendition) return 0;

    const { data: takes } = await supabaseServer
      .from("takes")
      .select("line_id")
      .eq("rendition_id", rendition.id);
    const takenLineIds = new Set((takes ?? []).map((t) => t.line_id));
    return Math.round((takenLineIds.size / total) * 100);
  } catch {
    return 0;
  }
}

export default async function SaladPage() {
  const trackCompletion = await getCompletion(TRACK.id);

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
    completePercent: 0, // no DB rows -> genuinely nothing recorded yet
    singable: false,
  }));
  const splitAt = Math.ceil(otherTracks.length / 2);
  const carouselTracks = [
    ...otherTracks.slice(0, splitAt),
    {
      title: TRACK.title,
      artist: TRACK.artist,
      coverUrl,
      completePercent: trackCompletion, // real: recorded lines / total lines
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
        {/* Same decorative field as the homepage, dimmed so it stays
            background texture instead of competing with this page's content. */}
        <div className="opacity-10">
          <FruitField />
        </div>

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
