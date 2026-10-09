// Pure helpers for Google Docs sync. Safe to import from client and server code (no DOM, no Node APIs).
//
// A note is reduced to a flat list of simple blocks: paragraph, heading 1 to 3, bulleted and numbered list items,
// each made of text runs with bold, italic, underline, strike and link marks. Everything else in the note or the
// document (pictures, tables, embeds, fonts, colours) is not part of the list and is never touched by the sync.

export type Run = { t: string; b?: 1; i?: 1; u?: 1; s?: 1; a?: string };
export type BlockKind = "p" | "h1" | "h2" | "h3" | "ul" | "ol";
export type Block = { k: BlockKind; r: Run[] };
/** A merged item is a normal block or a callout holding the Google Docs version of a block that changed in both places. */
export type Item = Block | { k: "co"; blocks: Block[] };

export const CALLOUT_LABEL = "Version from Google Docs";
const KINDS: BlockKind[] = ["p", "h1", "h2", "h3", "ul", "ol"];
export const MAX_BLOCKS = 4000;
export const MAX_TEXT = 600_000;

type Json = { type?: string; text?: string; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: Json[] };

// ── Runs and signatures ───────────────────────────────────────────────────────

export const safeHref = (h: unknown): string | undefined => {
  if (typeof h !== "string") return undefined;
  const v = h.trim();
  return /^(https?:\/\/|mailto:)/i.test(v) && v.length <= 2000 ? v : undefined;
};

/** Drops empty runs, merges neighbours with the same marks, and ignores underline on links (Docs always underlines links). */
export function normRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r0 of runs) {
    if (!r0.t) continue;
    const r: Run = { t: r0.t };
    if (r0.b) r.b = 1;
    if (r0.i) r.i = 1;
    if (r0.s) r.s = 1;
    if (r0.a) r.a = r0.a; else if (r0.u) r.u = 1;
    const p = out[out.length - 1];
    if (p && !!p.b === !!r.b && !!p.i === !!r.i && !!p.u === !!r.u && !!p.s === !!r.s && p.a === r.a) p.t += r.t;
    else out.push(r);
  }
  return out;
}

export const blockText = (b: Block) => b.r.map((x) => x.t).join("");
export const isEmptyP = (b: Block) => b.k === "p" && !blockText(b).trim();
export const sigOf = (b: Block): string => `${b.k}${JSON.stringify(b.r.map((x) => [x.t, x.b ? 1 : 0, x.i ? 1 : 0, x.u ? 1 : 0, x.s ? 1 : 0, x.a ?? ""]))}`;
export const itemSig = (it: Item): string => (it.k === "co" ? `co:${it.blocks.map(sigOf).join("")}` : sigOf(it));
export const blocksSig = (bs: Block[]) => bs.map(sigOf).join("\n");

export function trimTrailing(bs: Block[]): Block[] {
  let n = bs.length;
  while (n > 0 && isEmptyP(bs[n - 1])) n--;
  return n === bs.length ? bs : bs.slice(0, n);
}

/** Validates blocks that came from the browser. Returns null when the shape is wrong or too large. */
export function cleanBlocks(input: unknown): Block[] | null {
  if (!Array.isArray(input) || input.length > MAX_BLOCKS) return null;
  let total = 0;
  const out: Block[] = [];
  for (const raw of input as unknown[]) {
    const b = raw as { k?: unknown; r?: unknown };
    if (!b || typeof b.k !== "string" || !KINDS.includes(b.k as BlockKind) || !Array.isArray(b.r)) return null;
    const runs: Run[] = [];
    for (const rr of b.r as unknown[]) {
      const x = rr as Run;
      if (!x || typeof x.t !== "string") return null;
      total += x.t.length;
      if (total > MAX_TEXT) return null;
      const run: Run = { t: x.t };
      if (x.b) run.b = 1;
      if (x.i) run.i = 1;
      if (x.u) run.u = 1;
      if (x.s) run.s = 1;
      const a = safeHref(x.a);
      if (a) run.a = a;
      runs.push(run);
    }
    out.push({ k: b.k as BlockKind, r: normRuns(runs) });
  }
  return out;
}

// ── Editor JSON (Tiptap / ProseMirror) to blocks ──────────────────────────────

const MARK_FLAG: Record<string, "b" | "i" | "u" | "s"> = { bold: "b", italic: "i", underline: "u", strike: "s" };

function inlineRuns(content: Json[] | undefined): Run[] {
  const runs: Run[] = [];
  for (const n of content ?? []) {
    if (n.type === "hardBreak") { runs.push({ t: "\n" }); continue; }
    if (n.type !== "text" || !n.text) continue;
    const r: Run = { t: n.text };
    for (const m of n.marks ?? []) {
      const f = MARK_FLAG[m.type];
      if (f) r[f] = 1;
      else if (m.type === "link") { const a = safeHref(m.attrs?.href); if (a) r.a = a; }
    }
    runs.push(r);
  }
  return normRuns(runs);
}

const plainText = (n: Json): string => (n.type === "text" ? n.text ?? "" : n.type === "hardBreak" ? "\n" : (n.content ?? []).map(plainText).join(""));

export const isCalloutNode = (n: Json) =>
  n.type === "blockquote" && n.content?.[0]?.type === "paragraph" && plainText(n.content[0]).trim() === CALLOUT_LABEL;

function collect(n: Json, out: Block[], listKind: "ul" | "ol" | null, stat: { callouts: number }) {
  switch (n.type) {
    case "paragraph": out.push({ k: listKind ?? "p", r: inlineRuns(n.content) }); break;
    case "heading": {
      const lvl = Math.min(3, Math.max(1, Number(n.attrs?.level) || 1));
      out.push({ k: `h${lvl}` as BlockKind, r: inlineRuns(n.content) });
      break;
    }
    case "bulletList": case "orderedList": {
      const kind = n.type === "bulletList" ? "ul" : "ol";
      for (const li of n.content ?? []) for (const c of li.content ?? []) collect(c, out, kind, stat);
      break;
    }
    case "blockquote":
      if (isCalloutNode(n)) { stat.callouts++; break; }
      for (const c of n.content ?? []) collect(c, out, listKind, stat);
      break;
    case "codeBlock": {
      const t = plainText(n);
      if (t) out.push({ k: listKind ?? "p", r: [{ t }] });
      break;
    }
    default: break; // pictures, videos, embeds, rules and anything else stay out of the sync
  }
}

/** The blocks of one top-level editor node, plus how many callouts it is. */
export function nodeBlocks(node: Json): { blocks: Block[]; callouts: number } {
  const blocks: Block[] = []; const stat = { callouts: 0 };
  collect(node, blocks, null, stat);
  return { blocks, callouts: stat.callouts };
}

export type Unit = { pos: number; size: number; blocks: Block[] };

/** Reads the editor's top-level nodes. `pos` and `size` come from ProseMirror so changes can be applied in place. */
export function readUnits(nodes: { json: Json; pos: number; size: number }[]): { units: Unit[]; callouts: number; blank: boolean } {
  const units: Unit[] = []; let callouts = 0; let blank = true;
  for (const n of nodes) {
    const { blocks, callouts: c } = nodeBlocks(n.json);
    callouts += c;
    if (blocks.length) units.push({ pos: n.pos, size: n.size, blocks });
    const empty = n.json.type === "paragraph" && !(n.json.content?.length);
    if (!empty) blank = false;
  }
  return { units, callouts, blank };
}

// ── Blocks to editor JSON ─────────────────────────────────────────────────────

function inlineJson(runs: Run[]): Json[] {
  const out: Json[] = [];
  for (const r of runs) {
    const marks: NonNullable<Json["marks"]> = [];
    if (r.b) marks.push({ type: "bold" });
    if (r.i) marks.push({ type: "italic" });
    if (r.u) marks.push({ type: "underline" });
    if (r.s) marks.push({ type: "strike" });
    if (r.a) marks.push({ type: "link", attrs: { href: r.a } });
    r.t.split("\n").forEach((part, i) => {
      if (i > 0) out.push({ type: "hardBreak" });
      if (part) out.push(marks.length ? { type: "text", text: part, marks } : { type: "text", text: part });
    });
  }
  return out;
}

const para = (runs: Run[]): Json => { const c = inlineJson(runs); return c.length ? { type: "paragraph", content: c } : { type: "paragraph" }; };

export function blocksToNodes(items: Item[]): Json[] {
  const out: Json[] = [];
  let list: Json | null = null; let listKind: "ul" | "ol" | null = null;
  const close = () => { list = null; listKind = null; };
  for (const it of items) {
    if (it.k === "co") {
      close();
      out.push({ type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: CALLOUT_LABEL, marks: [{ type: "bold" }] }] }, ...blocksToNodes(it.blocks)] });
    } else if (it.k === "ul" || it.k === "ol") {
      if (!list || listKind !== it.k) {
        list = { type: it.k === "ul" ? "bulletList" : "orderedList", content: [] };
        listKind = it.k;
        out.push(list);
      }
      (list as Json).content!.push({ type: "listItem", content: [para(it.r)] });
    } else if (it.k === "p") {
      close(); out.push(para(it.r));
    } else {
      close();
      const c = inlineJson(it.r);
      out.push({ type: "heading", attrs: { level: Number(it.k[1]) }, ...(c.length ? { content: c } : {}) });
    }
  }
  return out;
}

// ── Diff ──────────────────────────────────────────────────────────────────────

export type Hunk = { a0: number; a1: number; b0: number; b1: number };
const DP_LIMIT = 4_000_000;

/** Matching index pairs (increasing in both lists) of a longest common subsequence. */
export function lcsPairs(a: string[], b: string[]): [number, number][] {
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let ea = a.length; let eb = b.length;
  while (ea > lo && eb > lo && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const pairs: [number, number][] = [];
  for (let i = 0; i < lo; i++) pairs.push([i, i]);
  const n = ea - lo; const m = eb - lo;
  if (n > 0 && m > 0 && n * m <= DP_LIMIT) {
    const w = m + 1;
    const t = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      t[i * w + j] = a[lo + i] === b[lo + j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
    }
    let i = 0; let j = 0;
    while (i < n && j < m) {
      if (a[lo + i] === b[lo + j]) { pairs.push([lo + i, lo + j]); i++; j++; }
      else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) i++;
      else j++;
    }
  }
  for (let k = 0; ea + k < a.length; k++) pairs.push([ea + k, eb + k]);
  return pairs;
}

export function diffHunks(a: string[], b: string[]): Hunk[] {
  const pairs = lcsPairs(a, b);
  const hunks: Hunk[] = [];
  let pa = 0; let pb = 0;
  for (const [i, j] of [...pairs, [a.length, b.length] as [number, number]]) {
    if (i > pa || j > pb) hunks.push({ a0: pa, a1: i, b0: pb, b1: j });
    pa = i + 1; pb = j + 1;
  }
  return hunks;
}

// ── Three-way merge ───────────────────────────────────────────────────────────

const sameSigs = (x: Block[], y: Block[]) => x.length === y.length && x.every((b, i) => sigOf(b) === sigOf(y[i]));

/**
 * Merges what changed in Logia (local) and in Google Docs (remote) since the last sync (base).
 * A region changed on both sides becomes the Logia version followed by a callout with the Docs version.
 * If one side only deleted, the other side's text wins, so no text is ever dropped.
 */
export function merge3(base: Block[], local: Block[], remote: Block[]): { items: Item[]; conflicts: number } {
  const bs = base.map(sigOf);
  const hl = diffHunks(bs, local.map(sigOf));
  const hr = diffHunks(bs, remote.map(sigOf));
  const items: Item[] = []; let conflicts = 0;

  // Two changes clash when they touch the same base blocks, or both insert at the same spot.
  const clash = (x: Hunk, y: Hunk) => (x.a0 < y.a1 && y.a0 < x.a1) || (x.a0 === x.a1 && y.a0 === y.a1 && x.a0 === y.a0);
  const apply = (hunks: Hunk[], other: Block[], s: number, e: number): Block[] => {
    const out: Block[] = []; let p = s;
    for (const h of hunks) { out.push(...base.slice(p, h.a0), ...other.slice(h.b0, h.b1)); p = h.a1; }
    out.push(...base.slice(p, e));
    return out;
  };
  const resolveOne = (b: Block[], l: Block[], r: Block[]) => {
    if (sameSigs(l, b)) items.push(...r);
    else if (sameSigs(r, b) || sameSigs(l, r)) items.push(...l);
    else if (b.length === 0) items.push(...l, ...r); // both added text at the same spot: keep both
    else if (r.length === 0) items.push(...l); // Docs deleted it, Logia changed it: keep the changed text
    else if (l.length === 0) items.push(...r); // Logia deleted it, Docs changed it: keep the changed text
    else { items.push(...l, { k: "co", blocks: r }); conflicts++; }
  };

  let i = 0; let j = 0; let pos = 0;
  while (i < hl.length || j < hr.length) {
    const a = hl[i]; const b = hr[j];
    if (a && b && clash(a, b)) {
      let s = Math.min(a.a0, b.a0); let e = Math.max(a.a1, b.a1);
      const li0 = i; const ri0 = j;
      i++; j++;
      for (let grew = true; grew;) {
        grew = false;
        while (i < hl.length && (hl[i].a0 < e || (hl[i].a0 === e && hr[j - 1] && clash(hl[i], hr[j - 1]))) ) { e = Math.max(e, hl[i].a1); i++; grew = true; }
        while (j < hr.length && (hr[j].a0 < e || (hr[j].a0 === e && hl[i - 1] && clash(hr[j], hl[i - 1])))) { e = Math.max(e, hr[j].a1); j++; grew = true; }
      }
      items.push(...base.slice(pos, s));
      const bSeg = base.slice(s, e);
      const lSeg = apply(hl.slice(li0, i), local, s, e);
      const rSeg = apply(hr.slice(ri0, j), remote, s, e);
      if (bSeg.length > 1 && lSeg.length === bSeg.length && rSeg.length === bSeg.length) {
        // Same number of blocks on all sides: judge them one by one so an untouched neighbour does not clash.
        for (let k = 0; k < bSeg.length; k++) resolveOne([bSeg[k]], [lSeg[k]], [rSeg[k]]);
      } else resolveOne(bSeg, lSeg, rSeg);
      pos = e;
    } else if (a && (!b || a.a0 < b.a0 || (a.a0 === b.a0 && a.a1 <= b.a1))) {
      items.push(...base.slice(pos, a.a0), ...local.slice(a.b0, a.b1)); pos = a.a1; i++;
    } else if (b) {
      items.push(...base.slice(pos, b.a0), ...remote.slice(b.b0, b.b1)); pos = b.a1; j++;
    }
  }
  items.push(...base.slice(pos));
  return { items, conflicts };
}

export const plainBlocks = (items: Item[]): Block[] => items.filter((i): i is Block => i.k !== "co");

// ── Applying a merged result to the open editor ───────────────────────────────

export type ApplyOp = { dels: [number, number][]; at: number; nodes: Json[] };

/**
 * Works out the smallest set of editor changes that turns the current blocks into `items`.
 * Untouched nodes (and anything the sync does not cover, like pictures) are left alone.
 * Ops come back highest position first, so they can be applied in order on one transaction.
 */
export function planApply(units: Unit[], blank: boolean, docEnd: number, items: Item[]): ApplyOp[] {
  const cBlocks: Block[] = []; const cUnit: number[] = []; const first: number[] = []; const last: number[] = [];
  units.forEach((u, ui) => { first[ui] = cBlocks.length; for (const b of u.blocks) { cBlocks.push(b); cUnit.push(ui); } last[ui] = cBlocks.length - 1; });
  const cs = cBlocks.map(sigOf); const ms = items.map(itemSig);
  const hunks = diffHunks(cs, ms);
  if (!hunks.length) return [];
  if (cBlocks.length === 0 && blank) return [{ dels: [[0, docEnd]], at: 0, nodes: blocksToNodes(items) }];

  type Ex = { a0: number; a1: number; b0: number; b1: number; uA: number; uB: number };
  const boundary: ApplyOp[] = []; const exp: Ex[] = [];
  for (const h of hunks) {
    const touched = new Set<number>();
    for (let i = h.a0; i < h.a1; i++) touched.add(cUnit[i]);
    if (h.a0 === h.a1 && h.a0 > 0 && h.a0 < cBlocks.length && cUnit[h.a0 - 1] === cUnit[h.a0]) touched.add(cUnit[h.a0]);
    if (!touched.size) {
      const at = h.a0 < cBlocks.length ? units[cUnit[h.a0]].pos : units.length ? units[units.length - 1].pos + units[units.length - 1].size : docEnd;
      boundary.push({ dels: [], at, nodes: blocksToNodes(items.slice(h.b0, h.b1)) });
      continue;
    }
    const uA = Math.min(...touched); const uB = Math.max(...touched);
    const a0 = first[uA]; const a1 = last[uB] + 1;
    exp.push({ a0, a1, b0: h.b0 - (h.a0 - a0), b1: h.b1 + (a1 - h.a1), uA, uB });
  }
  const merged: Ex[] = [];
  for (const e of exp) {
    const p = merged[merged.length - 1];
    if (p && e.uA <= p.uB) { p.a1 = Math.max(p.a1, e.a1); p.b1 = e.b1; p.uB = Math.max(p.uB, e.uB); }
    else merged.push({ ...e });
  }
  const ops: ApplyOp[] = [...boundary];
  let removed = 0;
  for (const e of merged) {
    const dels: [number, number][] = [];
    for (let u = e.uB; u >= e.uA; u--) {
      // Only units that hold blocks of this region; units between that hold no blocks (pictures) are never in `units`.
      dels.push([units[u].pos, units[u].pos + units[u].size]);
      removed += units[u].size;
    }
    ops.push({ dels, at: units[e.uA].pos, nodes: blocksToNodes(items.slice(e.b0, e.b1)) });
  }
  if (removed >= docEnd) for (const o of ops) if (!o.nodes.length) o.nodes = [{ type: "paragraph" }];
  ops.sort((x, y) => y.at - x.at);
  return ops;
}
