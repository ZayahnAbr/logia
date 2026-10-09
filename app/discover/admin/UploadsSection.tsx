"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { listPendingUploads, lookupUser, reviewUploadAction, setBan, type MediaAction, type PendingUpload, type UserLookup } from "@/app/upload-admin-actions";
import { toast } from "@/components/Toaster";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" });
const WHY: Record<string, string> = { checking: "The check never finished", unavailable: "The check could not run", unsure: "Not sure", unsafe: "Looks unsafe" };

// Pictures and videos wait here until the automatic check clears them or an admin decides (migration 43).
export function UploadsSection() {
  const [items, setItems] = useState<PendingUpload[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [email, setEmail] = useState("");
  const [found, setFound] = useState<UserLookup | null>(null);
  const [lookupErr, setLookupErr] = useState("");
  const [showSteps, setShowSteps] = useState(false);

  const load = async () => {
    const r = await listPendingUploads();
    if ("error" in r) { setErr(r.error); setItems([]); } else { setErr(""); setItems(r.items); }
  };
  useEffect(() => { void load(); }, []);

  const act = async (u: PendingUpload, action: MediaAction) => {
    if (action === "preserve" && !window.confirm("Hide this from everyone, keep the file as evidence and ban the account? Use this only for suspected child sexual abuse material.")) return;
    if (action === "strike" && !window.confirm("Remove this upload and add a strike to the account?")) return;
    const key = u.bucket + u.path;
    setBusy(key);
    const r = await reviewUploadAction(u.bucket, u.path, action, note);
    setBusy("");
    if ("error" in r) { toast(r.error, "error"); return; }
    toast(r.message);
    if (action === "preserve") setShowSteps(true);
    await load();
  };

  const find = async (e: React.FormEvent) => {
    e.preventDefault();
    setLookupErr(""); setFound(null);
    const r = await lookupUser(email);
    if ("error" in r) setLookupErr(r.error); else setFound(r.user);
  };
  const ban = async (banned: boolean) => {
    if (!found) return;
    if (banned && !window.confirm(`Ban ${found.email}? They will see an account-suspended page.`)) return;
    const r = await setBan(found.id, banned, note);
    if (r.error) { toast(r.error, "error"); return; }
    toast(banned ? "Account banned." : "Account restored.");
    const again = await lookupUser(found.email);
    if ("user" in again) setFound(again.user);
  };

  return (
    <section aria-labelledby="adm-uploads">
      <h2 id="adm-uploads" className="dc-h2">Uploads awaiting review{items && items.length ? ` (${items.length})` : ""}</h2>
      {err && <div className="notice notice-error" role="alert">{err}</div>}
      {items && !items.length && !err && <p style={{ color: "var(--muted)" }}>Nothing is waiting.</p>}
      <div style={{ display: "grid", gap: 12 }}>
        {(items ?? []).map((u) => (
          <article key={u.bucket + u.path} className="card" style={{ padding: 16, display: "grid", gap: 10 }} aria-label={`${u.kind} from ${u.email ?? "unknown"}`}>
            <div>
              <strong style={{ overflowWrap: "anywhere" }}>{u.email ?? u.user_id}</strong>
              <div style={{ fontSize: 14, color: "var(--muted)" }}>
                {u.kind === "video" ? "Video" : "Picture"} in {u.bucket}, {fmt(u.created_at)}. {WHY[u.outcome] ?? u.outcome}{u.category ? `: ${u.category}` : ""}{u.reason ? ` (${u.reason})` : ""}. Strikes: {u.strikes}.
              </div>
            </div>
            {u.url && /* eslint-disable-next-line @next/next/no-img-element */ <img src={u.url} alt="Uploaded picture awaiting review" style={{ maxWidth: "100%", maxHeight: 320, objectFit: "contain", borderRadius: 8 }} />}
            {u.frames && u.frames.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {u.frames.map((f, i) => <img key={i} src={f} alt={`Video frame ${i + 1} of ${u.frames!.length}`} style={{ width: 120, borderRadius: 6 }} />)}
              </div>
            )}
            {u.kind === "video" && !u.frames?.length && <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>No frames were taken. Open the file from storage ({u.bucket}/{u.path}) to look at it.</p>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => act(u, "approve")}>Approve</button>
              <button type="button" className="btn" disabled={!!busy} onClick={() => act(u, "remove")}>Remove (no strike)</button>
              <button type="button" className="btn" disabled={!!busy} onClick={() => act(u, "strike")}>Remove and strike</button>
              <button type="button" className="btn" disabled={!!busy} onClick={() => act(u, "preserve")}>Preserve and report</button>
            </div>
          </article>
        ))}
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label className="field-label" htmlFor="up-note">Note for the record (optional, used for strikes and bans)</label>
        <input id="up-note" className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
      </div>

      {showSteps && (
        <div className="card" style={{ padding: 16, marginTop: 12 }} role="region" aria-label="Reporting steps">
          <strong>Reporting steps</strong>
          <ol style={{ margin: "8px 0 0", paddingLeft: 20, display: "grid", gap: 4 }}>
            <li>Do not open, copy or forward the file. It is hidden and kept in storage as evidence.</li>
            <li>Write down the account email, the time and the file reference shown above.</li>
            <li>Report it to the Film and Publication Board (fpb.org.za, online reporting for child sexual abuse material).</li>
            <li>Report it to the South African Police Service (open a case at a police station, or the Crime Stop line 08600 10111) and keep the case number.</li>
            <li>Keep the file until the police or the Film and Publication Board tell you it can be released.</li>
          </ol>
        </div>
      )}

      <h3 className="dc-h2" style={{ fontSize: 16, marginTop: 20 }}>Look up a person</h3>
      <form onSubmit={find} className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
        <div className="field">
          <label className="field-label" htmlFor="up-email">Student email</label>
          <input id="up-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
        </div>
        <div><button type="submit" className="btn btn-primary" disabled={!email}><Search size={15} aria-hidden="true" /> Look up</button></div>
        {lookupErr && <div className="notice notice-error" role="alert">{lookupErr}</div>}
      </form>
      {found && (
        <div className="card" style={{ padding: 16, display: "grid", gap: 10, marginTop: 12 }} aria-live="polite">
          <strong style={{ overflowWrap: "anywhere" }}>{found.email}</strong>
          <div style={{ fontSize: 14, color: "var(--muted)" }}>
            {found.banned ? "Banned." : found.blockedUntil && new Date(found.blockedUntil) > new Date() ? `Uploads and hosting blocked until ${fmt(found.blockedUntil)}.` : "In good standing."}{" "}
            Strikes: {found.strikes.filter((s) => s.kind === "strike").length}.
          </div>
          {found.strikes.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
              {found.strikes.map((s, i) => <li key={i}>{fmt(s.at)}: {s.kind === "strike" ? "Strike" : s.kind === "ban" ? "Banned" : "Restored"}, {s.reason}{s.ref ? ` (${s.ref})` : ""}</li>)}
            </ul>
          )}
          <div>{found.banned ? <button type="button" className="btn" onClick={() => ban(false)}>Restore account</button> : <button type="button" className="btn" onClick={() => ban(true)}>Ban account</button>}</div>
        </div>
      )}
    </section>
  );
}
