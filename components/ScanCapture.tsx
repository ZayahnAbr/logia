"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, X, Loader2, ImagePlus, ScanLine } from "lucide-react";
import { scanPagesToText } from "@/app/actions";

const MAX_WIDTH = 1600;

// Downscales and lightly boosts contrast so text reads well and uploads stay small.
function toJpeg(source: CanvasImageSource, w: number, h: number) {
  const scale = Math.min(1, MAX_WIDTH / w);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.filter = "contrast(1.15) brightness(1.05)";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

function fileToJpeg(file: File) {
  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => { resolve(toJpeg(img, img.naturalWidth, img.naturalHeight)); URL.revokeObjectURL(img.src); };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export function ScanCapture({ onText, onCancel, label = "Transcribe pages" }: {
  onText: (text: string) => void; onCancel?: () => void; label?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [pages, setPages] = useState<string[]>([]);
  const [mathHeavy, setMathHeavy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopCamera = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; setCameraOn(false); };
  useEffect(() => stopCamera, []);

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 } } });
      streamRef.current = stream;
      setCameraOn(true);
      requestAnimationFrame(() => { if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); } });
    } catch {
      setError("Couldn't open the camera. Allow camera access, or use \"Upload photos\" instead.");
    }
  };

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    setPages((p) => [...p, toJpeg(v, v.videoWidth, v.videoHeight)]);
  };

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const imgs = await Promise.all([...files].filter((f) => f.type.startsWith("image/")).map(fileToJpeg));
    setPages((p) => [...p, ...imgs]);
  };

  const transcribe = async () => {
    setBusy(true); setError(null);
    const res = await scanPagesToText(pages, mathHeavy);
    setBusy(false);
    if ("error" in res && res.error) { setError(res.error); return; }
    stopCamera();
    onText(res.text ?? "");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {cameraOn ? (
        <div style={{ position: "relative", borderRadius: 14, overflow: "hidden", background: "#000" }}>
          <video ref={videoRef} playsInline muted style={{ width: "100%", maxHeight: 420, display: "block", objectFit: "contain" }} />
          {/* Framing guide */}
          <div style={{ position: "absolute", inset: "6% 10%", border: "2px dashed rgba(255,255,255,.6)", borderRadius: 10, pointerEvents: "none" }} />
          <div style={{ position: "absolute", bottom: 12, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 10 }}>
            <button type="button" onClick={capture} aria-label="Capture page"
              style={{ width: 62, height: 62, borderRadius: "50%", border: "4px solid #fff", background: "rgba(255,255,255,.25)", cursor: "pointer" }} />
            <button type="button" className="btn" onClick={stopCamera} style={{ position: "absolute", right: 12, bottom: 10 }}>Done</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={startCamera}><Camera size={14} /> Use camera</button>
          <label className="btn" style={{ cursor: "pointer" }}>
            <ImagePlus size={14} /> Upload photos
            <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          </label>
          {onCancel && <button type="button" className="btn btn-ghost" onClick={() => { stopCamera(); onCancel(); }}>Cancel</button>}
        </div>
      )}

      {pages.length > 0 && (
        <>
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{pages.length} page{pages.length === 1 ? "" : "s"} captured, read in this order.</div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
            {pages.map((src, i) => (
              <div key={i} style={{ position: "relative", flexShrink: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`Page ${i + 1}`} style={{ height: 110, borderRadius: 8, display: "block", boxShadow: "var(--shadow)" }} />
                <span style={{ position: "absolute", left: 6, top: 6, fontSize: 12, fontWeight: 700, background: "rgba(0,0,0,.6)", color: "#fff", borderRadius: 6, padding: "1px 6px" }}>{i + 1}</span>
                <button type="button" onClick={() => setPages((p) => p.filter((_, j) => j !== i))} aria-label="Remove page"
                  style={{ position: "absolute", right: 4, top: 4, width: 22, height: 22, borderRadius: "50%", border: "none", background: "rgba(0,0,0,.6)", color: "#fff", display: "grid", placeItems: "center", cursor: "pointer" }}>
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={mathHeavy} onChange={(e) => setMathHeavy(e.target.checked)} />
            These pages have lots of maths / science notation
          </label>
          <button type="button" className="btn btn-primary" onClick={transcribe} disabled={busy} style={{ alignSelf: "flex-start" }}>
            {busy ? <><Loader2 size={14} className="spin" /> Reading {pages.length} page{pages.length === 1 ? "" : "s"}…</> : <><ScanLine size={14} /> {label}</>}
          </button>
        </>
      )}
      {error && <div style={{ color: "var(--destructive)", fontSize: 12.5 }}>{error}</div>}
    </div>
  );
}
