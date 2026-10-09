"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Palette } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { toast } from "@/components/Toaster";
import { dropProps } from "@/lib/dropProps";
import { COVER_COLORS } from "@/lib/coverColors";
import { createClient } from "@/lib/supabase/client";
import { uploadBlocked, checkUploaded } from "@/lib/uploadSafety";
import { saveSpaceHeader } from "@/app/space-header-actions";
import { HEADER_BUCKET, HEADER_SOURCE_MAX_BYTES, HEADER_TYPES, headerLook, type HeaderKind } from "@/lib/spaceHeader";
import { HeaderCropper, type CropHandle } from "./HeaderCropper";

type Tab = "default" | "color" | "image";
const TABS: { id: Tab; label: string }[] = [{ id: "default", label: "Default" }, { id: "color", label: "Colour" }, { id: "image", label: "Image" }];

// Scaled copy of the real header band (same classes, same measured size) so text wraps exactly as it will.
function Preview({ look, size, texts }: {
  look: ReturnType<typeof headerLook>; size: { w: number; h: number }; texts: { eyebrow: string; name: string; sub: string };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [fw, setFw] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFw(el.clientWidth));
    ro.observe(el); setFw(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="sh-pv" aria-hidden="true" style={{ aspectRatio: `${size.w} / ${size.h}` }}>
      {fw > 0 && <HeaderClone look={look} size={size} texts={texts} scale={fw / size.w} />}
    </div>
  );
}

function HeaderClone({ look, size, texts, scale }: { look: ReturnType<typeof headerLook>; size: { w: number; h: number }; texts: { eyebrow: string; name: string; sub: string }; scale: number }) {
  return (
    <div className={`space-hero ${look.mesh ? "mesh-warm" : ""} ${look.className} sh-clone`} style={{ ...look.style, width: size.w, height: size.h, transform: `scale(${scale})` }}>
      <div>
        <p className="eyebrow" style={{ margin: 0 }}>{texts.eyebrow}</p>
        <div className="space-hero-h">{texts.name}</div>
        <p className="space-hero-p">{texts.sub}</p>
      </div>
    </div>
  );
}

export function SpaceHeaderEditor({ spaceId, kind, color, imageUrl, texts }: {
  spaceId: string; kind: HeaderKind; color: string | null; imageUrl: string | null; texts: { eyebrow: string; name: string; sub: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(kind);
  const [size, setSize] = useState({ w: 1000, h: 200 });
  const [draftColor, setDraftColor] = useState(color ?? COVER_COLORS[0]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const crop = useRef<CropHandle | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  const aspect = Math.min(10, Math.max(1.2, size.w / size.h));

  const openIt = () => {
    const el = openerRef.current?.closest<HTMLElement>("[data-sh-header]");
    if (el) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) setSize({ w: Math.round(r.width), h: Math.round(r.height) }); }
    setTab(kind); setDraftColor(color ?? COVER_COLORS[0]); setFile(null); setErr(null); setOpen(true);
  };
  const close = useCallback(() => { if (!busy) setOpen(false); }, [busy]);
  const onCropError = useCallback((m: string) => { setErr(m); setFile(null); }, []);

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    setErr(null);
    if (!HEADER_TYPES.includes(f.type)) { setErr("Use a JPG, PNG or WebP image."); return; }
    if (f.size > HEADER_SOURCE_MAX_BYTES) { setErr("That image is larger than 25 MB. Choose a smaller one."); return; }
    setFile(f);
  };

  const finish = async (res: { error?: string }, msg: string) => {
    setBusy(false);
    if (res.error) { setErr(res.error); return; }
    toast(msg);
    setOpen(false);
    router.refresh();
  };

  const saveDefault = async () => { setBusy(true); setErr(null); await finish(await saveSpaceHeader(spaceId, "default", null, null), "Header set back to the default."); };
  const saveColor = async () => { setBusy(true); setErr(null); await finish(await saveSpaceHeader(spaceId, "color", draftColor, null), "Header colour saved."); };
  const saveImage = async () => {
    if (!file) return;
    setBusy(true); setErr(null);
    const blob = await crop.current?.exportJpeg();
    if (!blob) { setBusy(false); setErr("Couldn't prepare the cropped image. Try a smaller image."); return; }
    const blocked = await uploadBlocked("image");
    if (blocked) { setBusy(false); setErr(blocked); return; }
    const path = `${spaceId}/${crypto.randomUUID()}.jpg`;
    const supabase = createClient();
    const up = await supabase.storage.from(HEADER_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (up.error) {
      setBusy(false);
      setErr(/bucket not found/i.test(up.error.message) ? "Headers need a database update. Run supabase/migration-38-space-header.sql." : "The upload failed. Try again.");
      return;
    }
    const checked = await checkUploaded(HEADER_BUCKET, path, "image");
    await finish(await saveSpaceHeader(spaceId, "image", null, path), checked.message ?? "Header image saved.");
  };

  const onTabKey = (e: React.KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const n = e.key === "ArrowRight" ? (i + 1) % 3 : e.key === "ArrowLeft" ? (i + 2) % 3 : e.key === "Home" ? 0 : e.key === "End" ? 2 : -1;
    if (n < 0) return;
    e.preventDefault(); setTab(TABS[n].id); setErr(null);
    requestAnimationFrame(() => document.getElementById(`sh-tab-${TABS[n].id}`)?.focus());
  };

  const colorLook = headerLook("color", draftColor, null);
  const overlayLook = { className: "sh-band sh-image sh-tone-light", style: { ["--sh-img" as string]: "none" } as Record<string, string>, mesh: false };

  return (
    <>
      <button ref={openerRef} type="button" className="btn btn-sm" onClick={openIt}><Palette size={14} aria-hidden="true" /> Change header</button>
      {open && (
        <Dialog title="Change header" onClose={close} width={640}>
          <p className="sh-lead">Everyone in this space sees the header you choose.</p>
          <div className="sh-tabs" role="tablist" aria-label="Header style" onKeyDown={onTabKey}>
            {TABS.map((t) => (
              <button key={t.id} id={`sh-tab-${t.id}`} type="button" role="tab" aria-selected={tab === t.id} aria-controls="sh-panel"
                tabIndex={tab === t.id ? 0 : -1} className="sh-tab" onClick={() => { setTab(t.id); setErr(null); }}>{t.label}</button>
            ))}
          </div>
          <div id="sh-panel" role="tabpanel" aria-labelledby={`sh-tab-${tab}`} className="sh-panel">
            {tab === "default" && (
              <>
                <Preview look={headerLook("default", null, null)} size={size} texts={texts} />
                <p className="sh-help">The Logia coral gradient. It turns a deeper coral in dark mode.</p>
                <div className="sh-actions"><button type="button" className="btn btn-primary" disabled={busy || kind === "default"} onClick={saveDefault}>{busy ? "Saving..." : "Use default"}</button></div>
              </>
            )}
            {tab === "color" && (
              <>
                <Preview look={colorLook} size={size} texts={texts} />
                <div className="sh-swatches" role="group" aria-label="Header colours">
                  {COVER_COLORS.map((c) => (
                    <button key={c} type="button" className="sh-swatch" style={{ background: c }} aria-label={c} aria-pressed={draftColor.toLowerCase() === c} onClick={() => setDraftColor(c)} />
                  ))}
                  <label className="sh-custom">
                    <span className="sr-only">Pick any colour</span>
                    <input type="color" value={draftColor} onChange={(e) => setDraftColor(e.target.value)} aria-label="Pick any colour" />
                    <span aria-hidden="true">Custom</span>
                  </label>
                </div>
                <p className="sh-help">Text switches between dark and light so it stays easy to read on any colour.</p>
                <div className="sh-actions">
                  <button type="button" className="btn" disabled={busy || kind === "default"} onClick={saveDefault}>Back to default</button>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={saveColor}>{busy ? "Saving..." : "Save colour"}</button>
                </div>
              </>
            )}
            {tab === "image" && (
              <>
                {file ? (
                  <HeaderCropper file={file} aspect={aspect} handle={crop} onError={onCropError}
                    overlay={(fw) => <HeaderClone look={overlayLook} size={size} texts={texts} scale={fw / size.w} />} />
                ) : (
                  <>
                    {kind === "image" && imageUrl && <Preview look={headerLook("image", null, imageUrl)} size={size} texts={texts} />}
                    <div className="sh-drop" {...dropProps((f) => pick(f))}>
                      <ImagePlus size={22} aria-hidden="true" />
                      <p>Drop a picture here, or</p>
                      <button type="button" className="btn btn-sm" onClick={() => fileInput.current?.click()}>Choose an image</button>
                      <p className="sh-help">JPG, PNG or WebP. You crop it to fit the header next; only the cropped picture is uploaded.</p>
                    </div>
                  </>
                )}
                <input ref={fileInput} type="file" accept={HEADER_TYPES.join(",")} className="sr-only" tabIndex={-1} aria-hidden="true"
                  onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
                <p className="sh-help">A dark overlay is added behind the text so it stays readable on any picture.</p>
                <div className="sh-actions">
                  {kind !== "default" && <button type="button" className="btn" disabled={busy} onClick={saveDefault}>{kind === "image" ? "Remove image" : "Back to default"}</button>}
                  {file && <button type="button" className="btn" disabled={busy} onClick={() => { setFile(null); fileInput.current?.click(); }}>Choose another</button>}
                  <button type="button" className="btn btn-primary" disabled={busy || !file} onClick={saveImage}>{busy ? "Saving..." : "Save image"}</button>
                </div>
              </>
            )}
            <p className="sh-err" role="alert">{err}</p>
          </div>
        </Dialog>
      )}
    </>
  );
}
