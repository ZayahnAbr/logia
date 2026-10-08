"use server";

// Title + cover art for a music link via the services' public oEmbed endpoints (no keys).
// Only fixed hosts are ever called, so this can't be used to fetch arbitrary URLs.
export type MediaMeta = { title: string; by?: string; thumb?: string };

const SPOTIFY_PATH = /^\/(?:intl-[a-z-]+\/)?(?:embed\/)?(playlist|album|track|episode|show|artist)\/([A-Za-z0-9]+)/;

// spotify:playlist:ID, spotify.link / spoti.fi short links (from the phone app) -> canonical open.spotify.com URL.
async function resolveSpotify(raw: string): Promise<string | null> {
  const uri = raw.trim().match(/^spotify:(playlist|album|track|episode|show|artist):([A-Za-z0-9]+)$/);
  if (uri) return `https://open.spotify.com/${uri[1]}/${uri[2]}`;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  const host = u.hostname.replace(/^www\./, "");
  if (host === "open.spotify.com") {
    const m = u.pathname.match(SPOTIFY_PATH);
    return m ? `https://open.spotify.com/${m[1]}/${m[2]}` : u.href;
  }
  if (host === "spotify.link" || host === "spoti.fi") {
    try {
      // Follow redirects by hand, only ever to Spotify hosts.
      let next = u.href;
      for (let i = 0; i < 5; i++) {
        const res = await fetch(next, { redirect: "manual", signal: AbortSignal.timeout(8000) });
        const loc = res.headers.get("location");
        if (!loc) {
          // Some short links land on an HTML page that names the target.
          const html = res.ok ? await res.text() : "";
          const m = html.match(/https:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(playlist|album|track|episode|show|artist)\/([A-Za-z0-9]+)/);
          return m ? `https://open.spotify.com/${m[1]}/${m[2]}` : null;
        }
        const to = new URL(loc, next);
        const h = to.hostname.replace(/^www\./, "");
        if (h === "open.spotify.com") { const m = to.pathname.match(SPOTIFY_PATH); return m ? `https://open.spotify.com/${m[1]}/${m[2]}` : null; }
        if (!["spotify.link", "spoti.fi", "spotify.app.link"].includes(h) && !h.endsWith(".app.link")) return null;
        next = to.href;
      }
    } catch { return null; }
  }
  return null;
}

// Fallback when oEmbed omits the cover: the public page's og:image (open.spotify.com only).
async function spotifyOgImage(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { "user-agent": "Mozilla/5.0 (compatible; Logia/1.0)" }, next: { revalidate: 60 * 60 * 24 } });
    if (!res.ok) return undefined;
    const html = await res.text();
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    const img = m?.[1];
    if (!img) return undefined;
    const h = new URL(img).hostname;
    return /(^|\.)scdn\.co$|(^|\.)spotifycdn\.com$/.test(h) ? img : undefined;
  } catch { return undefined; }
}

export async function getMediaMeta(raw: string): Promise<MediaMeta | null> {
  const spotify = await resolveSpotify(raw);
  let u: URL;
  try { u = new URL(spotify ?? raw); } catch { return null; }
  const host = u.hostname.replace(/^www\./, "");
  const endpoint =
    host === "open.spotify.com" ? `https://open.spotify.com/oembed?url=${encodeURIComponent(u.href)}`
    : ["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host) ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u.href)}`
    : host === "soundcloud.com" ? `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(u.href)}`
    : null;
  if (!endpoint) return null;
  try {
    const res = await fetch(endpoint, { next: { revalidate: 60 * 60 * 24 } });
    const j = res.ok ? await res.json() : {};
    let thumb = typeof j.thumbnail_url === "string" ? j.thumbnail_url : undefined;
    if (!thumb && host === "open.spotify.com") thumb = await spotifyOgImage(u.href);
    if (!res.ok && !thumb) return null;
    return { title: String(j.title ?? "").slice(0, 120) || "Untitled", by: j.author_name ? String(j.author_name).slice(0, 80) : undefined, thumb };
  } catch {
    return null;
  }
}
