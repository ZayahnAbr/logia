"use client";

// One place that loads PDF.js, so every PDF feature behaves the same on phones and laptops.
// - The "legacy" build runs on older mobile browsers (current builds need very recent Safari and Chrome).
// - The worker is served from this site (public/pdf.worker.legacy.min.mjs). A worker on another origin
//   (the CDN used before) can't start on many phones, and PDF.js then waits forever without an error.
//   Keep that file in step with the pdfjs-dist version: copy node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs.
// - Missing newer JavaScript features are filled in first.
export async function loadPdfjs() {
  const P = Promise as unknown as { withResolvers?: () => unknown };
  if (typeof P.withResolvers !== "function") {
    P.withResolvers = function () {
      let resolve!: (v: unknown) => void, reject!: (e: unknown) => void;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    };
  }
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.legacy.min.mjs";
  return pdfjs;
}

/** Rejects instead of waiting forever, so a stuck read always ends in a visible message. */
export function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
