"use client";

import { useEffect, useState } from "react";
import { Palette, Check } from "lucide-react";
import { setSpaceCover } from "@/app/actions";
import { toast } from "@/components/Toaster";

// Solid, user-chosen cover for a space card. The picker sits above the card's stretched link.
import { COVER_COLORS } from "@/lib/coverColors";
export { COVER_COLORS };

// Light covers get dark controls/badges; dark covers keep white ones (WCAG luminance).
const isLight = (hex?: string | null) => {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return true;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45;
};

export function SpaceCover({ spaceId, initial, children }: { spaceId: string; initial: string; children: React.ReactNode }) {
  const [color, setColor] = useState(initial || COVER_COLORS[0]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest(`[data-cover="${spaceId}"]`)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, [open, spaceId]);

  const pick = async (c: string) => {
    const prev = color;
    setColor(c); setOpen(false);
    const res = await setSpaceCover(spaceId, c);
    if (res && "error" in res && res.error) { setColor(prev); toast(res.error, "error"); }
  };

  return (
    <div className={`sp-cover${isLight(color) ? " is-light" : ""}`} style={{ background: color }} data-cover={spaceId}>
      {children}
      <button type="button" className="sp-paint" onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }} aria-label="Change cover colour" aria-expanded={open} title="Cover colour">
        <Palette size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="sp-palette" role="group" aria-label="Cover colour">
          {COVER_COLORS.map((c) => (
            <button key={c} type="button" style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={color === c} onClick={() => pick(c)}>
              {color === c && <Check size={13} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
