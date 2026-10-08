// Official embeds only (Spotify, YouTube, Apple Music, SoundCloud). Shared by the music widget and user cafes.
export type Embed = { src: string; height: number; label: string };

export function toEmbed(raw: string): Embed | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  const host = u.hostname.replace(/^www\./, "");
  if (host === "open.spotify.com") {
    const m = u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(playlist|album|track|episode|show|artist)\/([A-Za-z0-9]+)/);
    if (!m) return null;
    const compact = m[1] === "track" || m[1] === "episode";
    return { src: `https://open.spotify.com/embed/${m[1]}/${m[2]}?utm_source=logia`, height: compact ? 152 : 352, label: "Spotify" };
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com" || host === "youtu.be") {
    const list = u.searchParams.get("list");
    const id = host === "youtu.be" ? u.pathname.slice(1) : u.searchParams.get("v");
    if (id && /^[\w-]{6,}$/.test(id)) return { src: `https://www.youtube-nocookie.com/embed/${id}${list ? `?list=${encodeURIComponent(list)}` : ""}`, height: 220, label: "YouTube" };
    if (list) return { src: `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(list)}`, height: 220, label: "YouTube" };
    return null;
  }
  if (host === "music.apple.com") return { src: `https://embed.music.apple.com${u.pathname}`, height: 352, label: "Apple Music" };
  if (host === "soundcloud.com") return { src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(u.href)}&visual=false`, height: 166, label: "SoundCloud" };
  return null;
}
