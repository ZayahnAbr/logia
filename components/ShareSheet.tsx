"use client";

import { useState } from "react";
import { Share2, Mail, Link2, Check, Loader2, MoreHorizontal } from "lucide-react";
import { siWhatsapp, siImessage } from "simple-icons";

// Official brand marks (Simple Icons, CC0) on their brand colours, so targets are recognisable at a glance.
const BrandIcon = ({ path, hex }: { path: string; hex: string }) => (
  <span className="share-icon share-brand" style={{ background: `#${hex}` }} aria-hidden="true">
    <svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d={path} /></svg>
  </span>
);
import { Dialog } from "@/components/Dialog";
import { toast } from "@/components/Toaster";

export type ShareData = { title: string; text?: string; url?: string };

// One share pattern for notes, files, maps, books, rooms and invites.
// Phones get the native share sheet (WhatsApp, Messages, Mail…); everything else gets this dialog.
export function ShareButton({ label = "Share", iconOnly = false, className = "btn btn-ghost btn-sm", note, get, data }: {
  label?: string; iconOnly?: boolean; className?: string;
  note?: string;                                  // who can open it, shown in the dialog
  data?: ShareData;                               // static content…
  get?: () => Promise<ShareData | { error: string }>; // …or built on demand (e.g. a signed file link)
}) {
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<ShareData | null>(null);

  const open = async () => {
    setBusy(true);
    const d = get ? await get() : data!;
    setBusy(false);
    if (!d || "error" in d) { toast((d as any)?.error ?? "Couldn't prepare this to share.", "error"); return; }
    const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
    if (touch && navigator.share) {
      try { await navigator.share(d); return; }
      catch (e: any) { if (e?.name === "AbortError") return; /* fall through to dialog */ }
    }
    setSheet(d);
  };

  return (
    <>
      <button type="button" className={className} onClick={open} disabled={busy} aria-label={iconOnly ? label : undefined} aria-haspopup="dialog">
        {busy ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Share2 size={14} aria-hidden="true" />}
        {!iconOnly && label}
      </button>
      {sheet && <ShareDialog data={sheet} note={note} onClose={() => setSheet(null)} />}
    </>
  );
}

function ShareDialog({ data, note, onClose }: { data: ShareData; note?: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const body = [data.text, data.url].filter(Boolean).join("\n\n");
  const enc = encodeURIComponent;
  // iOS uses "sms:&body=", Android "sms:?body=" — "?&body=" works on both.
  const targets = [
    { label: "WhatsApp", icon: <BrandIcon path={siWhatsapp.path} hex={siWhatsapp.hex} />, href: `https://wa.me/?text=${enc(`${data.title}\n\n${body}`)}`, external: true },
    { label: "Messages", icon: <BrandIcon path={siImessage.path} hex={siImessage.hex} />, href: `sms:?&body=${enc(`${data.title}\n${body}`)}` },
    { label: "Email", icon: <span className="share-icon share-brand" style={{ background: "linear-gradient(180deg,#1e9bff,#0a6cff)" }} aria-hidden="true"><Mail size={22} color="#fff" /></span>, href: `mailto:?subject=${enc(data.title)}&body=${enc(body)}` },
  ];

  const copy = async () => {
    try { await navigator.clipboard.writeText(data.url ?? body); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { toast("Couldn't copy. Select the text and copy it manually.", "error"); }
  };

  return (
    <Dialog title={`Share “${data.title}”`} onClose={onClose} width={400}>
      <div className="share-grid">
        {targets.map(({ label, icon, href, external }) => (
          <a key={label} href={href} className="share-target" onClick={() => setTimeout(onClose, 300)}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            {icon}{label}
          </a>
        ))}
        <button type="button" className="share-target" onClick={copy}>
          <span className="share-icon" aria-hidden="true">{copied ? <Check size={18} /> : <Link2 size={18} />}</span>
          {copied ? "Copied" : data.url ? "Copy link" : "Copy text"}
        </button>
        {typeof navigator !== "undefined" && "share" in navigator && (
          <button type="button" className="share-target" onClick={() => navigator.share(data).then(onClose).catch(() => {})}>
            <span className="share-icon" aria-hidden="true"><MoreHorizontal size={18} /></span>More
          </button>
        )}
      </div>
      {data.url && <p className="share-url mono truncate" title={data.url}>{data.url}</p>}
      {note && <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "10px 0 0", lineHeight: 1.5 }}>{note}</p>}
    </Dialog>
  );
}
