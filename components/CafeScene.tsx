import type { CSSProperties } from "react";
import { LoopVideo } from "@/components/LoopVideo";

export type CafeSceneId = "rain-cafe" | "night-library" | "forest-cabin" | "lofi-desk";

// Deterministic spread so server and client render identical markup.
const spread = (n: number, seed: number) => Array.from({ length: n }, (_, i) => {
  const a = Math.sin((i + 1) * 12.9898 + seed) * 43758.5453;
  return a - Math.floor(a);
});

const Dots = ({ n, cls, seed }: { n: number; cls: string; seed: number }) => (
  <>
    {spread(n, seed).map((r, i) => {
      const r2 = spread(n, seed + 7)[i];
      return <i key={i} className={cls} style={{ "--x": `${Math.round(r * 100)}%`, "--y": `${Math.round(r2 * 100)}%`, "--d": `${(6 + r * 8).toFixed(1)}s`, "--s": `${(-r2 * 10).toFixed(1)}s` } as CSSProperties} />;
    })}
  </>
);

// Pure CSS scenes (see "Discover" in globals.css). Decorative only, so hidden from assistive tech.
export function CafeScene({ scene, src, image, color }: { scene: CafeSceneId; src?: string; image?: string; color?: string }) {
  // A picture or a plain colour replaces the animated scene entirely.
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
    <div className={`cafe-scene sc-${scene}`} aria-hidden="true">
      {scene === "rain-cafe" && (
        <>
          <div className="sc-window"><i className="sc-rain r1" /><i className="sc-rain r2" /><i className="sc-rain r3" /></div>
          <div className="sc-glow" />
          <div className="sc-table"><i className="sc-steam" /><i className="sc-steam s2" /><i className="sc-cup" /></div>
        </>
      )}
      {scene === "night-library" && (
        <>
          <div className="sc-shelves"><i /><i /><i /></div>
          <div className="sc-glow" />
          <div className="sc-lampshade" />
          <Dots n={16} cls="sc-dust" seed={3} />
        </>
      )}
      {scene === "forest-cabin" && (
        <>
          <div className="sc-moon" />
          <div className="sc-trees back"><i /><i /><i /><i /><i /></div>
          <div className="sc-trees front"><i /><i /><i /><i /></div>
          <div className="sc-cabin"><i /></div>
          <Dots n={14} cls="sc-fly" seed={9} />
        </>
      )}
      {scene === "lofi-desk" && (
        <>
          <div className="sc-sky"><i className="sc-stars" /><i className="sc-stars st2" /></div>
          <div className="sc-glow" />
          <div className="sc-desk"><i className="sc-steam" /><i className="sc-steam s2" /><i className="sc-steam s3" /><i className="sc-cup" /><i className="sc-deskLamp" /></div>
        </>
      )}
      {/* Real cozy loop (Pixabay, non-AI, self-hosted in /public/loops). The CSS scene shows while it loads or if it fails. */}
      <LoopVideo scene={scene} src={src} />
    </div>
  );
}
