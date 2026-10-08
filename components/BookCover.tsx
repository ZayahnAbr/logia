import { BookOpen } from "lucide-react";

// Apple Books–style cover: 2:3, soft spine shading and a grounded shadow.
// Falls back to a typographic cover (title on a warm tint) when there's no image.
const TINTS = ["#f6c1c7", "#fbd3b0", "#9cc3e6", "#a9c6a2", "#c6b8ea", "#f2b84b"];
const tintFor = (s: string) => TINTS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % TINTS.length];

export function BookCover({ title, url, width = 132 }: { title: string; url?: string | null; width?: number }) {
  return (
    <span className="book-cover" style={{ width, ["--tint" as string]: tintFor(title) }} aria-hidden="true">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className="book-cover-text">
          <BookOpen size={Math.max(14, width * 0.12)} />
          <span>{title}</span>
        </span>
      )}
    </span>
  );
}
