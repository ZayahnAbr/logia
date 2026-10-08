export interface MapNode {
  id: string;
  label: string;
  page: number;
  y: number;
  level: number;
  children: MapNode[];
  sourceText: string;
  note?: string;        // the student's own summary for this topic
  collapsed?: boolean;  // branch folded in the map view
  color?: string;       // user-chosen colour; inherited by sub-topics that don't set their own
}

interface TextBlock { text: string; page: number; fontSize: number; bold: boolean; y: number; }

const JUNK = /^(\d+\s*(of|\/)\s*\d+$|doi[:\s]|https?:\/\/|©|isbn)/i;

function isJunk(t: string) {
  const s = t.trim();
  if (s.length < 3) return true;
  if (/^[\d\s.,;:()\-–]+$/.test(s)) return true;
  if (JUNK.test(s)) return true;
  return false;
}

export function buildTree(blocks: TextBlock[], docTitle = "Document"): MapNode {
  const root: MapNode = { id: "root", label: docTitle, page: 1, y: 0, level: 0, children: [], sourceText: "" };
  if (blocks.length === 0) return root;

  // merge text runs that form one line
  const merged: TextBlock[] = [];
  for (const b of blocks) {
    const prev = merged[merged.length - 1];
    const sameStyle = prev && Math.abs(prev.fontSize - b.fontSize) <= 1 && prev.bold === b.bold;
    const sameLine = prev && prev.page === b.page && Math.abs(prev.y - b.y) < (b.fontSize + 6);
    if (prev && sameStyle && sameLine) prev.text = `${prev.text} ${b.text}`.trim();
    else merged.push({ ...b });
  }

  // drop running headers/footers repeated across 3+ pages
  const seen = new Map<string, Set<number>>();
  for (const b of merged) {
    const key = b.text.trim().toLowerCase().slice(0, 60);
    if (!seen.has(key)) seen.set(key, new Set());
    seen.get(key)!.add(b.page);
  }
  const repeated = new Set([...seen.entries()].filter(([, p]) => p.size >= 3).map(([k]) => k));

  // body size = size carrying the most characters
  const weight = new Map<number, number>();
  for (const b of merged) weight.set(b.fontSize, (weight.get(b.fontSize) ?? 0) + b.text.length);
  const bodySize = [...weight.entries()].sort((a, b) => b[1] - a[1])[0][0];

  // heading levels come from FONT SIZE ONLY — inline bold never creates a node
  const headingSizes = [...new Set(merged.map((b) => b.fontSize))]
    .filter((s) => s > bodySize)
    .sort((a, b) => b - a)
    .slice(0, 3);
  const levelForSize = new Map<number, number>();
  headingSizes.forEach((s, i) => levelForSize.set(s, i + 1));

  const classify = (b: TextBlock): number => {
    if (isJunk(b.text)) return -1;
    if (repeated.has(b.text.trim().toLowerCase().slice(0, 60))) return -1;
    if (b.text.length > 130) return 0;              // too long to be a heading → body
    return levelForSize.get(b.fontSize) ?? 0;       // no bold rule at all
  };

  const stack: MapNode[] = [root];
  let counter = 0;

  for (const b of merged) {
    const lvl = classify(b);
    if (lvl === -1) continue;
    if (lvl === 0) {
      const parent = stack[stack.length - 1];
      if (parent && parent.level > 0) parent.sourceText += (parent.sourceText ? " " : "") + b.text;
      continue;
    }
    const node: MapNode = {
      id: `n${counter++}`, label: b.text.trim(), page: b.page, y: b.y,
      level: lvl, children: [], sourceText: "",
    };
    while (stack.length > 1 && stack[stack.length - 1].level >= lvl) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  return prune(root);
}

// a parent with no text of its own inherits its descendants' text
export function textFor(node: MapNode): string {
  if (node.sourceText && node.sourceText.length > 100) return node.sourceText;
  const parts: string[] = [node.sourceText];
  const walk = (n: MapNode) => { n.children.forEach((c) => { parts.push(c.sourceText); walk(c); }); };
  walk(node);
  return parts.filter(Boolean).join(" ").trim();
}

function prune(node: MapNode): MapNode {
  node.children = node.children.map(prune).filter((c) => c.label.trim().length > 2);
  return node;
}