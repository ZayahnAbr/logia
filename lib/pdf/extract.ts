"use client";
import { loadPdfjs } from "@/lib/pdf/loadPdfjs";

export interface TextBlock {
  text: string;
  page: number;
  fontSize: number;
  bold: boolean;
  y: number;
}

export interface ExtractResult {
  blocks: TextBlock[];
  pageCount: number;
  needsOCR: boolean;
}

export async function extractPdf(file: File): Promise<ExtractResult> {
  const pdfjsLib = await loadPdfjs();

  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const blocks: TextBlock[] = [];
  let emptyPages = 0;

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    if (content.items.length === 0) { emptyPages++; continue; }

    for (const item of content.items as any[]) {
      const str = (item.str ?? "").trim();
      if (!str) continue;
      const fontSize = Math.abs(item.transform?.[0] ?? item.height ?? 10);
      const fontName = (item.fontName ?? "").toLowerCase();
      blocks.push({
        text: str,
        page: p,
        fontSize: Math.round(fontSize),
        bold: fontName.includes("bold") || fontName.includes("black") || fontName.includes("semib"),
        y: Math.round(item.transform?.[5] ?? 0),
      });
    }
  }

  return { blocks, pageCount: pdf.numPages, needsOCR: emptyPages > 0 && blocks.length === 0 };
}