"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown, FileText } from "lucide-react";
import type { MapNode } from "@/lib/pdf/buildTree";

export function MindMap({ root, onSelect, activeId }: { root: MapNode; onSelect: (n: MapNode) => void; activeId?: string }) {
  const count = countNodes(root);
  return (
    <div style={{ padding: "4px 4px 40px" }}>
      <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 12 }}>{count} sections</div>
      {root.children.map((child) => (
        <Branch key={child.id} node={child} depth={0} onSelect={onSelect} activeId={activeId} />
      ))}
      {root.children.length === 0 && (
        <div style={{ color: "var(--faint)", fontSize: 13, padding: 20 }}>No structure detected in this document.</div>
      )}
    </div>
  );
}

function countNodes(n: MapNode): number {
  return n.children.reduce((sum, c) => sum + 1 + countNodes(c), 0);
}

function Branch({ node, depth, onSelect, activeId }: { node: MapNode; depth: number; onSelect: (n: MapNode) => void; activeId?: string }) {
  const [open, setOpen] = useState(depth < 2);
  const hasKids = node.children.length > 0;
  const active = node.id === activeId;

  return (
    <div style={{ marginLeft: depth === 0 ? 0 : 16, position: "relative" }}>
      {depth > 0 && <span style={{ position: "absolute", left: -9, top: 0, bottom: 0, width: 1, background: "var(--border-soft)" }} />}
      <div
        onClick={() => onSelect(node)}
        style={{
          display: "flex", alignItems: "flex-start", gap: 7, padding: "7px 10px", borderRadius: 10,
          cursor: "pointer", marginBottom: 2,
          background: active ? "var(--accent-soft)" : "transparent",
          border: active ? "1px solid var(--accent)" : "1px solid transparent",
        }}
      >
        {hasKids ? (
          <button onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
            style={{ border: "none", background: "none", cursor: "pointer", color: "var(--faint)", display: "grid", placeItems: "center", padding: 0, width: 16, height: 18, flexShrink: 0 }}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span style={{ width: 16, height: 18, display: "grid", placeItems: "center", flexShrink: 0 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--faint)" }} />
          </span>
        )}
        <span style={{
          fontSize: node.level === 1 ? 14 : node.level === 2 ? 13 : 12.5,
          fontWeight: node.level === 1 ? 600 : node.level === 2 ? 500 : 400,
          color: active ? "var(--accent)" : "var(--text)",
          lineHeight: 1.4, flex: 1,
        }}>
          {node.label}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 12, color: "var(--faint)", flexShrink: 0, marginTop: 2 }}>
          <FileText size={10} /> {node.page}
        </span>
      </div>
      {open && hasKids && node.children.map((c) => (
        <Branch key={c.id} node={c} depth={depth + 1} onSelect={onSelect} activeId={activeId} />
      ))}
    </div>
  );
}