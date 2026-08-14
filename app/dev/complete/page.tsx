"use client";

// Dev-only tool for seeing the "rendition seals when full, auto-restarts,
// shows up in /gallery" flow without actually singing 20-90 real lines.
// Fills every open line of the chosen song's current rendition with fake
// (silent) takes via the real API, so the real completion/auto-restart
// logic runs exactly as it would for a real singer — then offers a one-click
// undo that reverses exactly what this tool did (see /api/dev/undo-fill).

import Link from "next/link";
import { useState } from "react";
import { SONGS } from "@/lib/track";

type LineRow = { id: string; idx: number; text: string; take: { id: string } | null };
type RenditionData = { renditionId: string; status: string; lines: LineRow[] };

// Minimal valid (silent) WAV, same trick used to verify this feature live.
function silentWav(): Blob {
  const h = new Uint8Array(44);
  const view = new DataView(h.buffer);
  const writeStr = (o: number, s: string) => s.split("").forEach((c, i) => (h[o + i] = c.charCodeAt(0)));
  writeStr(0, "RIFF"); view.setUint32(4, 36, true); writeStr(8, "WAVE");
  writeStr(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, 44100, true); view.setUint32(28, 88200, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); writeStr(36, "data"); view.setUint32(40, 0, true);
  return new Blob([h], { type: "audio/wav" });
}

const TEST_SINGER = "__dev_test__";

export default function DevCompletePage() {
  const [songId, setSongId] = useState(SONGS[0]?.id ?? "");
  const [status, setStatus] = useState<RenditionData | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [lastFill, setLastFill] = useState<{
    sealedRenditionId: string;
    freshRenditionId: string;
    takeIds: string[];
    slug: string;
  } | null>(null);

  const song = SONGS.find((s) => s.id === songId);
  const append = (line: string) => setLog((prev) => [...prev.slice(-6), line]);

  const refresh = async () => {
    const res = await fetch(`/api/renditions/${songId}`);
    const data = await res.json();
    setStatus(data);
    return data as RenditionData;
  };

  const fillAll = async () => {
    setBusy(true);
    setLog([]);
    try {
      const data = await refresh();
      const renditionId = data.renditionId;
      const open = data.lines.filter((l) => !l.take);
      append(`filling ${open.length} open line(s) in rendition ${renditionId.slice(0, 8)}…`);

      const takeIds: string[] = [];
      for (const line of open) {
        const fd = new FormData();
        fd.append("audio", silentWav(), "t.wav");
        fd.append("rendition_id", renditionId);
        fd.append("line_id", line.id);
        fd.append("singer_name", TEST_SINGER);
        fd.append("offset_ms", "0");
        fd.append("duration_ms", "100");
        const res = await fetch("/api/takes", { method: "POST", body: fd });
        const body = await res.json();
        if (!res.ok) {
          append(`✗ line ${line.idx} failed: ${body?.error ?? res.status}`);
          continue;
        }
        takeIds.push(body.take.id);
      }
      append(`submitted ${takeIds.length} take(s)`);

      const after = await fetch(`/api/renditions/${songId}?renditionId=${renditionId}`).then((r) => r.json());
      append(`rendition status: ${after.status}${after.completedAt ? ` (sealed at ${after.completedAt})` : ""}`);

      const fresh = await refresh();
      if (after.status === "completed") {
        append(`auto-restart: new active rendition ${fresh.renditionId.slice(0, 8)}`);
        setLastFill({
          sealedRenditionId: renditionId,
          freshRenditionId: fresh.renditionId,
          takeIds,
          slug: song?.slug ?? "",
        });
      } else {
        append("not full yet (song already had some lines taken) — run again to top it off");
      }
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!lastFill) return;
    setBusy(true);
    try {
      await fetch("/api/dev/undo-fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lastFill),
      });
      append("undone — rendition reverted, extra one removed");
      setLastFill(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-white p-6 font-sans text-black">
      <div className="mx-auto flex max-w-xl flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-lg">
        <h1 className="text-lg font-medium">dev: fill a rendition to test seal + gallery</h1>

        <label className="flex items-center gap-2 text-sm">
          song
          <select
            value={songId}
            onChange={(e) => {
              setSongId(e.target.value);
              setStatus(null);
              setLastFill(null);
              setLog([]);
            }}
            className="rounded border border-zinc-300 px-2 py-1"
          >
            {SONGS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={refresh}
            disabled={busy}
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm disabled:opacity-40"
          >
            check status
          </button>
          <button
            onClick={fillAll}
            disabled={busy}
            className="rounded-full bg-black px-4 py-2 text-sm text-white disabled:opacity-40"
          >
            fill all remaining lines (fake takes)
          </button>
          {lastFill && (
            <button
              onClick={undo}
              disabled={busy}
              className="rounded-full border border-red-300 px-4 py-2 text-sm text-red-600 disabled:opacity-40"
            >
              undo last fill
            </button>
          )}
        </div>

        {status && (
          <p className="text-sm text-zinc-600">
            {status.renditionId.slice(0, 8)} — {status.status} —{" "}
            {status.lines.filter((l) => l.take).length}/{status.lines.length} lines taken
          </p>
        )}

        {log.length > 0 && (
          <pre className="whitespace-pre-wrap rounded bg-zinc-50 p-3 text-xs text-zinc-700">
            {log.join("\n")}
          </pre>
        )}

        {lastFill && (
          <div className="flex gap-3 text-sm">
            <Link href="/gallery" className="underline">
              open /gallery →
            </Link>
            <Link href={`/listen/${lastFill.slug}`} className="underline">
              open /listen/{lastFill.slug} →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
