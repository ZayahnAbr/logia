"use client";
import { toast } from "@/components/Toaster";
import { ShareButton } from "@/components/ShareSheet";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, Handle, Position, useReactFlow,
  type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  X, Sparkles, Loader2, ShieldCheck, List, Network, Plus, CornerDownRight, Pencil, Trash2,
  ChevronsDownUp, ChevronsUpDown, StickyNote, Check, AlertCircle, FileText,
} from "lucide-react";
import { layoutMindMap, BRANCH_COLORS, ROOT_COLOR, type FlowNodeData } from "@/lib/pdf/flowLayout";
import { chunkText } from "@/app/pdf-actions";
import { createNote, updateNote, updateMindmap } from "@/app/actions";
import { MindMap } from "@/components/MindMap";
import { textFor, type MapNode } from "@/lib/pdf/buildTree";

// ─── Tree helpers ────────────────────────────────────────────────────────────

const newId = () => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function locate(root: MapNode, id: string): { node: MapNode; parent: MapNode | null } | null {
  if (root.id === id) return { node: root, parent: null };
  const stack: { node: MapNode; parent: MapNode }[] = root.children.map((c) => ({ node: c, parent: root }));
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur.node.id === id) return cur;
    cur.node.children.forEach((c) => stack.push({ node: c, parent: cur.node }));
  }
  return null;
}

const countAll = (n: MapNode): number => n.children.reduce((s, c) => s + 1 + countAll(c), 0);

// White or near-black text, whichever is more readable on the given background colour.
function textOn(hex: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "#fff";
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => { const c = parseInt(h, 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.05) ? "#ffffff" : "#18181b";
}

const PALETTE = [
  { hex: ROOT_COLOR, name: "Deep coral" }, ...BRANCH_COLORS.map((hex, i) => ({ hex, name: ["Coral", "Blue", "Green", "Amber", "Violet", "Pink", "Teal", "Red"][i] ?? hex })),
  { hex: "#64748b", name: "Slate" }, { hex: "#18181b", name: "Black" },
];

// First open of a map that has never been folded: show the root + two levels only.
function withDefaultFolding(root: MapNode): MapNode {
  const copy = structuredClone(root);
  let touched = false;
  const scan = (n: MapNode) => { if (n.collapsed !== undefined) touched = true; n.children.forEach(scan); };
  scan(copy);
  if (!touched) {
    const fold = (n: MapNode, depth: number) => { if (depth >= 2 && n.children.length) n.collapsed = true; n.children.forEach((c) => fold(c, depth + 1)); };
    fold(copy, 0);
  }
  return copy;
}

// ─── Node renderer ───────────────────────────────────────────────────────────

type Ctx = { editingId: string | null; commitEdit: (id: string, label: string) => void; cancelEdit: () => void; startEdit: (id: string) => void; toggle: (id: string) => void };
const MapCtx = createContext<Ctx | null>(null);

function MindNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  const ctx = useContext(MapCtx)!;
  const d = data;
  const isRoot = d.side === "root";
  const editing = ctx.editingId === id;

  const look: React.CSSProperties = isRoot
    ? { background: d.color, color: textOn(d.color), fontSize: 17, fontWeight: 700, padding: "14px 22px", borderRadius: 16, maxWidth: 280, boxShadow: `0 6px 20px ${d.color}4d` }
    : d.level === 1
      ? { background: `${d.color}1f`, color: "var(--text)", fontSize: 15, fontWeight: 650, padding: "10px 16px", borderRadius: 14, maxWidth: 240, boxShadow: `inset 0 0 0 2px ${d.color}` }
      : { background: "var(--surface)", color: "var(--text)", fontSize: 13.5, fontWeight: 500, padding: "8px 12px", borderRadius: 10, maxWidth: 220, boxShadow: "0 1px 2px rgba(24,24,27,.06), 0 0 0 1px var(--border)" };

  const toggleSide: React.CSSProperties = d.side === "left" ? { left: -14 } : { right: -14 };

  return (
    <div
      onDoubleClick={() => ctx.startEdit(id)}
      style={{
        ...look, position: "relative", lineHeight: 1.35, wordBreak: "break-word", cursor: "pointer",
        outline: selected ? "2px solid var(--focus)" : "none", outlineOffset: 3,
        display: "flex", alignItems: "center", gap: 7,
      }}
    >
      <Handle type="target" id="in-l" position={Position.Left} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle type="target" id="in-r" position={Position.Right} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle type="source" id="out-r" position={Position.Right} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle type="source" id="out-l" position={Position.Left} style={{ opacity: 0, pointerEvents: "none" }} />

      {d.level >= 2 && <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: d.color, flexShrink: 0 }} />}

      {editing ? (
        <input
          className="nodrag nopan" autoFocus defaultValue={d.label} aria-label="Topic name" maxLength={160}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") ctx.commitEdit(id, e.currentTarget.value);
            if (e.key === "Escape") ctx.cancelEdit();
          }}
          onBlur={(e) => ctx.commitEdit(id, e.currentTarget.value)}
          style={{ font: "inherit", color: "inherit", background: "rgba(255,255,255,.95)", border: "none", outline: "2px solid var(--focus)", borderRadius: 6, padding: "2px 6px", minWidth: 140, width: "100%", ...(isRoot ? { color: "#18181b" } : {}) }}
        />
      ) : (
        <span>{d.label}</span>
      )}

      {d.hasNote && !editing && <StickyNote size={13} aria-label="Has a note" style={{ flexShrink: 0, opacity: 0.7 }} />}

      {d.hasChildren && !isRoot && (
        <button
          type="button" className="nodrag nopan"
          aria-label={d.collapsed ? `Expand ${d.label} (${d.hiddenCount} hidden)` : `Collapse ${d.label}`}
          onClick={(e) => { e.stopPropagation(); ctx.toggle(id); }}
          style={{
            position: "absolute", top: "50%", transform: "translateY(-50%)", ...toggleSide,
            minWidth: 24, height: 24, padding: "0 6px", borderRadius: 999, border: `2px solid ${d.color}`,
            background: d.collapsed ? d.color : "#fff", color: d.collapsed ? "#fff" : "var(--text)",
            fontSize: 11, fontWeight: 700, cursor: "pointer", display: "grid", placeItems: "center", lineHeight: 1,
          }}
        >
          {d.collapsed ? `+${d.hiddenCount}` : "−"}
        </button>
      )}
    </div>
  );
}

const nodeTypes = { mindNode: MindNode };

// ─── Editor ──────────────────────────────────────────────────────────────────

type SaveState = "saved" | "saving" | "error";

export function MindMapper(props: { mapId: string; root: MapNode; docTitle: string; spaceId: string; onClose: () => void }) {
  return <ReactFlowProvider><Editor {...props} /></ReactFlowProvider>;
}

function Editor({ mapId, root: initialRoot, docTitle, spaceId, onClose }: { mapId: string; root: MapNode; docTitle: string; spaceId: string; onClose: () => void }) {
  const [tree, setTree] = useState<MapNode>(() => {
    const t = withDefaultFolding(initialRoot);
    t.label = docTitle; // the saved map name is the source of truth for the central topic
    return t;
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [view, setView] = useState<"map" | "outline">("map");
  const [save, setSave] = useState<SaveState>("saved");
  const [chunks, setChunks] = useState<any>(null);
  const [extracting, setExtracting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const { fitView } = useReactFlow();
  const firstRender = useRef(true);

  const mutate = useCallback((fn: (draft: MapNode) => void) => {
    setTree((t) => { const c = structuredClone(t); fn(c); return c; });
  }, []);

  // ── Autosave (debounced) ──
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    setSave("saving");
    const t = window.setTimeout(async () => {
      const res = await updateMindmap(spaceId, mapId, tree, tree.label);
      setSave(res && "error" in res && res.error ? "error" : "saved");
    }, 800);
    return () => window.clearTimeout(t);
  }, [tree, mapId, spaceId]);

  // ── Edits ──
  const addChild = useCallback((id: string) => {
    const nid = newId();
    mutate((r) => {
      const hit = locate(r, id); if (!hit) return;
      hit.node.collapsed = false;
      hit.node.children.push({ id: nid, label: "New topic", page: hit.node.page, y: 0, level: hit.node.level + 1, children: [], sourceText: "" });
    });
    setSelectedId(nid); setEditingId(nid);
  }, [mutate]);

  const addSibling = useCallback((id: string) => {
    if (id === tree.id) return addChild(id);
    const nid = newId();
    mutate((r) => {
      const hit = locate(r, id); if (!hit?.parent) return;
      const i = hit.parent.children.findIndex((c) => c.id === id);
      hit.parent.children.splice(i + 1, 0, { id: nid, label: "New topic", page: hit.node.page, y: 0, level: hit.node.level, children: [], sourceText: "" });
    });
    setSelectedId(nid); setEditingId(nid);
  }, [mutate, tree.id, addChild]);

  const remove = useCallback((id: string) => {
    if (id === tree.id) return;
    const hit = locate(tree, id); if (!hit) return;
    const n = countAll(hit.node);
    if (n > 0 && !window.confirm(`Delete "${hit.node.label}" and its ${n} sub-topic${n === 1 ? "" : "s"}? This can't be undone.`)) return;
    mutate((r) => { const h = locate(r, id); if (h?.parent) h.parent.children = h.parent.children.filter((c) => c.id !== id); });
    setSelectedId(hit.parent?.id ?? null);
  }, [mutate, tree]);

  const setColor = useCallback((id: string, color: string | null) => mutate((r) => {
    const h = locate(r, id); if (!h) return;
    if (color) h.node.color = color; else delete h.node.color;
  }), [mutate]);

  const toggle = useCallback((id: string) => mutate((r) => { const h = locate(r, id); if (h && h.node.children.length) h.node.collapsed = !h.node.collapsed; }), [mutate]);
  const foldAll = (collapsed: boolean) => mutate((r) => {
    const walk = (n: MapNode, depth: number) => { if (depth >= 1 && n.children.length) n.collapsed = collapsed; n.children.forEach((c) => walk(c, depth + 1)); };
    walk(r, 0);
  });

  const ctx: Ctx = useMemo(() => ({
    editingId,
    startEdit: (id) => { setSelectedId(id); setEditingId(id); },
    cancelEdit: () => setEditingId(null),
    commitEdit: (id, label) => {
      const clean = label.trim();
      if (clean) mutate((r) => { const h = locate(r, id); if (h) h.node.label = clean.slice(0, 160); });
      setEditingId(null);
    },
    toggle,
  }), [editingId, mutate, toggle]);

  // ── Layout ──
  const layout = useMemo(() => layoutMindMap(tree), [tree]);
  const nodes = useMemo(() => layout.nodes.map((n) => ({ ...n, selected: n.id === selectedId })), [layout, selectedId]);
  const nodeCount = layout.nodes.length;
  useEffect(() => { const t = window.setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50); return () => window.clearTimeout(t); }, [nodeCount, fitView, view]);

  // ── Keyboard shortcuts (XMind-style) ──
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editingId || !selectedId) return;
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select")) return;
    if (e.key === "Tab") { e.preventDefault(); addChild(selectedId); }
    else if (e.key === "Enter") { e.preventDefault(); addSibling(selectedId); }
    else if (e.key === "F2") { e.preventDefault(); setEditingId(selectedId); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(selectedId); }
    else if (e.key === " ") { e.preventDefault(); toggle(selectedId); }
    else if (e.key === "Escape") { setSelectedId(null); }
  };

  const selected = selectedId ? locate(tree, selectedId)?.node ?? null : null;
  const sourceText = selected ? textFor(selected) : "";

  useEffect(() => { setChunks(null); setPicked(new Set()); }, [selectedId]);

  const extract = async () => {
    if (!selected) return;
    setExtracting(true);
    const out = await chunkText(sourceText, selected.label);
    if ("error" in out) toast(out.error, "error"); else setChunks(out);
    setExtracting(false);
  };

  const exportSelected = async () => {
    if (!chunks?.chunks || picked.size === 0 || !selected) return;
    setExporting(true);
    const text = chunks.chunks.flatMap((c: any, i: number) => c.sentences.filter((_: string, j: number) => picked.has(`${i}-${j}`))).join("\n\n");
    const title = `${tree.label}: ${selected.label}`;
    const res = await createNote(spaceId, "From mind maps", title);
    if (res.id) await updateNote(spaceId, res.id, title, `<p>${text.replace(/\n\n/g, "</p><p>")}</p>`, "From mind maps");
    setExporting(false); setPicked(new Set());
    toast(res.id ? "Saved to a new note in the “From mind maps” folder." : "Couldn't create the note. Try again.", res.id ? "success" : "error");
  };

  const editBtn = (label: string, icon: React.ReactNode, onClick: () => void, disabled: boolean, danger = false) => (
    <button type="button" className="btn btn-ghost btn-sm" onClick={onClick} disabled={disabled} style={danger && !disabled ? { color: "var(--danger)" } : undefined}>
      {icon} <span className="mm-btn-label">{label}</span>
    </button>
  );

  return (
    <MapCtx.Provider value={ctx}>
      <div className="mm" onKeyDown={onKeyDown}>
        {/* Toolbar */}
        <div className="mm-bar">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><X size={15} aria-hidden="true" /> Close</button>
          <h2 className="mm-title truncate" title={tree.label}>{tree.label}</h2>
          <div role="tablist" aria-label="View" className="mm-seg">
            <button role="tab" aria-selected={view === "map"} className={view === "map" ? "on" : ""} onClick={() => setView("map")}><Network size={14} aria-hidden="true" /> Map</button>
            <button role="tab" aria-selected={view === "outline"} className={view === "outline" ? "on" : ""} onClick={() => setView("outline")}><List size={14} aria-hidden="true" /> Outline</button>
          </div>
          <ShareButton note="Shares the map as a text outline."
            get={async () => {
              const lines: string[] = [];
              const walk = (n: MapNode, d: number) => { n.children.forEach((c) => { lines.push(`${"  ".repeat(d)}• ${c.label}`); walk(c, d + 1); }); };
              walk(tree, 0);
              return { title: tree.label, text: lines.join("\n").slice(0, 3000) };
            }} />
          <span className="mm-save" role="status">
            {save === "saving" ? <><Loader2 size={13} className="spin" aria-hidden="true" /> Saving…</>
              : save === "error" ? <><AlertCircle size={13} aria-hidden="true" style={{ color: "var(--danger)" }} /> Not saved. Check your connection</>
              : <><Check size={13} aria-hidden="true" style={{ color: "var(--success)" }} /> Saved</>}
          </span>
        </div>

        <div className="mm-tools" role="toolbar" aria-label="Edit topic">
          {editBtn("Add sub-topic", <CornerDownRight size={14} aria-hidden="true" />, () => selectedId && addChild(selectedId), !selectedId)}
          {editBtn("Add topic", <Plus size={14} aria-hidden="true" />, () => selectedId && addSibling(selectedId), !selectedId)}
          {editBtn("Rename", <Pencil size={14} aria-hidden="true" />, () => selectedId && setEditingId(selectedId), !selectedId)}
          {editBtn("Delete", <Trash2 size={14} aria-hidden="true" />, () => selectedId && remove(selectedId), !selectedId || selectedId === tree.id, true)}
          <span className="mm-divider" aria-hidden="true" />
          {editBtn("Expand all", <ChevronsUpDown size={14} aria-hidden="true" />, () => foldAll(false), false)}
          {editBtn("Collapse all", <ChevronsDownUp size={14} aria-hidden="true" />, () => foldAll(true), false)}
          {!selectedId && <span className="mm-hint">Select a topic to edit it</span>}
        </div>

        <div className="mm-body">
          <div className="mm-canvas">
            {view === "map" ? (
              <ReactFlow
                nodes={nodes} edges={layout.edges} nodeTypes={nodeTypes}
                onNodeClick={(_, n) => setSelectedId(n.id)}
                onPaneClick={() => { setSelectedId(null); setEditingId(null); }}
                nodesDraggable={false} nodesConnectable={false} elementsSelectable
                nodeOrigin={[0.5, 0.5]} fitView minZoom={0.2} maxZoom={1.8} proOptions={{ hideAttribution: true }}
              >
                <Background color="#e9e5e2" gap={28} size={1.5} />
                <Controls showInteractive={false} position="bottom-left" />
              </ReactFlow>
            ) : (
              <div style={{ height: "100%", overflow: "auto", padding: "20px 24px" }}>
                <MindMap root={tree} onSelect={(n) => setSelectedId(n.id)} activeId={selectedId ?? undefined} />
              </div>
            )}
            {view === "map" && (
              <p className="mm-keys" aria-label="Keyboard shortcuts">
                <kbd>Tab</kbd> sub-topic · <kbd>Enter</kbd> topic · <kbd>F2</kbd> rename · <kbd>Del</kbd> delete · <kbd>Space</kbd> fold
              </p>
            )}
          </div>

          {/* Topic panel */}
          {selected && (
            <aside className="mm-panel" aria-label="Topic details">
              <div className="mm-panel-head">
                <div style={{ minWidth: 0 }}>
                  {selected.id !== tree.id && selected.page ? <div style={{ fontSize: 12, color: "var(--muted)" }}>From page {selected.page}</div> : null}
                  <h3 style={{ fontSize: 17, fontWeight: 650, margin: "2px 0 0", lineHeight: 1.35 }}>{selected.label}</h3>
                </div>
                <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Close topic details" onClick={() => setSelectedId(null)}><X size={16} /></button>
              </div>

              <div className="mm-panel-body">
                <fieldset style={{ border: "none", padding: 0, margin: "0 0 20px" }}>
                  <legend className="field-label" style={{ marginBottom: 8 }}>Colour</legend>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    {PALETTE.map((c) => (
                      <button key={c.hex} type="button" aria-label={`${c.name}`} aria-pressed={selected.color === c.hex} title={c.name}
                        onClick={() => setColor(selected.id, c.hex)}
                        style={{ width: 28, height: 28, borderRadius: "50%", background: c.hex, cursor: "pointer", padding: 0,
                          border: "2px solid #fff", boxShadow: selected.color === c.hex ? "0 0 0 2px var(--focus)" : "0 0 0 1px var(--border-input)" }} />
                    ))}
                    <label title="Custom colour" style={{ position: "relative", width: 28, height: 28, borderRadius: "50%", cursor: "pointer",
                      background: "conic-gradient(#ef4444, #f59e0b, #10b981, #3b82f6, #8b5cf6, #ec4899, #ef4444)", boxShadow: "0 0 0 1px var(--border-input)" }}>
                      <span className="sr-only">Custom colour</span>
                      <input type="color" value={selected.color ?? "#e8835a"} onChange={(e) => setColor(selected.id, e.target.value)}
                        style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer", border: "none", padding: 0 }} />
                    </label>
                  </div>
                  <p className="field-hint" style={{ margin: "8px 0 0" }}>
                    {selected.id === tree.id ? "Colours the central topic." : "Colours this topic, its sub-topics and their lines."}
                    {selected.color && (
                      <> <button type="button" onClick={() => setColor(selected.id, null)}
                        style={{ background: "none", border: "none", padding: 0, color: "var(--accent-text)", fontWeight: 600, cursor: "pointer", font: "inherit" }}>
                        Reset to automatic
                      </button></>
                    )}
                  </p>
                </fieldset>

                <label htmlFor="mm-note" className="field-label">Your notes</label>
                <textarea id="mm-note" key={selected.id} className="input" rows={5} defaultValue={selected.note ?? ""}
                  placeholder="Summarise this topic in your own words…"
                  onChange={(e) => { const v = e.target.value; const id = selected.id; mutate((r) => { const h = locate(r, id); if (h) h.node.note = v; }); }}
                  style={{ resize: "vertical", marginTop: 6 }} />
                <p className="field-hint" style={{ margin: "6px 0 20px" }}>Saved automatically.</p>

                {sourceText.length > 150 && (
                  <section aria-label="Key points from the source">
                    {!chunks && (
                      <button type="button" className="btn" onClick={extract} disabled={extracting} aria-busy={extracting}>
                        {extracting ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Extracting key points…</> : <><Sparkles size={14} aria-hidden="true" /> Extract key points from the PDF</>}
                      </button>
                    )}
                    {chunks?.error && (
                      <div className="notice notice-error" role="alert" style={{ marginTop: 10 }}>
                        <AlertCircle size={16} aria-hidden="true" style={{ flexShrink: 0 }} /> {chunks.error}
                      </div>
                    )}
                    {chunks?.skipped && <p className="field-hint">This section is references or disclosures, not study content.</p>}
                    {chunks?.chunks?.length > 0 && (
                      <>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--success)", margin: "4px 0 12px" }}>
                          <ShieldCheck size={14} aria-hidden="true" /> Every sentence is quoted from the source
                        </div>
                        {picked.size > 0 && (
                          <button type="button" className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginBottom: 14 }} disabled={exporting} onClick={exportSelected}>
                            <FileText size={14} aria-hidden="true" /> {exporting ? "Saving…" : `Save ${picked.size} selected to a note`}
                          </button>
                        )}
                        {chunks.chunks.map((c: any, i: number) => (
                          <div key={i} style={{ marginBottom: 18 }}>
                            <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 6 }}>{c.theme}</div>
                            {c.sentences.map((s: string, j: number) => {
                              const key = `${i}-${j}`;
                              const checked = picked.has(key);
                              return (
                                <label key={j} style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", padding: "6px 8px", borderRadius: 8, background: checked ? "var(--accent-soft)" : "transparent" }}>
                                  <input type="checkbox" checked={checked} style={{ marginTop: 4 }}
                                    onChange={() => setPicked((prev) => { const next = new Set(prev); if (checked) next.delete(key); else next.add(key); return next; })} />
                                  <span style={{ fontSize: 13.5, lineHeight: 1.55 }}>{s}</span>
                                </label>
                              );
                            })}
                          </div>
                        ))}
                      </>
                    )}
                  </section>
                )}
              </div>
            </aside>
          )}
        </div>
      </div>
    </MapCtx.Provider>
  );
}
