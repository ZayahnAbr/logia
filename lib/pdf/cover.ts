// Renders page 1 of a PDF to a small JPEG (the "cover"), in the browser.
// Accepts a local File (at upload time) or a signed URL (for books uploaded earlier).
export async function renderPdfCover(source: File | string, width = 360): Promise<{ blob: Blob; pages: number } | null> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
  const task = pdfjs.getDocument(
    typeof source === "string" ? { url: source, disableAutoFetch: true, disableStream: false } : { data: await source.arrayBuffer() },
  );
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    return blob ? { blob, pages: doc.numPages } : null;
  } finally {
    task.destroy();
  }
}
