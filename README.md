# fruit-salad

A public tool where one moment of human input — a sung line — becomes
part of a shared, growing artifact anyone can see. Strangers each record
one line of a song; playback stitches everyone's lines into a single
"Frankenstein" performance. Inspired by
[this TikTok](https://www.tiktok.com/@hollymariemusic_/video/7627425212765719830).

Built for a hackathon spanning these tracks:

- **[Main] Summerhacks Track** — public tool where one moment of human input becomes part of a shared, growing artifact
- **[Sponsor] Best Use of Reve** — brand/visual identity via generated illustration
- **[Sponsor] TECHNATION: Data Intelligence Track** — surface the data the app naturally generates

## Status

The hard problem (audio sync) has been de-risked first. See
[`app/sync-test/page.tsx`](app/sync-test/page.tsx) — record a line over an
instrumental, play it back sample-accurately via the Web Audio API. Nothing
else (database, rooms, gallery, dashboard) is built yet.

## Concept

- **Line** — the unit: one short vocal part of a song.
- **Rendition** — the container: one full pass through a song, ~20 lines,
  each filled by a different person. Renditions are permanent and public —
  that's the growing artifact.

**Two modes:**

- **Public server** — one global "song in progress." Land on the site, get
  assigned a random unclaimed line, record it, it locks in. When all lines
  are filled, the rendition is sealed, published to a gallery, and a new one
  starts. Anyone can browse every past rendition.
- **Private room** — 6-character code, host picks a song, lines get
  distributed among whoever joined, everyone records, then a synchronized
  reveal where the whole group hears the Frankenstein version at once. This
  is the Among Us–style mode, and it's where the laughs are.

## The one genuinely hard problem: sync

Everything else is CRUD. If singers drift off the beat, the demo dies. Solve
it structurally, not with signal processing:

- Don't let people sing freely. Each line has a fixed `start_ms` and
  `end_ms` in the instrumental. Play the instrumental starting 3 seconds
  before the line (with a visual count-in), record a window of exactly
  `(end_ms - start_ms) + padding`, and store the clip with its offset
  relative to line start. Playback is then just scheduling: instrumental at
  `t=0`, each clip at `t = line.start_ms`.
- Use the **Web Audio API**, not `<audio>` tags. Decode everything to
  `AudioBuffer`, then `source.start(contextTime + offset)`. This is
  sample-accurate. Multiple `<audio>` elements will drift audibly within
  seconds.

**Three cheap tricks that make it sound 10x better:**

1. **Headphones prompt.** Instrumental bleeding into the mic is the biggest
   quality killer. Hard-gate on a "are you wearing headphones?" screen, and
   set `echoCancellation: true` in `getUserMedia` as a fallback.
2. **Loudness normalization.** Compute RMS of each clip client-side at
   upload, store a gain factor, apply it on playback. Ten strangers at ten
   volumes sounds like garbage; normalized it sounds like a choir.
3. **Shared reverb bus.** Route every vocal clip through one
   `ConvolverNode` with a small hall impulse. Glues wildly different
   bedrooms/mics into something that sounds intentional. ~15 minutes of
   work, huge payoff.

**Latency:** there's ~80–200ms of round-trip delay between "instrumental
hits the speaker" and "mic captures the voice." MVP: subtract a fixed
120ms and add a manual slider on the review screen ("nudge earlier /
later"). Stretch goal: a calibration step that plays a click, records it,
and cross-correlates.

## Stack

- **Next.js + Tailwind on Vercel** — fastest path, and SSR is needed for
  shareable rendition pages with OG images.
- **Supabase** — Postgres + Storage + Realtime in one. Realtime is what
  makes the lobby and "line just got claimed" updates feel alive, nearly
  free.
- **Client-side audio only for MVP.** No ffmpeg, no server processing.
  `MediaRecorder` in, `decodeAudioData` out.
- **Export via `OfflineAudioContext`** → render the full mix → encode WAV →
  upload. One shareable file, the viral loop.

## Data model

```
songs        (id, title, artist, instrumental_url, cover_url, duration_ms)
lines        (id, song_id, idx, text, start_ms, end_ms)
renditions   (id, song_id, mode: public|private, room_code, status, created_at, mix_url)
takes        (id, rendition_id, line_id, singer_name, audio_url,
              offset_ms, gain, duration_ms, avg_pitch_hz, retake_count, created_at)
claims       (rendition_id, line_id, session_id, expires_at)   -- 60s soft lock
```

The `claims` table with an expiry is what makes public mode work without
users trampling each other.

## Prepping the song library

The sneaky time sink: per-line timestamps for ~20 songs. Build a 10-minute
admin page — play the instrumental, paste in lyrics split by line, hit
spacebar at the start of each line, dump the resulting JSON. One person can
time 20 songs in about an hour; forced alignment / LRC parsing / hand-edited
JSON are all slower and more fragile.

Cut to 8–10 songs for the hackathon. Use karaoke/instrumental versions so
people can actually hear themselves. Commercial tracks are fine for a demo
but would need licensing for a real launch (karaoke catalog, or commissioned
originals) — have that answer ready if judges ask.

## Build order

~36 hours, team of 4. Compress proportionally if shorter.

- **Hours 0–4 — Prove the sync works.** One person, one page, no database.
  Hardcode one song and one line. If it sounds aligned, the project is
  de-risked. Do not build anything else until this works. *(done — see
  `/sync-test`)*
- **Hours 4–10 — Vertical slice.** Supabase schema, upload to Storage, one
  song end-to-end: claim a line → record → save → someone else claims the
  next → play the assembled rendition. Ugly is fine.
- **Hours 10–18 — The two modes.** Public queue with claims/expiry, private
  rooms with codes and a lobby. Wire up Supabase Realtime so lines light up
  as they're claimed. In parallel: song timing, Reve assets.
- **Hours 18–26 — The payoff moments.** Synchronized reveal (host
  broadcasts a `playAt` server timestamp, all clients schedule to it), the
  public gallery of completed renditions, export-to-file + share page.
- **Hours 26–32 — Data dashboard and polish.**
- **Hours 32–36 — Freeze, seed with real data, rehearse.**

Team split: one person owns audio (deepest work, don't split it), one owns
backend/realtime/rooms, one owns frontend + Reve integration, one owns the
dashboard and song library prep. Audio person touches nothing else.

## Hitting the sponsor tracks

**Reve** — make the artifact visual, not just audible. Strongest move: each
rendition has a generated album cover that grows. Pre-generate illustrated
"choir" images in one consistent house style at tiers — 1 singer, 3, 5, 10,
20 — so the cover visibly fills with characters as the rendition fills with
voices. Same growth story as the audio, told in a single image. Beyond
that: illustrated cover art per song (one prompt template, consistent
style, pre-generated as static assets), a character mascot, illustrated
empty/loading states, a real landing page. Generate everything ahead of
time and commit as static files — never make a live API call during a
demo.

**TECHNATION** — surface what the app naturally produces. One explorable
dashboard page:

- **Line heatmap per song** — a strip of 20 bars showing takes and retakes
  per line. Reveals which line is hardest — the high note everybody
  re-records four times or abandons.
- **Crowd pitch range** — quick client-side autocorrelation per take,
  chart the distribution of average fundamental frequency across
  contributors. "Here's the vocal range of 400 strangers."
- **Time-of-day activity** — when do people sing? (Spoiler: 1am.)
- **Contributor map** — coarse geo from IP, city-level only.

Click any line in the heatmap to hear every take of it stacked. Making the
data audible is the thing judges won't have seen elsewhere. The framing
that wins: this data only exists because of the app, and it tells you
something about people, not about your infrastructure.

## Demo script

1. Land on the public song in progress — the cover art is half-populated
   with characters.
2. Judge scans a QR code, sings line 12 on their phone. Get a judge
   singing. This is the whole pitch.
3. Everyone watches the line lock in live and the cover art gain a
   character.
4. Play the completed rendition — 20 different strangers, one song.
5. Cut to the gallery: dozens of past renditions, permanent, browsable.
6. Cut to the dashboard: "line 8 of this song has been re-recorded 47
   times — it's the one nobody can hit."
7. Show the private room mode in 20 seconds as the "and it's also a party
   game" kicker.

## What to cut when behind

In order: pitch analysis → geo map → synchronized reveal (just have
everyone play independently) → export-to-video → private rooms entirely.
The public mode plus the gallery plus one working dashboard is a complete,
winning project on its own. Private rooms are a bonus.

The thing that kills this project is discovering at hour 20 that the audio
doesn't line up. Spend hours 0–4 on nothing but that.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The sync prototype is
at `/sync-test` — it needs headphones and mic access.

The instrumental for the prototype is synthetic (generated, not a licensed
track) so the sync technique can be proven without licensing concerns:

```bash
node scripts/generate-instrumental.mjs
```
