"use client";
import { loadPdfjs } from "@/lib/pdf/loadPdfjs";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RenameableTitle } from "@/components/RenameableTitle";
import {
  ArrowLeft, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Bookmark, BookmarkCheck,
  PanelRightOpen, PanelRightClose, Loader2, Trash2, Highlighter, AlertCircle,
} from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import {
  getBookFileUrl, saveReadingPosition, addHighlight, updateHighlight, deleteHighlight, toggleBookmark, getBookAnnotations, renameLibraryBook,
  type HighlightRect,
} from "@/app/library-actions";

type Highlight = { id: string; page: number; text: string; color: string; rects: HighlightRect[]; note: string };
type BookmarkRow = { id: string; page: number; label: string };

const COLORS = [
  { id: "yellow", label: "Yellow", swatch: "#fde047" },
  { id: "green", label: "Green", swatch: "#86efac" },
  { id: "blue", label: "Blue", swatch: "#93c5fd" },
  { id: "pink", label: "Pink", swatch: "#f9a8d4" },
];
const ZOOMS = [0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5];

export function BookReader({ bookId, title, initialPage, initialHighlights, initialBookmarks }: {
  bookId: string; title: string; initialPage: number; initialHighlights: Highlight[]; initialBookmarks: BookmarkRow[];
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(Math.max(1, initialPage));
  const [pageInput, setPageInput] = useState(String(Math.max(1, initialPage)));
  const [scale, setScale] = useState<number | null>(null); // null until "fit width" is computed
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 });

  const [highlights, setHighlights] = useState<Highlight[]>(initialHighlights);
  const [bookmarks, setBookmarks] = useState<BookmarkRow[]>(initialBookmarks);
  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState<"highlights" | "bookmarks">("highlights");
  const [activeHl, setActiveHl] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ x: number; y: number; text: string; rects: HighlightRect[] } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const renderTask = useRef<RenderTask | null>(null);
  const noteTimers = useRef<Record<string, number>>({});

  const flash = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(null), 2600); };

  // Re-fetch annotations on every open: the page props can be a cached snapshot from an
  // earlier visit (back button / client router cache) taken before newer highlights existed.
  useEffect(() => {
    let cancelled = false;
    getBookAnnotations(bookId).then((res) => {
      if (cancelled) return;
      if ("error" in res && res.error) { flash(res.error); return; }
      if (res.highlights) setHighlights(res.highlights as Highlight[]);
      if (res.bookmarks) setBookmarks(res.bookmarks as BookmarkRow[]);
    });
    return () => { cancelled = true; };
  }, [bookId]);

  // Load the document once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getBookFileUrl(bookId);
      if ("error" in res && res.error) { setLoadError(res.error); return; }
      try {
        const pdfjs = await loadPdfjs();
        const doc = await pdfjs.getDocument({ url: res.url! }).promise;
        if (cancelled) return;
        setPdf(doc);
        setNumPages(doc.numPages);
        setPage((p) => Math.min(p, doc.numPages));
        // Fit to the available width on first open.
        const first = await doc.getPage(1);
        const base = first.getViewport({ scale: 1 });
        const avail = (viewportRef.current?.clientWidth ?? 800) - 48;
        setScale(Math.min(2, Math.max(0.6, avail / base.width)));
      } catch {
        if (!cancelled) setLoadError("Couldn't open this PDF. It may be damaged or password-protected, so try uploading it again.");
      }
    })();
    return () => { cancelled = true; };
  }, [bookId]);

  // Render the current page (canvas + selectable text layer).
  useEffect(() => {
    if (!pdf || scale === null) return;
    let cancelled = false;
    (async () => {
      setRendering(true);
      setSelection(null);
      renderTask.current?.cancel();
      const pdfPage = await pdf.getPage(page);
      if (cancelled) return;
      const viewport = pdfPage.getViewport({ scale });
      const canvas = canvasRef.current!, text = textRef.current!;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      setPageSize({ w: viewport.width, h: viewport.height });

      const task = pdfPage.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      renderTask.current = task;
      try { await task.promise; } catch { return; } // cancelled by a newer render

      text.replaceChildren();
      text.style.setProperty("--total-scale-factor", String(scale));
      const { TextLayer } = await loadPdfjs();
      const layer = new TextLayer({ textContentSource: pdfPage.streamTextContent(), container: text, viewport });
      await layer.render();
      if (!cancelled) setRendering(false);
    })();
    return () => { cancelled = true; };
  }, [pdf, page, scale]);

  // Remember where the reader is (debounced).
  useEffect(() => {
    if (!numPages) return;
    setPageInput(String(page));
    const t = window.setTimeout(() => saveReadingPosition(bookId, page, numPages), 800);
    return () => window.clearTimeout(t);
  }, [bookId, page, numPages]);

  const go = useCallback((p: number) => { if (numPages) setPage(Math.min(numPages, Math.max(1, p))); }, [numPages]);

  // Arrow keys turn pages (unless the user is typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); go(page + 1); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(page - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, page]);

  // When a text selection ends inside the page, offer highlight colours next to it.
  const onSelectEnd = () => {
    const sel = window.getSelection();
    const pageEl = pageRef.current;
    if (!sel || sel.isCollapsed || !pageEl || !sel.rangeCount) { setSelection(null); return; }
    const range = sel.getRangeAt(0);
    if (!pageEl.contains(range.commonAncestorContainer)) { setSelection(null); return; }
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (!text) { setSelection(null); return; }
    const box = pageEl.getBoundingClientRect();
    const rects = [...range.getClientRects()]
      .filter((r) => r.width > 1 && r.height > 1)
      .map((r) => ({ x: (r.left - box.left) / box.width, y: (r.top - box.top) / box.height, w: r.width / box.width, h: r.height / box.height }));
    if (rects.length === 0) { setSelection(null); return; }
    const last = range.getBoundingClientRect();
    setSelection({ text, rects, x: last.left - box.left + last.width / 2, y: last.top - box.top });
  };

  const saveHighlight = async (color: string) => {
    if (!selection) return;
    const pending = selection;
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    const res = await addHighlight(bookId, page, pending.text, color, pending.rects);
    if ("error" in res && res.error) { flash(res.error); return; }
    if (res.highlight) {
      setHighlights((h) => [...h, res.highlight as Highlight].sort((a, b) => a.page - b.page));
      setTab("highlights");
      flash("Highlight saved");
    }
  };

  const removeHighlight = async (h: Highlight) => {
    setHighlights((all) => all.filter((x) => x.id !== h.id)); // optimistic
    const res = await deleteHighlight(h.id);
    if ("error" in res && res.error) { setHighlights((all) => [...all, h].sort((a, b) => a.page - b.page)); flash(res.error); return; }
    flash("Highlight removed");
  };

  const saveNote = async (h: Highlight, note: string) => {
    if (note === h.note) return;
    setHighlights((all) => all.map((x) => (x.id === h.id ? { ...x, note } : x)));
    const res = await updateHighlight(h.id, { note });
    if ("error" in res && res.error) flash(res.error);
  };

  const isBookmarked = bookmarks.some((b) => b.page === page);
  const onToggleBookmark = async () => {
    const res = await toggleBookmark(bookId, page);
    if ("error" in res && res.error) { flash(res.error); return; }
    if (res.bookmarked) {
      setBookmarks((b) => [...b, res.bookmark as BookmarkRow].sort((a, c) => a.page - c.page));
      flash(`Page ${page} bookmarked`);
    } else {
      setBookmarks((b) => b.filter((x) => x.page !== page));
      flash(`Bookmark on page ${page} removed`);
    }
  };

  const zoomIndex = scale === null ? -1 : ZOOMS.reduce((best, z, i) => (Math.abs(z - scale) < Math.abs(ZOOMS[best] - scale) ? i : best), 0);
  const zoomTo = (dir: 1 | -1) => setScale(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, zoomIndex + dir))]);
  const pageHighlights = highlights.filter((h) => h.page === page);

  return (
    <div className="reader">
      {/* Toolbar */}
      <header className="reader-bar">
        <Link href="/library" className="btn btn-ghost btn-sm"><ArrowLeft size={15} aria-hidden="true" /> Library</Link>
        <h1 className="reader-title" style={{ display: "flex" }}>
          <RenameableTitle value={title} label="textbook" onRename={(n) => renameLibraryBook(bookId, n)} />
        </h1>

        <nav aria-label="Page navigation" className="reader-group">
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Previous page" onClick={() => go(page - 1)} disabled={page <= 1}><ChevronLeft size={16} /></button>
          <form onSubmit={(e) => { e.preventDefault(); const n = parseInt(pageInput, 10); if (!Number.isNaN(n)) go(n); }} className="reader-pagebox">
            <label htmlFor="page-input" className="sr-only">Go to page</label>
            <input id="page-input" className="input" inputMode="numeric" value={pageInput} onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
              onBlur={() => { const n = parseInt(pageInput, 10); if (!Number.isNaN(n)) go(n); else setPageInput(String(page)); }}
              style={{ width: 56, minHeight: 32, textAlign: "center", padding: "0 6px" }} />
            <span style={{ fontSize: 13, color: "var(--muted)", whiteSpace: "nowrap" }}>of {numPages || "…"}</span>
          </form>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Next page" onClick={() => go(page + 1)} disabled={!numPages || page >= numPages}><ChevronRight size={16} /></button>
        </nav>

        <div className="reader-group" role="group" aria-label="Zoom">
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Zoom out" onClick={() => zoomTo(-1)} disabled={zoomIndex <= 0}><ZoomOut size={16} /></button>
          <span style={{ fontSize: 13, color: "var(--muted)", minWidth: 44, textAlign: "center" }} aria-live="polite">{scale ? `${Math.round(scale * 100)}%` : "-"}</span>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Zoom in" onClick={() => zoomTo(1)} disabled={zoomIndex >= ZOOMS.length - 1}><ZoomIn size={16} /></button>
        </div>

        <div className="reader-group">
          <button type="button" className="btn btn-sm" aria-pressed={isBookmarked} onClick={onToggleBookmark} disabled={!numPages}
            style={isBookmarked ? { background: "var(--accent-soft)", color: "var(--accent-text)" } : undefined}>
            {isBookmarked ? <BookmarkCheck size={15} aria-hidden="true" /> : <Bookmark size={15} aria-hidden="true" />}
            {isBookmarked ? "Bookmarked" : "Bookmark page"}
          </button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={panelOpen ? "Hide notes panel" : "Show notes panel"} aria-expanded={panelOpen} onClick={() => setPanelOpen((o) => !o)}>
            {panelOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
        </div>
      </header>

      <div className="reader-body">
        {/* Page */}
        <div ref={viewportRef} className="reader-viewport" onMouseUp={onSelectEnd} onKeyUp={(e) => { if (e.shiftKey) onSelectEnd(); }}>
          {loadError ? (
            <div className="notice notice-error" role="alert" style={{ maxWidth: 520, margin: "48px auto" }}>
              <AlertCircle size={18} aria-hidden="true" style={{ flexShrink: 0 }} /> {loadError}
            </div>
          ) : (
            <div ref={pageRef} className="reader-page" style={{ width: pageSize.w || undefined, height: pageSize.h || undefined, minHeight: pageSize.h ? undefined : "70vh", minWidth: pageSize.w ? undefined : "min(100%, 600px)" }}>
              <canvas ref={canvasRef} aria-label={`Page ${page} of ${title}`} role="img" />
              {pageHighlights.flatMap((h) => h.rects.map((r, i) => (
                <div key={`${h.id}-${i}`} className={`reader-hl ${h.color}${activeHl === h.id ? " active" : ""}`}
                  style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />
              )))}
              <div ref={textRef} className="textLayer" />
              {(rendering || !pdf) && !loadError && (
                <div className="reader-loading" aria-live="polite">
                  <Loader2 size={20} className="spin" aria-hidden="true" /> {pdf ? `Loading page ${page}…` : "Opening your textbook…"}
                </div>
              )}

              {selection && (
                <div role="toolbar" aria-label="Highlight selection" className="reader-popover"
                  style={{ left: Math.min(Math.max(selection.x, 110), pageSize.w - 110), top: Math.max(selection.y - 52, 4) }}
                  onMouseUp={(e) => e.stopPropagation()}>
                  <Highlighter size={15} aria-hidden="true" style={{ color: "var(--muted)" }} />
                  {COLORS.map((c) => (
                    <button key={c.id} type="button" aria-label={`Highlight in ${c.label.toLowerCase()}`} title={`Highlight in ${c.label.toLowerCase()}`}
                      onClick={() => saveHighlight(c.id)} className="reader-swatch" style={{ background: c.swatch }} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Notes panel */}
        {panelOpen && (
          <aside className="reader-panel" aria-label="Highlights and bookmarks">
            <div role="tablist" aria-label="Notes" className="reader-tabs">
              {(["highlights", "bookmarks"] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} id={`tab-${t}`} aria-controls={`panel-${t}`}
                  className={`reader-tab${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>
                  {t === "highlights" ? "Highlights" : "Bookmarks"} <span className="reader-count">{t === "highlights" ? highlights.length : bookmarks.length}</span>
                </button>
              ))}
            </div>

            {tab === "highlights" ? (
              <div role="tabpanel" id="panel-highlights" aria-labelledby="tab-highlights" className="reader-list">
                {highlights.length === 0 ? (
                  <p className="reader-empty">Select any text on the page and choose a colour to highlight it.</p>
                ) : highlights.map((h) => (
                  <div key={h.id} className={`reader-item${activeHl === h.id ? " on" : ""}`}>
                    <button type="button" className="reader-item-main" onClick={() => { go(h.page); setActiveHl(h.id); }}>
                      <span className="reader-dot" style={{ background: COLORS.find((c) => c.id === h.color)?.swatch }} aria-hidden="true" />
                      <span style={{ minWidth: 0 }}>
                        <span className="reader-meta">Page {h.page} · {COLORS.find((c) => c.id === h.color)?.label}</span>
                        <span className="reader-quote">“{h.text}”</span>
                      </span>
                    </button>
                    <label className="sr-only" htmlFor={`note-${h.id}`}>Note for highlight on page {h.page}</label>
                    <textarea id={`note-${h.id}`} className="input" rows={1} defaultValue={h.note} placeholder="Add a note…"
                      onChange={(e) => {
                        // Save while typing (debounced) so leaving the page never loses a note.
                        const value = e.target.value.trim();
                        window.clearTimeout(noteTimers.current[h.id]);
                        noteTimers.current[h.id] = window.setTimeout(() => saveNote(h, value), 700);
                      }}
                      onBlur={(e) => { window.clearTimeout(noteTimers.current[h.id]); saveNote(h, e.target.value.trim()); }}
                      style={{ minHeight: 34, fontSize: 13, resize: "vertical" }} />
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeHighlight(h)} style={{ alignSelf: "flex-start", color: "var(--danger)" }}>
                      <Trash2 size={14} aria-hidden="true" /> Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div role="tabpanel" id="panel-bookmarks" aria-labelledby="tab-bookmarks" className="reader-list">
                {bookmarks.length === 0 ? (
                  <p className="reader-empty">Use “Bookmark page” in the toolbar to save pages you want to come back to.</p>
                ) : bookmarks.map((b) => (
                  <div key={b.id} className={`reader-item reader-item-row${b.page === page ? " on" : ""}`}>
                    <button type="button" className="reader-item-main" onClick={() => go(b.page)} aria-current={b.page === page ? "page" : undefined}>
                      <BookmarkCheck size={16} aria-hidden="true" style={{ color: "var(--accent-text)", flexShrink: 0 }} />
                      <span>Page {b.page}{b.label ? ` · ${b.label}` : ""}</span>
                    </button>
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Remove bookmark on page ${b.page}`}
                      onClick={async () => { const r = await toggleBookmark(bookId, b.page); if ("error" in r && r.error) return flash(r.error); setBookmarks((all) => all.filter((x) => x.id !== b.id)); }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </aside>
        )}
      </div>

      {toast && <div role="status" className="reader-toast">{toast}</div>}
    </div>
  );
}
