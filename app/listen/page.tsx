import { redirect } from "next/navigation";
import { DEFAULT_SONG } from "@/lib/track";

// Bare /listen (no song picked) — send to the default song's own route,
// forwarding ?rendition= if a gallery link brought us here.
export default async function ListenRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rendition = params.rendition;
  const query = typeof rendition === "string" ? `?rendition=${rendition}` : "";
  redirect(`/listen/${DEFAULT_SONG.slug}${query}`);
}
