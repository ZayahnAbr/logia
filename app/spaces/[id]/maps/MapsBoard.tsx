"use client";
import { RenameableTitle } from "@/components/RenameableTitle";
import { renameUpload } from "@/app/actions";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2, Network, Trash2, Clock, Plus, Search } from "lucide-react";
import "../../../workspace-layout.css";
import { extractPdf } from "@/lib/pdf/extract";
import { buildTree, type MapNode } from "@/lib/pdf/buildTree";
import { MindMapper } from "@/components/MindMapper";
import { createMindmap, deleteMindmap } from "@/app/actions";

type Mindmap = { id: string; title: string; created_at: string; tree_json: MapNode | null };

const countNodes = (n: MapNode): number => 1 + (n.children ?? []).reduce((t, c) => t + countNodes(c), 0);

export function MapsBoard({ spaceId, maps }: { spaceId: string; maps: Mindmap[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState<{ id: string; tree: MapNode; title: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  // Start from an empty map: just a central topic, ready to rename and build on.
  const newBlank = async () => {
    setCreating(true); setError(null);
    const tree: MapNode = { id: "root", label: "Untitled map", page: 0, y: 0, level: 0, children: [], sourceText: "" };
    const res = await createMindmap(spaceId, "Untitled map", tree);
    setCreating(false);
    if ("error" in res && res.error) { setError(res.error); return; }
    setLive({ id: res.id!, tree, title: "Untitled map" });
    router.refresh();
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const result = await extractPdf(file);
      if (result.needsOCR) { setError("This PDF is a scan with no selectable text, so headings can't be read. Use a text-based PDF, or start a blank map."); setLoading(false); e.target.value = ""; return; }
      const title = file.name.replace(/\.pdf$/i, "");
      const tree = buildTree(result.blocks, title);
      const res = await createMindmap(spaceId, title, tree);
      if ("error" in res && res.error) { setError(res.error); setLoading(false); e.target.value = ""; return; }
      setLive({ id: res.id!, tree, title });
      router.refresh();
    } catch { setError("Couldn't read that PDF. It may be damaged or password-protected, so try another file."); }
    setLoading(false);
    e.target.value = "";
  };

  const openSaved = (m: Mindmap) => {
    if (!m.tree_json) { setError("This map was created before maps could be saved. Re-upload the PDF to rebuild it."); return; }
    setLive({ id: m.id, tree: m.tree_json, title: m.title });
  };

  const remove = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm("Delete this mind map? This can't be undone.")) return;
    await deleteMindmap(spaceId, id);
    router.refresh();
  };

  const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

  if (live) {
    return <div className="wk-maps-live"><MindMapper key={live.id} mapId={live.id} root={live.tree} docTitle={live.title} spaceId={spaceId} onClose={() => { setLive(null); router.refresh(); }} /></div>;
  }

  const shown = maps.filter((m) => !q.trim() || m.title.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="wk-maps">
      <section aria-labelledby="map-start" className="wk-start-wrap">
        <h2 id="map-start" className="wk-h2">Start a map</h2>
        <div className="wk-start-grid">
          <label className="wk-start" style={{ cursor: loading ? "progress" : "pointer" }}>
            <span className="wk-start-ico">{loading ? <Loader2 size={20} className="spin" aria-hidden="true" /> : <Upload size={20} aria-hidden="true" />}</span>
            <span className="wk-start-t">{loading ? "Reading PDF…" : "From a PDF"}</span>
            <span className="wk-start-d">Headings in the file become branches you can edit. Needs a PDF with selectable text.</span>
            <input type="file" accept="application/pdf" className="sr-only" onChange={onPick} disabled={loading} />
          </label>
          <button type="button" className="wk-start" onClick={newBlank} disabled={creating} aria-busy={creating}>
            <span className="wk-start-ico">{creating ? <Loader2 size={20} className="spin" aria-hidden="true" /> : <Plus size={20} aria-hidden="true" />}</span>
            <span className="wk-start-t">Blank map</span>
            <span className="wk-start-d">Begin with one central topic, then add and arrange your own branches.</span>
          </button>
        </div>
        {error && <p role="alert" className="field-error">{error}</p>}
      </section>

      <section aria-labelledby="map-yours">
        <div className="wk-toolbar">
          <h2 id="map-yours" className="wk-h2" style={{ margin: 0 }}>Your maps <span className="wk-count">{maps.length}</span></h2>
          {maps.length > 1 && (
            <div className="nb-search wk-search">
              <Search size={15} aria-hidden="true" />
              <label htmlFor="map-q" className="sr-only">Search mind maps</label>
              <input id="map-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search mind maps" />
            </div>
          )}
        </div>
      {maps.length === 0 ? (
        <div className="wk-empty">
          <strong>No mind maps yet</strong>
          <p>A mind map lays a chapter out as one picture, so you can see how the ideas connect before you revise them.</p>
          <ol>
            <li>Pick a start above: a PDF or a blank map.</li>
            <li>Select a topic to rename it, recolour it or add branches.</li>
            <li>Come back here to reopen it. Maps save as you work.</li>
          </ol>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty card"><strong>No maps match &ldquo;{q}&rdquo;.</strong> Try a word from the map&apos;s title.</div>
      ) : (
        <ul className="wk-map-grid">
          {shown.map((m) => {
            const branches = m.tree_json?.children?.slice(0, 4) ?? [];
            const topics = m.tree_json ? countNodes(m.tree_json) - 1 : 0;
            return (
              <li key={m.id} className="card-i wk-map-card">
                <div className="wk-map-prev" aria-hidden="true">
                  {m.tree_json ? (
                    <>
                      <span className="wk-map-root">{m.tree_json.label}</span>
                      <span className="wk-map-branches">{branches.map((b) => <span key={b.id}>{b.label}</span>)}</span>
                      {branches.length === 0 && <span className="wk-map-hint">No branches yet</span>}
                    </>
                  ) : <Network size={26} />}
                </div>
                <div className="wk-map-body">
                  <RenameableTitle value={m.title} label="mind map" style={{ fontSize: 14, fontWeight: 600 }}
                    onRename={async (n) => { const r = await renameUpload("mindmap", spaceId, m.id, n); if (!r.error) router.refresh(); return r; }} />
                  <div className="wk-map-meta">
                    <Clock size={11} aria-hidden="true" /> {when(m.created_at)}
                    {m.tree_json ? <span>· {topics} topic{topics === 1 ? "" : "s"}</span> : <span style={{ color: "var(--amber)" }}>· needs re-upload</span>}
                  </div>
                </div>
                {/* Stretched button: the whole card opens the map, while the delete button stays separate. */}
                <button className="stretched sr-only-text" onClick={() => openSaved(m)} aria-label={`Open mind map ${m.title}`}
                  style={{ all: "unset", position: "static", cursor: "pointer" }} />
                <button className="btn btn-ghost btn-icon btn-sm wk-map-del" onClick={(e) => remove(e, m.id)} aria-label={`Delete mind map ${m.title}`}>
                  <Trash2 size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      </section>
    </div>
  );
}
