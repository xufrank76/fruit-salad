import { config } from 'dotenv'
config({ path: '.env.local' })
console.log('URL loaded as:', process.env.NEXT_PUBLIC_SUPABASE_URL)

// Seed the Supabase "songs" and "lines" tables for every song in
// PENDING_SONGS (lib/track.ts) — i.e. audio + LRC-timestamped lyrics are
// ready in public/, but the song hasn't been added to the DB yet. For each
// one, prints a ready-to-paste Song (with the new row's real id) — move it
// into SONGS once pasted so it becomes singable (see README "Prepping the
// song library").
//
// Run: npx tsx scripts/seed.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLyrics } from "../lib/lyrics";
import { PENDING_SONGS, type Song } from "../lib/track";

async function main() {
  const { supabaseServer } = await import("../lib/supabase-server");

  if (PENDING_SONGS.length === 0) {
    console.log("PENDING_SONGS is empty — add an entry in lib/track.ts first.");
    return;
  }

  for (const song of PENDING_SONGS) {
    const lyricsPath = join(process.cwd(), "public", song.lyricsUrl.replace(/^\//, ""));
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

    const { data: songRow, error: songError } = await supabaseServer
      .from("songs")
      .insert({
        title: song.title,
        artist: song.artist,
        instrumental_url: song.audioUrl,
        duration_ms: Math.round(rows[rows.length - 1].end_ms),
      })
      .select()
      .single();

    if (songError) throw songError;

    const { error: linesError } = await supabaseServer
      .from("lines")
      .insert(rows.map((row) => ({ ...row, song_id: songRow.id })));

    if (linesError) throw linesError;

    const pasteReady: Song = { id: songRow.id, ...song };
    console.log(`\nSeeded "${song.title}" — move this into SONGS in lib/track.ts:\n`);
    console.log(JSON.stringify(pasteReady, null, 2));
  }

  console.log("\nSeed complete. Remove the pasted entries from PENDING_SONGS.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
