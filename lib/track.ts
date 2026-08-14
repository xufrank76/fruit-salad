export type Song = {
  // "songs" row id, seeded by scripts/seed.ts. Never guess this — it only
  // exists once seed.ts has printed it back for you to paste in below.
  id: string;
  // Picks this song in /record/[slug] and /listen/[slug]; local to this
  // file, never stored in the DB.
  slug: string;
  title: string;
  artist: string;
  audioUrl: string;
  lyricsUrl: string;
};

// Songs with audio + timestamped lyrics wired up — singable end-to-end via
// /record/<slug> and /listen/<slug>.
export const SONGS: Song[] = [
  {
    id: "cb47507f-53a0-487a-af6d-af2dd57cb964",
    slug: "beauty-and-a-beat",
    title: "Beauty and a Beat",
    artist: "Justin Bieber ft. Nicki Minaj",
    audioUrl:
      "/Justin%20Bieber%20-%20Beauty%20And%20A%20Beat%20ft.%20Nicki%20Minaj%20(Official%20Audio)%20ft.%20Nicki%20Minaj%20-%20Justin%20Bieber%20(128k).mp3",
    lyricsUrl: "/beautyandabeat.txt",
  },
  {
    id: "961cb3ff-35b0-4d6d-b3bd-f322dcf7b2c5",
    slug: "you-belong-with-me",
    title: "You Belong With Me",
    artist: "Taylor Swift",
    audioUrl: "/Taylor%20Swift%20-%20You%20Belong%20With%20Me.mp3",
    lyricsUrl: "/youbelongwithme.txt",
  },
  {
    id: "6b5a614a-d97b-4169-9be1-a6da04a6c252",
    slug: "risk-it-all",
    title: "Risk It All",
    artist: "Bruno Mars",
    audioUrl: "/Bruno%20Mars%20-%20Risk%20It%20All%20%5BThe%20Romantic%5D.mp3",
    lyricsUrl: "/riskitall.txt",
  },
  {
    id: "8b1a7463-5f1d-4a5e-af97-930b28988dcd",
    slug: "let-it-go",
    title: "Let It Go",
    artist: "Idina Menzel",
    audioUrl:
      "/Idina%20Menzel%20-%20Let%20It%20Go%20(From%20Frozen_Sing-Along).mp3",
    lyricsUrl: "/letitgo.txt",
  },
  {
    id: "c23d0cb9-47e4-4675-8fab-888a866ad86f",
    slug: "thank-u-next",
    title: "thank u, next",
    artist: "Ariana Grande",
    audioUrl:
      "/Ariana%20Grande%20-%20thank%20u%2C%20next%20(Official%20Lyric%20Video).mp3",
    lyricsUrl: "/thankunext.txt",
  },
  {
    id: "f46f9ab7-5ea2-456b-b32f-513b9111813a",
    slug: "clarity",
    title: "Clarity",
    artist: "Zedd",
    audioUrl: "/Zedd%20-%20Clarity%20(feat.%20Foxes).mp3",
    lyricsUrl: "/clarity.txt",
  },
  {
    id: "3250ed7f-54ad-40dc-beb2-3da906b3dbd5",
    slug: "birds-of-a-feather",
    title: "Birds of a Feather",
    artist: "Billie Eilish",
    audioUrl:
      "/Billie%20Eilish%20-%20BIRDS%20OF%20A%20FEATHER%20(Official%20Lyric%20Video).mp3",
    lyricsUrl: "/birdsofafeather.txt",
  },
];

// Falls back to the first song for the handful of places (bare /record,
// /listen redirects, the old unrouted /song prototype) that need *a* song
// without a slug in the URL to pick one.
export const DEFAULT_SONG = SONGS[0];

export function getSongBySlug(slug: string): Song | undefined {
  return SONGS.find((s) => s.slug === slug);
}

// Audio file + LRC-timestamped lyrics (see public/beautyandabeat.txt for the
// "[mm:ss.cc]line text" format) are ready in public/, but this song hasn't
// been seeded into the DB yet. Run `npx tsx scripts/seed.ts` — it seeds
// every entry here and prints a ready-to-paste Song (with the new row's id)
// for you to move up into SONGS above.
export const PENDING_SONGS: Omit<Song, "id">[] = [];

// The rest of the library — cover art only, no audio/lyrics prepped yet, so
// these render on the salad page but aren't singable like SONGS entries are.
// With no DB rows they have no real completion (0%). Once you've got a
// song's audio + timed lyrics ready, move its entry here into PENDING_SONGS.
export const OTHER_TRACKS: { title: string; artist: string }[] = [];
