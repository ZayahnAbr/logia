import { useId } from "react";
import { parseCover, type Cover } from "@/lib/notebookCovers";

// Cover artwork (decorative). Colours and patterns are drawn in code; images arrive as a signed URL.
// Fills its parent: the parent decides the size and shape.
export function CoverArt({ cover, imageUrl, className }: {
  cover: { kind: string | null; value: string | null } | Cover | null | undefined;
  imageUrl?: string | null; className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const c = parseCover(cover ?? null);
  const fallback = "#6B7785";

  if (c?.kind === "image" && imageUrl) {
    const pos = c.pos ?? { x: 50, y: 50 };
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt="" className={className} loading="lazy" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: `${pos.x}% ${pos.y}%`, display: "block" }} />;
  }
  const bg = c?.color ?? fallback;
  const ink = "rgba(255,255,255,.55)";
  const svg = (
    <svg className={className} width="100%" height="100%" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid slice" style={{ display: "block" }}>
      <rect width="100%" height="100%" fill={bg} />
      {c?.kind === "pattern" && (
        <>
          <defs>
            {c.pattern === "dots" && <pattern id={uid} width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="8" cy="8" r="2.2" fill={ink} /></pattern>}
            {c.pattern === "grid" && <pattern id={uid} width="18" height="18" patternUnits="userSpaceOnUse"><path d="M18 0H0V18" fill="none" stroke={ink} strokeWidth="1" /></pattern>}
            {c.pattern === "lines" && <pattern id={uid} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0H12" stroke={ink} strokeWidth="2" /></pattern>}
            {c.pattern === "waves" && <pattern id={uid} width="40" height="14" patternUnits="userSpaceOnUse"><path d="M0 7 Q10 0 20 7 T40 7" fill="none" stroke={ink} strokeWidth="1.6" /></pattern>}
          </defs>
          <rect width="100%" height="100%" fill={`url(#${uid})`} />
        </>
      )}
    </svg>
  );
  if (c?.kind !== "emoji") return svg;
  return (
    <span className="nbk-art-wrap" aria-hidden="true">
      {svg}
      <span className="nbk-art-emoji">{c.emoji}</span>
    </span>
  );
}
