"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Boxes, ChevronsUpDown, Check, LayoutGrid, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type SpaceRow = { id: string; name: string; subject: string | null };

// Dropdown listing the user's spaces. Keyboard: Enter/Space opens, ↑/↓ move, Escape closes.
export function SpaceSwitcher({ currentId, currentName, onNavigate }: {
  currentId?: string; currentName?: string; onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [spaces, setSpaces] = useState<SpaceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Load the list the first time the menu opens.
  useEffect(() => {
    if (!open || spaces) return;
    createClient().from("spaces").select("id, name, subject").order("name").then(({ data, error: err }) => {
      if (err) setError("Couldn't load your spaces. Check your connection and try again.");
      else setSpaces((data as SpaceRow[]) ?? []);
    });
  }, [open, spaces]);

  // Close on outside click / Escape; focus the first item when it opens.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); buttonRef.current?.focus(); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  useEffect(() => {
    if (open && spaces) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open, spaces]);

  const choose = () => { setOpen(false); onNavigate?.(); };

  return (
    <div ref={wrapRef} style={{ position: "relative", marginTop: 6 }}>
      <button ref={buttonRef} type="button" data-tour="spaces" className="sidebar-space-pill"
        aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", margin: 0, border: "none", font: "inherit", textAlign: "left" }}>
        <Boxes size={15} strokeWidth={1.75} style={{ color: "var(--coral)", flexShrink: 0 }} aria-hidden="true" />
        <span style={{ minWidth: 0, flex: 1 }}>
          <span className="truncate" style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{currentName ?? "Choose a space"}</span>
          <span style={{ display: "block", fontSize: 12, color: "var(--faint)" }}>{currentId ? "Switch space" : "Pick one to see its tools"}</span>
        </span>
        <ChevronsUpDown size={14} aria-hidden="true" style={{ color: "var(--faint)", flexShrink: 0 }} />
      </button>

      {open && (
        <div ref={menuRef} role="menu" aria-label="Your spaces"
          style={{ position: "absolute", left: 0, right: 0, top: "calc(100% + 6px)", zIndex: 40, background: "var(--surface)", borderRadius: "var(--r-md)", padding: 6, boxShadow: "var(--shadow-lift), 0 0 0 1px var(--border)", maxHeight: 320, overflowY: "auto" }}>
          {error ? (
            <p role="alert" className="field-error" style={{ margin: 8 }}>{error}</p>
          ) : !spaces ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 10, fontSize: 13, color: "var(--muted)" }}>
              <Loader2 size={14} className="spin" aria-hidden="true" /> Loading spaces…
            </div>
          ) : spaces.length === 0 ? (
            <p style={{ margin: 8, fontSize: 13, color: "var(--muted)" }}>You haven&apos;t created or joined a space yet.</p>
          ) : spaces.map((s) => (
            <Link key={s.id} href={`/spaces/${s.id}`} role="menuitem" onClick={choose} className="switcher-item"
              aria-current={s.id === currentId ? "true" : undefined}>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="truncate" style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>{s.name}</span>
                {s.subject && <span className="truncate" style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{s.subject}</span>}
              </span>
              {s.id === currentId && <Check size={15} aria-label="Current space" style={{ color: "var(--accent-text)", flexShrink: 0 }} />}
            </Link>
          ))}
          <div aria-hidden="true" style={{ height: 1, background: "var(--border-soft)", margin: "6px 4px" }} />
          <Link href="/spaces" role="menuitem" onClick={choose} className="switcher-item">
            <LayoutGrid size={15} aria-hidden="true" style={{ color: "var(--muted)" }} />
            <span style={{ fontSize: 13.5 }}>All spaces · create or join</span>
          </Link>
        </div>
      )}
    </div>
  );
}
