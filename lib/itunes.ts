// iTunes Search API (Apple) — free, no auth, returns artwork URLs as part of
// its standard search results. This is the widely-used, permitted pattern for
// apps that reference/link back to music; unlike scraping an official cover,
// this is a licensed-for-display asset served directly by Apple's API.
export async function fetchAlbumArtwork(
  artist: string,
  track: string,
  size = 600
): Promise<string | null> {
  const term = encodeURIComponent(`${artist} ${track}`);
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${term}&entity=song&limit=1`,
      { next: { revalidate: 60 * 60 * 24 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const artworkUrl100: string | undefined = data.results?.[0]?.artworkUrl100;
    if (!artworkUrl100) return null;
    // iTunes returns a 100x100 thumbnail URL; the size is just a URL segment,
    // swap it for a larger one.
    return artworkUrl100.replace(/\/100x100bb\.jpg$/, `/${size}x${size}bb.jpg`);
  } catch {
    return null;
  }
}
