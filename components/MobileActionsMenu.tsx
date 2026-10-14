"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal, X } from "lucide-react";

// Space-header actions (change header, make public, share, invite...): five buttons is a lot to have
// permanently on screen on a phone. Above the "actions" breakpoint they render in their usual row;
// below it, they collapse behind one "More" button and drop down as a short list. Desktop is untouched —
// this only changes what phones see, and every child button keeps its own click handling and dialogs.
export function MobileActionsMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={ref} className="hero-actions">
      <button type="button" className="hero-actions-trigger btn btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true" aria-label="Space actions">
        {open ? <X size={15} aria-hidden="true" /> : <MoreHorizontal size={15} aria-hidden="true" />} Actions
      </button>
      <div className="hero-actions-row" data-open={open || undefined}>{children}</div>
    </div>
  );
}
