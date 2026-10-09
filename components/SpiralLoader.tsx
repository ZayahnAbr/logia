import { useId } from "react";
import { LOGO_CENTERLINE, LOGO_MASK_WIDTH, LOGO_PATH, LOGO_RED, LOGO_VIEWBOX } from "@/lib/logoPath";

// Loading indicator: the Logia spiral being drawn, then wiped away, on a loop. It fades in after a short delay so
// quick page changes show nothing at all. With reduced motion it is the still spiral. Announced as "Loading".
export function SpiralLoader({ size = 72, label, color = LOGO_RED, inline = false }: { size?: number; label?: string; color?: string; inline?: boolean }) {
  const id = useId().replace(/:/g, "");
  return (
    <div role="status" aria-live="polite" className={inline ? "spiral-loader is-inline" : "spiral-loader"}>
      <svg width={size} height={size} viewBox={LOGO_VIEWBOX} aria-hidden="true" focusable="false" className="spiral-draw">
        <defs>
          <mask id={`sl-${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="2178" height="2178">
            <path d={LOGO_CENTERLINE} fill="none" stroke="#fff" strokeWidth={LOGO_MASK_WIDTH} strokeLinecap="round" pathLength={1} className="spiral-pen" />
          </mask>
        </defs>
        <path mask={`url(#sl-${id})`} fill={color} fillRule="evenodd" d={LOGO_PATH} />
      </svg>
      {label ? <span className="spiral-label" aria-hidden="true">{label}</span> : null}
      <span className="sr-only">{label ?? "Loading"}</span>
    </div>
  );
}
