import { LoopVideo } from "@/components/LoopVideo";
import type { LoopSceneId } from "@/lib/loopScenes";

export type CafeSceneId = LoopSceneId;

// Decorative only, so hidden from assistive tech. A preset scene is its poster JPG with the real loop over it.
export function CafeScene({ scene, src, image, color, play }: { scene: CafeSceneId; src?: string; image?: string; color?: string; play?: boolean }) {
  // A picture or a plain colour replaces the loop entirely.
  if (color) return <div className="cafe-scene sc-plain" style={{ background: color }} aria-hidden="true" />;
  if (image) {
    return (
      <div className="cafe-scene sc-plain" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, decorative */}
        <img className="cafe-loop on" src={image} alt="" />
      </div>
    );
  }
  return (
    <div className="cafe-scene" aria-hidden="true">
      <LoopVideo scene={scene} src={src} play={play} />
    </div>
  );
}
