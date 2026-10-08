"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Lock } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { toast } from "@/components/Toaster";
import { setSpacePublic } from "@/app/discover-actions";

// Shown to a space's creator only. Lists the space on Discover so anyone on Logia can join.
export function MakePublicButton({ spaceId, isPublic, description }: { spaceId: string; isPublic: boolean; description: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(description);
  const [busy, setBusy] = useState(false);

  const save = async (makePublic: boolean) => {
    if (makePublic && !text.trim()) { toast("Add a short description so people know what the space is for.", "error"); return; }
    setBusy(true);
    const res = await setSpacePublic(spaceId, makePublic, text);
    setBusy(false);
    if (res.error) { toast(res.error, "error"); return; }
    toast(makePublic ? "Your space is now public." : "Your space is private again.");
    setOpen(false);
    router.refresh();
  };

  return (
    <>
      <button type="button" className="btn btn-sm" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {isPublic ? <Globe size={14} aria-hidden="true" /> : <Lock size={14} aria-hidden="true" />}
        {isPublic ? "Public" : "Make public"}
      </button>
      {open && (
        <Dialog title={isPublic ? "Public space settings" : "Make this space public"} onClose={() => setOpen(false)} width={460}>
          <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 14 }}>
            {isPublic
              ? "Anyone on Logia can find and join this space from Discover. Making it private hides it from Discover. Current members stay."
              : "Anyone on Logia will be able to find this space on Discover and join it. They will see your notes, files and decks like any member. Only make it public if you are happy with that."}
          </p>
          <div className="field">
            <label className="field-label" htmlFor="pub-desc">Public description</label>
            <textarea id="pub-desc" className="input" rows={3} maxLength={280} value={text} onChange={(e) => setText(e.target.value)} placeholder="Who is this space for and what will you study?" style={{ resize: "vertical" }} />
            <div className="field-hint">{text.length}/280</div>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            {isPublic && <button type="button" className="btn" disabled={busy} onClick={() => save(false)}>Make private</button>}
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => save(true)}>{isPublic ? "Save description" : "Make public"}</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
