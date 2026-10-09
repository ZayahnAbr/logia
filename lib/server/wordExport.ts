import "server-only";
import {
  AlignmentType, Document, ExternalHyperlink, HeadingLevel, LevelFormat, Packer, Paragraph, TextRun,
  type ParagraphChild,
} from "docx";
import type { Block, Run } from "@/lib/gdocBlocks";

// Builds a .docx from a note's simple blocks: title, headings 1 to 3, paragraphs, bulleted and numbered lists,
// with bold, italic, underline, strikethrough and links. Pictures, colours and fonts are not included.

function runChildren(r: Run): ParagraphChild[] {
  const parts = r.t.split("\n");
  const base = { bold: !!r.b, italics: !!r.i, strike: !!r.s, underline: r.u || r.a ? {} : undefined };
  const runs = parts.map((t, i) => new TextRun({ ...base, text: t, break: i > 0 ? 1 : undefined, ...(r.a ? { color: "0563C1" } : {}) }));
  return r.a ? [new ExternalHyperlink({ link: r.a, children: runs })] : runs;
}

const HEADINGS = { h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2, h3: HeadingLevel.HEADING_3 } as const;

export async function blocksToDocx(title: string, blocks: Block[]): Promise<Buffer> {
  const children: Paragraph[] = [];
  if (title.trim()) children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: title.trim() })] }));
  let numberedRuns = 0; let prev = "";
  for (const b of blocks) {
    const kids = b.r.flatMap(runChildren);
    if (b.k === "ul") children.push(new Paragraph({ numbering: { reference: "logia-bullets", level: 0 }, children: kids }));
    else if (b.k === "ol") {
      if (prev !== "ol") numberedRuns++; // each separate list starts again at 1
      children.push(new Paragraph({ numbering: { reference: "logia-numbers", level: 0, instance: numberedRuns }, children: kids }));
    } else if (b.k === "p") children.push(new Paragraph({ children: kids }));
    else children.push(new Paragraph({ heading: HEADINGS[b.k], children: kids }));
    prev = b.k;
  }
  if (!children.length) children.push(new Paragraph({}));
  const indent = { left: 720, hanging: 360 };
  const doc = new Document({
    creator: "Logia",
    title: title.trim() || "Logia note",
    numbering: {
      config: [
        { reference: "logia-bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent } } }] },
        { reference: "logia-numbers", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent } } }] },
      ],
    },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}
