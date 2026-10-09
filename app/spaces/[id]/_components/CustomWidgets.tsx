"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Plus, Upload, Link2, Type, Trash2, Play, Pause, Loader2, ImageIcon, Heading, AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import { dropProps } from "@/lib/dropProps";
import { Dialog } from "@/components/Dialog";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/Toaster";
import { uploadBlocked, checkUploaded } from "@/lib/uploadSafety";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_TEXT, WIDGET_BUCKET, STICKY_COLORS, STICKY_MAX_TEXT, type GifData, type ImageData, type TextData, type StickyData } from "@/lib/customWidgets";
import { addStickyNote, saveStickyNote, addImageLink, addTextWidget, addUploadedImage, removeCustomWidget, saveTextWidget } from "../widget-actions";

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

// Animated pictures start still when the person prefers reduced motion, and can always be paused (WCAG 2.2.2).
function MotionImage({ src, still, alt, animated, noReferrer }: { src: string; still?: string; alt: string; animated: boolean; noReferrer?: boolean }) {
  const reduced = useReducedMotion();
  const [override, setOverride] = useState<boolean | null>(null);
  const playing = animated && (override ?? !reduced);
  const canvas = useRef<HTMLCanvasElement>(null);
  const useCanvas = animated && !playing && !still;

  useEffect(() => {
    if (!useCanvas) return;
    const img = new Image();
    if (noReferrer) img.referrerPolicy = "no-referrer";
    img.onload = () => {
      const c = canvas.current;
      if (!c) return;
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext("2d")?.drawImage(img, 0, 0);
    };
    img.src = src;
  }, [useCanvas, src, noReferrer]);

  return (
    <div className="cw-media">
      {useCanvas ? <canvas ref={canvas} className="cw-img" role="img" aria-label={alt} />
        : // eslint-disable-next-line @next/next/no-img-element
        <img className="cw-img" src={animated && !playing && still ? still : src} alt={alt} loading="lazy" decoding="async" referrerPolicy={noReferrer ? "no-referrer" : undefined} />}
      {animated && (
        <button type="button" className="cw-play btn btn-sm" aria-pressed={playing} onClick={() => setOverride(!playing)}>
          {playing ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />} {playing ? "Pause" : "Play"}
          <span className="sr-only"> animation</span>
        </button>
      )}
    </div>
  );
}

function RemoveButton({ spaceId, id, label }: { spaceId: string; id: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="cw-foot">
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} aria-busy={busy} aria-label={`Remove ${label}`}
        onClick={async () => { setBusy(true); const r = await removeCustomWidget(spaceId, id); if (r.error) { setError(r.error); setBusy(false); } }}>
        {busy ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />} Remove
      </button>
      {error && <span role="alert" className="cw-err">{error}</span>}
    </div>
  );
}

export function GifWidgetView({ spaceId, id, data }: { spaceId: string; id: string; data: GifData }) {
  return (
    <div className="cw-card card">
      <MotionImage src={data.url} still={data.still} alt={data.title} animated />
      <div className="cw-foot">
        <span className="cw-credit">Powered by GIPHY</span>
      </div>
      <RemoveButton spaceId={spaceId} id={id} label={data.title} />
    </div>
  );
}

// The picture itself: no card, background, border or shadow. Placement is handled by StickerLayer.
export function ImageStickerBody({ data, src }: { data: ImageData; src: string | null }) {
  return src ? (
    <figure className="cw-fig st-fig">
      <MotionImage src={src} alt={data.alt} animated={data.animated} noReferrer />
      {data.caption && <figcaption>{data.caption}</figcaption>}
    </figure>
  ) : <p className="cw-note">This image could not be loaded.</p>;
}

export function TextStickerBody({ id, data }: { id: string; data: TextData }) {
  const [val, setVal] = useState<TextData>(data);
  const [state, setState] = useState<"saved" | "saving" | "error">("saved");
  const first = useRef(true);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setState("saving");
    const t = window.setTimeout(async () => { const r = await saveTextWidget(id, { text: val.text, size: val.size, align: val.align }); setState(r.error ? "error" : "saved"); }, 800);
    return () => window.clearTimeout(t);
  }, [val, id]);

  // Size the box to exactly fit the words (every render, so it follows font scaling from resize),
  // which keeps the resize handle right at the corner of the text.
  useLayoutEffect(() => {
    const a = area.current;
    if (!a) return;
    a.style.width = "0px"; a.style.height = "0px";
    a.style.width = `${a.scrollWidth + 2}px`;
    a.style.height = `${a.scrollHeight}px`;
  });

  return (
    <div className="cw-textcard">
      <textarea ref={area} className={`cw-text cw-text-${val.size}`} style={{ textAlign: val.align }} rows={val.size === "heading" ? 1 : 3}
        aria-label="Text" placeholder="Type here" maxLength={MAX_TEXT} value={val.text}
        onChange={(e) => setVal({ ...val, text: e.target.value })} />
      <div className="cw-foot cw-textbar">
        <button type="button" className="st-btn" aria-pressed={val.size === "heading"} aria-label="Heading size" title="Heading size"
          onClick={() => setVal({ ...val, size: val.size === "heading" ? "body" : "heading" })}><Heading size={14} aria-hidden="true" /></button>
        <button type="button" className="st-btn" aria-label={`Alignment: ${val.align}. Click to change`} title="Alignment"
          onClick={() => setVal({ ...val, align: val.align === "left" ? "center" : val.align === "center" ? "right" : "left" })}>
          {val.align === "left" ? <AlignLeft size={14} aria-hidden="true" /> : val.align === "center" ? <AlignCenter size={14} aria-hidden="true" /> : <AlignRight size={14} aria-hidden="true" />}
        </button>
        <span className="cw-count" role="status" data-state={state}>{state === "saving" ? "Saving" : state === "error" ? "Not saved. Check your connection." : "Saved"} · {val.text.length}/{MAX_TEXT}</span>
      </div>
    </div>
  );
}

const StickerMaker = dynamic(() => import("./StickerMaker"), { ssr: false });


const SavedStickers = dynamic(() => import("./SavedStickers"), { ssr: false });

// A square paper note, a free sticker. Text saves as you type; the font scales with the note's width.
export function StickyStickerBody({ id, data, tilt }: { id: string; data: StickyData; tilt: number }) {
  const [text, setText] = useState(data.text);
  const [color, setColor] = useState(data.color);
  const [state, setState] = useState<"saved" | "saving" | "error">("saved");
  const first = useRef(true);
  const bg = STICKY_COLORS.find((c) => c.id === color)?.bg ?? STICKY_COLORS[0].bg;

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setState("saving");
    const t = window.setTimeout(async () => { const r = await saveStickyNote(id, { text, color }); setState(r.error ? "error" : "saved"); }, 700);
    return () => window.clearTimeout(t);
  }, [text, color, id]);

  return (
    <div className="stn" style={{ background: bg, ["--tilt" as string]: `${tilt}deg` }}>
      <label htmlFor={`stn-${id}`} className="sr-only">Sticky note text</label>
      <textarea id={`stn-${id}`} className="stn-text" value={text} maxLength={STICKY_MAX_TEXT} placeholder="Jot something down" onChange={(e) => setText(e.target.value)} />
      <div className="stn-bar">
        <span role="radiogroup" aria-label="Note colour" className="stn-dots">
          {STICKY_COLORS.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={color === c.id} aria-label={c.label} className="sticky-dot" style={{ background: c.bg }} onClick={() => setColor(c.id)} />
          ))}
        </span>
        <span role="status" className={state === "error" ? "stn-err" : "sr-only"}>{state === "error" ? "Not saved" : state === "saving" ? "Saving" : "Saved"}</span>
      </div>
    </div>
  );
}

type Tab = "image" | "text" | "sticker" | "saved" | "sticky";
const ALL_TABS: { key: Tab; label: string }[] = [{ key: "image", label: "Image" }, { key: "text", label: "Text" }, { key: "sticky", label: "Sticky note" }, { key: "sticker", label: "Sticker" }, { key: "saved", label: "Saved" }];

export function AddWidgetButton({ spaceId, stickyReady }: { spaceId: string; stickyReady?: boolean }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" className="btn btn-sm" data-tour="add-widget" onClick={() => setOpen(true)}><Plus size={15} aria-hidden="true" /> Add widget</button>
      {open && <AddDialog spaceId={spaceId} stickyReady={!!stickyReady} onClose={close} />}
    </>
  );
}

function AddDialog({ spaceId, stickyReady, onClose }: { spaceId: string; stickyReady: boolean; onClose: () => void }) {
  const TABS = ALL_TABS.filter((t) => t.key !== "sticky" || stickyReady);
  const [tab, setTab] = useState<Tab>("image");
  const [stickyColor, setStickyColor] = useState("yellow");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const done = (r: { error?: string }) => { setBusy(false); if (r.error) setError(r.error); else onClose(); };

  const onKey = (e: React.KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.key === tab);
    const j = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length : -1;
    if (j < 0) return;
    e.preventDefault(); setTab(TABS[j].key); setError(null);
    requestAnimationFrame(() => document.getElementById(`cw-tab-${TABS[j].key}`)?.focus());
  };

  return (
    <Dialog title="Add widget" onClose={onClose} width={640}>
      <div role="tablist" aria-label="Widget type" className="cw-tabs" onKeyDown={onKey}>
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" id={`cw-tab-${t.key}`} aria-selected={tab === t.key} aria-controls="cw-panel" tabIndex={tab === t.key ? 0 : -1}
            className={`cw-tab${tab === t.key ? " is-on" : ""}`} onClick={() => { setTab(t.key); setError(null); }}>{t.label}</button>
        ))}
      </div>
      <div id="cw-panel" role="tabpanel" aria-labelledby={`cw-tab-${tab}`} className="cw-panel">
        {tab === "image" && <ImageForm spaceId={spaceId} busy={busy} setBusy={setBusy} done={done} setError={setError} />}
        {tab === "sticker" && <StickerMaker spaceId={spaceId} busy={busy} setBusy={setBusy} done={done} setError={setError} />}
        {tab === "saved" && <SavedStickers spaceId={spaceId} busy={busy} setBusy={setBusy} done={done} setError={setError} />}
        {tab === "sticky" && (
          <div className="cw-form">
            <p className="cw-note">A square paper note you can type on, drag anywhere, resize and recolour. It appears near the top of the page.</p>
            <div role="radiogroup" aria-label="Note colour" className="stn-dots">
              {STICKY_COLORS.map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={stickyColor === c.id} aria-label={c.label} className="sticky-dot" style={{ background: c.bg }} onClick={() => setStickyColor(c.id)} />
              ))}
            </div>
            <button type="button" className="btn btn-primary" disabled={busy} aria-busy={busy} onClick={async () => { setBusy(true); setError(null); done(await addStickyNote(spaceId, stickyColor)); }}>
              {busy ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />} Add sticky note
            </button>
          </div>
        )}
        {tab === "text" && (
          <div className="cw-form">
            <p className="cw-note">A free text block for a reminder, goal or heading. Edit it right on the page.</p>
            <button type="button" className="btn btn-primary" disabled={busy} aria-busy={busy} onClick={async () => { setBusy(true); setError(null); done(await addTextWidget(spaceId)); }}>
              {busy ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Type size={14} aria-hidden="true" />} Add text widget
            </button>
          </div>
        )}
      </div>
      <div role="alert" className="cw-err">{error}</div>
    </Dialog>
  );
}

function ImageForm({ spaceId, busy, setBusy, done, setError }: { spaceId: string; busy: boolean; setBusy: (b: boolean) => void; done: (r: { error?: string }) => void; setError: (e: string | null) => void }) {
  const [mode, setMode] = useState<"upload" | "link">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [alt, setAlt] = useState("");
  const [caption, setCaption] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "link") { setBusy(true); done(await addImageLink(spaceId, link, alt, caption)); return; }
    if (!file) { setError("Choose an image first."); return; }
    const ext = IMAGE_TYPES[file.type];
    if (!ext) { setError("Only JPG, PNG, WebP or GIF images can be added."); return; }
    if (file.size > MAX_IMAGE_BYTES) { setError("That image is larger than 10 MB."); return; }
    setBusy(true);
    const blocked = await uploadBlocked("image");
    if (blocked) { setBusy(false); setError(blocked); return; }
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setBusy(false); setError("Please sign in again."); return; }
    const path = `${user.id}/${spaceId}/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from(WIDGET_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) {
      setBusy(false);
      setError(/bucket not found/i.test(up.error.message) ? "Uploads need a database update. Run supabase/migration-25-space-widgets.sql." : "The upload failed. Try again.");
      return;
    }
    const checked = await checkUploaded(WIDGET_BUCKET, path, "image");
    if (checked.message) toast(checked.message, checked.state === "unsafe" ? "error" : "success");
    const r = await addUploadedImage(spaceId, path, alt, caption);
    if (r.error) await supabase.storage.from(WIDGET_BUCKET).remove([path]);
    done(r);
  };

  return (
    <form className="cw-form" onSubmit={submit}>
      <div className="cw-mode" role="group" aria-label="Image source">
        <button type="button" className="btn btn-sm" aria-pressed={mode === "upload"} onClick={() => setMode("upload")}><Upload size={14} aria-hidden="true" /> Upload</button>
        <button type="button" className="btn btn-sm" aria-pressed={mode === "link"} onClick={() => setMode("link")}><Link2 size={14} aria-hidden="true" /> Paste a link</button>
      </div>
      {mode === "upload" ? (
        <label className={`cw-drop${file ? " is-set" : ""}`} {...dropProps((f) => setFile(f))}>
          <span className="cw-drop-ic" aria-hidden="true">{file ? <ImageIcon size={20} /> : <Upload size={20} />}</span>
          <span className="cw-drop-t">{file ? file.name : "Choose or drop an image"}</span>
          <span className="cw-drop-h">{file ? "Click to choose a different image" : "JPG, PNG, WebP or GIF, up to 10 MB"}</span>
          <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      ) : (
        <div>
          <label className="field-l" htmlFor="cw-link">Image link (https only)</label>
          <input id="cw-link" className="input" type="url" required value={link} maxLength={1000} placeholder="https://example.com/picture.jpg" onChange={(e) => setLink(e.target.value)} />
        </div>
      )}
      <div>
        <label className="field-l" htmlFor="cw-alt">Description for screen readers (optional)</label>
        <input id="cw-alt" className="input" value={alt} maxLength={200} onChange={(e) => setAlt(e.target.value)} />
      </div>
      <div>
        <label className="field-l" htmlFor="cw-cap">Caption (optional)</label>
        <input id="cw-cap" className="input" value={caption} maxLength={160} onChange={(e) => setCaption(e.target.value)} />
      </div>
      <p className="cw-note">Images are only checked for type and size. Add pictures that are suitable for a study space.</p>
      <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
        {busy ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <ImageIcon size={14} aria-hidden="true" />} Add image
      </button>
    </form>
  );
}
