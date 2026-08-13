// The one song wired up so far, for testing the private "sing along" flow.
export const TRACK = {
  // "songs" row seeded by scripts/seed.ts for this track.
  id: "cb47507f-53a0-487a-af6d-af2dd57cb964",
  title: "Beauty and a Beat",
  artist: "Justin Bieber ft. Nicki Minaj",
  audioUrl:
    "/Justin%20Bieber%20-%20Beauty%20And%20A%20Beat%20ft.%20Nicki%20Minaj%20(Official%20Audio)%20ft.%20Nicki%20Minaj%20-%20Justin%20Bieber%20(128k).mp3",
  lyricsUrl: "/beautyandabeat.txt",
};

// The rest of the library — cover art only, no audio/lyrics wired up yet, so
// these render on the salad page but aren't singable like TRACK is. With no
// DB rows they have no real completion (0%).
export const OTHER_TRACKS: { title: string; artist: string }[] = [
  { title: "Risk It All", artist: "Bruno Mars" },
  { title: "thank u, next", artist: "Ariana Grande" },
  { title: "One Dance", artist: "Drake" },
  { title: "You Belong With Me", artist: "Taylor Swift" },
  { title: "Let It Go", artist: "Idina Menzel" },
  { title: "Clarity", artist: "Zedd" },
  { title: "Birds of a Feather", artist: "Billie Eilish" },
];
