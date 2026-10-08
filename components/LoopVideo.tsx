"use client";

import { useEffect, useRef, useState } from "react";

// Looping ambient video for a café. Muted (autoplay-safe), fades in once playable,
// and stays as a still frame for people who prefer reduced motion.
export const LOOP_SRC: Record<string, string> = {
  "rain-cafe": "/loops/rain-cafe.mp4",
  "night-library": "/loops/night-library.mp4",
  "forest-cabin": "/loops/forest-cabin.mp4",
  "lofi-desk": "/loops/lofi-desk.mp4",
};

export function LoopVideo({ scene, src: custom }: { scene: string; src?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const src = custom ?? LOOP_SRC[scene];
  useEffect(() => {
    const v = ref.current; if (!v) return;
    // loadeddata can fire before hydration attaches the handler
    if (v.readyState >= 2) setReady(true);
    v.muted = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { v.pause(); return; }
    v.play().catch(() => { /* autoplay blocked: first frame still shows */ });
  }, [src]);
  if (!src) return null;
  return (
    <video ref={ref} className={`cafe-loop${ready ? " on" : ""}`} src={src} muted loop playsInline autoPlay preload="auto"
      onLoadedData={() => setReady(true)} aria-hidden="true" tabIndex={-1} />
  );
}
