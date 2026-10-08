"use client";

import { Printer, Download } from "lucide-react";

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// "Print / Save as PDF" uses the browser print dialog (styled by the @media print rules);
// pass `markdown` to also offer a plain .md download for backup to Drive/OneDrive folders.
export function ExportButtons({ markdown, filename = "logia-export" }: { markdown?: () => string; filename?: string }) {
  return (
    <div className="no-print" style={{ display: "flex", gap: 6 }}>
      <button type="button" className="btn btn-ghost" onClick={() => window.print()} style={{ fontSize: 12.5 }}>
        <Printer size={13} /> Print / PDF
      </button>
      {markdown && (
        <button type="button" className="btn btn-ghost" style={{ fontSize: 12.5 }}
          onClick={() => download(`${filename.replace(/[^\w\- ]+/g, "").trim() || "logia-export"}.md`, markdown())}>
          <Download size={13} /> Download
        </button>
      )}
    </div>
  );
}
