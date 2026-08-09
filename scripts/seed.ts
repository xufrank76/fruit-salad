import { config } from 'dotenv'
config({ path: '.env.local' })
console.log('URL loaded as:', process.env.NEXT_PUBLIC_SUPABASE_URL)

// Seed the Supabase "songs" and "lines" tables from the one hardcoded track
// (lib/track.ts + public/beautyandabeat.txt) so the DB has something to
// query while the real ingestion flow (README "Prepping the song library")
// isn't built yet.
//
// Run: npx tsx scripts/seed.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLyrics } from "../lib/lyrics";
import { TRACK } from "../lib/track";

async function main() {
  const { supabaseServer } = await import("../lib/supabase-server");
  const lyricsPath = join(process.cwd(), "public", "beautyandabeat.txt");
  const lyricsText = readFileSync(lyricsPath, "utf-8");
  const lyrics = parseLyrics(lyricsText);

  if (lyrics.some((l) => l.timeMs == null)) {
    throw new Error(`${lyricsPath} has untimed lines; every line needs an LRC timestamp to seed start_ms/end_ms.`);
  }

  // End of a line is the next line's start; the last line has no next line
  // to bound it, so pad it the same way app/song/page.tsx does when it has
  // no audio duration to fall back on.
  const rows = lyrics.map((line, i) => {
    const startMs = line.timeMs as number;
    const endMs =
      i < lyrics.length - 1 ? (lyrics[i + 1].timeMs as number) : startMs + 4000;
    return {
      idx: i,
      text: line.text,
      start_ms: Math.round(startMs),
      end_ms: Math.round(endMs),
    };
  });

  const { data: song, error: songError } = await supabaseServer
    .from("songs")
    .insert({
      title: TRACK.title,
      artist: TRACK.artist,
      instrumental_url: TRACK.audioUrl,
      duration_ms: Math.round(rows[rows.length - 1].end_ms),
    })
    .select()
    .single();

  if (songError) throw songError;

  const { error: linesError } = await supabaseServer
    .from("lines")
    .insert(rows.map((row) => ({ ...row, song_id: song.id })));

  if (linesError) throw linesError;

  console.log("Seed complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
