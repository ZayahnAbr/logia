import { LOGO_PATH, LOGO_RED, LOGO_VIEWBOX } from "@/lib/logoPath";

// The Logia spiral. Decorative by default (the word "logia" usually sits beside it); give `title` when it
// stands alone. Colour follows `color`, `currentColor` if you pass "currentColor", else the brand red.
export function LogoMark({ size = 24, color = LOGO_RED, title, className, style }: {
  size?: number; color?: string; title?: string; className?: string; style?: React.CSSProperties;
}) {
  return (
    <svg width={size} height={size} viewBox={LOGO_VIEWBOX} className={className} style={{ display: "block", flexShrink: 0, ...style }}
      role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      <path fill={color} fillRule="evenodd" d={LOGO_PATH} />
    </svg>
  );
}
