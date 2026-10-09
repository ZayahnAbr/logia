"use client";
import { RenameableTitle } from "@/components/RenameableTitle";
import { ShareButton } from "@/components/ShareSheet";
import { shareFileLink } from "@/app/share-actions";
import { renameUpload } from "@/app/actions";

import { useEffect, useRef, useState, useTransition } from "react";
import { FolderChips } from "@/components/FolderChips";
import { FileThumb } from "./FileThumb";
import { ExtractText } from "./ExtractText";
import { CourseOutlineButton } from "@/components/CourseOutlineSetup";
import { moveFile, renameFileFolder, getFilePreviewUrls, generateNotesFromText } from "@/app/actions";
import { toast } from "@/components/Toaster";
import { useRouter } from "next/navigation";
import { uploadFile, deleteFile, getFileUrl } from "@/app/actions";
import { extractFileText, chunkForIndex } from "@/lib/extractText";
import { indexContent } from "@/app/actions";
import { Upload, Loader2, Trash2, Download, FolderOpen, Search, X, NotebookPen, ScanText, LayoutGrid, List, Link2, FilePenLine } from "lucide-react";
import { ImportLink, EDITABLE_NOTE_RE } from "./ImportLink";
import { openFileAsNote } from "@/app/import-actions";

type FileRow = { id: string; name: string; folder: string; size_bytes: number; mime_type: string; path: string; created_at: string };

const fmt = (b: number) => b > 1_000_000 ? `${(b / 1_000_000).toFixed(1)} MB` : `${Math.round(b / 1000)} KB`;

export function FilesBoard({
  spaceId,
  files,
  folders,
}: {
  spaceId: string;
  files: FileRow[];
  folders: string[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);
  const [dropping, setDropping] = useState(false);
  const [activeFolder, setActiveFolder] = useState("All");
  const [folder] = useState("General");
  const [downloading, setDownloading] = useState<string | null>(null);

  const [moved, setMoved] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"new" | "name" | "size">("new");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selId, setSelId] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string | null>>({});
  const folderOf = (x: FileRow) => moved[x.id] ?? x.folder;
  const folderList = [...new Set(["General", ...folders, ...Object.values(moved)])];
  const allFolders = ["All", ...folderList];

  // Preview links for every file shown (one batched request).
  useEffect(() => {
    const ids = files.map((x) => x.id).filter((id) => !(id in previews));
    if (!ids.length) return;
    getFilePreviewUrls(spaceId, ids).then((m) => setPreviews((p) => ({ ...p, ...m })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, spaceId]);

  // Read the file on this device, then have the AI write structured notes from it.
  const [noting, setNoting] = useState<string | null>(null);
  const canNote = (x: FileRow) => /\.(pdf|pptx|docx|txt|md)$/i.test(x.name);
  const canExtract = (x: FileRow) => canNote(x) || x.mime_type?.startsWith("image/");
  const [extracting, setExtracting] = useState<{ file: FileRow; url: string } | null>(null);
  const openExtract = async (x: FileRow) => {
    const url = previews[x.id] ?? (await getFileUrl(x.path)).url;
    if (url) setExtracting({ file: x, url }); else setErr("Couldn't open the file.");
  };
  const [importing, setImporting] = useState(false);
  const [converting, setConverting] = useState<string | null>(null);
  const canEdit = (x: FileRow) => EDITABLE_NOTE_RE.test(x.name);
  const openAsNote = async (x: FileRow) => {
    setConverting(x.id);
    const res = await openFileAsNote(spaceId, x.id);
    setConverting(null);
    if ("error" in res && res.error) { toast(res.error, "error"); return; }
    toast("Opened as an editable note. The original file is unchanged.");
    router.push(`/spaces/${spaceId}/notes?note=${(res as { id: string }).id}`);
  };
  const makeNotes = async (x: FileRow) => {
    setNoting(x.id);
    try {
      const url = previews[x.id] ?? (await getFileUrl(x.path)).url;
      if (!url) throw new Error("Couldn't open the file.");
      const blob = await (await fetch(url)).blob();
      const text = await extractFileText(new File([blob], x.name, { type: x.mime_type }));
      const res = await generateNotesFromText(spaceId, x.name, text);
      if ("error" in res && res.error) { toast(res.error, "error"); return; }
      toast(`Notes ready: ${res.title}`);
      router.push(`/spaces/${spaceId}/notes?note=${res.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't make notes from this file.", "error");
    } finally { setNoting(null); }
  };

  const move = async (x: FileRow, to: string) => {
    if (folderOf(x) === to) return;
    setMoved((m) => ({ ...m, [x.id]: to }));
    const res = await moveFile(spaceId, x.id, to);
    if (res && "error" in res && res.error) { setMoved((m) => { const c = { ...m }; delete c[x.id]; return c; }); setErr(res.error); return; }
    router.refresh();
  };
  const needle = q.trim().toLowerCase();
  const filtered = files.filter((x) => (activeFolder === "All" || folderOf(x) === activeFolder) && (!needle || x.name.toLowerCase().includes(needle)))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "size" ? b.size_bytes - a.size_bytes : +new Date(b.created_at) - +new Date(a.created_at));
  const sel = files.find((x) => x.id === selId) ?? null;

  // Upload one or many files (picker or drag-and-drop), one after another, with progress.
  const uploadMany = (list: File[]) => {
    if (!list.length) return;
    const tooBig = list.filter((f) => f.size > 25 * 1024 * 1024);
    const ok = list.filter((f) => f.size <= 25 * 1024 * 1024);
    if (inputRef.current) inputRef.current.value = "";
    if (!ok.length) { setErr(tooBig.length === 1 ? `"${tooBig[0].name}" is ${fmt(tooBig[0].size)}. The limit is 25 MB, so choose a smaller file.` : `All ${tooBig.length} files are over the 25 MB limit.`); return; }
    start(async () => {
      setErr(null);
      const failed: string[] = tooBig.map((f) => `${f.name} (over 25 MB)`);
      for (let i = 0; i < ok.length; i++) {
        const file = ok[i];
        setProgress({ done: i, total: ok.length, name: file.name });
        const fd = new FormData();
        fd.set("spaceId", spaceId);
        fd.set("folder", activeFolder !== "All" ? activeFolder : folder);
        fd.set("file", file);
        const res = await uploadFile(fd);
        if (res?.error) { failed.push(`${file.name} (${res.error})`); continue; }
        if ((res as any)?.id) {
          try {
            const text = await extractFileText(file);
            const chunks = chunkForIndex(text);
            if (chunks.length) await indexContent(spaceId, "file", (res as any).id, file.name, chunks);
          } catch { /* indexing is best-effort */ }
        }
      }
      setProgress(null);
      const added = ok.length - (failed.length - tooBig.length);
      if (failed.length) setErr(`Not uploaded: ${failed.join(", ")}.`);
      if (added) toast(added === 1 ? "1 file uploaded" : `${added} files uploaded`);
      router.refresh();
    });
  };
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => uploadMany([...(e.target.files ?? [])]);

  const remove = (fileId: string, path: string) => start(async () => {
    if (!window.confirm("Delete this file? This can't be undone.")) return;
    await deleteFile(spaceId, fileId, path);
    router.refresh();
  });

  const download = async (path: string, name: string) => {
    setDownloading(path);
    const res = await getFileUrl(path);
    if (res.url) { const a = document.createElement("a"); a.href = res.url; a.download = name; a.click(); }
    setDownloading(null);
  };

  return (
    <div className={dropping ? "fb-dropping" : undefined}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); if (!dropping) setDropping(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false); }}
      onDrop={(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setDropping(false); if (!pending) uploadMany([...e.dataTransfer.files]); }}>
      {dropping && <div className="fb-drop-hint" aria-hidden="true"><Upload size={20} /> Drop to upload</div>}
      {/* Toolbar: search, sort, view, upload */}
      <div className="nb-bar" style={{ alignItems: "flex-start" }}>
        <div className="nb-search">
          <Search size={15} aria-hidden="true" />
          <label htmlFor="fb-q" className="sr-only">Search files</label>
          <input id="fb-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files" />
          {q && <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setQ("")} aria-label="Clear search"><X size={14} /></button>}
        </div>
        <label className="sr-only" htmlFor="fb-sort">Sort files</label>
        <select id="fb-sort" className="ln-select" style={{ height: 38 }} value={sort} onChange={(e) => setSort(e.target.value as "new" | "name" | "size")}>
          <option value="new">Newest first</option>
          <option value="name">Name</option>
          <option value="size">Largest first</option>
        </select>
        <div className="ln-seg" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")}><LayoutGrid size={14} aria-hidden="true" /> Grid</button>
          <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={14} aria-hidden="true" /> List</button>
        </div>
        <CourseOutlineButton spaceId={spaceId} variant="button" files={files.map((x) => ({ id: x.id, name: x.name, path: x.path, mime_type: x.mime_type }))} />
        <button type="button" className="btn" style={{ height: 36 }} onClick={() => setImporting(true)}><Link2 size={14} aria-hidden="true" /> Import from link</button>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <label className="btn btn-primary" style={{ cursor: pending ? "not-allowed" : "pointer", height: 36 }} aria-disabled={pending}>
            {pending ? <><Loader2 size={14} className="spin" aria-hidden="true" /> {progress && progress.total > 1 ? `Uploading ${progress.done + 1} of ${progress.total}` : "Uploading…"}</> : <><Upload size={14} aria-hidden="true" /> Upload files</>}
            <input ref={inputRef} type="file" multiple hidden onChange={onPick} disabled={pending} />
          </label>
          <span style={{ fontSize: 12, color: "var(--faint)" }} aria-live="polite">{progress ? `Uploading ${progress.name}` : "Pick or drop several at once · up to 25 MB each"}</span>
        </div>
      </div>

      <FolderChips storageKey={`logia.files.${spaceId}.folderColors`} dragType="text/file-id"
        folders={folderList} total={files.length} active={activeFolder} onSelect={setActiveFolder}
        counts={Object.fromEntries(folderList.map((fName) => [fName, files.filter((x) => folderOf(x) === fName).length]))}
        onDropItem={(fName, id) => { const x = files.find((y) => y.id === id); if (x) move(x, fName); }}
        onRename={async (from, to) => {
          const res = await renameFileFolder(spaceId, from, to);
          if (res && "error" in res && res.error) { setErr(res.error); return res; }
          setMoved((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v === from ? to : v])));
          router.refresh();
        }} />

      {err && <div role="alert" className="err" style={{ marginBottom: 12 }}>{err}</div>}

      <div className={`ln-files${sel ? " has-sel" : ""}`}>
      <div className="ln-files-grid">
      {filtered.length === 0 ? (
        <div className="empty card">{needle ? <><strong>No files match “{q}”.</strong> Try another name.</> : <><strong>No files in {activeFolder === "All" ? "this space" : activeFolder} yet.</strong> Upload slides, readings or PDFs, and Ask AI can answer questions from them.</>}</div>
      ) : view === "list" ? (
        <ul className="ln-files-list">
          {filtered.map((f) => (
            <li key={f.id} className="ln-frow" aria-current={selId === f.id}>
              <button type="button" className="ln-frow-t" onClick={() => setSelId(selId === f.id ? null : f.id)} aria-label={`Details for ${f.name}`}>{f.name}</button>
              <span className="ln-frow-m">{folderOf(f)} · {fmt(f.size_bytes)}</span>
              <button aria-label={`Download ${f.name}`} className="btn btn-ghost btn-icon btn-sm" onClick={() => download(f.path, f.name)} disabled={downloading === f.path}><Download size={14} /></button>
              <button aria-label={`Delete ${f.name}`} className="btn btn-ghost btn-icon btn-sm" onClick={() => remove(f.id, f.path)}><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="fb-grid">
          {filtered.map((f) => (
            <li key={f.id} className={`fb-tile${selId === f.id ? " ln-sel" : ""}`} draggable onDragStart={(e) => { e.dataTransfer.setData("text/file-id", f.id); e.dataTransfer.effectAllowed = "move"; }}>
              <button type="button" className="fb-open" onClick={() => setSelId(selId === f.id ? null : f.id)} aria-label={`Details for ${f.name}`} aria-pressed={selId === f.id} disabled={downloading === f.path}>
                <FileThumb name={f.name} mime={f.mime_type} url={previews[f.id] ?? null} />
                {downloading === f.path && <span className="fb-busy"><Loader2 size={18} className="spin" aria-hidden="true" /></span>}
              </button>
              <div className="fb-meta">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <RenameableTitle value={f.name} label="file" style={{ fontSize: 13.5, fontWeight: 600 }}
                    onRename={async (n) => { const r = await renameUpload("file", spaceId, f.id, n); if (!r.error) router.refresh(); return r; }} />
                  <div style={{ fontSize: 12, color: "var(--faint)" }}>{fmt(f.size_bytes)}</div>
                </div>
              </div>
              {canEdit(f) && (
                <div className="fb-ai" role="group" aria-label={`Edit ${f.name} in Logia`}>
                  <button type="button" onClick={() => openAsNote(f)} disabled={converting !== null} title="Makes a separate editable note. Formatting is approximated and the original file is unchanged.">
                    {converting === f.id ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Converting…</> : <><FilePenLine size={14} aria-hidden="true" /> Open as editable note</>}
                  </button>
                </div>
              )}
              {canExtract(f) && (
                <div className="fb-ai" role="group" aria-label={`AI tools for ${f.name}`}>
                  <button type="button" onClick={() => openExtract(f)} title="Pull the text out of this file">
                    <ScanText size={14} aria-hidden="true" /> Extract text
                  </button>
                  {canNote(f) && (
                    <button type="button" onClick={() => makeNotes(f)} disabled={noting !== null} title="Write study notes from this file and open them">
                      {noting === f.id ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Writing…</> : <><NotebookPen size={14} aria-hidden="true" /> Make notes</>}
                    </button>
                  )}
                </div>
              )}
              <div className="fb-actions">
                <label className="nb-move" title="Move to folder">
                  <span className="sr-only">Move {f.name} to folder</span>
                  <FolderOpen size={14} aria-hidden="true" />
                  <select value={folderOf(f)} onChange={(e) => move(f, e.target.value)}>
                    {folderList.map((fName) => <option key={fName} value={fName}>{fName}</option>)}
                  </select>
                </label>
                <button aria-label={`Download ${f.name}`} className="btn btn-ghost btn-icon btn-sm" onClick={() => download(f.path, f.name)} disabled={downloading === f.path}><Download size={14} /></button>
                <ShareButton iconOnly label={`Share ${f.name}`} className="btn btn-ghost btn-icon btn-sm" note="Anyone with this link can download the file for the next hour. Only share files you have the right to share, not lecture slides, past papers or textbooks from your university."
                  get={() => shareFileLink(spaceId, f.id)} />
                <button aria-label={`Delete ${f.name}`} className="btn btn-ghost btn-icon btn-sm" onClick={() => remove(f.id, f.path)}><Trash2 size={14} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
      </div>
      {sel && (
        <aside className="ln-detail" aria-label={`Details for ${sel.name}`}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <strong style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{sel.name}</strong>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Close details" onClick={() => setSelId(null)}><X size={14} /></button>
          </div>
          <FileThumb name={sel.name} mime={sel.mime_type} url={previews[sel.id] ?? null} />
          <dl>
            <dt>Size</dt><dd>{fmt(sel.size_bytes)}</dd>
            <dt>Folder</dt><dd>{folderOf(sel)}</dd>
            <dt>Type</dt><dd>{sel.mime_type || "Unknown"}</dd>
            <dt>Added</dt><dd>{new Date(sel.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</dd>
          </dl>
          <div className="ln-detail-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => download(sel.path, sel.name)} disabled={downloading === sel.path}><Download size={14} aria-hidden="true" /> Download</button>
            {canEdit(sel) && <button type="button" className="btn btn-sm" onClick={() => openAsNote(sel)} disabled={converting !== null}>{converting === sel.id ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Converting…</> : <><FilePenLine size={14} aria-hidden="true" /> Open as editable note</>}</button>}
            {canExtract(sel) && <button type="button" className="btn btn-sm" onClick={() => openExtract(sel)}><ScanText size={14} aria-hidden="true" /> Extract text</button>}
            {canNote(sel) && <button type="button" className="btn btn-sm" onClick={() => makeNotes(sel)} disabled={noting !== null}>{noting === sel.id ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Writing…</> : <><NotebookPen size={14} aria-hidden="true" /> Make notes</>}</button>}
          </div>
          {canEdit(sel) && <p style={{ fontSize: 12, color: "var(--faint)", margin: "8px 0 0" }}>Open as editable note makes a separate copy in Logia. Formatting is approximated, the original file is unchanged, and edits do not sync back.</p>}
          {/\.pdf$/i.test(sel.name) && <p style={{ fontSize: 12, color: "var(--faint)", margin: "8px 0 0" }}>PDFs can&rsquo;t be edited. Extract text converts the text into an editable note.</p>}
        </aside>
      )}
      </div>
      {importing && <ImportLink spaceId={spaceId} folder={activeFolder !== "All" ? activeFolder : folder} onClose={() => setImporting(false)} />}
      {extracting && <ExtractText spaceId={spaceId} file={extracting.file} url={extracting.url} onClose={() => setExtracting(null)} />}
    </div>
  );
}
