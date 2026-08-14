import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

// Ephemeral "recording in progress" markers (see README's claims table) — a
// soft, advisory lock. It lets clients show "someone's recording this line"
// so people don't pick the same open line at once, but it's not the actual
// data-integrity guarantee: that's the unique constraint on
// takes(rendition_id, line_id), enforced at submit time regardless of what
// happens here. A claim just expires if its holder never submits or explicitly
// releases it (tab closed, recording abandoned, etc).
const CLAIM_TTL_MS = 60_000;

// Claims the given lines for `sessionId`, skipping any that another session
// already holds (not expired). Returns which lines were actually claimed vs.
// blocked, so the caller can tell the difference.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const renditionId = body?.renditionId;
  const lineIds = body?.lineIds;
  const sessionId = body?.sessionId;
  if (
    typeof renditionId !== "string" ||
    typeof sessionId !== "string" ||
    !Array.isArray(lineIds) ||
    lineIds.length === 0 ||
    lineIds.some((id) => typeof id !== "string")
  ) {
    return NextResponse.json({ error: "Invalid claim request" }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const { data: existing, error: findError } = await supabaseServer
    .from("claims")
    .select("line_id, session_id, expires_at")
    .eq("rendition_id", renditionId)
    .in("line_id", lineIds);

  if (findError) {
    return NextResponse.json({ error: findError.message }, { status: 500 });
  }

  const blocked = (existing ?? [])
    .filter((c) => c.session_id !== sessionId && c.expires_at > nowIso)
    .map((c) => c.line_id as string);
  const blockedSet = new Set(blocked);
  const toClaim = lineIds.filter((id) => !blockedSet.has(id));

  if (toClaim.length > 0) {
    const expiresAt = new Date(Date.now() + CLAIM_TTL_MS).toISOString();
    const { error: upsertError } = await supabaseServer.from("claims").upsert(
      toClaim.map((lineId) => ({
        rendition_id: renditionId,
        line_id: lineId,
        session_id: sessionId,
        expires_at: expiresAt,
      })),
      { onConflict: "rendition_id,line_id" }
    );
    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ claimed: toClaim, blocked });
}

// Releases claims held by `sessionId` for the given lines — called when
// recording finishes or is cancelled, so the line frees up immediately
// instead of waiting out the TTL. Only ever deletes the caller's own claims.
export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  const lineIds = body?.lineIds;
  const sessionId = body?.sessionId;
  if (
    typeof sessionId !== "string" ||
    !Array.isArray(lineIds) ||
    lineIds.some((id) => typeof id !== "string")
  ) {
    return NextResponse.json({ error: "Invalid release request" }, { status: 400 });
  }
  if (lineIds.length === 0) {
    return NextResponse.json({ ok: true });
  }

  const { error } = await supabaseServer
    .from("claims")
    .delete()
    .eq("session_id", sessionId)
    .in("line_id", lineIds);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
