"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Scissors, Crosshair, Upload, ImageIcon, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { MAX_IMAGE_BYTES, WIDGET_BUCKET } from "@/lib/customWidgets";
import { saveStickerToLibrary, placeSavedSticker } from "../widget-actions";
import { dropProps } from "@/lib/dropProps";

// Google MediaPipe Tasks Vision (Apache-2.0) with the magic_touch interactive segmentation model (Apache-2.0).
// Keep this in step with the installed @mediapipe/tasks-vision version.
const MP_VERSION = "1.1.0";
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite";
const MAX_SIDE = 1024;
const PAD = 4;
const OUTLINE = 6;
const UNDO_MAX = 12;
const BRUSH_MIN = 4;
const BRUSH_MAX = 120;

type Segmenter = {
  segment: (image: HTMLCanvasElement, roi: { keypoint: { x: number; y: number } }) => {
    confidenceMasks?: { getAsFloat32Array(): Float32Array; width: number; height: number }[];
    categoryMask?: { getAsUint8Array(): Uint8Array; width: number; height: number };
    close(): void;
  };
  close(): void;
};

function blurAlpha(a: Float32Array, w: number, h: number) {
  // Two light 3x3 box passes: softens the cut edge without eating into the subject.
  let src = a;
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float32Array(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= w) continue;
            s += src[yy * w + xx]; n++;
          }
        }
        out[y * w + x] = s / n;
      }
    }
    src = out;
  }
  return src;
}

function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

// Builds the cut-out. crop=true trims to the alpha bounding box (export); crop=false keeps the full frame (preview).
function compose(photo: HTMLCanvasElement, alpha: Float32Array, outline: boolean, crop: boolean): HTMLCanvasElement | null {
  const w = photo.width, h = photo.height;
  const cut = makeCanvas(w, h);
  const cctx = cut.getContext("2d")!;
  const img = photo.getContext("2d")!.getImageData(0, 0, w, h);
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = Math.max(0, Math.min(1, alpha[i]));
      img.data[i * 4 + 3] = Math.round(a * 255);
      if (a > 0.03) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
  }
  if (maxX < 0) return null;
  cctx.putImageData(img, 0, 0);
  const r = outline ? OUTLINE : 0;
  if (!crop && !outline) return cut;
  const pad = PAD + r;
  const bx = crop ? minX - pad : 0, by = crop ? minY - pad : 0;
  const ow = crop ? maxX - minX + 1 + pad * 2 : w, oh = crop ? maxY - minY + 1 + pad * 2 : h;
  const out = makeCanvas(ow, oh);
  const octx = out.getContext("2d")!;
  if (outline) {
    const ring = makeCanvas(ow, oh);
    const rctx = ring.getContext("2d")!;
    for (let k = 0; k < 24; k++) {
      const ang = (k / 24) * Math.PI * 2;
      rctx.drawImage(cut, -bx + Math.cos(ang) * r, -by + Math.sin(ang) * r);
    }
    rctx.globalCompositeOperation = "source-in";
    rctx.fillStyle = "#ffffff";
    rctx.fillRect(0, 0, ow, oh);
    octx.drawImage(ring, 0, 0);
  }
  octx.drawImage(cut, -bx, -by);
  return out;
}

function toPngBlob(c: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((res) => c.toBlob((b) => res(b), "image/png"));
}

export default function StickerMaker({ spaceId, busy, setBusy, done, setError }: {
  spaceId: string; busy: boolean; setBusy: (b: boolean) => void; done: (r: { error?: string }) => void; setError: (e: string | null) => void;
}) {
  const [model, setModel] = useState<"loading" | "ready" | "failed">("loading");
  const [status, setStatus] = useState("Loading the cut-out tool. The first time this downloads a model of about 10 MB.");
  const [fileName, setFileName] = useState("");
  const [hasPhoto, setHasPhoto] = useState(false);
  const [hasCut, setHasCut] = useState(false);
  const [working, setWorking] = useState(false);
  const [outline, setOutline] = useState(false);
  const [alt, setAlt] = useState("");

  const segRef = useRef<Segmenter | null>(null);
  const photoRef = useRef<HTMLCanvasElement | null>(null);
  const alphaRef = useRef<Float32Array | null>(null);
  const view = useRef<HTMLCanvasElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const autoRef = useRef<Float32Array | null>(null);
  const undoRef = useRef<Float32Array[]>([]);
  const lastPt = useRef<{ x: number; y: number } | null>(null);
  const raf = useRef(0);
  const [tool, setTool] = useState<"pick" | "erase" | "restore">("pick");
  const [brush, setBrush] = useState(28);
  const [undoCount, setUndoCount] = useState(0);

  // Lazy load: only when the Sticker tab is opened.
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const mp = await import("@mediapipe/tasks-vision");
        const fileset = await mp.FilesetResolver.forVisionTasks(WASM_BASE);
        const seg = await mp.InteractiveSegmenterLegacy.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL },
          runningMode: "IMAGE",
          outputConfidenceMasks: true,
          outputCategoryMask: true,
        });
        if (dead) { seg.close(); return; }
        segRef.current = seg as unknown as Segmenter;
        setModel("ready");
        setStatus("Cut-out tool ready. Choose a photo.");
      } catch {
        if (dead) return;
        setModel("failed");
        setStatus("");
      }
    })();
    return () => { dead = true; try { segRef.current?.close(); } catch { /* ignore */ } segRef.current = null; };
  }, []);

  const draw = useCallback(() => {
    const c = view.current, photo = photoRef.current;
    if (!c || !photo) return;
    c.width = photo.width; c.height = photo.height;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    const alpha = alphaRef.current;
    const shown = alpha ? compose(photo, alpha, outline, false) : null;
    ctx.drawImage(shown ?? photo, 0, 0);
  }, [outline]);

  useEffect(() => { if (hasPhoto) draw(); }, [hasPhoto, hasCut, draw]);

  const onFile = async (f: File | null) => {
    setError(null);
    alphaRef.current = null; autoRef.current = null; undoRef.current = []; setUndoCount(0); setHasCut(false); setTool("pick");
    if (!f) return;
    if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type)) { setError("Only JPG, PNG, WebP or GIF images can be used."); return; }
    setFileName(f.name);
    try {
      const bmp = await createImageBitmap(f);
      const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
      const c = makeCanvas(Math.max(1, Math.round(bmp.width * scale)), Math.max(1, Math.round(bmp.height * scale)));
      c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      photoRef.current = c;
      setHasPhoto(true);
      setStatus("Photo ready. Tap the object you want to keep, or use Keep the centre.");
    } catch {
      photoRef.current = null; setHasPhoto(false);
      setError("That image could not be read. Try a different one.");
    }
  };

  const pick = (nx: number, ny: number) => {
    const seg = segRef.current, photo = photoRef.current;
    if (!seg || !photo || working) return;
    setError(null); setWorking(true); setStatus("Cutting out the object.");
    window.setTimeout(() => {
      try {
        const res = seg.segment(photo, { keypoint: { x: nx, y: ny } });
        const n = photo.width * photo.height;
        let a: Float32Array | null = null;
        const conf = res.confidenceMasks?.[0];
        if (conf && conf.width * conf.height === n) a = conf.getAsFloat32Array().slice();
        else if (res.categoryMask && res.categoryMask.width * res.categoryMask.height === n) {
          const u = res.categoryMask.getAsUint8Array();
          a = new Float32Array(n);
          for (let i = 0; i < n; i++) a[i] = u[i] > 0 ? 1 : 0;
        }
        res.close();
        if (!a) throw new Error("no mask");
        let any = false;
        for (let i = 0; i < n; i++) { a[i] = a[i] > 0.5 ? 1 : 0; if (a[i]) any = true; }
        if (!any) { setStatus("Nothing was found at that spot. Tap the object itself."); setWorking(false); return; }
        alphaRef.current = blurAlpha(a, photo.width, photo.height);
        autoRef.current = alphaRef.current.slice();
        undoRef.current = []; setUndoCount(0);
        setHasCut(true);
        draw();
        setStatus("Cut-out ready. Tap a different spot to choose another object, or add the sticker.");
      } catch {
        setError("The cut-out failed on this photo. Try another photo or spot.");
        setStatus("");
      }
      setWorking(false);
    }, 30);
  };

  const onTap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool !== "pick") return;
    const r = e.currentTarget.getBoundingClientRect();
    pick(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
  };

  // ---- Manual touch-up brush ----
  const queueDraw = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => { raf.current = 0; draw(); });
  };

  const stamp = (cx: number, cy: number, rad: number, erase: boolean) => {
    const a = alphaRef.current, photo = photoRef.current;
    if (!a || !photo) return;
    const w = photo.width, h = photo.height;
    const x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(w - 1, Math.ceil(cx + rad));
    const y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(h - 1, Math.ceil(cy + rad));
    const inner = rad * 0.7;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > rad) continue;
        const s = d <= inner ? 1 : 1 - (d - inner) / (rad - inner || 1);
        const i = y * w + x;
        a[i] = erase ? Math.min(a[i], 1 - s) : Math.max(a[i], s);
      }
    }
  };

  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const c = view.current!, r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height, k: c.width / r.width };
  };

  const radiusFor = (e: React.PointerEvent) => {
    const base = brush / 2;
    return e.pointerType === "pen" && e.pressure > 0 ? Math.max(1.5, base * (0.4 + e.pressure * 1.2)) : base;
  };

  const moveCursor = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cur = cursor.current, c = view.current;
    if (!cur || !c || tool === "pick") return;
    const r = c.getBoundingClientRect(), wr = c.parentElement!.getBoundingClientRect();
    const d = brush * (r.width / c.width);
    cur.style.width = cur.style.height = `${d}px`;
    cur.style.transform = `translate(${e.clientX - wr.left - d / 2}px, ${e.clientY - wr.top - d / 2}px)`;
    cur.style.display = "block";
  };

  const strokeTo = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const last = lastPt.current;
    if (!last) return;
    const p = toCanvas(e), rad = radiusFor(e);
    const dist = Math.hypot(p.x - last.x, p.y - last.y);
    const step = Math.max(1, rad / 3);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= n; i++) stamp(last.x + ((p.x - last.x) * i) / n, last.y + ((p.y - last.y) * i) / n, rad, tool === "erase");
    lastPt.current = { x: p.x, y: p.y };
    queueDraw();
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === "pick" || !hasCut || !alphaRef.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    undoRef.current.push(alphaRef.current.slice());
    if (undoRef.current.length > UNDO_MAX) undoRef.current.shift();
    setUndoCount(undoRef.current.length);
    const p = toCanvas(e);
    lastPt.current = { x: p.x, y: p.y };
    stamp(p.x, p.y, radiusFor(e), tool === "erase");
    queueDraw();
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    moveCursor(e);
    if (lastPt.current) strokeTo(e);
  };

  const endStroke = () => { lastPt.current = null; };

  const undo = () => {
    const prev = undoRef.current.pop();
    setUndoCount(undoRef.current.length);
    if (!prev) return;
    alphaRef.current = prev; draw(); setStatus("Undid the last brush stroke.");
  };

  const resetCut = () => {
    if (!autoRef.current) return;
    undoRef.current = []; setUndoCount(0);
    alphaRef.current = autoRef.current.slice(); draw(); setStatus("Back to the automatic cut-out.");
  };

  const chooseTool = (t: "pick" | "erase" | "restore") => {
    setTool(t);
    if (cursor.current && t === "pick") cursor.current.style.display = "none";
    setStatus(t === "pick" ? "Choose object mode. Tap the object to keep." : t === "erase" ? "Erase mode. Paint over parts to remove." : "Restore mode. Paint to bring back parts of the photo.");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement && t.type !== "range" && t.type !== "file") return;
    if (!hasCut) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === "e") { e.preventDefault(); chooseTool("erase"); }
    else if (k === "r") { e.preventDefault(); chooseTool("restore"); }
    else if (k === "o") { e.preventDefault(); chooseTool("pick"); }
    else if (e.key === "[") { e.preventDefault(); setBrush((b) => Math.max(BRUSH_MIN, b - 4)); }
    else if (e.key === "]") { e.preventDefault(); setBrush((b) => Math.min(BRUSH_MAX, b + 4)); }
  };

  const add = async () => {
    const photo = photoRef.current, alpha = alphaRef.current;
    if (!photo || !alpha) return;
    setError(null); setBusy(true); setStatus("Adding the sticker.");
    let out = compose(photo, alpha, outline, true);
    if (!out) { setBusy(false); setError("There is nothing to add. Choose an object first."); return; }
    let blob = await toPngBlob(out);
    for (let i = 0; blob && blob.size > MAX_IMAGE_BYTES && i < 6; i++) {
      const s = makeCanvas(Math.max(1, Math.round(out.width * 0.75)), Math.max(1, Math.round(out.height * 0.75)));
      s.getContext("2d")!.drawImage(out, 0, 0, s.width, s.height);
      out = s; blob = await toPngBlob(out);
    }
    if (!blob || blob.size > MAX_IMAGE_BYTES) { setBusy(false); setError("The sticker is larger than 10 MB. Try a smaller photo."); return; }
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setBusy(false); setError("Please sign in again."); return; }
    // Every sticker is saved to the personal library first, then placed in this space as a copy.
    const path = `${user.id}/library/${crypto.randomUUID()}.png`;
    const up = await supabase.storage.from(WIDGET_BUCKET).upload(path, blob, { contentType: "image/png", upsert: false });
    if (up.error) {
      setBusy(false);
      setError(/bucket not found/i.test(up.error.message) ? "Uploads need a database update. Run supabase/migration-25-space-widgets.sql." : "The upload failed. Try again.");
      return;
    }
    const saved = await saveStickerToLibrary(path, alt, out.width, out.height);
    if (saved.error || !saved.id) {
      await supabase.storage.from(WIDGET_BUCKET).remove([path]);
      setBusy(false); setError(saved.error ?? "Could not save the sticker.");
      return;
    }
    done(await placeSavedSticker(spaceId, saved.id));
  };

  return (
    <div className="cw-form" onKeyDown={onKeyDown}>
      <p className="cw-note">Pick a photo, then tap the object to keep. Logia cuts it out and adds it as a sticker. Runs on your device. The photo is only uploaded when you add the sticker.</p>

      {model === "loading" && (
        <p className="cw-note stk-load"><Loader2 size={14} className="spin" aria-hidden="true" /> Loading the cut-out tool. The first time this downloads a model of about 10 MB.</p>
      )}
      {model === "failed" && (
        <p role="alert" className="cw-err">The cut-out tool could not be loaded. Check your connection and reopen this tab to try again. You can still add the photo as it is from the Image tab.</p>
      )}

      {model === "ready" && (
        <>
          <label className={`cw-drop${hasPhoto ? " is-set" : ""}`} {...dropProps((f) => onFile(f))}>
            <span className="cw-drop-ic" aria-hidden="true">{hasPhoto ? <ImageIcon size={20} /> : <Upload size={20} />}</span>
            <span className="cw-drop-t">{hasPhoto ? fileName : "Choose or drop a photo"}</span>
            <span className="cw-drop-h">{hasPhoto ? "Click to choose a different photo" : "JPG, PNG, WebP or GIF"}</span>
            <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          </label>

          {hasPhoto && (
            <>
              <div className="stk-stage">
                <div className="stk-wrap">
                  <canvas ref={view} className={`stk-canvas${tool !== "pick" ? " is-brush" : ""}`} role="img"
                    onPointerUp={(e) => { endStroke(); onTap(e); }} onPointerDown={onDown} onPointerMove={onMove} onPointerCancel={endStroke}
                    onPointerLeave={() => { if (cursor.current) cursor.current.style.display = "none"; }}
                    aria-label={hasCut ? (tool === "pick" ? "Preview of the cut-out sticker on a checkerboard. Tap or click a spot to choose a different object." : `Preview of the cut-out sticker on a checkerboard. Paint to ${tool === "erase" ? "erase parts" : "restore parts"}.`) : "Your photo. Tap or click the object you want to keep, or use the Keep the centre button."} />
                  <div ref={cursor} className={`stk-cursor${tool === "restore" ? " is-restore" : ""}`} aria-hidden="true" />
                </div>
              </div>
              <div className="cw-mode" role="group" aria-label="Cut-out options">
                <button type="button" className="btn btn-sm" disabled={working || busy} onClick={() => pick(0.5, 0.5)}>
                  <Crosshair size={14} aria-hidden="true" /> Keep the centre
                </button>
                <button type="button" className="btn btn-sm" aria-pressed={outline} onClick={() => setOutline(!outline)}>
                  <Scissors size={14} aria-hidden="true" /> White outline
                </button>
              </div>
              {hasCut && (
                <div className="stk-touch">
                  <div className="cw-mode" role="group" aria-label="Touch-up tool">
                    <button type="button" className="btn btn-sm" aria-pressed={tool === "pick"} aria-keyshortcuts="O" onClick={() => chooseTool("pick")}>Choose object <kbd>O</kbd></button>
                    <button type="button" className="btn btn-sm" aria-pressed={tool === "erase"} aria-keyshortcuts="E" onClick={() => chooseTool("erase")}>Erase <kbd>E</kbd></button>
                    <button type="button" className="btn btn-sm" aria-pressed={tool === "restore"} aria-keyshortcuts="R" onClick={() => chooseTool("restore")}>Restore <kbd>R</kbd></button>
                  </div>
                  <div className="stk-size">
                    <label className="field-l" htmlFor="stk-brush">Brush size: {brush} px (<kbd>[</kbd> smaller, <kbd>]</kbd> larger)</label>
                    <input id="stk-brush" type="range" min={BRUSH_MIN} max={BRUSH_MAX} step={2} value={brush} onChange={(e) => setBrush(Number(e.target.value))} />
                  </div>
                  <div className="cw-mode">
                    <button type="button" className="btn btn-sm" disabled={undoCount === 0} aria-keyshortcuts="Control+Z Meta+Z" onClick={undo}>Undo <kbd>Ctrl/Cmd+Z</kbd></button>
                    <button type="button" className="btn btn-sm" onClick={resetCut}>Reset to automatic cut</button>
                  </div>
                  <p className="cw-note">Erase removes more of the photo. Restore paints parts of the original back. Works with mouse, touch and pen.</p>
                </div>
              )}
              <div>
                <label className="field-l" htmlFor="stk-alt">Description for screen readers (optional)</label>
                <input id="stk-alt" className="input" value={alt} maxLength={200} onChange={(e) => setAlt(e.target.value)} />
              </div>
              <button type="button" className="btn btn-primary" disabled={!hasCut || working || busy} aria-busy={busy} onClick={add}>
                {busy ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />} Add sticker
              </button>
              <p className="cw-note">Stickers you make are also saved to your Saved tab, so you can reuse them in any space.</p>
            </>
          )}
        </>
      )}

      <p className="cw-note" role="status" aria-live="polite">{working ? "Cutting out the object." : status}</p>
    </div>
  );
}
