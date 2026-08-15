import AlbumCarousel from "./AlbumCarousel";
import { fetchAlbumArtwork } from "@/lib/itunes";
import { DEFAULT_SONG, OTHER_TRACKS, SONGS } from "@/lib/track";
import { supabaseServer } from "@/lib/supabase-server";
import { CANVAS_HEIGHT, CANVAS_WIDTH, cover } from "../coverUnit";
import FruitField from "../FruitField";

// Live completion, not a cached snapshot — recompute per request so the shelf
// reflects real progress. (Album art fetches keep their own 1-day cache.)
export const dynamic = "force-dynamic";

type Progress = { percent: number; voices: number };
const NO_PROGRESS: Progress = { percent: 0, voices: 0 };

// Real completion = distinct lines with a take / total lines, plus how many
// distinct singers contributed those takes, for the song's current public
// rendition. Read-only (never creates a rendition); zeroed on any error.
async function getProgress(songId: string): Promise<Progress> {
  try {
    const { data: lines } = await supabaseServer
      .from("lines")
      .select("id")
      .eq("song_id", songId);
    const total = lines?.length ?? 0;
    if (total === 0) return NO_PROGRESS;

    // The current, still-open rendition — same lookup as GET
    // /api/renditions/[songId]. A song can have both a sealed rendition and
    // a fresh one going at once (see auto-restart), so this must exclude
    // completed ones instead of assuming at most one public row exists.
    const { data: renditions } = await supabaseServer
      .from("renditions")
      .select("id")
      .eq("song_id", songId)
      .eq("mode", "public")
      .neq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1);
    const rendition = renditions?.[0];
    if (!rendition) return NO_PROGRESS;

    const { data: takes } = await supabaseServer
      .from("takes")
      .select("line_id, singer_name, device_id")
      .eq("rendition_id", rendition.id);
    const takenLineIds = new Set((takes ?? []).map((t) => t.line_id));
    // Anonymous takes are deduped by device_id (one per browser) rather than
    // the shared "Anonymous" label, so distinct unnamed singers still count
    // separately. Rows from before device_id existed fall back to the old
    // shared bucket.
    const voices = new Set(
      (takes ?? []).map((t) => t.singer_name || t.device_id || "Anonymous")
    );
    return {
      percent: Math.round((takenLineIds.size / total) * 100),
      voices: voices.size,
    };
  } catch {
    return NO_PROGRESS;
  }
}

// How many times this song has been fully sung already (sealed renditions —
// see POST /api/takes) — drives the "past salads" link on its card. 0 on any
// error so the card just omits the link instead of crashing.
async function getPastSaladsCount(songId: string): Promise<number> {
  try {
    const { count } = await supabaseServer
      .from("renditions")
      .select("id", { count: "exact", head: true })
      .eq("song_id", songId)
      .eq("status", "completed");
    return count ?? 0;
  } catch {
    return 0;
  }
}

export default async function SaladPage() {
  // Licensed-for-display artwork via Apple's iTunes Search API (lib/itunes.ts)
  // — falls back to the generated halftone pattern below if the lookup fails.
  const [songProgress, pastSaladsCounts, songCoverUrls, otherCoverUrls] =
    await Promise.all([
      Promise.all(SONGS.map((s) => getProgress(s.id))),
      Promise.all(SONGS.map((s) => getPastSaladsCount(s.id))),
      Promise.all(SONGS.map((s) => fetchAlbumArtwork(s.artist, s.title))),
      Promise.all(OTHER_TRACKS.map((t) => fetchAlbumArtwork(t.artist, t.title))),
    ]);

  const songTracksAll = SONGS.map((s, i) => ({
    title: s.title,
    artist: s.artist,
    coverUrl: songCoverUrls[i],
    completePercent: songProgress[i].percent, // real: recorded lines / total lines
    voices: songProgress[i].voices,
    singable: true,
    slug: s.slug,
    pastSalads: pastSaladsCounts[i],
  }));

  // Keep the default song centered in the shelf (not wherever it happens to
  // sit in SONGS) — same spot the original single-TRACK layout always gave
  // it, with the rest of the singable songs split evenly around it.
  const defaultIdx = songTracksAll.findIndex((t) => t.slug === DEFAULT_SONG.slug);
  const defaultTrack = songTracksAll[defaultIdx];
  const restSongTracks = songTracksAll.filter((_, i) => i !== defaultIdx);
  const songSplitAt = Math.ceil(restSongTracks.length / 2);
  const songTracks = [
    ...restSongTracks.slice(0, songSplitAt),
    defaultTrack,
    ...restSongTracks.slice(songSplitAt),
  ];

  // The singable songs sit in the middle of the shelf (not at an end) so
  // there's something to scroll to on both sides.
  const otherTracks = OTHER_TRACKS.map((t, i) => ({
    title: t.title,
    artist: t.artist,
    coverUrl: otherCoverUrls[i],
    completePercent: 0, // no DB rows -> genuinely nothing recorded yet
    singable: false,
  }));
  const otherSplitAt = Math.ceil(otherTracks.length / 2);
  const carouselTracks = [
    ...otherTracks.slice(0, otherSplitAt),
    ...songTracks,
    ...otherTracks.slice(otherSplitAt),
  ];
  const trackIndex = otherSplitAt + songSplitAt;

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

        {/* Card + progress + button row share one flex column so later blocks
            always sit below the card's actual rendered height, not a fixed
            coordinate. */}
        <div
          className="absolute left-1/2 flex -translate-x-1/2 flex-col items-center"
          style={{ top: cover(243), gap: cover(20) }}
        >
          {/* Horizontally scrollable shelf of the whole library — the
              singable SONGS start centered, the rest peek at the edges and
              are fully hidden past that until scrolled into view. Only the
              centered card shows its title/artist (see AlbumCarousel). */}
          <AlbumCarousel tracks={carouselTracks} initialIndex={trackIndex} />
        </div>
      </div>

      <p className="font-display pointer-events-none absolute bottom-6 right-6 text-5xl font-medium text-black sm:text-6xl md:text-7xl lg:text-8xl dark:text-zinc-50">
        fruit salad
      </p>
    </div>
  );
}
