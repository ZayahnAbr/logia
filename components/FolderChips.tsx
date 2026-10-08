"use client";

import { useEffect, useState } from "react";
import { Folder, FolderPlus, MoreHorizontal, Pencil } from "lucide-react";

// Folder bar shared by Notes and Files: select, drop items onto a folder, rename, recolour,
// and add new folders. Colours are remembered per space on this device.
export const FOLDER_COLORS = ["#8e8e95", "#f2836b", "#e0b100", "#1f8a4c", "#14a39a", "#2f5bd3", "#7b4fd6", "#d23c8a"];

export function FolderChips({ storageKey, folders, counts, active, onSelect, onDropItem, onRename, dragType, total }: {
  storageKey: string; folders: string[]; counts: Record<string, number>; total: number; active: string;
  onSelect: (f: string) => void; onDropItem: (folder: string, id: string) => void;
  onRename: (from: string, to: string) => Promise<{ error?: string } | void>; dragType: string;
}) {
  const [colors, setColors] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<string[]>([]);
  const [drop, setDrop] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => { try { setColors(JSON.parse(localStorage.getItem(storageKey) || "{}")); } catch { /* */ } }, [storageKey]);
  const setColor = (f: string, c: string) => {
    const next = { ...colors, [f]: c }; setColors(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* */ }
  };
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest(".fc-menu-wrap")) setMenu(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, [menu]);

  const list = [...new Set([...folders, ...extra])];
  const commitRename = async () => {
    if (!renaming) return;
    const to = renaming.to.trim();
    const from = renaming.from;
    setRenaming(null);
    if (!to || to === from) return;
    const res = await onRename(from, to);
    if (res && "error" in res && res.error) return;
    if (colors[from]) { const c = { ...colors, [to]: colors[from] }; delete c[from]; setColors(c); try { localStorage.setItem(storageKey, JSON.stringify(c)); } catch { /* */ } }
    setExtra((x) => x.map((n) => (n === from ? to : n)));
    if (active === from) onSelect(to);
  };

  const chip = (f: string, isAll = false) => {
    const tone = isAll ? undefined : colors[f];
    if (renaming?.from === f) {
      return (
        <form key={f} className="fc-rename" onSubmit={(e) => { e.preventDefault(); commitRename(); }}>
          <label htmlFor={`fc-r-${f}`} className="sr-only">New name for {f}</label>
          <input id={`fc-r-${f}`} autoFocus className="input" value={renaming.to} maxLength={40}
            onChange={(e) => setRenaming({ from: f, to: e.target.value })} onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === "Escape") setRenaming(null); }} />
        </form>
      );
    }
    return (
      <span key={f} className={`fc${active === f ? " on" : ""}${drop === f ? " drop" : ""}`} style={tone ? { ["--fc" as string]: tone } : undefined}>
        <button type="button" role="tab" aria-selected={active === f} className="fc-main" onClick={() => onSelect(f)}
          onDragOver={(e) => { if (!isAll && e.dataTransfer.types.includes(dragType)) { e.preventDefault(); setDrop(f); } }}
          onDragLeave={() => setDrop((d) => (d === f ? null : d))}
          onDrop={(e) => { e.preventDefault(); setDrop(null); const id = e.dataTransfer.getData(dragType); if (id && !isAll) onDropItem(f, id); }}>
          <Folder size={13} aria-hidden="true" className="fc-ico" /> {f} <span className="fc-count">{isAll ? total : counts[f] ?? 0}</span>
        </button>
        {!isAll && (
          <span className="fc-menu-wrap">
            <button type="button" className="fc-more" aria-label={`Options for ${f}`} aria-expanded={menu === f} onClick={() => setMenu((m) => (m === f ? null : f))}><MoreHorizontal size={14} /></button>
            {menu === f && (
              <div className="fc-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => { setMenu(null); setRenaming({ from: f, to: f }); }}><Pencil size={13} aria-hidden="true" /> Rename</button>
                <div className="fc-swatches" role="group" aria-label="Folder colour">
                  {FOLDER_COLORS.map((c) => (
                    <button key={c} type="button" className={`fc-sw${(colors[f] ?? FOLDER_COLORS[0]) === c ? " on" : ""}`} style={{ background: c }}
                      aria-label={`Colour ${c}`} aria-pressed={(colors[f] ?? FOLDER_COLORS[0]) === c} onClick={() => setColor(f, c)} />
                  ))}
                </div>
              </div>
            )}
          </span>
        )}
      </span>
    );
  };

  return (
    <div className="fc-bar" role="tablist" aria-label="Folders. Drag an item onto a folder to move it.">
      {chip("All", true)}
      {list.map((f) => chip(f))}
      {adding === null ? (
        <button type="button" className="fc fc-new" onClick={() => setAdding("")}><FolderPlus size={13} aria-hidden="true" /> New folder</button>
      ) : (
        <form className="fc-rename" onSubmit={(e) => { e.preventDefault(); const n = adding.trim(); if (n) { setExtra((x) => [...new Set([...x, n])]); onSelect(n); } setAdding(null); }}>
          <label htmlFor="fc-new" className="sr-only">Folder name</label>
          <input id="fc-new" autoFocus className="input" value={adding} maxLength={40} placeholder="Folder name"
            onChange={(e) => setAdding(e.target.value)} onBlur={() => !adding.trim() && setAdding(null)} onKeyDown={(e) => { if (e.key === "Escape") setAdding(null); }} />
        </form>
      )}
    </div>
  );
}
