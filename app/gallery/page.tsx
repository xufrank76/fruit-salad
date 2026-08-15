import { ArrowLeft } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { fetchAlbumArtwork } from "@/lib/itunes";
import { getSongBySlug, SONGS, type Song } from "@/lib/track";
import { supabaseServer } from "@/lib/supabase-server";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "../coverUnit";
import FruitField from "../FruitField";

// Live, not a cached snapshot — recompute per request so a rendition that
// just sealed shows up here right away.
export const dynamic = "force-dynamic";

type CompletedRendition = {
  id: string;
  completedAt: string;
  contributorCount: number;
};

// Every sealed (fully-sung) rendition of a song, newest first, with how many
// distinct singers filled it in — a rendition gets sealed the moment its
// last open line is recorded (see POST /api/takes). Read-only, never creates
// anything; empty on any error (including completed_at not existing yet,
// pre-migration) so the page just shows its empty state instead of crashing.
async function getCompletedRenditions(songId: string): Promise<CompletedRendition[]> {
  try {
    const { data: renditions } = await supabaseServer
      .from("renditions")
      .select("id, completed_at")
      .eq("song_id", songId)
      .eq("status", "completed")
      .order("completed_at", { ascending: false });
    const sealed = (renditions ?? []).filter((r) => r.completed_at);
    if (sealed.length === 0) return [];

    const { data: takes } = await supabaseServer
      .from("takes")
      .select("rendition_id, singer_name, device_id")
      .in("rendition_id", sealed.map((r) => r.id));
    const singersByRendition = new Map<string, Set<string>>();
    for (const t of takes ?? []) {
      const set = singersByRendition.get(t.rendition_id) ?? new Set<string>();
      // See salad/page.tsx: dedupe anonymous takes by device_id, not the
      // shared "Anonymous" label, so distinct unnamed singers still count.
      set.add(t.singer_name || t.device_id || "Anonymous");
      singersByRendition.set(t.rendition_id, set);
    }

    return sealed.map((r) => ({
      id: r.id,
      completedAt: r.completed_at as string,
      contributorCount: singersByRendition.get(r.id)?.size ?? 0,
    }));
  } catch {
    return [];
  }
}

type GalleryEntry = CompletedRendition & { song: Song; coverUrl: string | null };

export default async function GalleryPage({
  searchParams,
}: {
  searchParams: Promise<{ song?: string }>;
}) {
  // ?song=<slug> (from the carousel's per-song "N past salads" link) narrows
  // this to just that song instead of the whole library's feed.
  const { song: songSlug } = await searchParams;
  const filteredSong = songSlug ? getSongBySlug(songSlug) : undefined;
  const songs = filteredSong ? [filteredSong] : SONGS;

  // Every song in scope can have its own completed renditions, so gather
  // each one's list + cover art, then merge into one newest-first feed.
  const perSong = await Promise.all(
    songs.map(async (song) => {
      const [renditions, coverUrl] = await Promise.all([
        getCompletedRenditions(song.id),
        fetchAlbumArtwork(song.artist, song.title),
      ]);
      return renditions.map((r): GalleryEntry => ({ ...r, song, coverUrl }));
    })
  );
  const completed = perSong
    .flat()
    .sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1));

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-white dark:bg-black">
      {/* Decorative background only, kept on the app's fixed 1280x832 canvas
          (matching FruitField's own layout); the interactive content below
          uses plain responsive Tailwind so an arbitrarily long, scrollable
          grid works correctly on any screen size, portrait phones included. */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
        >
          <div className="opacity-10">
            <FruitField />
          </div>
        </div>
      </div>

      <div className="relative z-10 flex h-full w-full flex-col">
        <div className="flex items-center gap-3 px-4 pt-5 sm:px-8 sm:pt-6">
          <Link href="/salad" className="shrink-0 text-black dark:text-zinc-100">
            <ArrowLeft className="h-5 w-5 sm:h-6 sm:w-6" />
          </Link>
          <p className="font-display text-xl font-medium text-black dark:text-zinc-100 sm:text-2xl">
            {filteredSong ? `past salads of ${filteredSong.title}` : "salads"}
          </p>
        </div>

        {completed.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="font-display text-2xl font-medium text-black dark:text-zinc-50">
              no finished salads yet
            </p>
            <p className="font-display max-w-xs text-base text-zinc-500 dark:text-zinc-400">
              once every line of a song is sung by someone, it&apos;ll show up
              here.
            </p>
            <Link
              href={filteredSong ? `/record/${filteredSong.slug}` : "/salad"}
              className="font-display mt-2 rounded-[20px] border border-[rgba(253,137,2,0.2)] bg-[#ffefdc] px-6 py-3 text-base text-black"
            >
              go sing something
            </Link>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
            <div className="flex max-w-4xl flex-wrap gap-4 sm:gap-6">
              {completed.map((r) => (
                <Link
                  key={r.id}
                  href={`/listen/${r.song.slug}?rendition=${r.id}`}
                  className="group flex w-36 flex-col gap-2 sm:w-44"
                >
                  <div className="relative aspect-square w-full overflow-hidden rounded-[20px] bg-[#7a2020] shadow-lg transition-transform group-hover:scale-[1.02]">
                    {r.coverUrl ? (
                      <Image
                        src={r.coverUrl}
                        alt=""
                        fill
                        className="object-cover"
                        sizes="25vw"
                      />
                    ) : (
                      <div
                        className="absolute inset-0"
                        style={{
                          backgroundImage:
                            "radial-gradient(circle, rgba(255,239,220,0.5) 1.6px, transparent 1.6px)",
                          backgroundSize: "10px 10px",
                        }}
                      />
                    )}
                  </div>
                  <div className="font-display px-1">
                    <p className="truncate text-sm font-medium text-black dark:text-zinc-50">
                      {r.song.title}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      completed{" "}
                      {new Date(r.completedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {r.contributorCount === 1
                        ? "1 voice"
                        : `${r.contributorCount} voices`}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="font-display pointer-events-none absolute bottom-6 right-6 text-5xl font-medium text-black sm:text-6xl md:text-7xl lg:text-8xl dark:text-zinc-50">
        fruit salad
      </p>
    </div>
  );
}
