"use client";

import { useEffect, useState } from "react";
import { type MediaMeta } from "@/app/media-actions";
import { loadMediaMeta } from "@/lib/mediaMeta";
import { useMusic } from "@/components/MusicProvider";
import { Music, Pencil, X } from "lucide-react";

// Study music via the services' official embeds (no account linking or API keys).
// Spotify plays full tracks when the viewer is signed in to Spotify in this browser, previews otherwise.
import { toEmbed, type Embed } from "@/lib/musicEmbed";
export { toEmbed };

const SUGGESTIONS = [
  { label: "Lofi beats", url: "https://open.spotify.com/playlist/37i9dQZF1DWWQRwui0ExPn", art: "linear-gradient(135deg,#f2836b,#c6b8ea)" },
  { label: "Deep focus", url: "https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ", art: "linear-gradient(135deg,#3f8f8a,#9cc3e6)" },
  { label: "Peaceful piano", url: "https://open.spotify.com/playlist/37i9dQZF1DX4sWSpwq3LiO", art: "linear-gradient(135deg,#fbd3b0,#a9c6a2)" },
];

// Chooses what plays. The player itself lives in <MusicProvider> so it survives page changes.
export function MusicWidget() {
  const music = useMusic();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [covers, setCovers] = useState<Record<string, MediaMeta | null>>({});
  // Real cover art for the suggested playlists.
  useEffect(() => {
    let alive = true;
    Promise.all(SUGGESTIONS.map((x) => loadMediaMeta(x.url).then((m) => [x.url, m] as const)))
      .then((pairs) => { if (alive) setCovers(Object.fromEntries(pairs)); });
    return () => { alive = false; };
  }, []);
  if (!music) return null;
  const current = music.url ? toEmbed(music.url) : null;
  const pick = SUGGESTIONS.find((x) => x.url === music.url);

  const save = (value: string) => {
    if (!toEmbed(value)) { setErr("Paste a Spotify, YouTube, Apple Music or SoundCloud link."); return; }
    music.play(value.trim()); setEditing(false); setDraft(""); setErr(null);
  };

  if (current && !editing) {
    // Same look as the mini player: cover, title, artist. The player itself stays in the corner.
    const title = music.meta?.title ?? pick?.label ?? `${current.label} playlist`;
    return (
      <div className="music-np">
        {music.meta?.thumb
          ? <img src={music.meta.thumb} alt="" className="music-np-cover" />
          : <span className="music-np-cover music-np-blank" aria-hidden="true"><Music size={20} /></span>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="truncate music-np-title">{title}</div>
          <div className="truncate music-np-by"><span className="music-eq" aria-hidden="true"><i /><i /><i /><i /></span> {music.meta?.by ? `${music.meta.by} · ` : ""}{current.label}</div>
        </div>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditing(true)} aria-label="Change music" title="Change"><Pencil size={15} /></button>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={music.stop} aria-label="Stop music" title="Stop"><X size={15} /></button>
      </div>
    );
  }

  return (
    <div className="card music-setup">
      <div className="music-tiles">
        {SUGGESTIONS.map((x) => (
          <button key={x.label} type="button" className={`music-tile${covers[x.url]?.thumb ? " has-art" : " skeleton"}`} onClick={() => save(x.url)}
            style={covers[x.url]?.thumb ? { background: `center / cover no-repeat url("${covers[x.url]!.thumb}")` } : undefined}>
            {!covers[x.url]?.thumb && <Music size={18} aria-hidden="true" />}
            <span>{covers[x.url]?.title ?? x.label}</span>
            <small>Spotify</small>
          </button>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); save(draft); }} style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <label htmlFor="music-link" className="sr-only">Music link</label>
        <input id="music-link" className="input" type="url" placeholder="Or paste a Spotify, YouTube or Apple Music link" value={draft}
          onChange={(e) => { setDraft(e.target.value); setErr(null); }} aria-invalid={!!err} aria-describedby={err ? "music-err" : undefined} />
        <button className="btn btn-primary" disabled={!draft.trim()}>Play</button>
        {editing && <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>}
      </form>
      {err && <p id="music-err" className="field-error" style={{ margin: "8px 0 0" }}>{err}</p>}
    </div>
  );
}
