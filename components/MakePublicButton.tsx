"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Globe, Lock, X } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { toast } from "@/components/Toaster";
import { publishSpace, makeSpacePrivate, getMyPublicState, rescanIfDue } from "@/app/discover-actions";
import { FORMAT_TAGS, LEVELS, MAX_TAGS, SUBJECT_TAGS, normaliseTags } from "@/lib/spaceTags";
import { hasBlockedWord } from "@/lib/moderation";
import { setCloneOptions, saveDesignLayout } from "@/app/shared-items-actions";

// Shown to a space's creator only. Lists the space on Discover so anyone on Logia can look around and copy it.
export function MakePublicButton({ spaceId, isPublic, description, cloneReady = false, allowDesign = true, allowContent = false }: {
  spaceId: string; isPublic: boolean; description: string; cloneReady?: boolean; allowDesign?: boolean; allowContent?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(description);
  const [busy, setBusy] = useState(false);
  // A space that is already public starts unticked until its creator confirms (set by migration 39).
  const [design, setDesign] = useState(allowDesign);
  const [content, setContent] = useState(allowContent);

  const [status, setStatus] = useState<"private" | "pending" | "public" | "rejected">(isPublic ? "public" : "private");
  const [tags, setTags] = useState<string[]>([]);
  const [tagText, setTagText] = useState("");
  const [level, setLevel] = useState("");
  const [school, setSchool] = useState("");
  const [note, setNote] = useState("");

  // Loads the saved tags and status; a public space is re-checked here when something changed (debounced in the database).
  useEffect(() => {
    let alive = true;
    (async () => {
      if (isPublic) await rescanIfDue(spaceId);
      const st = await getMyPublicState(spaceId);
      if (!alive || !st) return;
      setStatus(st.status); setTags(st.tags); setLevel(st.level); setSchool(st.institution);
      if ((st.status === "public") !== isPublic) router.refresh();
    })();
    return () => { alive = false; };
  }, [spaceId, isPublic, router]);

  const addTag = (raw: string) => {
    const [t] = normaliseTags([raw]);
    if (!t || tags.includes(t) || tags.length >= MAX_TAGS) return;
    setTags([...tags, t]); setTagText("");
  };
  const toggleTag = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : cur.length < MAX_TAGS ? [...cur, t] : cur));

  const makePrivate = async () => {
    setBusy(true);
    const res = await makeSpacePrivate(spaceId);
    setBusy(false);
    if (res.error) { setNote(res.error); return; }
    setStatus("private"); toast("Your space is private again.");
    setOpen(false); router.refresh();
  };

  const save = async () => {
    setNote("");
    if (!text.trim()) { setNote("Add a short description so people know what the space is for."); return; }
    if (hasBlockedWord([text, school, ...tags].join(" "))) { setNote("The description, tags or school can't be shown publicly. Edit them, then try again."); return; }
    setBusy(true);
    const res = await publishSpace(spaceId, { description: text, tags, institution: school, level, allowDesign: cloneReady ? design : undefined, allowContent: cloneReady ? content : undefined });
    if (res.error) { setBusy(false); setNote(res.error); return; }
    if (res.status === "public" && cloneReady) {
      // Saved after publishing; a failure here never blocks the space from being public.
      const o = await setCloneOptions(spaceId, design, content);
      if (design) {
        try {
          const raw = window.localStorage.getItem(`logia.space.${spaceId}.layout`);
          if (raw) await saveDesignLayout(spaceId, JSON.parse(raw));
        } catch { /* no saved layout on this device: copies use the default layout */ }
      }
      if (o.error) setNote(o.error);
    }
    setBusy(false);
    if (res.status) setStatus(res.status);
    if (res.status === "public") { toast("Your space is now public."); setOpen(false); }
    else setNote(res.message ?? "");
    router.refresh();
  };

  return (
    <>
      <button type="button" className="btn btn-sm" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {isPublic ? <Globe size={14} aria-hidden="true" /> : status === "pending" ? <Clock size={14} aria-hidden="true" /> : <Lock size={14} aria-hidden="true" />}
        {isPublic ? "Public" : status === "pending" ? "Pending review" : "Make public"}
      </button>
      {open && (
        <Dialog title={isPublic ? "Public space settings" : "Make this space public"} onClose={() => setOpen(false)} width={460}>
          <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 14 }}>
            {isPublic
              ? "Anyone on Logia can find this space on Discover, look around, and copy it into a space of their own. They can never change your original. Making it private hides it from Discover."
              : status === "pending" ? "We're checking your space before it appears on Discover. It stays private until then. You can update the details below and send it again."
              : "Anyone on Logia will be able to find this space on Discover, look around, and copy it into a space of their own to edit. They can never change your original. Only make it public if you are happy with that. We check public spaces before they appear on Discover."}
          </p>
          <p className="field-hint" role="note" style={{ marginTop: 0 }}>
            Public spaces are only visible to people signed in to Logia, never to search engines. Even so, don&rsquo;t
            put your university&rsquo;s material here: lecture slides, past papers, memos and textbooks usually belong to
            the university or the publisher. Your own notes and flashcards are fine.
          </p>
          <div className="field">
            <label className="field-label" htmlFor="pub-desc">Public description</label>
            <textarea id="pub-desc" className="input" rows={3} maxLength={280} value={text} onChange={(e) => setText(e.target.value)} placeholder="Who is this space for and what will you study?" style={{ resize: "vertical" }} />
            <div className="field-hint">{text.length}/280</div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="pub-tag">Tags ({tags.length}/{MAX_TAGS})</label>
            {tags.length > 0 && (
              <ul style={{ listStyle: "none", margin: "0 0 8px", padding: 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {tags.map((t) => (
                  <li key={t} className="pill" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {t}
                    <button type="button" onClick={() => toggleTag(t)} aria-label={`Remove tag ${t}`} style={{ background: "none", border: 0, padding: 4, cursor: "pointer", color: "inherit", display: "inline-flex" }}><X size={12} aria-hidden="true" /></button>
                  </li>
                ))}
              </ul>
            )}
            <input id="pub-tag" className="input" value={tagText} maxLength={24} disabled={tags.length >= MAX_TAGS} placeholder="Type a tag and press Enter" aria-describedby="pub-tag-hint"
              onChange={(e) => setTagText(e.target.value.replace(",", ""))}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagText); } }} />
            <div id="pub-tag-hint" className="field-hint">2 to 24 letters, numbers, spaces or hyphens. Tags help people find your space.</div>
            {[["Subjects", SUBJECT_TAGS], ["Formats", FORMAT_TAGS]].map(([label, list]) => (
              <div key={label as string} role="group" aria-label={`${label} suggestions`} style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {(list as string[]).map((t) => (
                  <button key={t} type="button" className="btn btn-sm" aria-pressed={tags.includes(t)} onClick={() => toggleTag(t)}
                    style={tags.includes(t) ? { background: "var(--ink)", color: "var(--on-ink)" } : undefined}>{t}</button>
                ))}
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <div className="field">
              <label className="field-label" htmlFor="pub-level">Level (optional)</label>
              <select id="pub-level" className="input" value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="">Not set</option>
                {LEVELS.map((l) => <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="pub-school">University or school (optional)</label>
              <input id="pub-school" className="input" value={school} maxLength={60} onChange={(e) => setSchool(e.target.value)} />
            </div>
          </div>
          {cloneReady && (
            <fieldset className="shr-fs" style={{ marginTop: 12 }}>
              <legend>Copying</legend>
              <label className="shr-check">
                <input type="checkbox" checked={design} onChange={(e) => setDesign(e.target.checked)} />
                <span><strong>Let people copy this space&rsquo;s design</strong><br /><span className="shr-meta">This includes your stickers, text, sticky notes (which may hold personal reminders), colours, header and home page layout. Anyone on Logia could then copy them into a space of their own.</span></span>
              </label>
              <label className="shr-check">
                <input type="checkbox" checked={content} onChange={(e) => setContent(e.target.checked)} />
                <span><strong>Let people copy my notes and flashcards</strong><br /><span className="shr-meta">Off unless you tick it. Files, books, audio, papers and chat are never copied.</span></span>
              </label>
            </fieldset>
          )}
          <p role="status" aria-live="polite" style={{ margin: "12px 0 0", fontSize: 14, color: "var(--muted)" }}>{note}</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            {(isPublic || status === "pending") && <button type="button" className="btn" disabled={busy} onClick={makePrivate}>Make private</button>}
            <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Checking..." : isPublic ? "Save changes" : status === "pending" ? "Send again" : "Make public"}</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
