"use client";
import { toast } from "@/components/Toaster";
import { Dialog } from "@/components/Dialog";
import { MathDictionary } from "@/components/MathDictionary";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Youtube from "@tiptap/extension-youtube";
import { TextStyle, Color, FontFamily, FontSize } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import * as Y from "yjs";
import { SupabaseYProvider } from "@/lib/collab/SupabaseYProvider";
import { useRoom } from "@/components/RoomProvider";
import { Avatar, AVATAR_COLORS } from "@/components/Avatar";
import { Node, mergeAttributes } from "@tiptap/core";
import { useEffect, useRef, useState } from "react";
import { Bold, Italic, Heading1, Heading2, List, ListOrdered, Strikethrough, ImageIcon, Film, Loader2, Layers, Baseline, Highlighter, ChevronDown, Sigma } from "lucide-react";
import { getNoteMediaSignedUrl } from "@/app/actions";
import { createClient } from "@/lib/supabase/client";

const FONTS = [
  { label: "Default", value: "" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Classic", value: "'Times New Roman', Times, serif" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Rounded", value: "'Trebuchet MS', 'Segoe UI', sans-serif" },
  { label: "Mono", value: "ui-monospace, 'Cascadia Code', Menlo, monospace" },
];
const SIZES = ["11", "12", "14", "16", "18", "20", "24", "28", "36"];
const TEXT_COLORS = ["#202124", "#5f6368", "#c5221f", "#e8710a", "#b06000", "#188038", "#1967d2", "#7b1fa2", "#c2185b"];
const HL_COLORS = [
  { label: "Yellow", value: "#fff2a8" }, { label: "Green", value: "#cdeec8" }, { label: "Blue", value: "#cfe3fb" },
  { label: "Pink", value: "#fbd3e3" }, { label: "Orange", value: "#fde0c4" }, { label: "Purple", value: "#e4d7f7" },
];

const Iframe = Node.create({
  name: "iframe",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      src: { default: null },
      style: { default: "width:100%;aspect-ratio:16/9;border:none;border-radius:10px;margin:10px 0;" },
    };
  },
  parseHTML() { return [{ tag: "iframe" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["iframe", mergeAttributes(HTMLAttributes, { allowfullscreen: "true" })];
  },
});

export function RichEditor({
  value,
  onChange,
  spaceId,
  onMakeFlashcard,
  makingFlashcard,
  noteId,
}: {
  value: string;
  onChange: (html: string) => void;
  spaceId: string;
  onMakeFlashcard?: (selectedText: string) => void;
  makingFlashcard?: boolean;
  noteId?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  // Must sit above the early return below: hooks run in the same order every render.
  const [videoOpen, setVideoOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoErr, setVideoErr] = useState<string | null>(null);
  const [palette, setPalette] = useState<"color" | "hl" | null>(null);
  const [dict, setDict] = useState(false);
  const [, force] = useState(0); // re-render toolbar when the cursor moves, so pickers show current values


  // Colour palettes close on outside click or Escape.
  useEffect(() => {
    if (!palette) return;
    const onDown = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest(".doc-pop-wrap")) setPalette(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPalette(null); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [palette]);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // ── Live co-editing: one Yjs doc per note, synced over Supabase Realtime ──
  const { me } = useRoom();
  const [collab] = useState(() => {
    if (!noteId || typeof window === "undefined") return null;
    const doc = new Y.Doc();
    return { doc, provider: null as SupabaseYProvider | null };
  });
  // Until the shared doc has the note's real content (from the DB or a peer), never report changes:
  // otherwise the editor's empty starting state would be autosaved over the note.
  const ready = useRef(!noteId);
  const [peers, setPeers] = useState<{ id: number; name: string; color: string; icon?: string | null; colorId?: string | null }[]>([]);
  const myColor = AVATAR_COLORS.find((c) => c.id === me?.color)?.hex ?? "#f2836b";
  if (collab && !collab.provider && me) {
    collab.provider = new SupabaseYProvider(createClient(), noteId!, collab.doc, { name: me.name, color: myColor, icon: me.icon, colorId: me.color } as never);
  }

  const editor = useEditor({
    extensions: [
      collab ? StarterKit.configure({ undoRedo: false }) : StarterKit,
      Image.configure({ HTMLAttributes: { style: "max-width:100%;border-radius:10px;margin:10px 0;" } }),
      Youtube.configure({ width: 560, height: 315, HTMLAttributes: { style: "border-radius:10px;margin:10px 0;" } }),
      Iframe,
      TextStyle, Color, FontFamily, FontSize,
      Highlight.configure({ multicolor: true }),
      ...(collab && collab.provider ? [
        Collaboration.configure({ document: collab.doc }),
        CollaborationCaret.configure({ provider: collab.provider, user: { name: me!.name.split(/\s+/)[0], color: myColor } }),
      ] : []),
    ],
    content: collab && collab.provider ? undefined : value,
    immediatelyRender: false,
    editorProps: { attributes: { class: "tiptap md" } },
    onUpdate: ({ editor }) => { if (ready.current) onChange(editor.getHTML()); },
    onSelectionUpdate: ({ editor }) => { setHasSelection(!editor.state.selection.empty); force((n) => n + 1); },
    onTransaction: () => force((n) => n + 1),
  }, [!!collab?.provider]);

  useEffect(() => {
    const p = collab?.provider;
    if (!p || !editor) return;
    let alive = true;
    p.synced.then((fromPeer) => {
      if (!alive) return;
      const empty = collab!.doc.getXmlFragment("default").length === 0;
      if (!fromPeer && empty && value) editor.commands.setContent(value, { emitUpdate: false });
      ready.current = true;
    });
    const onAw = () => {
      const list = [...p.awareness.getStates().entries()]
        .filter(([id, st]) => id !== collab!.doc.clientID && st.user)
        .map(([id, st]) => ({ id, ...(st.user as { name: string; color: string; icon?: string | null; colorId?: string | null }) }));
      setPeers(list);
    };
    p.awareness.on("change", onAw);
    return () => { alive = false; p.awareness.off("change", onAw); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);
  useEffect(() => () => { collab?.provider?.destroy(); collab?.doc.destroy(); }, [collab]);

  useEffect(() => {
    // With live co-editing the shared doc is the source of truth; never overwrite it from props.
    if (editor && !collab && value !== editor.getHTML()) editor.commands.setContent(value || "");
  }, [value, editor]);

  if (!editor) return null;

  const Btn = ({ on, active, children, label, disabled }: { on: () => void; active: boolean; children: React.ReactNode; label: string; disabled?: boolean }) => (
    <button type="button" className="btn btn-ghost" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={on}
      style={{ width: 34, height: 34, padding: 0, color: active ? "var(--accent)" : "var(--muted)", background: active ? "var(--accent-soft)" : "transparent" }}>
      {children}
    </button>
  );

  const uploadAndGetUrl = async (file: File): Promise<string | null> => {
    if (!file || file.size === 0) return null;
    if (file.size > 25 * 1024 * 1024) { toast(`"${file.name}" is over the 25 MB limit. Choose a smaller file.`, "error"); return null; }
    const supabase = createClient();
    const safeName = file.name.replace(/[^\w.\-]/g, "_");
    const path = `${spaceId}/note-media-${crypto.randomUUID()}-${safeName}`;
    const { error: upErr } = await supabase.storage.from("space-files").upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) { toast("Upload failed: " + upErr.message, "error"); return null; }
    const res = await getNoteMediaSignedUrl(path);
    if (res.error) { toast(res.error, "error"); return null; }
    return res.url ?? null;
  };

  const insertImage = async (file: File) => {
    setUploading(true);
    const url = await uploadAndGetUrl(file);
    if (url) editor.chain().focus().setImage({ src: url }).run();
    setUploading(false);
  };


  const insertVideoLink = (raw: string) => {
    let u: URL;
    try { u = new URL(raw.trim()); } catch { setVideoErr("That doesn't look like a link. Paste the full address, starting with https://"); return; }
    if (u.protocol !== "https:" && u.protocol !== "http:") { setVideoErr("Only http(s) links can be embedded."); return; }
    const url = u.href.replace(/"/g, "%22").replace(/</g, "%3C").replace(/>/g, "%3E");
    if (/youtube\.com|youtu\.be/.test(u.hostname)) editor.chain().focus().setYoutubeVideo({ src: url }).run();
    else if (/\.(mp4|webm|ogg)$/i.test(u.pathname)) editor.chain().focus().insertContent(`<video src="${url}" controls style="max-width:100%;border-radius:10px;margin:10px 0;"></video>`).run();
    else editor.chain().focus().insertContent(`<iframe src="${url}" style="width:100%;aspect-ratio:16/9;border:none;border-radius:10px;margin:10px 0;" allowfullscreen></iframe>`).run();
    setVideoOpen(false); setVideoUrl(""); setVideoErr(null);
  };

  return (
    <div>
      <div className="doc-tools no-print">
        {peers.length > 0 && (
          <span className="doc-peers" title={`Also editing: ${peers.map((x) => x.name).join(", ")}`}>
            {peers.slice(0, 4).map((x) => <Avatar key={x.id} name={x.name} color={x.colorId} icon={x.icon} size={26} ring />)}
            <span className="sr-only">{peers.length} other {peers.length === 1 ? "person is" : "people are"} editing</span>
          </span>
        )}
        <Btn label="Heading" active={editor.isActive("heading", { level: 1 })} on={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 size={15} /></Btn>
        <Btn label="Subheading" active={editor.isActive("heading", { level: 2 })} on={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={15} /></Btn>
        <Btn label="Bold" active={editor.isActive("bold")} on={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></Btn>
        <Btn label="Italic" active={editor.isActive("italic")} on={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></Btn>
        <Btn label="Strikethrough" active={editor.isActive("strike")} on={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={15} /></Btn>
        <div style={{ width: 1, background: "var(--border-soft)", margin: "4px 4px" }} />
        <label className="doc-select">
          <span className="sr-only">Font</span>
          <select value={(editor.getAttributes("textStyle").fontFamily as string) ?? ""} title="Font"
            onChange={(e) => { const v = e.target.value; const c = editor.chain().focus(); (v ? c.setFontFamily(v) : c.unsetFontFamily()).run(); }}>
            {FONTS.map((x) => <option key={x.label} value={x.value} style={{ fontFamily: x.value || undefined }}>{x.label}</option>)}
          </select>
          <ChevronDown size={12} aria-hidden="true" />
        </label>
        <label className="doc-select doc-size">
          <span className="sr-only">Text size</span>
          <select value={String(editor.getAttributes("textStyle").fontSize ?? "").replace("px", "")} title="Text size"
            onChange={(e) => { const v = e.target.value; const c = editor.chain().focus(); (v ? c.setFontSize(`${v}px`) : c.unsetFontSize()).run(); }}>
            <option value="">Size</option>
            {SIZES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <ChevronDown size={12} aria-hidden="true" />
        </label>
        <div className="doc-pop-wrap">
          <Btn label="Text colour" active={palette === "color"} on={() => setPalette((p) => (p === "color" ? null : "color"))}>
            <span className="doc-colour-ico"><Baseline size={15} /><i style={{ background: (editor.getAttributes("textStyle").color as string) || "#202124" }} /></span>
          </Btn>
          {palette === "color" && (
            <div className="doc-pop" role="dialog" aria-label="Text colour">
              {TEXT_COLORS.map((c) => (
                <button key={c} type="button" className="doc-swatch" style={{ background: c }} aria-label={`Text colour ${c}`}
                  onClick={() => { editor.chain().focus().setColor(c).run(); setPalette(null); }} />
              ))}
              <label className="doc-swatch doc-custom" title="Custom colour">
                <span className="sr-only">Custom text colour</span>
                <input type="color" onChange={(e) => editor.chain().focus().setColor(e.target.value).run()} />
              </label>
              <button type="button" className="btn btn-ghost btn-sm doc-reset" onClick={() => { editor.chain().focus().unsetColor().run(); setPalette(null); }}>Reset</button>
            </div>
          )}
        </div>
        <div className="doc-pop-wrap">
          <Btn label="Highlight" active={palette === "hl" || editor.isActive("highlight")} on={() => setPalette((p) => (p === "hl" ? null : "hl"))}>
            <span className="doc-colour-ico"><Highlighter size={15} /><i style={{ background: (editor.getAttributes("highlight").color as string) || "#fff2a8" }} /></span>
          </Btn>
          {palette === "hl" && (
            <div className="doc-pop" role="dialog" aria-label="Highlight colour">
              {HL_COLORS.map((c) => (
                <button key={c.value} type="button" className="doc-swatch" style={{ background: c.value }} aria-label={`${c.label} highlight`}
                  onClick={() => { editor.chain().focus().setHighlight({ color: c.value }).run(); setPalette(null); }} />
              ))}
              <button type="button" className="btn btn-ghost btn-sm doc-reset" onClick={() => { editor.chain().focus().unsetHighlight().run(); setPalette(null); }}>None</button>
            </div>
          )}
        </div>
        <div style={{ width: 1, background: "var(--border-soft)", margin: "4px 4px" }} />
        <Btn label="Bullets" active={editor.isActive("bulletList")} on={() => editor.chain().focus().toggleBulletList().run()}><List size={15} /></Btn>
        <Btn label="Numbered" active={editor.isActive("orderedList")} on={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={15} /></Btn>
        <div style={{ width: 1, background: "var(--border-soft)", margin: "4px 4px" }} />
        <Btn label="Insert image" active={false} disabled={uploading} on={() => imageInputRef.current?.click()}>
          {uploading ? <Loader2 size={15} className="spin" /> : <ImageIcon size={15} />}
        </Btn>
        <Btn label="Math dictionary" active={dict} on={() => setDict(true)}><Sigma size={15} /></Btn>
        <Btn label="Insert video link" active={false} on={() => { setVideoErr(null); setVideoOpen(true); }}><Film size={15} /></Btn>
        <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) insertImage(f); e.target.value = ""; }} />
        {onMakeFlashcard && (
          <>
            <div style={{ width: 1, background: "var(--border-soft)", margin: "4px 4px" }} />
            <button
              type="button"
              className="btn btn-ghost"
              title="Turn the highlighted text into a flashcard"
              disabled={!hasSelection || makingFlashcard}
              onClick={() => {
                const { from, to } = editor.state.selection;
                const text = editor.state.doc.textBetween(from, to, " ");
                onMakeFlashcard(text);
              }}
              style={{ height: 34, fontSize: 12.5, color: hasSelection ? "var(--accent)" : "var(--faint)" }}
            >
              {makingFlashcard ? <Loader2 size={14} className="spin" /> : <Layers size={14} />} Make flashcard
            </button>
          </>
        )}
      </div>
      <EditorContent editor={editor} />
      {dict && (
        <MathDictionary onClose={() => setDict(false)} onInsert={(t) => {
          const e = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          editor.chain().focus().insertContent(`<p><strong>${e(t.term)}:</strong> ${e(t.plain ?? t.def)}</p>`).run();
          setDict(false);
        }} />
      )}
      {videoOpen && (
        <Dialog title="Embed a video" onClose={() => setVideoOpen(false)}>
          <form onSubmit={(e) => { e.preventDefault(); insertVideoLink(videoUrl); }} style={{ display: "grid", gap: 12 }}>
            <label className="field">
              <span className="field-label">Video link</span>
              <input className="input" type="url" autoFocus required placeholder="https://youtu.be/…" value={videoUrl}
                onChange={(e) => { setVideoUrl(e.target.value); setVideoErr(null); }} aria-invalid={!!videoErr} aria-describedby="video-hint" />
              <span id="video-hint" className={videoErr ? "field-error" : "field-hint"}>{videoErr ?? "YouTube, Vimeo, or a direct .mp4 / .webm file."}</span>
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setVideoOpen(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={!videoUrl.trim()}>Embed video</button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
