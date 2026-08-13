import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

// Accepts a finished take as multipart form data, uploads the audio to the
// "takes" storage bucket, and records it against a line in a rendition.
export async function POST(request: Request) {
  const formData = await request.formData();
  const audio = formData.get("audio");
  const renditionId = formData.get("rendition_id");
  const lineId = formData.get("line_id");
  const singerName = formData.get("singer_name");
  const offsetMs = formData.get("offset_ms");
  const durationMs = formData.get("duration_ms");

  if (!(audio instanceof File) || typeof renditionId !== "string" || typeof lineId !== "string") {
    return NextResponse.json(
      { error: "Missing required fields: audio, rendition_id, line_id" },
      { status: 400 }
    );
  }

  const filename = `${lineId}-${Date.now()}.wav`;
  const { error: uploadError } = await supabaseServer.storage
    .from("takes")
    .upload(filename, audio, { contentType: audio.type || "audio/wav" });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const {
    data: { publicUrl },
  } = supabaseServer.storage.from("takes").getPublicUrl(filename);

  const { data: take, error: insertError } = await supabaseServer
    .from("takes")
    .insert({
      rendition_id: renditionId,
      line_id: lineId,
      singer_name: typeof singerName === "string" && singerName ? singerName : null,
      audio_url: publicUrl,
      offset_ms: typeof offsetMs === "string" ? Number(offsetMs) : null,
      duration_ms: typeof durationMs === "string" ? Number(durationMs) : null,
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ take });
}

// Deletes a submitted take (its DB row and the uploaded audio), reopening the
// line so it can be sung again. Ownership is enforced client-side (the record
// page only offers delete for takes it created on this device); there's no
// auth, so this endpoint trusts the take id it's given.
export async function DELETE(request: Request) {
  let takeId: unknown;
  try {
    ({ takeId } = await request.json());
  } catch {
    takeId = undefined;
  }
  if (typeof takeId !== "string" || !takeId) {
    return NextResponse.json({ error: "Missing take id" }, { status: 400 });
  }

  // Look up the audio file so we can remove it from Storage too, not just the
  // row (otherwise the WAV is orphaned in the bucket forever).
  const { data: take } = await supabaseServer
    .from("takes")
    .select("audio_url")
    .eq("id", takeId)
    .maybeSingle();

  if (take?.audio_url) {
    // Public URL is .../object/public/takes/<path>; the bucket-relative path is
    // everything after "/takes/".
    const path = take.audio_url.split("/takes/")[1];
    if (path) {
      // Best-effort: a failed file delete shouldn't block removing the row.
      await supabaseServer.storage
        .from("takes")
        .remove([decodeURIComponent(path)]);
    }
  }

  const { error: deleteError } = await supabaseServer
    .from("takes")
    .delete()
    .eq("id", takeId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
