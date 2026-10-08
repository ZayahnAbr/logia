"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronUp, GripHorizontal, Music, X } from "lucide-react";
import { toEmbed } from "@/components/MusicWidget";
import { type MediaMeta } from "@/app/media-actions";
import { loadMediaMeta } from "@/lib/mediaMeta";

// The player lives in the root layout, so music keeps playing while you move between pages.
// The Space home widget only chooses what plays; this owns the one <iframe>.
type Ctx = { url: string | null; meta: MediaMeta | null; play: (url: string) => void; stop: () => void };
const MusicCtx = createContext<Ctx | null>(null);
export const useMusic = () => useContext(MusicCtx);

const KEY = "logia.music";
const POS_KEY = "logia.music.pos";
const HIDE_ON = ["/", "/features", "/pricing", "/invite", "/donate"];

export function MusicProvider({ children }: { children: ReactNode }) {
  const [url, setUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<MediaMeta | null>(null);
  const [open, setOpen] = useState(true);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null); // top-left, px; null = default corner
  const dockRef = useRef<HTMLElement>(null);
  const dragFrom = useRef<{ dx: number; dy: number } | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    try {
      setUrl(localStorage.getItem(KEY));
      const p = JSON.parse(localStorage.getItem(POS_KEY) || "null");
      if (p && typeof p.x === "number") setPos(p);
    } catch { /* storage blocked */ }
  }, []);

  // Real title + cover for whatever is playing.
  useEffect(() => {
    setMeta(null);
    if (!url) return;
    let alive = true;
    loadMediaMeta(url).then((m) => { if (alive) setMeta(m); });
    return () => { alive = false; };
  }, [url]);

  const play = useCallback((u: string) => {
    setUrl(u); setOpen(true);
    try { localStorage.setItem(KEY, u); } catch { /* */ }
  }, []);
  const stop = useCallback(() => {
    setUrl(null);
    try { localStorage.removeItem(KEY); } catch { /* */ }
  }, []);

  // Drag the player by its top bar; keep it inside the window.
  const clamp = (x: number, y: number) => {
    const el = dockRef.current;
    const w = el?.offsetWidth ?? 340, h = el?.offsetHeight ?? 60;
    return { x: Math.min(Math.max(8, x), window.innerWidth - w - 8), y: Math.min(Math.max(8, y), window.innerHeight - h - 8) };
  };
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const r = dockRef.current!.getBoundingClientRect();
    dragFrom.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragFrom.current) return;
    setPos(clamp(e.clientX - dragFrom.current.dx, e.clientY - dragFrom.current.dy));
  };
  const onUp = () => {
    if (!dragFrom.current) return;
    dragFrom.current = null;
    try { if (pos) localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* */ }
  };
  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clamp(p.x, p.y) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const embed = url ? toEmbed(url) : null;
  const hidden = HIDE_ON.includes(pathname) || pathname.startsWith("/auth");

  return (
    <MusicCtx.Provider value={{ url, meta, play, stop }}>
      {children}
      {embed && !hidden && (
        <aside ref={dockRef} className={`music-dock${open ? "" : " is-min"}`} aria-label="Music player"
          style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}>
          <div className="music-dock-bar" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            title="Drag to move the player">
            <GripHorizontal size={14} aria-hidden="true" className="music-dock-grip" />
            {meta?.thumb ? <img src={meta.thumb} alt="" className="music-dock-thumb" /> : <Music size={14} aria-hidden="true" />}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="truncate" style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>{meta?.title ?? embed.label}</span>
              {meta?.by && <span className="truncate" style={{ display: "block", fontSize: 11.5 }}>{meta.by}</span>}
            </span>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setOpen((o) => !o)}
              aria-label={open ? "Minimise player" : "Show player"} aria-expanded={open}>
              {open ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronUp size={15} aria-hidden="true" />}
            </button>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={stop} aria-label="Stop music and close player"><X size={15} aria-hidden="true" /></button>
          </div>
          {/* Kept mounted while minimised (only visually collapsed) so playback doesn't stop. */}
          <iframe title={`${meta?.title ?? embed.label} player`} src={embed.src} height={Math.min(embed.height, 152)} loading="lazy"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" />
        </aside>
      )}
    </MusicCtx.Provider>
  );
}
