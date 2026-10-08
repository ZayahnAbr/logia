"use client";

import { getMediaMeta, type MediaMeta } from "@/app/media-actions";

// Canonical link (drops ?si= tracking, intl-xx prefixes) so oEmbed always recognises it.
export function canonicalMusicUrl(raw: string) {
  try {
    const u = new URL(raw.trim());
    if (u.hostname.replace(/^www\./, "") === "open.spotify.com") {
      const m = u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(playlist|album|track|episode|show|artist)\/([A-Za-z0-9]+)/);
      if (m) return `https://open.spotify.com/${m[1]}/${m[2]}`;
    }
    return u.href;
  } catch { return raw; }
}

const cache = new Map<string, MediaMeta | null>();

/** Title + cover (a Spotify playlist's own cover art). Server first, browser fallback. */
export async function loadMediaMeta(raw: string): Promise<MediaMeta | null> {
  const url = canonicalMusicUrl(raw);
  if (cache.has(url)) return cache.get(url)!;
  let meta = await getMediaMeta(url).catch(() => null);
  if (!meta?.thumb) {
    const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
    const endpoint = host === "open.spotify.com" ? `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`
      : ["youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com"].includes(host) ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`
      : null;
    if (endpoint) {
      try {
        const j = await (await fetch(endpoint)).json();
        meta = { title: String(j.title ?? meta?.title ?? "").slice(0, 120), by: j.author_name, thumb: j.thumbnail_url };
      } catch { /* keep whatever the server gave */ }
    }
  }
  cache.set(url, meta);
  return meta;
}
