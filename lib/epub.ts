// EPUB helpers (browser only). epub.js is loaded on demand so PDF users never download it.
export const isEpubPath = (path: string) => /\.epub$/i.test(path);
export const isEpubFile = (f: File) => f.type === "application/epub+zip" || /\.epub$/i.test(f.name);

/** The book's own cover image, re-encoded to a small JPEG. Null when the EPUB has no cover. */
export async function renderEpubCover(source: File | ArrayBuffer, width = 360): Promise<Blob | null> {
  const ePub = (await import("epubjs")).default;
  const book = ePub(source instanceof File ? await source.arrayBuffer() : source);
  try {
    await book.ready;
    const url = await book.coverUrl();
    if (!url) return null;
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.round((img.naturalHeight / img.naturalWidth) * width);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  } catch {
    return null;
  } finally {
    book.destroy();
  }
}
