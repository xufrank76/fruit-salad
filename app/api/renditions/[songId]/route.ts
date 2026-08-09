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

// Finds (or starts) the one global public rendition for a song, and returns
// every line for that song alongside whatever take already fills it in this
// rendition, so a client can resume instead of re-recording filled lines.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ songId: string }> }
) {
  const { songId } = await params;

  const { data: existing, error: findError } = await supabaseServer
    .from("renditions")
    .select("*")
    .eq("song_id", songId)
    .eq("mode", "public")
    .maybeSingle();

  if (findError) {
    return NextResponse.json({ error: findError.message }, { status: 500 });
  }

  let rendition = existing;
  if (!rendition) {
    const { data: created, error: createError } = await supabaseServer
      .from("renditions")
      .insert({ song_id: songId, mode: "public", status: "in_progress" })
      .select()
      .single();

    if (createError) {
      return NextResponse.json({ error: createError.message }, { status: 500 });
    }
    rendition = created;
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

  const linesWithTakes = (lines ?? []).map((line) => ({
    ...line,
    take: takeByLineId.get(line.id) ?? null,
  }));

  return NextResponse.json({ renditionId: rendition.id, lines: linesWithTakes });
}
