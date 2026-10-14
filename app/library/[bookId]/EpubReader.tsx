"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Book, Rendition, Contents, NavItem } from "epubjs";
import {
  ArrowLeft, ChevronLeft, ChevronRight, Bookmark, BookmarkCheck, PanelRightOpen, PanelRightClose,
  Loader2, Trash2, Highlighter, AlertCircle, AArrowDown, AArrowUp, List,
} from "lucide-react";
import { RenameableTitle } from "@/components/RenameableTitle";
import { toast } from "@/components/Toaster";
import {
  getBookFileUrl, saveEpubPosition, addHighlight, updateHighlight, deleteHighlight, toggleBookmark, getBookAnnotations, renameLibraryBook,
} from "@/app/library-actions";

// EPUBs reflow, so there are no fixed pages: positions are EPUB CFIs, and "page" in the
// shared highlight/bookmark tables stores the epub.js location index (stable for a given book).
type Highlight = { id: string; page: number; text: string; color: string; rects: { cfi?: string }[]; note: string };
type BookmarkRow = { id: string; page: number; label: string };

const COLORS = [
  { id: "yellow", label: "Yellow", swatch: "#fde047", fill: "rgba(253,224,71,.55)" },
  { id: "green", label: "Green", swatch: "#86efac", fill: "rgba(134,239,172,.6)" },
  { id: "blue", label: "Blue", swatch: "#93c5fd", fill: "rgba(147,197,253,.6)" },
  { id: "pink", label: "Pink", swatch: "#f9a8d4", fill: "rgba(249,168,212,.6)" },
];
const SIZES = [90, 100, 112, 125, 140];
const cfiOf = (h: Highlight) => h.rects?.[0]?.cfi ?? "";

export function EpubReader({ bookId, title, initialCfi, initialHighlights, initialBookmarks }: {
  bookId: string; title: string; initialCfi: string | null; initialHighlights: Highlight[]; initialBookmarks: BookmarkRow[];
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const rendRef = useRef<Rendition | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const noteTimers = useRef<Record<string, number>>({});
  const painted = useRef(false);

  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pct, setPct] = useState(0);
  const [loc, setLoc] = useState<{ cfi: string; index: number; chapter: string }>({ cfi: initialCfi ?? "", index: 0, chapter: "" });
  const [toc, setToc] = useState<NavItem[]>([]);
  const [size, setSize] = useState(1);
  const [highlights, setHighlights] = useState<Highlight[]>(initialHighlights);
  const [bookmarks, setBookmarks] = useState<BookmarkRow[]>(initialBookmarks);
  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState<"contents" | "highlights" | "bookmarks">("contents");
  const [selection, setSelection] = useState<{ cfi: string; text: string } | null>(null);

  // Open the book from a signed URL as raw bytes (the URL has no .epub suffix for epub.js to sniff).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ default: ePub }, url, fresh] = await Promise.all([import("epubjs"), getBookFileUrl(bookId), getBookAnnotations(bookId)]);
        if ("highlights" in fresh && fresh.highlights) { setHighlights(fresh.highlights as Highlight[]); setBookmarks(fresh.bookmarks as BookmarkRow[]); }
        if (!url.url) throw new Error(url.error ?? "missing");
        const data = await (await fetch(url.url)).arrayBuffer();
        if (cancelled || !hostRef.current) return;
        const book = ePub(data);
        bookRef.current = book;
        const rendition = book.renderTo(hostRef.current, { width: "100%", height: "100%", flow: "paginated", spread: "auto", allowScriptedContent: false });
        rendRef.current = rendition;
        rendition.themes.default({
          body: { "font-family": "var(--font-sans), Georgia, serif !important", "line-height": "1.65 !important", color: "#1f1d1a" },
          "::selection": { background: "rgba(232,131,90,.35)" },
        });
        rendition.themes.fontSize(`${SIZES[1]}%`);
        await book.ready;
        setToc(book.navigation?.toc ?? []);
        await rendition.display(initialCfi || undefined);
        setReady(true);
        // Locations power the % progress and stable indices for bookmarks; generated once per open.
        await book.locations.generate(1600);
        if (!cancelled) report(rendition.currentLocation() as unknown as { start: { cfi: string } });
      } catch {
        if (!cancelled) setLoadError("Couldn't open this EPUB. It may be damaged or DRM-protected, so try another copy.");
      }
    })();
    return () => { cancelled = true; rendRef.current?.destroy(); bookRef.current?.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  const chapterFor = useCallback((href?: string) => {
    if (!href) return "";
    const flat = (items: NavItem[]): NavItem[] => items.flatMap((i) => [i, ...flat(i.subitems ?? [])]);
    return flat(toc).find((t) => href.includes(t.href.split("#")[0]))?.label.trim() ?? "";
  }, [toc]);

  const report = useCallback((location: { start: { cfi: string; href?: string } } | null) => {
    const book = bookRef.current;
    if (!book || !location?.start) return;
    const cfi = location.start.cfi;
    const total = book.locations.length();
    const index = total ? book.locations.locationFromCfi(cfi) as unknown as number : 0;
    const p = total ? Math.round(book.locations.percentageFromCfi(cfi) * 100) : 0;
    setLoc({ cfi, index: index || 0, chapter: chapterFor(location.start.href) });
    if (total) setPct(p);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveEpubPosition(bookId, cfi, Math.max(1, p)), 800);
  }, [bookId, chapterFor]);

  // Rendition events: position, text selection, keyboard and swipe inside the book frame.
  useEffect(() => {
    const r = rendRef.current;
    if (!r || !ready) return;
    const onRelocated = (l: unknown) => report(l as { start: { cfi: string; href?: string } });
    const onSelected = (cfiRange: string, contents: Contents) => {
      const text = contents.window.getSelection()?.toString().trim() ?? "";
      if (text) setSelection({ cfi: cfiRange, text });
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "ArrowRight") r.next(); if (e.key === "ArrowLeft") r.prev(); };
    let touchX = 0;
    const onContent = (contents: Contents) => {
      const doc = contents.document;
      doc.addEventListener("keydown", onKey);
      doc.addEventListener("contextmenu", (e) => { if (doc.getSelection()?.toString().trim()) e.preventDefault(); });
      doc.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
      doc.addEventListener("touchend", (e) => {
        const dx = e.changedTouches[0].clientX - touchX;
        if (Math.abs(dx) > 50 && !doc.getSelection()?.toString()) (dx < 0 ? r.next() : r.prev());
      }, { passive: true });
    };
    r.on("relocated", onRelocated);
    r.on("selected", onSelected);
    r.hooks.content.register(onContent);
    window.addEventListener("keydown", onKey);
    // Paint saved highlights once per open (this effect re-runs when the TOC loads).
    if (!painted.current) {
      painted.current = true;
      for (const h of highlights) { const cfi = cfiOf(h); if (cfi) try { r.annotations.highlight(cfi, { id: h.id }, undefined, `hl-${h.color}`, { fill: COLORS.find((c) => c.id === h.color)?.fill ?? COLORS[0].fill }); } catch { /* stale range */ } }
    }
    return () => { r.off("relocated", onRelocated); r.off("selected", onSelected); window.removeEventListener("keydown", onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, report]);

  const setFont = (i: number) => { const n = Math.max(0, Math.min(SIZES.length - 1, i)); setSize(n); rendRef.current?.themes.fontSize(`${SIZES[n]}%`); };

  const saveHighlight = async (color: string) => {
    if (!selection) return;
    const sel = selection;
    setSelection(null);
    const fill = COLORS.find((c) => c.id === color)!.fill;
    const res = await addHighlight(bookId, loc.index, sel.text, color, [{ cfi: sel.cfi }] as never);
    if ("error" in res && res.error) { toast(res.error, "error"); return; }
    const h = res.highlight as Highlight;
    rendRef.current?.annotations.highlight(sel.cfi, { id: h.id }, undefined, `hl-${color}`, { fill });
    setHighlights((all) => [...all, h]);
    setTab("highlights");
  };

  const removeHighlight = async (h: Highlight) => {
    const res = await deleteHighlight(h.id);
    if ("error" in res && res.error) { toast(res.error, "error"); return; }
    try { rendRef.current?.annotations.remove(cfiOf(h), "highlight"); } catch { /* already gone */ }
    setHighlights((all) => all.filter((x) => x.id !== h.id));
  };

  const saveNote = async (h: Highlight, note: string) => {
    if (note === h.note) return;
    const res = await updateHighlight(h.id, { note });
    if ("error" in res && res.error) toast(res.error, "error");
    else setHighlights((all) => all.map((x) => (x.id === h.id ? { ...x, note } : x)));
  };

  const isBookmarked = bookmarks.some((b) => b.page === loc.index);
  const onToggleBookmark = async () => {
    const res = await toggleBookmark(bookId, loc.index, loc.chapter || `${pct}% through`);
    if ("error" in res && res.error) { toast(res.error as string, "error"); return; }
    const fresh = await getBookAnnotations(bookId);
    if ("bookmarks" in fresh && fresh.bookmarks) setBookmarks(fresh.bookmarks as BookmarkRow[]);
  };
  const goIndex = (index: number) => { const cfi = bookRef.current?.locations.cfiFromLocation(index); if (cfi) rendRef.current?.display(cfi as string); };

  const flatToc = (items: NavItem[], depth = 0): { item: NavItem; depth: number }[] => items.flatMap((i) => [{ item: i, depth }, ...flatToc(i.subitems ?? [], depth + 1)]);

  return (
    <div className="reader">
      <header className="reader-bar">
        <Link href="/library" className="btn btn-ghost btn-sm"><ArrowLeft size={15} aria-hidden="true" /> Library</Link>
        <h1 className="reader-title" style={{ display: "flex" }}>
          <RenameableTitle value={title} label="book" onRename={(n) => renameLibraryBook(bookId, n)} />
        </h1>

        <nav aria-label="Page navigation" className="reader-group">
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Previous page" onClick={() => rendRef.current?.prev()} disabled={!ready}><ChevronLeft size={16} /></button>
          <span style={{ fontSize: 13, color: "var(--muted)", minWidth: 64, textAlign: "center", fontVariantNumeric: "tabular-nums" }} aria-live="polite">{ready ? `${pct}% read` : "…"}</span>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Next page" onClick={() => rendRef.current?.next()} disabled={!ready}><ChevronRight size={16} /></button>
        </nav>

        <div className="reader-group" role="group" aria-label="Text size">
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Smaller text" onClick={() => setFont(size - 1)} disabled={size <= 0}><AArrowDown size={16} /></button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Larger text" onClick={() => setFont(size + 1)} disabled={size >= SIZES.length - 1}><AArrowUp size={16} /></button>
        </div>

        <div className="reader-group">
          <button type="button" className="btn btn-sm" aria-pressed={isBookmarked} onClick={onToggleBookmark} disabled={!ready}
            style={isBookmarked ? { background: "var(--accent-soft)", color: "var(--accent-text)" } : undefined}>
            {isBookmarked ? <BookmarkCheck size={15} aria-hidden="true" /> : <Bookmark size={15} aria-hidden="true" />}
            {isBookmarked ? "Bookmarked" : "Bookmark"}
          </button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={panelOpen ? "Hide side panel" : "Show side panel"} aria-expanded={panelOpen} onClick={() => setPanelOpen((o) => !o)}>
            {panelOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
        </div>
      </header>

      <div className="reader-body">
        <div className="reader-viewport epub-viewport">
          {loadError ? (
            <div className="notice notice-error" role="alert" style={{ maxWidth: 520, margin: "48px auto" }}>
              <AlertCircle size={18} aria-hidden="true" style={{ flexShrink: 0 }} /> {loadError}
            </div>
          ) : (
            <div className="epub-page">
              <div ref={hostRef} className="epub-host" aria-label={`${title}, ${loc.chapter || "book"}`} />
              {!ready && <div className="reader-loading" aria-live="polite"><Loader2 size={20} className="spin" aria-hidden="true" /> Opening your book…</div>}
              {selection && (
                <div role="toolbar" aria-label="Highlight selection" className="reader-popover epub-popover">
                  <Highlighter size={15} aria-hidden="true" style={{ color: "var(--muted)" }} />
                  {COLORS.map((c) => (
                    <button key={c.id} type="button" aria-label={`Highlight in ${c.label.toLowerCase()}`} onClick={() => saveHighlight(c.id)} className="reader-swatch" style={{ background: c.swatch }} />
                  ))}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelection(null)}>Cancel</button>
                </div>
              )}
            </div>
          )}
          {ready && <div className="epub-progress" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>}
        </div>

        {panelOpen && (
          <aside className="reader-panel" aria-label="Contents, highlights and bookmarks">
            <div role="tablist" aria-label="Side panel" className="reader-tabs">
              {(["contents", "highlights", "bookmarks"] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} id={`tab-${t}`} aria-controls={`panel-${t}`}
                  className={`reader-tab${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>
                  {t === "contents" ? <><List size={14} aria-hidden="true" /> Contents</> : t === "highlights" ? <>Highlights <span className="reader-count">{highlights.length}</span></> : <>Bookmarks <span className="reader-count">{bookmarks.length}</span></>}
                </button>
              ))}
            </div>

            {tab === "contents" && (
              <div role="tabpanel" id="panel-contents" aria-labelledby="tab-contents" className="reader-list">
                {toc.length === 0 ? <p className="reader-empty">This book doesn&apos;t include a table of contents.</p> : flatToc(toc).map(({ item, depth }) => (
                  <button key={item.id + item.href} type="button" className={`epub-toc${item.label.trim() === loc.chapter ? " on" : ""}`} style={{ paddingLeft: 12 + depth * 14 }}
                    onClick={() => rendRef.current?.display(item.href)}>{item.label.trim()}</button>
                ))}
              </div>
            )}

            {tab === "highlights" && (
              <div role="tabpanel" id="panel-highlights" aria-labelledby="tab-highlights" className="reader-list">
                {highlights.length === 0 ? (
                  <p className="reader-empty">Select any text in the book and choose a colour to highlight it.</p>
                ) : highlights.map((h) => (
                  <div key={h.id} className="reader-item">
                    <button type="button" className="reader-item-main" onClick={() => cfiOf(h) && rendRef.current?.display(cfiOf(h))}>
                      <span className="reader-dot" style={{ background: COLORS.find((c) => c.id === h.color)?.swatch }} aria-hidden="true" />
                      <span style={{ minWidth: 0 }}>
                        <span className="reader-meta">{COLORS.find((c) => c.id === h.color)?.label}</span>
                        <span className="reader-quote">“{h.text}”</span>
                      </span>
                    </button>
                    <label className="sr-only" htmlFor={`note-${h.id}`}>Note for this highlight</label>
                    <textarea id={`note-${h.id}`} className="input" rows={1} defaultValue={h.note} placeholder="Add a note…"
                      onChange={(e) => { const v = e.target.value.trim(); window.clearTimeout(noteTimers.current[h.id]); noteTimers.current[h.id] = window.setTimeout(() => saveNote(h, v), 700); }}
                      onBlur={(e) => { window.clearTimeout(noteTimers.current[h.id]); saveNote(h, e.target.value.trim()); }}
                      style={{ minHeight: 34, fontSize: 13, resize: "vertical" }} />
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeHighlight(h)} style={{ alignSelf: "flex-start", color: "var(--danger)" }}>
                      <Trash2 size={14} aria-hidden="true" /> Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            {tab === "bookmarks" && (
              <div role="tabpanel" id="panel-bookmarks" aria-labelledby="tab-bookmarks" className="reader-list">
                {bookmarks.length === 0 ? (
                  <p className="reader-empty">Use “Bookmark” in the toolbar to save places you want to come back to.</p>
                ) : bookmarks.map((b) => (
                  <div key={b.id} className={`reader-item reader-item-row${b.page === loc.index ? " on" : ""}`}>
                    <button type="button" className="reader-item-main" onClick={() => goIndex(b.page)}>
                      <BookmarkCheck size={16} aria-hidden="true" style={{ color: "var(--accent-text)", flexShrink: 0 }} />
                      <span className="reader-quote" style={{ fontStyle: "normal" }}>{b.label || "Bookmark"}</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
