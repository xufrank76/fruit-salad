import { redirect } from "next/navigation";
import { DEFAULT_SONG } from "@/lib/track";

// Bare /record (no song picked) — send to the default song's own route.
export default function RecordRedirect() {
  redirect(`/record/${DEFAULT_SONG.slug}`);
}
