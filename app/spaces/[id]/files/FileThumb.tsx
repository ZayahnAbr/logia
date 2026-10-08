"use client";

import { useEffect, useRef, useState } from "react";
import { renderPdfCover } from "@/lib/pdf/cover";

// What a file looks like: images show themselves, PDFs show page 1 (rendered on this device
// when the tile scrolls into view), everything else gets a typed tile.
const TYPE_TONES: Record<string, string> = { DOC: "#2f5bd3", DOCX: "#2f5bd3", PPT: "#d2521e", PPTX: "#d2521e", XLS: "#1f8a4c", XLSX: "#1f8a4c", CSV: "#1f8a4c", TXT: "#6b6f76", ZIP: "#7b4fd6", MP3: "#d23c8a", MP4: "#d23c8a" };

export function FileThumb({ name, mime, url }: { name: string; mime: string; url: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pdfImg, setPdfImg] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const isImg = mime?.startsWith("image/");
  const isPdf = mime?.includes("pdf") || /\.pdf$/i.test(name);
  const ext = (name.split(".").pop() || "FILE").toUpperCase().slice(0, 4);

  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !isPdf || !url || pdfImg) return;
    let alive = true;
    renderPdfCover(url, 300).then((out) => { if (alive && out) setPdfImg(URL.createObjectURL(out.blob)); }).catch(() => {});
    return () => { alive = false; };
  }, [visible, isPdf, url, pdfImg]);
  useEffect(() => () => { if (pdfImg) URL.revokeObjectURL(pdfImg); }, [pdfImg]);

  return (
    <div ref={ref} className="fthumb" aria-hidden="true">
      {isImg && url && visible ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" />
      ) : isPdf && pdfImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={pdfImg} alt="" className="fthumb-page" />
      ) : (
        <span className="fthumb-type" style={{ ["--ft" as string]: TYPE_TONES[ext] ?? (isPdf ? "#d23c3c" : "#8e8e95") }}>
          <span className="fthumb-doc"><i /><i /><i /><i /></span>
          <b>{isPdf ? "PDF" : ext}</b>
        </span>
      )}
    </div>
  );
}
