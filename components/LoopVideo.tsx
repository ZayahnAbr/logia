"use client";

import { useEffect, useRef, useState } from "react";

import { LOOP_SRC, POSTER, isSceneId } from "@/lib/loopScenes";

// Muted loop, autoplay-safe. `play` lets a card start and stop it (hover, focus, scroll position).
// When `play` is omitted it plays whenever motion is allowed.
export function LoopVideo({ scene, src: custom, play }: { scene: string; src?: string; play?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = custom ?? (isSceneId(scene) ? LOOP_SRC[scene] : undefined);
  const poster = custom ? undefined : isSceneId(scene) ? POSTER[scene] : undefined;
  const want = play ?? true;
  useEffect(() => {
    const v = ref.current; if (!v) return;
    // loadeddata can fire before hydration attaches the handler
    if (v.readyState >= 2) setReady(true);
    v.muted = true;
    if (!want || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { v.pause(); return; }
    v.play().catch(() => { /* autoplay blocked: poster still shows */ });
  }, [src, want]);
  if (!src) return null;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- local poster still, decorative */}
      {poster && <img className="cafe-poster" src={poster} alt="" />}
      {!failed && (
        <video ref={ref} className={`cafe-loop${ready ? " on" : ""}`} src={src} poster={poster} muted loop playsInline autoPlay={want} preload={play === undefined ? "auto" : "metadata"}
          onLoadedData={() => setReady(true)} onError={() => setFailed(true)} aria-hidden="true" tabIndex={-1} />
      )}
    </>
  );
}
