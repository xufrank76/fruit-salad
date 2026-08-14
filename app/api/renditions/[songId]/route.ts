import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

type Take = {
  id: string;
  rendition_id: string;
  line_id: string;
  singer_name: string | null;
  audio_url: string;
  offset_ms: number | null;
  duration_ms: number | null;
};

type RenditionRow = {
  id: string;
  status: string | null;
  completed_at: string | null;
};

// Finds (or starts) the current, still-open public rendition for a song — or,
// if `?renditionId=` is given, fetches that SPECIFIC rendition instead (used
// to view a past, sealed one from the gallery) — and returns every line for
// the song alongside whatever take fills it in that rendition, so a client
// can resume instead of re-recording filled lines.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ songId: string }> }
) {
  const { songId } = await params;
  const requestedId = new URL(request.url).searchParams.get("renditionId");

  let rendition: RenditionRow | null = null;

  if (requestedId) {
    const { data, error } = await supabaseServer
      .from("renditions")
      .select("id, status, completed_at")
      .eq("id", requestedId)
      .eq("song_id", songId)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Rendition not found" }, { status: 404 });
    }
    rendition = data;
  } else {
    // The current, still-open rendition — completed ones are excluded so a
    // sealed rendition never gets reused for new takes. If every rendition
    // for this song is sealed (or none exist yet), start a fresh one: this
    // is what makes the song "auto-restart" once it's fully sung.
    const { data: existing, error: findError } = await supabaseServer
      .from("renditions")
      .select("id, status, completed_at")
      .eq("song_id", songId)
      .eq("mode", "public")
      .neq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1);

    if (findError) {
      return NextResponse.json({ error: findError.message }, { status: 500 });
    }

    rendition = existing?.[0] ?? null;
    if (!rendition) {
      const { data: created, error: createError } = await supabaseServer
        .from("renditions")
        .insert({ song_id: songId, mode: "public", status: "in_progress" })
        .select("id, status, completed_at")
        .single();

      if (createError) {
        return NextResponse.json({ error: createError.message }, { status: 500 });
      }
      rendition = created;
    }
  }

  const { data: lines, error: linesError } = await supabaseServer
    .from("lines")
    .select("*")
    .eq("song_id", songId)
    .order("idx", { ascending: true });

  if (linesError) {
    return NextResponse.json({ error: linesError.message }, { status: 500 });
  }

  const lineIds = (lines ?? []).map((l) => l.id);
  const takeByLineId = new Map<string, Take>();
  if (lineIds.length > 0) {
    const { data: takes, error: takesError } = await supabaseServer
      .from("takes")
      .select("*")
      .eq("rendition_id", rendition.id)
      .in("line_id", lineIds);

    if (takesError) {
      return NextResponse.json({ error: takesError.message }, { status: 500 });
    }
    for (const take of takes ?? []) takeByLineId.set(take.line_id, take);
  }

  // Active "recording in progress" claims (see /api/claims) — best-effort:
  // if the claims table doesn't exist yet (migration not applied), just treat
  // it as no active claims rather than failing the whole endpoint. Pointless
  // for a sealed past rendition, but harmless to still check.
  const claimBySessionByLineId = new Map<string, string>();
  if (lineIds.length > 0) {
    const { data: claims } = await supabaseServer
      .from("claims")
      .select("line_id, session_id")
      .eq("rendition_id", rendition.id)
      .gt("expires_at", new Date().toISOString())
      .in("line_id", lineIds);
    for (const c of claims ?? []) claimBySessionByLineId.set(c.line_id, c.session_id);
  }

  const linesWithTakes = (lines ?? []).map((line) => ({
    ...line,
    take: takeByLineId.get(line.id) ?? null,
    claimedBySession: claimBySessionByLineId.get(line.id) ?? null,
  }));

  return NextResponse.json({
    renditionId: rendition.id,
    status: rendition.status,
    completedAt: rendition.completed_at,
    lines: linesWithTakes,
  });
}
