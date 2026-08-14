// Fetch synced (LRC) lyrics from LRCLIB and cache them into public/ as each
// song's lyrics file. LRC lines look like "[00:12.34]words"; the app parses
// the timestamps to know when each line starts (lib/lyrics.ts).
//
// Run: node scripts/fetch-lyrics.mjs
// LRCLIB is a free, keyless, community lyrics DB. Coverage is crowdsourced,
// so a miss here just means fall back to manual timing for that track.
import { writeFileSync } from "node:fs";

const TRACKS = [
  {
    out: "public/beautyandabeat.txt",
    artist: "Justin Bieber",
    title: "Beauty and a Beat",
    durationSec: 228,
  },
  {
    out: "public/youbelongwithme.txt",
    artist: "Taylor Swift",
    title: "You Belong With Me",
    durationSec: 228,
  },
  {
    out: "public/riskitall.txt",
    artist: "Bruno Mars",
    title: "Risk It All",
    durationSec: 205,
  },
  {
    out: "public/letitgo.txt",
    artist: "Idina Menzel",
    title: "Let It Go",
    durationSec: 224,
  },
  {
    out: "public/thankunext.txt",
    artist: "Ariana Grande",
    title: "thank u, next",
    durationSec: 207,
  },
  {
    out: "public/clarity.txt",
    artist: "Zedd",
    title: "Clarity",
    durationSec: 271,
  },
  {
    out: "public/birdsofafeather.txt",
    artist: "Billie Eilish",
    title: "Birds of a Feather",
    durationSec: 210,
  },
];

for (const t of TRACKS) {
  const url =
    `https://lrclib.net/api/get?artist_name=${encodeURIComponent(t.artist)}` +
    `&track_name=${encodeURIComponent(t.title)}&duration=${t.durationSec}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "fruit-salad (hackathon prototype)" },
    });
    if (!res.ok) {
      console.error(`✗ ${t.title}: HTTP ${res.status}`);
      continue;
    }
    const data = await res.json();
    if (!data.syncedLyrics) {
      console.error(`✗ ${t.title}: no synced lyrics in LRCLIB`);
      continue;
    }
    // LRCLIB marks instrumental breaks as a bare timestamp with no words
    // (e.g. "[01:07.56] ") — drop those, or they'd show up as blank,
    // singable rows in the app.
    const lines = data.syncedLyrics
      .split(/\r?\n/)
      .filter((line) => /^\[\d+:\d+(?:\.\d+)?\]\s*\S/.test(line));
    writeFileSync(t.out, lines.join("\n") + "\n");
    console.log(`✓ ${t.title}: ${lines.length} timed lines → ${t.out}`);
  } catch (e) {
    console.error(`✗ ${t.title}: ${e.message}`);
  }
}
