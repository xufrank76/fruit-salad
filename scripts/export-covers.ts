// One-off export of album cover art for the hackathon track (feeding covers
// into Reve). Not part of the app's runtime — run manually with:
//   npx tsx scripts/export-covers.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchAlbumArtwork } from "../lib/itunes";

const SONGS: { artist: string; track: string }[] = [
  { artist: "Justin Bieber", track: "Beauty and a Beat" },
  { artist: "Bruno Mars", track: "Risk It All" },
  { artist: "Ariana Grande", track: "thank u, next" },
  { artist: "Drake", track: "One Dance" },
  { artist: "Taylor Swift", track: "You Belong With Me" },
  { artist: "Idina Menzel", track: "Let It Go" },
  { artist: "The Jackson 5", track: "I Want You Back" },
];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function main() {
  const outDir = join(process.cwd(), "exports", "album-covers");
  mkdirSync(outDir, { recursive: true });

  for (const { artist, track } of SONGS) {
    const url = await fetchAlbumArtwork(artist, track, 3000);
    if (!url) {
      console.error(`No artwork found for ${artist} - ${track}`);
      continue;
    }
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Failed to download ${url} (${res.status})`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = url.match(/\.(jpg|jpeg|png)$/i)?.[1] ?? "jpg";
    const filename = `${slugify(artist)}-${slugify(track)}.${ext}`;
    writeFileSync(join(outDir, filename), buf);
    console.log(`Saved ${filename} (${(buf.length / 1024).toFixed(0)} KB) from ${url}`);
  }

  console.log(`\nDone. Files in ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
