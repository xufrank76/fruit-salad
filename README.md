# Fruit Salad

## Inspiration

There's a TikTok trend where a group chat passes a song around — one line
at a time — until a voice memo thread becomes a full cover with everyone's
voice stitched together. We wanted that feeling without needing a group
chat full of willing friends. What if the "group chat" was just the
internet? Any stranger adds the next line to a song already in progress —
Omegle-spontaneous, but built to outlive the session.

## What it does

A song is broken into short lines — Fruits. Browse the shelf (real cover
art via Apple's iTunes Search API), pick a song, claim open lines, and
record: the backing track counts you in, your mic is captured on the same
clock as playback, you review and re-take, then submit. Your take joins
that song's shared, permanent Rendition in Supabase, so the next stranger
picks up where you left off. The more lines filled, the more fruits sprout
in the background — the art tells the story of who's shown up. Every
visual is our own hand-drawn work, not a template.

## How we built it

Non-negotiable constraint: timing. If strangers' voices don't land on the
beat, the idea falls apart.

- **Sample-accurate scheduling** — everything decoded to `AudioBuffer` and
  scheduled against one shared `AudioContext` clock, not `<audio>` tags.
- **Clock-anchored mic capture** — captured on that same clock (not
  `MediaRecorder`'s own timeline), corrected for real device output latency.
- **Shared reverb + RMS loudness normalization** so mismatched mics/rooms
  sound like one performance instead of twenty volumes fighting.
- **Next.js + Tailwind on Vercel**, **Supabase** (Postgres + Storage) behind
  two API routes: find-or-create a song's rendition, and submit a take.
- **LRC-timestamped lyrics** drive every line's start/end.
- **Hand-drawn visuals, Reve only for animation** — see below.

## Use of Reve

We care about retaining human creativity, so every fruit — apples,
blueberries, lemons, oranges, pears — started as our own illustration, not
a prompt. Image generation is easy to get carried away with; we used Reve
for speed, not authorship. Each fruit needed a second frame for a
stop-motion wobble, and hand-redrawing every variant wasn't realistic on a
hackathon clock — so we fed our originals into Reve to generate the
matching frame, swapped between in CSS. The design stayed ours; Reve just
helped us animate it fast enough to ship. That sprouting animation also
tells the story: more lines filled, more fruits on screen — motion in
service of a human-authored idea, not a replacement for one.

## Challenges we ran into

`MediaRecorder`'s unpredictable latency drifted against the Web Audio
clock — rebuilding capture on the `AudioContext` clock itself, and
correcting for output latency (singers react to what they hear, not when
we schedule it), was what got it sounding *together* instead of just
technically working. We also hit the usual music-hackathon wall:
licensing real tracks for the demo vs. what a real launch would need.

## Accomplishments that we're proud of

Every visual was hand-drawn by our team, not pulled from a UI kit — and
getting that to sit on top of a genuinely hard audio problem, feeling like
one project instead of two bolted together, is what we're proudest of.

## What we learned

Real hands-on experience with low-level Web Audio timing, and wiring a
resumable multi-user backend where "who's filled what" stays consistent as
strangers drop in and out. Underneath it: a shared song built line by line
by people who'll never meet is a small but real piece of connection.

## What's next for Fruit Salad

- **Private rooms** — a code, a host who picks the song, and a synchronized
  reveal for the whole group.
- **A data dashboard** — line heatmap, crowd pitch range, contributor map.
- **Growing album art via Reve** as more strangers contribute.
- **Pitch smoothing** to blend takes recorded off-key or off-tempo.
- **A bigger licensed library**, and one-click video export.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) (headphones + mic
needed). To add a song: drop its audio into `public/`, add it to
`scripts/fetch-lyrics.mjs`'s `TRACKS` list to pull timestamped lyrics from
LRCLIB, then run `npx tsx scripts/seed.ts` and wire it into `lib/track.ts`.

## Disclaimer

This is a hackathon proof of concept, not a commercial product. The demo
songs are real, commercially-released tracks used only for testing and
demonstration — nothing here is licensed, monetized, or intended for public
distribution. A real launch would run on a licensed karaoke catalog or
commissioned originals (see "Challenges" above). Rights holder with a
concern? Reach out and we'll take it down.
