"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Maximize2, Minimize2, ZoomIn, ZoomOut } from "lucide-react";
import { HEADER_EXPORT_WIDTH, HEADER_MAX_BYTES } from "@/lib/spaceHeader";

export type CropHandle = { exportJpeg: () => Promise<Blob | null> };

const MAX_ZOOM = 4;

// Pointer-event + canvas crop tool. The frame has the header's exact aspect ratio.
// Zoom is relative to "Fill" (image covers the frame = 1). "Fit" shows the whole image (zoom below 1),
// with the leftover strip painted in the image's average colour. Offsets are fractions of the frame width.
export function HeaderCropper({ file, aspect, handle, overlay, onError }: {
  file: File; aspect: number; handle: MutableRefObject<CropHandle | null>;
  overlay: (frameWidth: number) => ReactNode; onError: (msg: string) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [fw, setFw] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [avg, setAvg] = useState("#444444");
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; zoom: number } | null>(null);
  const fh = fw / aspect;

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u); setNat(null); setZoom(1); setOff({ x: 0, y: 0 });
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setNat({ w: img.naturalWidth, h: img.naturalHeight });
      try {
        const c = document.createElement("canvas"); c.width = c.height = 1;
        const g = c.getContext("2d");
        if (g) { g.drawImage(img, 0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; setAvg(`rgb(${d[0]},${d[1]},${d[2]})`); }
      } catch { /* keep default */ }
    };
    img.onerror = () => onError("That image couldn't be opened. Try a JPG, PNG or WebP.");
    img.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file, onError]);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFw(el.clientWidth));
    ro.observe(el);
    setFw(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Scale (display px per image px) at zoom 1 and at "Fit".
  const fill = nat && fw ? Math.max(fw / nat.w, fh / nat.h) : 1;
  const fit = nat && fw ? Math.min(fw / nat.w, fh / nat.h) : 1;
  const minZoom = fit / fill;

  const clampOff = useCallback((x: number, y: number, z: number) => {
    if (!nat || !fw) return { x: 0, y: 0 };
    const s = z * Math.max(fw / nat.w, fw / aspect / nat.h);
    const mx = Math.max(0, (nat.w * s - fw) / 2) / fw;
    const my = Math.max(0, (nat.h * s - fw / aspect) / 2) / fw;
    return { x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) };
  }, [nat, fw, aspect]);

  const apply = useCallback((z: number, x: number, y: number) => {
    const nz = Math.min(MAX_ZOOM, Math.max(minZoom, z));
    setZoom(nz);
    setOff(clampOff(x, y, nz));
  }, [minZoom, clampOff]);

  // Keep the position valid when the frame resizes.
  useEffect(() => { setOff((o) => clampOff(o.x, o.y, zoom)); }, [fw, clampOff, zoom]);

  const zoomBy = (factor: number) => apply(zoom * factor, off.x, off.y);

  // Non-passive wheel listener so the page doesn't scroll while zooming.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); apply(zoom * Math.exp(-e.deltaY * 0.0015), off.x, off.y); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [apply, zoom, off.x, off.y]);

  const dist = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!nat) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) gesture.current = { dist: dist() || 1, zoom };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !fw) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 && gesture.current) {
      apply(gesture.current.zoom * (dist() / gesture.current.dist), off.x, off.y);
    } else if (pointers.current.size === 1) {
      apply(zoom, off.x + (e.clientX - prev.x) / fw, off.y + (e.clientY - prev.y) / fw);
    }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = (e.shiftKey ? 0.08 : 0.025);
    if (e.key === "ArrowLeft") apply(zoom, off.x - step, off.y);
    else if (e.key === "ArrowRight") apply(zoom, off.x + step, off.y);
    else if (e.key === "ArrowUp") apply(zoom, off.x, off.y - step);
    else if (e.key === "ArrowDown") apply(zoom, off.x, off.y + step);
    else if (e.key === "+" || e.key === "=") zoomBy(1.1);
    else if (e.key === "-" || e.key === "_") zoomBy(1 / 1.1);
    else return;
    e.preventDefault();
  };

  useEffect(() => {
    handle.current = {
      exportJpeg: async () => {
        const img = imgRef.current;
        if (!img || !nat || !fw) return null;
        const W = HEADER_EXPORT_WIDTH, H = Math.round(W / aspect);
        const canvas = document.createElement("canvas");
        canvas.width = W; canvas.height = H;
        const g = canvas.getContext("2d");
        if (!g) return null;
        const k = W / fw;
        const s = zoom * fill * k; // output px per image px
        g.fillStyle = avg; g.fillRect(0, 0, W, H);
        g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
        g.drawImage(img, W / 2 + off.x * W - (nat.w * s) / 2, H / 2 + off.y * W - (nat.h * s) / 2, nat.w * s, nat.h * s);
        for (const q of [0.85, 0.75, 0.65, 0.5]) {
          const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", q));
          if (blob && blob.size <= HEADER_MAX_BYTES) return blob;
        }
        return null;
      },
    };
    return () => { handle.current = null; };
  });

  const s = zoom * fill;
  const pct = Math.round(zoom * 100);

  return (
    <div className="sh-crop">
      <div ref={frameRef} className="sh-frame" tabIndex={0} role="group" aria-label="Crop area. Drag to move the picture."
        aria-describedby="sh-crop-help" style={{ aspectRatio: String(aspect), background: avg }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onKeyDown={onKeyDown}>
        {url && nat && fw > 0 && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" draggable={false} className="sh-frame-img"
            style={{ width: nat.w * s, height: nat.h * s, left: fw / 2 + off.x * fw - (nat.w * s) / 2, top: fh / 2 + off.y * fw - (nat.h * s) / 2 }} />
        )}
        <div className="sh-frame-over" aria-hidden="true">{fw > 0 && overlay(fw)}</div>
      </div>
      <p id="sh-crop-help" className="sh-help">Drag to move, scroll or pinch to zoom. With the crop area focused: arrow keys move, plus and minus zoom. Text above shows how the header will read.</p>
      <div className="sh-crop-tools">
        <button type="button" className="btn btn-sm btn-icon" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.15)}><ZoomOut size={16} aria-hidden="true" /></button>
        <input type="range" className="sh-zoom" aria-label="Zoom" min={Math.round(minZoom * 100)} max={MAX_ZOOM * 100} step={1}
          value={Math.min(MAX_ZOOM * 100, Math.max(Math.round(minZoom * 100), pct))} aria-valuetext={`${pct} percent`}
          onChange={(e) => apply(Number(e.target.value) / 100, off.x, off.y)} />
        <button type="button" className="btn btn-sm btn-icon" aria-label="Zoom in" onClick={() => zoomBy(1.15)}><ZoomIn size={16} aria-hidden="true" /></button>
        <button type="button" className="btn btn-sm" onClick={() => apply(minZoom, 0, 0)}><Minimize2 size={14} aria-hidden="true" /> Fit</button>
        <button type="button" className="btn btn-sm" onClick={() => apply(1, 0, 0)}><Maximize2 size={14} aria-hidden="true" /> Fill</button>
      </div>
    </div>
  );
}
