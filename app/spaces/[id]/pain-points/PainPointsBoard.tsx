"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Check, RotateCcw, Trash2, Flame, ChevronDown, FileCheck2, PenLine } from "lucide-react";
import { addPainPoint, setPainPointResolved, deletePainPoint } from "@/app/actions";

type Point = { id: string; title: string; description: string; topic: string | null; hits: number; source: string; resolved: boolean; updated_at: string };

function Severity({ hits }: { hits: number }) {
  const color = hits >= 3 ? "var(--destructive)" : hits === 2 ? "var(--amber)" : "var(--muted)";
  const bg = hits >= 3 ? "var(--destructive-soft)" : hits === 2 ? "var(--amber-soft)" : "var(--surface-2)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, padding: "3px 9px", borderRadius: 999, color, background: bg }}>
      <Flame size={11} /> {hits}× {hits === 1 ? "seen" : "repeated"}
    </span>
  );
}

export function PainPointsBoard({ spaceId, points }: { spaceId: string; points: Point[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [topic, setTopic] = useState("");
  const [adding, setAdding] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [q, setQ] = useState("");
  const [topicF, setTopicF] = useState<string | null>(null);
  const [sort, setSort] = useState<"hits" | "recent">("hits");

  const topics = [...new Set(points.map((p) => p.topic).filter(Boolean))] as string[];
  const needle = q.trim().toLowerCase();
  const visible = points
    .filter((p) => (!topicF || p.topic === topicF) && (!needle || p.title.toLowerCase().includes(needle) || p.description.toLowerCase().includes(needle)))
    .sort((a, b) => (sort === "hits" ? b.hits - a.hits : 0) || (a.updated_at < b.updated_at ? 1 : -1));
  const open = visible.filter((p) => !p.resolved);
  const resolved = visible.filter((p) => p.resolved);

  const add = async () => {
    if (!title.trim()) return;
    await addPainPoint(spaceId, title, desc, topic);
    setTitle(""); setDesc(""); setTopic(""); setAdding(false);
    router.refresh();
  };
  const toggle = async (id: string, r: boolean) => { await setPainPointResolved(spaceId, id, r); router.refresh(); };
  const remove = async (id: string) => { if (!window.confirm("Delete this pain point? This can't be undone.")) return; await deletePainPoint(spaceId, id); router.refresh(); };

  const row = (p: Point) => (
    <div key={p.id} className="card" style={{ padding: 16, opacity: p.resolved ? 0.75 : 1, gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, minHeight: 24 }}>
        {p.topic ? <span style={{ fontSize: 12, fontWeight: 600, padding: "3px 9px", borderRadius: 999, background: "var(--surface-2)", color: "var(--accent-text)", boxShadow: "inset 0 0 0 1px var(--border)" }}>{p.topic}</span> : <span />}
        {!p.resolved && <Severity hits={p.hits} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35, textDecoration: p.resolved ? "line-through" : "none" }}>{p.title}</div>
        {p.description && <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.55, marginTop: 6, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.description}</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, borderTop: "1px solid var(--border-soft)", paddingTop: 10 }}>
        <span style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 5, flex: 1, minWidth: 0 }}>
          {p.source === "paper" ? <><FileCheck2 size={12} aria-hidden="true" /> From a marked paper</> : <><PenLine size={12} aria-hidden="true" /> Added by you</>}
        </span>
        <button className="btn btn-ghost" style={{ height: 30, fontSize: 12 }} onClick={() => toggle(p.id, !p.resolved)}>
          {p.resolved ? <><RotateCcw size={12} /> Reopen</> : <><Check size={12} /> Fixed it</>}
        </button>
        <button className="btn btn-ghost" style={{ width: 30, height: 30, padding: 0, justifyContent: "center" }} onClick={() => remove(p.id)} aria-label={`Delete ${p.title}`}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {adding ? (
        <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          <label className="field"><span className="field-label">What do you keep getting wrong?</span><input className="input" placeholder="e.g. Sign errors in optimisation" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="field"><span className="field-label">Details <span className="field-hint">(optional)</span></span><textarea className="input" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
          <label className="field"><span className="field-label">Topic <span className="field-hint">(optional)</span></span><input className="input" placeholder="e.g. Calculus" value={topic} onChange={(e) => setTopic(e.target.value)} /></label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={add} disabled={!title.trim()}>Add pain point</button>
            <button className="btn btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : null}

      {!adding && (
        <div className="pr-filters" style={{ marginBottom: 0 }}>
          {points.length > 1 && <div className="nb-search" style={{ flex: "1 1 220px", maxWidth: 360 }}>
            <Search size={15} aria-hidden="true" />
            <label htmlFor="pp-q" className="sr-only">Search pain points</label>
            <input id="pp-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pain points" />
          </div>}
          {topics.length > 0 && (
            <div role="group" aria-label="Filter by topic" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button type="button" className="pr-chip" aria-pressed={topicF === null} onClick={() => setTopicF(null)}>All topics</button>
              {topics.map((t) => <button key={t} type="button" className="pr-chip" aria-pressed={topicF === t} onClick={() => setTopicF(topicF === t ? null : t)}>{t}</button>)}
            </div>
          )}
          {points.length > 1 && <button type="button" className="pr-chip" onClick={() => setSort((x) => (x === "hits" ? "recent" : "hits"))} style={{ marginLeft: "auto" }}>
            Sort: {sort === "hits" ? "most repeated" : "most recent"}
          </button>}
          <button className="btn btn-primary" style={{ marginLeft: points.length > 1 ? 0 : "auto", height: 40 }} onClick={() => setAdding(true)}>
            <Plus size={14} /> Add a pain point
          </button>
        </div>
      )}

      {open.length === 0 ? (
        <div className="empty card">
          {points.length > 0 && visible.length === 0
            ? "No pain points match those filters."
            : "Nothing to fix right now. Mark a past paper and any mistakes will show up here automatically."}
          {points.length === 0 && <div style={{ marginTop: 12 }}><a className="btn btn-sm" href={`/spaces/${spaceId}/papers`}>Go to past papers</a></div>}
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{open.length} open · use this as your pre-test checklist</div>
          <div className="pr-pp-grid">{open.map(row)}</div>
        </>
      )}

      {resolved.length > 0 && (
        <>
          <button className="btn btn-ghost" style={{ alignSelf: "flex-start", marginTop: 8 }} onClick={() => setShowResolved((s) => !s)}>
            Previously struggled with ({resolved.length})
            <ChevronDown size={13} style={{ transform: showResolved ? "rotate(180deg)" : "none" }} />
          </button>
          {showResolved && <div className="pr-pp-grid">{resolved.map(row)}</div>}
        </>
      )}
    </div>
  );
}
