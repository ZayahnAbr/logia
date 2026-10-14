"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Compass, Eye, Flag, Search, Users, X } from "lucide-react";
import { listDiscoverSpaces, myOwnSpaceIds, type DiscoverSpace, type Facets } from "@/app/discover-actions";
import { LEVELS } from "@/lib/spaceTags";
import { ReportDialog } from "./ReportDialog";
import { CloneSpaceButton } from "@/components/CloneSpaceButton";
import { Dialog } from "@/components/Dialog";

// Same look as the real space header band (lib/spaceHeader.ts), kept light here since the card
// only has the colour, not an image (reading the header image needs a signed URL we don't fetch for a list).
function cardBandStyle(s: DiscoverSpace): CSSProperties | undefined {
  if (s.header_kind === "color" && s.header_color) return { background: s.header_color };
  return undefined;
}

type Sort = "members" | "newest" | "copied";
const SORTS: { id: Sort; label: string }[] = [{ id: "members", label: "Most members" }, { id: "newest", label: "Newest" }, { id: "copied", label: "Most copied" }];
const TOP_TAGS = 8;
const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

// Filters live in the URL (?tab=spaces&q=&tag=&level=&uni=&sort=) so a filtered view can be shared.
function readUrl() {
  const u = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const sort = u.get("sort");
  return { q: u.get("q") ?? "", tags: u.getAll("tag"), level: u.get("level") ?? "", uni: u.get("uni") ?? "", sort: (SORTS.some((s) => s.id === sort) ? sort : "members") as Sort };
}

export function SpacesTab() {
  const [spaces, setSpaces] = useState<DiscoverSpace[] | null>(null);
  const [facets, setFacets] = useState<Facets>({ tags: [], levels: [], institutions: [] });
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [level, setLevel] = useState("");
  const [uni, setUni] = useState("");
  const [sort, setSort] = useState<Sort>("members");
  const [moreTags, setMoreTags] = useState(false);
  const [ready, setReady] = useState(false);
  const [reporting, setReporting] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<DiscoverSpace | null>(null);
  const [mySpaceIds, setMySpaceIds] = useState<Set<string>>(new Set());
  const [announce, setAnnounce] = useState("");
  const firstLoad = useRef(true);

  useEffect(() => {
    const f = readUrl();
    setQ(f.q); setTags(f.tags); setLevel(f.level); setUni(f.uni); setSort(f.sort); setReady(true);
    myOwnSpaceIds().then((ids) => setMySpaceIds(new Set(ids))).catch(() => {});
  }, []);

  // Keep the filters in the address bar without a server round trip.
  useEffect(() => {
    if (!ready) return;
    const u = new URLSearchParams({ tab: "spaces" });
    if (q.trim()) u.set("q", q.trim());
    tags.forEach((t) => u.append("tag", t));
    if (level) u.set("level", level);
    if (uni) u.set("uni", uni);
    if (sort !== "members") u.set("sort", sort);
    window.history.replaceState(null, "", `/discover?${u.toString()}`);
  }, [ready, q, tags, level, uni, sort]);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const t = setTimeout(() => {
      listDiscoverSpaces({ q, tags, level, institution: uni, sort }).then((r) => {
        if (!alive) return;
        if ("error" in r) { setError(r.error); return; }
        setError(""); setSpaces(r.spaces); setFacets(r.facets);
        if (!firstLoad.current) setAnnounce(`${r.spaces.length} ${r.spaces.length === 1 ? "space" : "spaces"} found`);
        firstLoad.current = false;
      });
    }, firstLoad.current ? 0 : 250);
    return () => { alive = false; clearTimeout(t); };
  }, [ready, q, tags, level, uni, sort]);

  const toggle = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  const filtered = !!(q.trim() || tags.length || level || uni);
  const clear = () => { setQ(""); setTags([]); setLevel(""); setUni(""); };
  const shownTags = useMemo(() => {
    const all = facets.tags;
    const visible = moreTags ? all : all.slice(0, TOP_TAGS);
    // A chosen tag is always visible so it can be turned off.
    const extra = tags.filter((t) => !visible.some((v) => v.value === t)).map((t) => ({ value: t, n: all.find((a) => a.value === t)?.n ?? 0 }));
    return [...visible, ...extra];
  }, [facets.tags, moreTags, tags]);
  const list = spaces ?? [];

  return (
    <div className="dc-spaces">
      <div className="dc-filters card">
        <div className="dc-fhead">
          <h2>Find a study space</h2>
          <span aria-hidden="true">{spaces === null ? "" : `${list.length} ${list.length === 1 ? "space" : "spaces"}`}</span>
        </div>
        <div className="field" style={{ maxWidth: 420 }}>
          <label className="field-label" htmlFor="space-search">Search public spaces</label>
          <div style={{ position: "relative" }}>
            <Search size={16} aria-hidden="true" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--faint)" }} />
            <input id="space-search" type="search" className="input" style={{ paddingLeft: 36 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, description or tag" />
          </div>
        </div>

        {facets.tags.length > 0 && (
          <div role="group" aria-label="Filter by tag" className="dc-chiprow">
            {shownTags.map((t) => (
              <button key={t.value} type="button" className="dc-chip" aria-pressed={tags.includes(t.value)} onClick={() => toggle(t.value)}>
                {t.value} <span className="dc-chip-n">{t.n}</span>
              </button>
            ))}
            {facets.tags.length > TOP_TAGS && (
              <button type="button" className="dc-chip dc-chip-more" aria-expanded={moreTags} onClick={() => setMoreTags((v) => !v)}>
                {moreTags ? "Fewer" : `More (${facets.tags.length - TOP_TAGS})`}
              </button>
            )}
          </div>
        )}

        <div className="dc-selects">
          {facets.levels.length > 0 && (
            <div className="field">
              <label className="field-label" htmlFor="sp-level">Level</label>
              <select id="sp-level" className="input" value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="">Any level</option>
                {LEVELS.filter((l) => facets.levels.some((f) => f.value === l)).map((l) => <option key={l} value={l}>{cap(l)} ({facets.levels.find((f) => f.value === l)?.n})</option>)}
              </select>
            </div>
          )}
          {facets.institutions.length > 0 && (
            <div className="field">
              <label className="field-label" htmlFor="sp-uni">University or school</label>
              <select id="sp-uni" className="input" value={uni} onChange={(e) => setUni(e.target.value)}>
                <option value="">Any</option>
                {facets.institutions.map((i) => <option key={i.value} value={i.value}>{i.value} ({i.n})</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label className="field-label" htmlFor="sp-sort">Sort by</label>
            <select id="sp-sort" className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          {filtered && <button type="button" className="btn btn-sm" onClick={clear}>Clear filters</button>}
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>

      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {!error && spaces === null && (
        <ul className="dc-grid dc-spgrid" role="status" aria-label="Loading public spaces" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {[0, 1, 2].map((i) => <li key={i} className="card dc-skel" aria-hidden="true"><i /><i /><i /></li>)}
        </ul>
      )}
      {!error && spaces !== null && list.length === 0 && (
        <div className="dc-empty card">
          <span className="dc-empty-icon" aria-hidden="true"><Compass size={22} /></span>
          <h2>{filtered ? "No spaces match yet" : "No public spaces yet"}</h2>
          <p>{filtered
            ? "Try removing a tag, choosing any level, or searching for something shorter."
            : "Spaces appear here when their creator makes them public. Yours could be the first: open a space and choose Make public."}</p>
          {filtered ? <button type="button" className="btn" onClick={clear}>Clear filters</button> : <Link href="/spaces" className="btn btn-primary">Go to my spaces</Link>}
        </div>
      )}

      <ul className="dc-grid dc-spgrid" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {list.map((s) => {
          const mine = mySpaceIds.has(s.id);
          return (
            <li key={s.id} className="card dc-card dc-spcard">
              <button type="button" className="dc-spband dc-spband-btn" style={cardBandStyle(s)} onClick={() => setPreviewing(s)} aria-label={`View ${s.name}`} />
              <div className="dc-body">
                {s.subject && <div className="eyebrow">{s.subject}</div>}
                <h2 className="dc-name">{s.name}</h2>
                <p className="dc-desc">{s.public_description || "No description yet."}</p>
                {s.tags.length > 0 && (
                  <ul className="dc-tags" aria-label="Tags">
                    {s.tags.slice(0, 3).map((t) => <li key={t}>{t}</li>)}
                    {s.tags.length > 3 && <li title={s.tags.slice(3).join(", ")}>+{s.tags.length - 3}</li>}
                  </ul>
                )}
                <div className="dc-meta">
                  <span className="dc-count"><Users size={14} aria-hidden="true" /> {s.member_count} {s.member_count === 1 ? "member" : "members"}</span>
                  {(s.level || s.institution) && <span className="dc-sub">{[s.level ? cap(s.level) : "", s.institution].filter(Boolean).join(" · ")}</span>}
                </div>
                <div className="dc-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setPreviewing(s)} aria-label={`View ${s.name}`}><Eye size={14} aria-hidden="true" /> View</button>
                  {mine ? (
                    <button type="button" className="btn" disabled aria-disabled="true" title="This is your own space">Your space</button>
                  ) : (
                    <CloneSpaceButton spaceId={s.id} spaceName={s.name} className="btn btn-primary" />
                  )}
                  <button type="button" className="btn btn-ghost" onClick={() => setReporting(s.id)} aria-label={`Report ${s.name}`}><Flag size={14} aria-hidden="true" /> Report</button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {reporting && <ReportDialog kind="space" targetId={reporting} onClose={() => setReporting(null)} />}
      {previewing && (
        <Dialog title={previewing.name} onClose={() => setPreviewing(null)} width={480}>
          <div className="dc-preview-band" style={cardBandStyle(previewing)} aria-hidden="true" />
          {previewing.subject && <p className="eyebrow" style={{ marginTop: 14 }}>{previewing.subject}</p>}
          <p style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.55 }}>{previewing.public_description || "No description yet."}</p>
          {previewing.tags.length > 0 && (
            <ul className="dc-tags" aria-label="Tags" style={{ marginBottom: 12 }}>
              {previewing.tags.map((t) => <li key={t}>{t}</li>)}
            </ul>
          )}
          <div className="dc-meta" style={{ marginBottom: 16 }}>
            <span className="dc-count"><Users size={14} aria-hidden="true" /> {previewing.member_count} {previewing.member_count === 1 ? "member" : "members"}</span>
            {(previewing.level || previewing.institution) && <span className="dc-sub">{[previewing.level ? cap(previewing.level) : "", previewing.institution].filter(Boolean).join(" · ")}</span>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-ghost" onClick={() => setPreviewing(null)}><X size={14} aria-hidden="true" /> Close</button>
            {mySpaceIds.has(previewing.id) ? (
              <button type="button" className="btn" disabled aria-disabled="true">Your space</button>
            ) : (
              <CloneSpaceButton spaceId={previewing.id} spaceName={previewing.name} className="btn btn-primary" />
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}
