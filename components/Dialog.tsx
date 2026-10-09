"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Accessible modal: role="dialog", labelled by its title, focus trapped inside,
// Escape closes (when onClose is given), focus returns to the trigger on close.
export function Dialog({ title, onClose, children, width = 420, hideTitle = false }: {
  title: string; onClose?: () => void; children: ReactNode; width?: number; hideTitle?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Callers usually pass a new onClose function on every render (an inline arrow). Keeping the
  // latest one in a ref lets the effect below run once when the dialog opens. Before, it re-ran
  // on every keystroke and pulled focus back to the first button (the close X) mid-typing.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // Focus the first form field if there is one, otherwise the first control.
    const field = ref.current?.querySelector<HTMLElement>("input:not([disabled]):not([type=hidden]), textarea:not([disabled]), select:not([disabled])");
    const first = field ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? ref.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      const close = closeRef.current;
      if (e.key === "Escape" && close) { e.preventDefault(); close(); return; }
      if (e.key !== "Tab" || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const firstEl = items[0], lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previous?.focus?.();
    };
  }, []);

  // Portalled to <body> so a transformed ancestor (e.g. page-enter animation) can't offset it.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center", padding: 16, background: "rgba(17,17,17,.45)" }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="card"
        style={{ position: "relative", width: "100%", maxWidth: width, maxHeight: "calc(100vh - 32px)", overflowY: "auto", padding: 28, outline: "none" }}>
        <h2 id={titleId} className={hideTitle ? "sr-only" : undefined} style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px", paddingRight: onClose ? 40 : 0 }}>{title}</h2>
        {onClose && (
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close"
            style={{ position: "absolute", top: 16, right: 16 }}>
            <X size={16} />
          </button>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
