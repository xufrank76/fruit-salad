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
  const deviceId = formData.get("device_id");
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
      device_id: typeof deviceId === "string" && deviceId ? deviceId : null,
      audio_url: publicUrl,
      offset_ms: typeof offsetMs === "string" ? Number(offsetMs) : null,
      duration_ms: typeof durationMs === "string" ? Number(durationMs) : null,
    })
    .select()
    .single();

  if (insertError) {
    // 23505 = unique_violation on takes(rendition_id, line_id) — someone else's
    // take landed on this line first. Without the constraint this would have
    // silently created an orphaned second row instead of failing cleanly.
    if (insertError.code === "23505") {
      return NextResponse.json(
        { error: "Someone else just recorded this line — try another." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // If this take just filled the last open line, seal the rendition (see
  // README: "when all lines are filled, the rendition is sealed, published
  // to a gallery, and a new one starts") — the next visit to
  // /api/renditions/[songId] then spins up a fresh rendition automatically
  // instead of reusing this finished one. Best-effort: a failure here
  // shouldn't fail the take that was just successfully saved.
  try {
    const { data: rendition } = await supabaseServer
      .from("renditions")
      .select("song_id")
      .eq("id", renditionId)
      .maybeSingle();

    if (rendition) {
      const { count: totalLines } = await supabaseServer
        .from("lines")
        .select("id", { count: "exact", head: true })
        .eq("song_id", rendition.song_id);

      const { data: takenRows } = await supabaseServer
        .from("takes")
        .select("line_id")
        .eq("rendition_id", renditionId);
      const takenCount = new Set((takenRows ?? []).map((t) => t.line_id)).size;

      if (totalLines != null && totalLines > 0 && takenCount >= totalLines) {
        await supabaseServer
          .from("renditions")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", renditionId);
      }
    }
  } catch {
    /* best-effort completion check — the take itself already saved fine */
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
