import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

// Dev-only companion to /dev/complete: undoes a test fill by deleting the
// fake takes it created, reverting the rendition it sealed back to
// in_progress, and removing the extra rendition auto-restart spun up —
// mirrors exactly the manual cleanup used to verify the completion/gallery
// feature, exposed as a reusable button instead of a one-off script.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const sealedRenditionId = body?.sealedRenditionId;
  const freshRenditionId = body?.freshRenditionId;
  const takeIds = body?.takeIds;
  if (!Array.isArray(takeIds) || takeIds.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  for (const takeId of takeIds) {
    const { data: take } = await supabaseServer
      .from("takes")
      .select("audio_url")
      .eq("id", takeId)
      .maybeSingle();
    if (take?.audio_url) {
      const path = take.audio_url.split("/takes/")[1];
      if (path) {
        await supabaseServer.storage.from("takes").remove([decodeURIComponent(path)]);
      }
    }
    await supabaseServer.from("takes").delete().eq("id", takeId);
  }

  if (typeof sealedRenditionId === "string") {
    await supabaseServer
      .from("renditions")
      .update({ status: "in_progress", completed_at: null })
      .eq("id", sealedRenditionId);
  }
  if (typeof freshRenditionId === "string" && freshRenditionId !== sealedRenditionId) {
    await supabaseServer.from("renditions").delete().eq("id", freshRenditionId);
  }

  return NextResponse.json({ ok: true });
}
