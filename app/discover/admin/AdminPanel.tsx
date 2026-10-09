"use client";

import { useState } from "react";
import { Check, EyeOff, Plus, Trash2, X } from "lucide-react";
import { setCafeStatus } from "@/app/cafe-actions";
import { PlansSection } from "./PlansSection";
import { UploadsSection } from "./UploadsSection";
import { toEmbed } from "@/lib/musicEmbed";
import { Avatar } from "@/components/Avatar";
import type { PendingCafe } from "@/lib/userCafes";
import { toast } from "@/components/Toaster";
import { addStream, deleteStream, resolveReport, reviewSpace, setStreamActive, type OpenReport, type PendingSpace, type Stream } from "@/app/discover-actions";
import { parseYouTubeId } from "@/lib/youtube";

const KIND_LABEL = { cafe_message: "Café message", space: "Public space", stream: "Stream", user_cafe: "Hosted room" } as const;
const HIDE_LABEL = { cafe_message: "Hide message", space: "Hide space", stream: "Turn off stream", user_cafe: "Hide room" } as const;

export function AdminPanel({ reports: initialReports, reportsError, streams: initialStreams, streamsError, pending: initialPending, pendingError, spaces: initialSpaces, spacesError }: {
  reports: OpenReport[]; reportsError: string; streams: Stream[]; streamsError: string; pending: PendingCafe[]; pendingError: string; spaces: PendingSpace[]; spacesError: string;
}) {
  const [pending, setPending] = useState(initialPending);
  const [reports, setReports] = useState(initialReports);
  const [streams, setStreams] = useState(initialStreams);
  const [spaces, setSpaces] = useState(initialSpaces);
  const [busy, setBusy] = useState<string | null>(null);

  const review = async (sp: PendingSpace, approve: boolean) => {
    setBusy(sp.space_id);
    const res = await reviewSpace(sp.space_id, approve);
    setBusy(null);
    if (res.error) { toast(res.error, "error"); return; }
    setSpaces((cur) => cur.filter((x) => x.space_id !== sp.space_id));
    toast(approve ? "Space approved and listed." : "Space kept private.");
  };

  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [channel, setChannel] = useState("");
  const [kind, setKind] = useState<"live" | "video">("video");
  const vid = parseYouTubeId(url);

  const resolve = async (r: OpenReport, action: "dismiss" | "hide") => {
    setBusy(r.id);
    const res = await resolveReport(r.id, action);
    setBusy(null);
    if (res.error) { toast(res.error, "error"); return; }
    setReports((cur) => cur.filter((x) => x.id !== r.id));
    toast(action === "hide" ? "Hidden and report closed." : "Report dismissed.");
  };

  const decide = async (c: PendingCafe, status: "public" | "unlisted" | "hidden") => {
    setBusy(c.cafe.id);
    const res = await setCafeStatus(c.cafe.id, status);
    setBusy(null);
    if (res.error) { toast(res.error, "error"); return; }
    setPending((cur) => cur.filter((x) => x.cafe.id !== c.cafe.id));
    toast(status === "public" ? "Room approved and listed." : status === "unlisted" ? "Room rejected. It stays link-only." : "Room hidden.");
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("add");
    const res = await addStream(url, title, channel, kind);
    setBusy(null);
    if ("error" in res) { toast(res.error, "error"); return; }
    setStreams((cur) => [res.stream, ...cur]);
    setUrl(""); setTitle(""); setChannel("");
    toast("Stream added.");
  };

  const toggle = async (s: Stream) => {
    const res = await setStreamActive(s.id, !s.is_active);
    if (res.error) { toast(res.error, "error"); return; }
    setStreams((cur) => cur.map((x) => (x.id === s.id ? { ...x, is_active: !s.is_active } : x)));
  };

  const remove = async (s: Stream) => {
    if (!window.confirm(`Delete "${s.title}"? This cannot be undone.`)) return;
    const res = await deleteStream(s.id);
    if (res.error) { toast(res.error, "error"); return; }
    setStreams((cur) => cur.filter((x) => x.id !== s.id));
  };

  return (
    <div style={{ display: "grid", gap: 32 }}>
      <UploadsSection />
      <PlansSection />
      <section aria-labelledby="adm-spaces">
        <h2 id="adm-spaces" className="dc-h2">Spaces awaiting review ({spaces.length})</h2>
        {spacesError && <div className="notice notice-error" role="alert">{spacesError}</div>}
        {!spacesError && spaces.length === 0 && <div className="empty card" style={{ padding: "24px 20px" }}>No spaces are waiting.</div>}
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
          {spaces.map((sp) => (
            <li key={sp.space_id} className="card" style={{ padding: 16, display: "grid", gap: 10 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16 }}>{sp.name}</h3>
                <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 4 }}>By {sp.owner_name} · asked {new Date(sp.requested_at).toLocaleString()}</div>
                {sp.public_description && <p style={{ margin: "6px 0 0", overflowWrap: "anywhere" }}>{sp.public_description}</p>}
                {sp.tags.length > 0 && <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--muted)" }}>Tags: {sp.tags.join(", ")}</p>}
              </div>
              <div>
                <div className="field-label">Flagged items</div>
                {sp.reports.length === 0 ? <p className="field-hint">Nothing specific was recorded.</p> : (
                  <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
                    {sp.reports.map((r) => (
                      <li key={r.id} style={{ overflowWrap: "anywhere" }}><strong>{r.kind === "image" ? "Picture" : r.kind === "text" ? "Text" : "Check"}:</strong> {r.ref}<br /><span style={{ color: "var(--muted)", fontSize: 13.5 }}>{r.reason}</span></li>
                    ))}
                  </ul>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="btn btn-sm btn-primary" disabled={busy === sp.space_id} onClick={() => review(sp, true)}><Check size={14} aria-hidden="true" /> Approve</button>
                <button type="button" className="btn btn-sm" disabled={busy === sp.space_id} onClick={() => review(sp, false)}><X size={14} aria-hidden="true" /> Keep private</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="adm-rooms">
        <h2 id="adm-rooms" className="dc-h2">Rooms awaiting review ({pending.length})</h2>
        {pendingError && <div className="notice notice-error" role="alert">{pendingError}</div>}
        {!pendingError && pending.length === 0 && <div className="empty card" style={{ padding: "24px 20px" }}>No rooms are waiting.</div>}
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
          {pending.map((p) => {
            const c = p.cafe;
            const embed = c.music_kind === "link" && c.music_url ? toEmbed(c.music_url) : null;
            const hostName = p.host?.display_name || "Unknown host";
            return (
              <li key={c.id} className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16 }}>{c.name}</h3>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5, color: "var(--muted)", marginTop: 4 }}>
                    <Avatar name={hostName} color={p.host?.avatar_color ?? null} icon={p.host?.avatar_icon ?? null} size={20} /> {hostName} · {c.focus_minutes}/{c.break_minutes} min
                  </div>
                  {c.description && <p style={{ margin: "6px 0 0", overflowWrap: "anywhere" }}>{c.description}</p>}
                </div>
                <div className="adm-media">
                  <div>
                    <div className="field-label">Loop</div>
                    {c.loop_kind === "upload" && p.loopUrl && <video src={p.loopUrl} controls muted loop playsInline preload="metadata" aria-label={`Loop video for ${c.name}`} />}
                    {c.loop_kind === "image" && p.loopUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                      <img src={p.loopUrl} alt={`Background picture uploaded for ${c.name}`} style={{ width: "100%", maxHeight: 260, objectFit: "contain", borderRadius: 12, background: "#000" }} />
                    )}
                    {c.loop_kind === "color" && c.bg_color && (
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span aria-hidden="true" style={{ width: 56, height: 36, borderRadius: 8, background: c.bg_color, border: "1px solid var(--border)" }} />
                        <span className="field-hint" style={{ margin: 0 }}>Solid colour {c.bg_color}</span>
                      </div>
                    )}
                    {c.loop_kind === "preset" && <p className="field-hint">{`Preset: ${c.loop_preset}`}</p>}
                    {(c.loop_kind === "upload" || c.loop_kind === "image") && !p.loopUrl && <p className="field-hint">{c.loop_kind === "image" ? "The picture could not be loaded." : "The video could not be loaded."}</p>}
                  </div>
                  {p.coverUrl && (
                    <div>
                      <div className="field-label">Cover</div>
                      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                      <img src={p.coverUrl} alt={`Cover picture made for ${c.name}`} style={{ width: "100%", maxHeight: 260, objectFit: "contain", borderRadius: 12, background: "#000" }} />
                    </div>
                  )}
                  <div>
                    <div className="field-label">Music</div>
                    {c.music_kind === "upload" && p.audioUrl && <audio src={p.audioUrl} controls preload="metadata" aria-label={`Track for ${c.name}`} style={{ width: "100%" }} />}
                    {c.music_kind === "upload" && !p.audioUrl && <p className="field-hint">The track could not be loaded.</p>}
                    {embed && <iframe title={`${embed.label} music for ${c.name}`} src={embed.src} height={Math.min(embed.height, 232)} loading="lazy" style={{ width: "100%", border: 0, borderRadius: 12 }} allow="encrypted-media" referrerPolicy="strict-origin-when-cross-origin" />}
                    {c.music_kind === "link" && !embed && <p className="field-hint">Unrecognised link: {c.music_url}</p>}
                    {c.music_kind === "none" && <p className="field-hint">No music.</p>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="btn btn-sm btn-primary" disabled={busy === c.id} onClick={() => decide(p, "public")}><Check size={14} aria-hidden="true" /> Approve</button>
                  <button type="button" className="btn btn-sm" disabled={busy === c.id} onClick={() => decide(p, "unlisted")}><X size={14} aria-hidden="true" /> Reject (link only)</button>
                  <button type="button" className="btn btn-sm" disabled={busy === c.id} onClick={() => decide(p, "hidden")}><EyeOff size={14} aria-hidden="true" /> Hide</button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="adm-reports">
        <h2 id="adm-reports" className="dc-h2">Open reports ({reports.length})</h2>
        {reportsError && <div className="notice notice-error" role="alert">{reportsError}</div>}
        {!reportsError && reports.length === 0 && <div className="empty card" style={{ padding: "24px 20px" }}>Nothing to review.</div>}
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
          {reports.map((r) => (
            <li key={r.id} className="card" style={{ padding: 16 }}>
              <div className="eyebrow">{KIND_LABEL[r.kind]} · {new Date(r.created_at).toLocaleString()}</div>
              {r.target ? (
                <div style={{ margin: "6px 0" }}>
                  <strong>{r.target.title}</strong>{r.target.hidden && <span className="pill" style={{ marginLeft: 8, background: "var(--surface-2)" }}>Already hidden</span>}
                  <p style={{ margin: "4px 0 0", overflowWrap: "anywhere" }}>{r.target.detail}</p>
                </div>
              ) : <p style={{ color: "var(--muted)" }}>The reported content is gone or can no longer be read.</p>}
              <p style={{ margin: "6px 0 12px", fontSize: 13.5, color: "var(--muted)" }}>Reason: {r.reason || "None given"}</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="btn btn-sm btn-primary" disabled={busy === r.id || !r.target} onClick={() => resolve(r, "hide")}><EyeOff size={14} aria-hidden="true" /> {HIDE_LABEL[r.kind]}</button>
                <button type="button" className="btn btn-sm" disabled={busy === r.id} onClick={() => resolve(r, "dismiss")}><X size={14} aria-hidden="true" /> Dismiss</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="adm-streams">
        <h2 id="adm-streams" className="dc-h2">Study with me streams</h2>
        {streamsError && <div className="notice notice-error" role="alert">{streamsError}</div>}
        <form onSubmit={add} className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
          <div className="field">
            <label className="field-label" htmlFor="st-url">YouTube link</label>
            <input id="st-url" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" required aria-describedby="st-url-hint" />
            <div id="st-url-hint" className="field-hint" aria-live="polite">{url ? (vid ? `Video id: ${vid}` : "That is not a recognised YouTube link.") : "Paste a video or live stream URL."}</div>
          </div>
          {vid && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`https://i.ytimg.com/vi/${vid}/hqdefault.jpg`} alt="Thumbnail preview" style={{ width: 200, borderRadius: 10, aspectRatio: "16/9", objectFit: "cover" }} />
          )}
          <div className="field">
            <label className="field-label" htmlFor="st-title">Title</label>
            <input id="st-title" className="input" value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="st-channel">Channel</label>
            <input id="st-channel" className="input" value={channel} maxLength={80} onChange={(e) => setChannel(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="st-kind">Type</label>
            <select id="st-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as "live" | "video")}>
              <option value="video">Video</option>
              <option value="live">Live stream</option>
            </select>
          </div>
          <div><button type="submit" className="btn btn-primary" disabled={busy === "add" || !vid}><Plus size={15} aria-hidden="true" /> Add stream</button></div>
        </form>

        <ul style={{ listStyle: "none", margin: "16px 0 0", padding: 0, display: "grid", gap: 8 }}>
          {streams.map((s) => (
            <li key={s.id} className="card" style={{ padding: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", opacity: s.is_active ? 1 : 0.7 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`https://i.ytimg.com/vi/${s.youtube_id}/default.jpg`} alt="" width={64} height={48} style={{ borderRadius: 6, objectFit: "cover" }} />
              <div style={{ flex: 1, minWidth: 160 }}>
                <div className="truncate" style={{ fontWeight: 600 }}>{s.title}</div>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>{s.channel || "No channel"} · {s.kind === "live" ? "Live" : "Video"}</div>
              </div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13.5 }}>
                <input type="checkbox" checked={s.is_active} onChange={() => toggle(s)} /> Visible
              </label>
              <button type="button" className="btn btn-sm btn-icon" onClick={() => remove(s)} aria-label={`Delete ${s.title}`}><Trash2 size={14} aria-hidden="true" /></button>
            </li>
          ))}
          {streams.length === 0 && !streamsError && <li className="empty card" style={{ padding: "20px" }}>No streams yet. Add the first one above.</li>}
        </ul>
      </section>
    </div>
  );
}
