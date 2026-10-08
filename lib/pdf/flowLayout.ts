import type { MapNode } from "./buildTree";
import type { Node, Edge } from "@xyflow/react";

// Distinct, saturated branch colours (used for lines/dots/borders — text stays dark for contrast).
export const ROOT_COLOR = "#b4532d";
export const BRANCH_COLORS = ["#e8835a", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#ef4444"];

// Centre-to-centre distances (nodes are positioned by their centre — see nodeOrigin in MindMapper).
const X_GAP = [0, 420, 360, 330, 310]; // horizontal distance from parent, by depth
const ROW = 96;                         // vertical slot per visible leaf

export type FlowNodeData = {
  label: string; level: number; page?: number; color: string; side: "left" | "right" | "root";
  hiddenCount: number; collapsed: boolean; hasChildren: boolean; hasNote: boolean;
};

const visibleKids = (n: MapNode) => (n.collapsed ? [] : n.children);
const countAll = (n: MapNode): number => n.children.reduce((s, c) => s + 1 + countAll(c), 0);
const leaves = (n: MapNode): number => { const k = visibleKids(n); return k.length === 0 ? 1 : k.reduce((s, c) => s + leaves(c), 0); };

// Balanced radial layout: the root sits in the middle; top-level branches are split between the
// right and left sides so both halves carry roughly the same number of visible leaves.
export function layoutMindMap(root: MapNode): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const nodes: Node<FlowNodeData>[] = [];
  const edges: Edge[] = [];

  const tops = visibleKids(root);
  const right: MapNode[] = [], left: MapNode[] = [];
  let rw = 0, lw = 0;
  tops.forEach((t) => { const w = leaves(t); if (rw <= lw) { right.push(t); rw += w; } else { left.push(t); lw += w; } });

  const add = (n: MapNode, depth: number, side: "left" | "right", color: string, x: number, y: number) => {
    nodes.push({
      id: n.id, type: "mindNode", position: { x, y }, draggable: false,
      data: {
        label: n.label, level: depth, page: n.page, color, side, collapsed: !!n.collapsed,
        hasChildren: n.children.length > 0, hiddenCount: n.collapsed ? countAll(n) : 0, hasNote: !!n.note?.trim(),
      },
    });
  };

  const placeSide = (branches: MapNode[], side: "left" | "right", colorOffset: number) => {
    const total = branches.reduce((s, b) => s + leaves(b), 0);
    let cursor = -(total * ROW) / 2;
    const dir = side === "right" ? 1 : -1;

    const walk = (n: MapNode, depth: number, inherited: string, parentX: number): number => {
      const color = n.color ?? inherited;
      const x = parentX + dir * (X_GAP[Math.min(depth, X_GAP.length - 1)]);
      const kids = visibleKids(n);
      let y: number;
      if (kids.length === 0) { y = cursor + ROW / 2; cursor += ROW; }
      else {
        const ys = kids.map((k) => walk(k, depth + 1, color, x));
        y = (ys[0] + ys[ys.length - 1]) / 2;
      }
      add(n, depth, side, color, x, y);
      kids.forEach((k) => edges.push({
        id: `${n.id}->${k.id}`, source: n.id, target: k.id, type: "default",
        sourceHandle: side === "right" ? "out-r" : "out-l", targetHandle: side === "right" ? "in-l" : "in-r",
        style: { stroke: color, strokeWidth: depth === 1 ? 3 : 2.25 },
      }));
      return y;
    };

    branches.forEach((b, i) => {
      const color = b.color ?? BRANCH_COLORS[(colorOffset + i) % BRANCH_COLORS.length];
      walk(b, 1, color, 0);
      edges.push({
        id: `root->${b.id}`, source: root.id, target: b.id, type: "default",
        sourceHandle: side === "right" ? "out-r" : "out-l", targetHandle: side === "right" ? "in-l" : "in-r",
        style: { stroke: color, strokeWidth: 3.5 },
      });
    });
  };

  placeSide(right, "right", 0);
  placeSide(left, "left", right.length);
  add(root, 0, "right", root.color ?? ROOT_COLOR, 0, 0);
  nodes[nodes.length - 1].data.side = "root";
  return { nodes, edges };
}
