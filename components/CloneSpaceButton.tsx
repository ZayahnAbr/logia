"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2 } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { toast } from "@/components/Toaster";
import { cloneSpace, getCloneOptions } from "@/app/shared-items-actions";

type Mode = "design" | "both" | "content";

// Copies a PUBLIC space into a new space owned by the person. Used on Discover and on a public space's home.
// Only the options the space's creator allowed are offered.
export function CloneSpaceButton({ spaceId, spaceName, className = "btn btn-ghost", viewToken, options, autoOpen = false }: {
  spaceId: string; spaceName: string; className?: string;
  /** Copying through a view link (migration 40): the options are already known and the space need not be public. */
  viewToken?: string; options?: { design: boolean; content: boolean }; autoOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const [opts, setOpts] = useState<{ design: boolean; content: boolean } | { error: string } | null>(options ?? null);
  const [mode, setMode] = useState<Mode>(options ? (options.design ? "design" : "content") : "design");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open || options) return;
    let alive = true;
    getCloneOptions(spaceId).then((o) => {
      if (!alive) return;
      setOpts(o);
      if (!("error" in o)) setMode(o.design ? "design" : "content");
    });
    return () => { alive = false; };
  }, [open, spaceId, options]);

  const ok = opts && !("error" in opts) ? opts : null;
  const none = ok && !ok.design && !ok.content;

  const go = async () => {
    setBusy(true); setErr("");
    const res = await cloneSpace(spaceId, mode !== "content", mode !== "design", viewToken);
    setBusy(false);
    if ("error" in res) { setErr(res.error); return; }
    const bits = [
      res.stickers ? `${res.stickers} stickers` : "", res.notes ? `${res.notes} notes` : "", res.cards ? `${res.cards} cards` : "",
    ].filter(Boolean).join(", ");
    toast(`Copied.${bits ? ` ${bits}.` : ""}${res.skipped ? ` ${res.skipped} picture${res.skipped === 1 ? "" : "s"} could not be copied and ${res.skipped === 1 ? "was" : "were"} left out.` : ""}${res.truncated ? " Some items were cut to the size limit." : ""}${res.images_removed ? " Pictures inside notes were not copied." : ""}`);
    router.push(`/spaces/${res.space_id}`);
  };

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={`Copy ${spaceName} to my own space`}>
        <Copy size={14} aria-hidden="true" /> Copy space
      </button>
      {open && (
        <Dialog title="Copy this space" onClose={() => setOpen(false)} width={500}>
          <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 14 }}>
            You get a new space of your own called &ldquo;{spaceName} (copy)&rdquo;. You are its only member and the original is not changed.
          </p>
          {!opts && <p role="status" style={{ color: "var(--muted)" }}>Checking what the creator allows…</p>}
          {opts && "error" in opts && <div className="notice notice-error" role="alert">{opts.error}</div>}
          {none && <p>The creator of this space has not allowed copying it.</p>}
          {ok && !none && (
            <fieldset className="shr-fs">
              <legend>What should be copied?</legend>
              {ok.design && (
                <label className="shr-check">
                  <input type="radio" name="clone-mode" checked={mode === "design"} onChange={() => setMode("design")} />
                  <span><strong>Copy the design</strong><br /><span className="shr-meta">Name, subject, header, home page stickers, text and sticky notes, colours, widget layout, and empty notebooks and decks with the same names and covers.</span></span>
                </label>
              )}
              {ok.design && ok.content && (
                <label className="shr-check">
                  <input type="radio" name="clone-mode" checked={mode === "both"} onChange={() => setMode("both")} />
                  <span><strong>Copy design and content</strong><br /><span className="shr-meta">The design above, plus the notes and flashcards the creator wrote (up to 200 notes per notebook and 1000 cards per deck).</span></span>
                </label>
              )}
              {ok.content && !ok.design && (
                <label className="shr-check">
                  <input type="radio" name="clone-mode" checked={mode === "content"} onChange={() => setMode("content")} />
                  <span><strong>Copy notes and flashcards only</strong><br /><span className="shr-meta">The notes and flashcards the creator wrote, in notebooks and decks with the same names.</span></span>
                </label>
              )}
            </fieldset>
          )}
          <p className="shr-meta" style={{ margin: "12px 0 0" }}>
            Never copied: files, library books, lecture audio, past papers, chat, members, calendar events, course marks and review history. Pictures inside notes are left out. A picture that cannot be copied is skipped. You can copy up to 5 spaces a day.
          </p>
          {err && <div className="notice notice-error" role="alert" style={{ marginTop: 12 }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={go} disabled={busy || !ok || !!none} aria-busy={busy}>
              {busy ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Copying…</> : "Copy space"}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
