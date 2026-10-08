import type React from "react";

// Drag a photo from the desktop or a Downloads folder onto a drop area (adds "is-over" while hovering).
export function dropProps(onFile: (f: File) => void) {
  return {
    onDragOver: (e: React.DragEvent<HTMLElement>) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; e.currentTarget.classList.add("is-over"); },
    onDragLeave: (e: React.DragEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) e.currentTarget.classList.remove("is-over"); },
    onDrop: (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault();
      e.currentTarget.classList.remove("is-over");
      const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/"));
      if (f) onFile(f);
    },
  };
}
