import type { Editor } from "@tiptap/react";
import { planApply, readUnits, trimTrailing, type Block, type Item } from "@/lib/gdocBlocks";

// Helpers shared by the Google Docs sync and the Word export: read the open editor as simple blocks,
// and apply changed blocks back to it in place.

export function readEditor(editor: Editor) {
  const nodes: { json: never; pos: number; size: number }[] = [];
  editor.state.doc.forEach((node, offset) => nodes.push({ json: node.toJSON() as never, pos: offset, size: node.nodeSize }));
  return { ...readUnits(nodes), docEnd: editor.state.doc.content.size };
}

export const flatBlocks = (units: { blocks: Block[] }[]) => trimTrailing(units.flatMap((u) => u.blocks));

/** The note's text as simple blocks (paragraphs, headings 1 to 3, list items, bold, italic, underline, strike, links). */
export const noteBlocksOf = (editor: Editor): Block[] => flatBlocks(readEditor(editor).units);

/** Applies changed blocks to the live editor in one transaction. Returns false if it could not. */
export function applyItems(editor: Editor, items: Item[]): boolean {
  try {
    const cur = readEditor(editor);
    const ops = planApply(cur.units, cur.blank, cur.docEnd, items);
    if (!ops.length) return true;
    const tr = editor.state.tr;
    const schema = editor.state.schema;
    for (const op of ops) {
      for (const [from, to] of op.dels) tr.delete(from, to);
      if (op.nodes.length) tr.insert(op.at, op.nodes.map((n) => schema.nodeFromJSON(n)));
    }
    editor.view.dispatch(tr);
    return true;
  } catch { return false; }
}
