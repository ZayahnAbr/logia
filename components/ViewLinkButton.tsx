"use client";

import { useEffect, useState } from "react";
import { Link2, Copy, Check, Loader2, Eye } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { toast } from "@/components/Toaster";
import { listViewLinks, createViewLink, revokeViewLink, type ViewLink } from "@/app/view-link-actions";

// Shown in the space header to the space's creator (and, for peer spaces, anyone who may edit the header).
// Makes a link that lets anyone look at the space without an account (migration 40).
export function ViewLinkButton({ spaceId }: { spaceId: string }) {
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<ViewLink[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    listViewLinks(spaceId).then((r) => {
      if (!alive) return;
      if ("error" in r) { setErr(r.error); setLinks([]); } else { setErr(""); setLinks(r.links); }
    });
    return () => { alive = false; };
  }, [open, spaceId]);

  const urlFor = (token: string) => `${window.location.origin}/s/${token}`;

  const make = async () => {
    setBusy(true); setErr("");
    const r = await createViewLink(spaceId);
    setBusy(false);
    if ("error" in r) { setErr(r.error); return; }
    setLinks((cur) => [r.link, ...(cur ?? [])]);
  };

  const copy = async (l: ViewLink) => {
    try {
      await navigator.clipboard.writeText(urlFor(l.token));
      setCopied(l.id);
      toast("Link copied.");
      window.setTimeout(() => setCopied((c) => (c === l.id ? null : c)), 2000);
    } catch {
      toast("Couldn't copy. Select the link and copy it yourself.", "error");
    }
  };

  const revoke = async (l: ViewLink) => {
    setBusy(true); setErr("");
    const r = await revokeViewLink(l.id);
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    setLinks((cur) => (cur ?? []).filter((x) => x.id !== l.id));
    setConfirm(null);
    toast("That link no longer works.");
  };

  return (
    <>
      <button type="button" className="btn btn-sm" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Link2 size={14} aria-hidden="true" /> Share view link
      </button>
      {open && (
        <Dialog title="Share a view link" onClose={() => { setOpen(false); setConfirm(null); }} width={520}>
          <p className="vl-plain">
            Anyone with this link can look at this space&rsquo;s design and the notebooks and flashcards you&rsquo;ve shared. They need an account to copy anything. Files, papers and lectures are never shown.
          </p>
          <p className="vl-plain vl-plain-sub">
            The link works whether or not the space is public on Discover. What people may copy follows the copy options in the Make public dialog. Stop a link at any time and it stops working straight away.
          </p>

          {!links && <p role="status" className="vl-plain">Loading your links…</p>}
          {links && links.length === 0 && !err && <p className="vl-plain">You have no active links yet.</p>}
          {links && links.length > 0 && (
            <ul className="vl-links">
              {links.map((l) => (
                <li key={l.id} className="vl-link card">
                  <label className="sr-only" htmlFor={`vl-url-${l.id}`}>View link address</label>
                  <input id={`vl-url-${l.id}`} className="input vl-url" readOnly value={typeof window === "undefined" ? "" : urlFor(l.token)} onFocus={(e) => e.currentTarget.select()} />
                  <div className="vl-link-meta">
                    <span className="vl-views"><Eye size={13} aria-hidden="true" /> {l.view_count} {l.view_count === 1 ? "view" : "views"}</span>
                    <span className="vl-views">Made {new Date(l.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
                  </div>
                  {confirm === l.id ? (
                    <div className="vl-link-actions" role="group" aria-label="Confirm stopping this link">
                      <span className="vl-plain" style={{ margin: 0 }}>Stop this link for everyone?</span>
                      <button type="button" className="btn btn-sm" onClick={() => setConfirm(null)}>Keep it</button>
                      <button type="button" className="btn btn-sm btn-primary" disabled={busy} aria-busy={busy} onClick={() => revoke(l)}>Stop link</button>
                    </div>
                  ) : (
                    <div className="vl-link-actions">
                      <button type="button" className="btn btn-sm" onClick={() => copy(l)}>
                        {copied === l.id ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} {copied === l.id ? "Copied" : "Copy link"}
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => setConfirm(l.id)} aria-label="Stop this link">Stop link</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {err && <div className="notice notice-error" role="alert" style={{ marginTop: 12 }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ghost" onClick={() => { setOpen(false); setConfirm(null); }}>Close</button>
            <button type="button" className="btn btn-primary" onClick={make} disabled={busy || !links} aria-busy={busy}>
              {busy ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Working…</> : links && links.length > 0 ? "Make another link" : "Create link"}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
