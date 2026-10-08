"use client";
import { BookCover } from "@/components/BookCover";
import { renderPdfCover } from "@/lib/pdf/cover";
import { isEpubFile, isEpubPath, renderEpubCover } from "@/lib/epub";
import { toast } from "@/components/Toaster";
import { RenameableTitle } from "@/components/RenameableTitle";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Upload, BookOpen, Trash2, X, Loader2, CheckCircle2, AlertCircle, Search, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { createLibraryBook, deleteLibraryBook, renameLibraryBook, setBookCover, getBookFileUrl } from "@/app/library-actions";
import type { LibraryBook } from "@/lib/queries";

const MAX_BYTES = 100 * 1024 * 1024;
const fmtSize = (b: number) => b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading"; file: File; pct: number }
  | { kind: "processing"; file: File }
  | { kind: "success"; file: File; id: string }
  | { kind: "error"; message: string; file?: File };

export function LibraryBoard({ books }: { books: LibraryBook[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"recent" | "title" | "progress">("recent");
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    const list = books.filter((b) => !n || b.title.toLowerCase().includes(n));
    const prog = (b: LibraryBook) => (b.page_count ? b.last_page / b.page_count : 0);
    if (sort === "title") return [...list].sort((a, b) => a.title.localeCompare(b.title));
    if (sort === "progress") return [...list].sort((a, b) => prog(b) - prog(a));
    return [...list].sort((a, b) => (b.opened_at ? new Date(b.opened_at).getTime() : 0) - (a.opened_at ? new Date(a.opened_at).getTime() : 0));
  }, [books, q, sort]);
  const busy = state.kind === "uploading" || state.kind === "processing";

  // Page 1 → small JPEG in the user's covers folder. Best-effort: a book without a cover still works.
  const makeCover = async (bookId: string, userId: string, source: File | string, epub = false) => {
    try {
      let out: { blob: Blob; pages: number | null } | null;
      if (epub) {
        const data = typeof source === "string" ? await (await fetch(source)).arrayBuffer() : source;
        const blob = await renderEpubCover(data);
        out = blob ? { blob, pages: null } : null;
      } else out = await renderPdfCover(source);
      if (!out) return false;
      const coverPath = `${userId}/covers/${bookId}.jpg`;
      const { error } = await createClient().storage.from("library").upload(coverPath, out.blob, { contentType: "image/jpeg", upsert: true });
      if (error) return false;
      const res = await setBookCover(bookId, coverPath, out.pages);
      return !("error" in res && res.error);
    } catch { return false; }
  };

  // Books uploaded before covers existed: render theirs once, a few at a time.
  useEffect(() => {
    const missing = books.filter((b) => !b.cover_path).slice(0, 4);
    if (!missing.length) return;
    let cancelled = false;
    (async () => {
      const { data: { user } } = await createClient().auth.getUser();
      if (!user) return;
      let made = 0;
      for (const b of missing) {
        if (cancelled) return;
        const u = await getBookFileUrl(b.id);
        if (u.url && (await makeCover(b.id, user.id, u.url, isEpubPath(b.file_path ?? "")))) made++;
      }
      if (made && !cancelled) router.refresh();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [books.map((b) => b.id + (b.cover_path ?? "")).join()]);

  const upload = async (file: File) => {
    const epub = isEpubFile(file);
    if (!epub && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setState({ kind: "error", message: `"${file.name}" isn't a PDF or EPUB. The library accepts .pdf and .epub files.` });
      return;
    }
    if (file.size > MAX_BYTES) {
      setState({ kind: "error", message: `"${file.name}" is ${fmtSize(file.size)}. The limit is 100 MB, so try a compressed copy of the PDF.` });
      return;
    }

    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setState({ kind: "error", message: "Your session has expired. Please sign in again." }); return; }

    // Storage name is a random id; the original filename is kept separately as the display title.
    const path = `${session.user.id}/${crypto.randomUUID()}.${epub ? "epub" : "pdf"}`;
    const title = file.name.replace(/\.(pdf|epub)$/i, "");
    setState({ kind: "uploading", file, pct: 0 });

    // XHR (not fetch) so we can report real upload progress and allow cancelling.
    const ok = await new Promise<boolean>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open("POST", `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/library/${path}`);
      xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
      xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
      xhr.setRequestHeader("Content-Type", epub ? "application/epub+zip" : "application/pdf");
      xhr.setRequestHeader("x-upsert", "false");
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) setState({ kind: "uploading", file, pct: Math.round((e.loaded / e.total) * 100) }); };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve(true);
        const notSetUp = xhr.status === 404 || /bucket/i.test(xhr.responseText);
        setState({ kind: "error", file, message: notSetUp
          ? (epub ? "Upload failed: EPUB support needs a database update. Ask the site admin to run migration 17." : "Upload failed: the library storage isn't set up yet. Ask the site admin to run migration 10.")
          : `Upload failed (error ${xhr.status}). Check your connection and try again.` });
        resolve(false);
      };
      xhr.onerror = () => { setState({ kind: "error", file, message: "Upload failed: lost connection. Check your internet and try again." }); resolve(false); };
      xhr.onabort = () => { setState({ kind: "idle" }); resolve(false); };
      xhr.send(file);
    });
    xhrRef.current = null;
    if (!ok) return;

    setState({ kind: "processing", file });
    const res = await createLibraryBook(title, path, file.size, null);
    if ("error" in res && res.error) { setState({ kind: "error", file, message: res.error }); return; }
    await makeCover(res.id!, session.user.id, file, epub);
    setState({ kind: "success", file, id: res.id! });
    router.refresh();
  };

  const onPick = (files: FileList | null) => {
    const f = files?.[0];
    if (f) upload(f);
    if (inputRef.current) inputRef.current.value = "";
  };

  const remove = async (b: LibraryBook) => {
    if (!window.confirm(`Delete "${b.title}" and all its highlights and bookmarks? This can't be undone.`)) return;
    const res = await deleteLibraryBook(b.id);
    if ("error" in res && res.error) { toast(res.error, "error"); return; }
    router.refresh();
  };

  const reading = books.filter((b) => b.opened_at && b.page_count && b.last_page / b.page_count < 0.99)
    .sort((a, b) => new Date(b.opened_at!).getTime() - new Date(a.opened_at!).getTime()).slice(0, 3);
  const pick = () => inputRef.current?.click();
  const SORTS = [["recent", "Recent"], ["title", "Title"], ["progress", "Most read"]] as const;

  return (
    <div className={`lb${dragging ? " is-drag" : ""}`}
      onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (!busy) onPick(e.dataTransfer.files); }}>
      <input ref={inputRef} type="file" accept="application/pdf,.pdf,application/epub+zip,.epub" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => onPick(e.target.files)} />
      {dragging && <div className="lb-drop" aria-hidden="true"><Upload size={22} /> Drop a PDF or EPUB to add it</div>}

      <div className="lb-bar">
        <h2 id="shelf-heading">All textbooks <span>{books.length}</span></h2>
        <div className="lb-tools">
          {books.length > 1 && (
            <>
              <div className="nb-search lb-search">
                <Search size={15} aria-hidden="true" />
                <label htmlFor="lib-q" className="sr-only">Search textbooks</label>
                <input id="lib-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search textbooks" />
              </div>
              <div className="lb-seg" role="radiogroup" aria-label="Sort textbooks">
                {SORTS.map(([k, l]) => (
                  <button key={k} type="button" role="radio" aria-checked={sort === k} onClick={() => setSort(k)}>{l}</button>
                ))}
              </div>
            </>
          )}
          <button type="button" className="btn btn-primary" onClick={pick} disabled={busy}><Plus size={15} aria-hidden="true" /> Add textbook</button>
        </div>
      </div>

      {state.kind !== "idle" && (
        <div className="lb-status" aria-live="polite">
          {"file" in state && state.file && (
            <div className="lb-status-row">
              {state.kind === "success" ? <CheckCircle2 size={18} style={{ color: "var(--success)" }} aria-hidden="true" />
                : state.kind === "error" ? <AlertCircle size={18} style={{ color: "var(--danger)" }} aria-hidden="true" />
                : <Loader2 size={18} className="spin" aria-hidden="true" />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="filename" title={state.file.name} style={{ fontSize: 14, fontWeight: 500 }}>{state.file.name}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
                  {isEpubFile(state.file) ? "EPUB" : "PDF"} · {fmtSize(state.file.size)} · {state.kind === "uploading" ? `Uploading ${state.pct}%`
                    : state.kind === "processing" ? "Adding to your library" : state.kind === "success" ? "Added" : "Not uploaded"}
                </div>
                {state.kind === "uploading" && (
                  <div role="progressbar" aria-label="Upload progress" aria-valuenow={state.pct} aria-valuemin={0} aria-valuemax={100} className="lb-prog"><i style={{ width: `${state.pct}%` }} /></div>
                )}
              </div>
              {state.kind === "uploading" && <button type="button" className="btn btn-ghost btn-sm" onClick={() => xhrRef.current?.abort()}>Cancel</button>}
              {state.kind === "success" && <Link href={`/library/${state.id}`} className="btn btn-sm">Open</Link>}
              {(state.kind === "success" || state.kind === "error") && (
                <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Dismiss" onClick={() => setState({ kind: "idle" })}><X size={15} /></button>
              )}
            </div>
          )}
          {state.kind === "error" && <p role="alert" className="field-error" style={{ margin: "8px 0 0" }}>{state.message}</p>}
        </div>
      )}

      {books.length === 0 ? (
        <button type="button" className="lb-empty" onClick={pick} disabled={busy}>
          <span className="lb-empty-ic" aria-hidden="true"><BookOpen size={24} /></span>
          <strong>Add your first textbook</strong>
          <span>Drag a PDF or EPUB anywhere on this page, or click to choose one. Up to 100 MB.</span>
          <span className="lb-empty-feats" aria-hidden="true"><i>Highlights</i><i>Bookmarks</i><i>Picks up where you left off</i></span>
        </button>
      ) : (
        <>
          {reading.length > 0 && !q && (
            <section aria-labelledby="lb-cont-h" className="lb-cont">
              <h3 id="lb-cont-h">Continue reading</h3>
              <div className="lb-cont-row">
                {reading.map((b) => {
                  const pct = Math.round((b.last_page / b.page_count!) * 100);
                  return (
                    <Link key={b.id} href={`/library/${b.id}`} className="lb-cont-card">
                      <span className="lb-cont-cover"><BookCover title={b.title} url={b.cover_url} width={72} /></span>
                      <span className="lb-cont-body">
                        <strong className="truncate">{b.title}</strong>
                        <span className="lb-cont-meta">Page {b.last_page} of {b.page_count}</span>
                        <span className="lb-prog" aria-label={`${pct}% read`}><i style={{ width: `${pct}%` }} /></span>
                        <span className="lb-cont-cta">Continue</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {shown.length === 0 ? (
            <div className="empty card"><strong>No textbooks match &ldquo;{q}&rdquo;.</strong> Try part of the title.</div>
          ) : (
            <ul className="lb-shelf" aria-labelledby="shelf-heading">
              {shown.map((b) => {
                const pct = b.page_count ? Math.round((b.last_page / b.page_count) * 100) : 0;
                return (
                  <li key={b.id} className="lb-book">
                    <Link href={`/library/${b.id}`} className="lb-cover" aria-label={`Open ${b.title}`}>
                      <BookCover title={b.title} url={b.cover_url} width={200} />
                    </Link>
                    <button type="button" className="lb-del btn btn-icon btn-sm" aria-label={`Delete ${b.title}`} onClick={() => remove(b)}><Trash2 size={14} /></button>
                    {b.opened_at && pct > 0 && <span className="lb-prog lb-prog-cover" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>}
                    <RenameableTitle value={b.title} label="textbook" className="lb-title" style={{ fontSize: 13.5, fontWeight: 600 }}
                      onRename={async (n) => { const r = await renameLibraryBook(b.id, n); if (!r.error) router.refresh(); return r; }} />
                    <span className="lb-meta">{!b.opened_at ? <span className="lb-new">New</span> : pct >= 99 ? "Finished" : `${pct}% read`}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
