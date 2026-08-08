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
    writeFileSync(t.out, data.syncedLyrics.trimEnd() + "\n");
    const count = data.syncedLyrics.trim().split("\n").length;
    console.log(`✓ ${t.title}: ${count} timed lines → ${t.out}`);
  } catch (e) {
    console.error(`✗ ${t.title}: ${e.message}`);
  }
}
