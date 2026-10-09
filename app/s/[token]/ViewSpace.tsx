"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Eye, Copy, Layers, Lock } from "lucide-react";
import { CoverArt } from "@/components/NotebookCover";
import { CloneSpaceButton } from "@/components/CloneSpaceButton";
import { PreviewDialog, AddDialog } from "@/app/spaces/[id]/_components/SharedItemsWidget";
import { ImageStickerBody } from "@/app/spaces/[id]/_components/CustomWidgets";
import { previewViewShare, copySharedViaLink } from "@/app/view-link-actions";
import type { SharedItem } from "@/app/shared-items-actions";
import { headerLook, type HeaderKind } from "@/lib/spaceHeader";
import {
  STICKY_COLORS, STICKER_MIN_W, STICKER_MAX_W, STICKER_DEFAULT_IMAGE_W, STICKER_DEFAULT_TEXT_W, STICKER_DEFAULT_STICKY_W, STICKER_MAX_Y,
  type ImageData, type TextData, type StickyData, type StickerPos,
} from "@/lib/customWidgets";

type ViewItem = { share_id: string; kind: "notebook" | "deck"; title: string; cover_kind: string | null; cover_value: string | null; icon: string | null; item_count: number; owner_name: string };
type ViewWidget = { id: string; kind: "text" | "sticky" | "image"; data: Record<string, unknown> };
export type ViewData = {
  name: string; subject: string | null; copied_from_name: string | null;
  header_kind: HeaderKind; header_color: string | null; has_header_image: boolean;
  allow_design: boolean; allow_content: boolean;
  design: { widgets: ViewWidget[]; colors: Record<string, string>; layout: unknown } | null;
  items: ViewItem[];
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const tiltFor = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0; return (Math.abs(h) % 5) - 2; };

export function ViewSpace({ token, data, signedIn, resume }: { token: string; data: ViewData; signedIn: boolean; resume: string | null }) {
  const here = `/s/${token}`;
  const canClone = data.allow_design || data.allow_content;
  // Sign-in and sign-up send people back to this page, with a note of what they were about to do.
  const back = (action?: string) => encodeURIComponent(action ? `${here}?resume=${action}` : here);
  const signUp = (action?: string) => `/auth/sign-up?next=${back(action)}`;
  const signIn = (action?: string) => `/auth/signin?next=${back(action)}`;

  const items: SharedItem[] = useMemo(() => data.items.map((i) => ({ ...i, item_id: "", owner_id: "", is_mine: false })), [data.items]);
  const [preview, setPreview] = useState<SharedItem | null>(null);
  const [adding, setAdding] = useState<SharedItem | null>(() => {
    if (!signedIn || !resume?.startsWith("add-")) return null;
    return items.find((i) => i.share_id === resume.slice(4)) ?? null;
  });
  const autoClone = signedIn && resume === "clone" && canClone;

  // Once the saved action has been picked up, tidy the address bar.
  useEffect(() => {
    if (!resume) return;
    try { window.history.replaceState(null, "", here); } catch { /* ignore */ }
  }, [resume, here]);

  const load = useCallback((shareId: string, kind: "notebook" | "deck") => previewViewShare(token, shareId, kind), [token]);
  const copy = useCallback((shareId: string, target: string) => copySharedViaLink(token, shareId, target), [token]);

  const imageUrl = data.has_header_image ? `${here}/media?h=1` : null;
  const look = headerLook(data.header_kind, data.header_color, imageUrl);
  const widgets = data.design?.widgets ?? [];

  return (
    <div className="vl-page">
      <div className="vl-bar">
        <p className="vl-bar-text">You are viewing <strong>{data.name}</strong> on Logia</p>
        <div className="vl-bar-actions">
          {signedIn ? (
            <>
              {canClone && (
                <CloneSpaceButton spaceId="" spaceName={data.name} className="btn btn-sm btn-primary" viewToken={token}
                  options={{ design: data.allow_design, content: data.allow_content }} autoOpen={autoClone} />
              )}
              <Link href="/spaces" className="btn btn-sm">My spaces</Link>
            </>
          ) : (
            <>
              <Link href={signUp(canClone ? "clone" : undefined)} className="btn btn-sm btn-primary">{canClone ? "Sign up to copy this space" : "Create a free account"}</Link>
              <Link href={signIn(canClone ? "clone" : undefined)} className="btn btn-sm">Sign in</Link>
            </>
          )}
        </div>
      </div>

      <main id="main" className="vl-main" tabIndex={-1}>
        <header className={`space-hero ${look.mesh ? "mesh-warm" : look.className}`} style={look.style} data-sh-header="">
          <div>
            <p className="eyebrow" style={{ color: "rgba(17,17,17,.66)", margin: 0 }}>Shared space{data.subject ? ` · ${data.subject}` : ""}</p>
            <h1 className="space-hero-h">{data.name}</h1>
            <p className="space-hero-p">Read only. Copying needs a free Logia account.</p>
            {data.copied_from_name && <p className="shr-credit">Copied from {data.copied_from_name}</p>}
          </div>
        </header>

        {widgets.length > 0 && <ViewStickers token={token} widgets={widgets} colors={data.design?.colors ?? {}} />}

        <section className="vl-section" aria-labelledby="vl-items-h">
          <h2 id="vl-items-h" className="vl-h2">Shared notebooks and flashcards</h2>
          {items.length === 0 ? (
            <div className="empty card" style={{ padding: "24px 20px" }}>Nothing has been shared from this space yet.</div>
          ) : (
            <ul className="shr-list">
              {items.map((it) => (
                <li key={it.share_id} className="shr-row card">
                  <span className="shr-art" aria-hidden="true">
                    {it.kind === "notebook" ? <CoverArt cover={{ kind: it.cover_kind, value: it.cover_value }} /> : <Layers size={22} />}
                  </span>
                  <div className="shr-body">
                    <span className="shr-title truncate" title={it.title}>{it.title}</span>
                    <span className="shr-meta">
                      {it.kind === "notebook" ? "Notebook" : "Flashcard deck"} · {it.item_count} {it.kind === "notebook" ? (it.item_count === 1 ? "note" : "notes") : (it.item_count === 1 ? "card" : "cards")}
                    </span>
                    <span className="shr-meta">Shared by {it.owner_name}</span>
                  </div>
                  <div className="shr-actions">
                    <button type="button" className="btn btn-sm" onClick={() => setPreview(it)} aria-haspopup="dialog" aria-label={`Preview ${it.title}`}>
                      <Eye size={14} aria-hidden="true" /> Preview
                    </button>
                    {signedIn ? (
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => setAdding(it)} aria-haspopup="dialog" aria-label={`Add ${it.title} to mine`}>
                        <Copy size={14} aria-hidden="true" /> Add to mine
                      </button>
                    ) : (
                      <Link href={signUp(`add-${it.share_id}`)} className="btn btn-sm btn-primary" aria-label={`Sign up to add ${it.title} to your own space`}>
                        <Lock size={14} aria-hidden="true" /> Sign up to add
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="vl-foot">
            You can look at this page and preview what was shared without an account. Files, papers and lectures are never shown here.
          </p>
        </section>
      </main>

      {preview && <PreviewDialog item={preview} onClose={() => setPreview(null)} load={load} />}
      {adding && <AddDialog item={adding} currentSpace="" onClose={() => setAdding(null)} copy={copy} />}
    </div>
  );
}

// The creator's stickers as they placed them on their home page: same positions, not draggable or editable.
function ViewStickers({ token, widgets, colors }: { token: string; widgets: ViewWidget[]; colors: Record<string, string> }) {
  const root = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(0);
  const [mobile, setMobile] = useState(false);
  const [heights, setHeights] = useState<Record<string, number>>({});

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const mq = window.matchMedia("(max-width: 759px)");
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => { ro.disconnect(); mq.removeEventListener("change", on); };
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setHeights((cur) => {
        const next = { ...cur };
        let changed = false;
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.sid;
          const h = Math.round((e.target as HTMLElement).offsetHeight);
          if (id && next[id] !== h) { next[id] = h; changed = true; }
        }
        return changed ? next : cur;
      });
    });
    el.querySelectorAll<HTMLElement>("[data-sid]").forEach((n) => ro.observe(n));
    return () => ro.disconnect();
  }, [widgets, mobile]);

  const geo = useMemo(() => {
    const out: Record<string, { left: number; top: number; w: number; z: number }> = {};
    const maxW = Math.max(STICKER_MIN_W, Math.min(STICKER_MAX_W, W - 2));
    let cursor = 8;
    widgets.forEach((s, i) => {
      const p = s.data as StickerPos;
      const baseW = s.kind === "text" ? STICKER_DEFAULT_TEXT_W : s.kind === "sticky" ? STICKER_DEFAULT_STICKY_W : STICKER_DEFAULT_IMAGE_W;
      const w = clamp(Math.round(typeof p.w === "number" ? p.w : baseW), STICKER_MIN_W, Math.min(maxW, Math.max(STICKER_MIN_W, W)));
      const h = heights[s.id] ?? 160;
      let left: number, top: number;
      if (typeof p.x === "number" && typeof p.y === "number") { left = p.x * W; top = p.y; }
      else { left = W - w - 16; top = cursor; cursor += h + 12; }
      out[s.id] = { left: clamp(left, 0, Math.max(0, W - w)), top: clamp(top, 0, STICKER_MAX_Y), w, z: typeof p.z === "number" ? p.z : i };
    });
    return out;
  }, [widgets, W, heights]);

  // A sticker placed far down the creator's home would leave a tall empty gap here, so very tall layouts are squeezed.
  const rawBottom = Math.max(0, ...widgets.map((s) => (geo[s.id]?.top ?? 0) + (heights[s.id] ?? 0)));
  const squeeze = rawBottom > 1100 ? 1100 / rawBottom : 1;
  const topOf = (id: string) => Math.round((geo[id]?.top ?? 0) * squeeze);
  const height = mobile ? 0 : Math.max(0, ...widgets.map((s) => topOf(s.id) + (heights[s.id] ?? 0))) + 16;
  const order = useMemo(() => [...widgets].sort((a, b) => (geo[a.id]?.z ?? 0) - (geo[b.id]?.z ?? 0)).map((s, i) => [s.id, i] as const), [widgets, geo]);
  const rank = Object.fromEntries(order);

  const render = (s: ViewWidget) => {
    const g = geo[s.id];
    const rawTint = colors[`cw-${s.id}`];
    const tint = typeof rawTint === "string" && /^[a-z]{3,12}$/.test(rawTint) ? rawTint : undefined;
    const abs = !mobile;
    const style = abs
      ? { ["--st-w" as string]: `${g?.w ?? 220}px`, left: g?.left ?? 0, top: topOf(s.id), width: g?.w ?? 220, zIndex: 1 + (rank[s.id] ?? 0), visibility: W ? undefined : ("hidden" as const) }
      : { ["--st-w" as string]: `${g?.w ?? 220}px`, width: `min(100%, ${g?.w ?? 220}px)` };
    let body: React.ReactNode = null;
    let label = "";
    if (s.kind === "text") {
      const d = s.data as unknown as TextData;
      label = "Text";
      body = (
        <div className="cw-textcard">
          <div className={`cw-text cw-text-${d.size === "heading" ? "heading" : "body"} vl-text`} style={{ textAlign: d.align === "center" || d.align === "right" ? d.align : "left" }}>{String(d.text ?? "")}</div>
        </div>
      );
    } else if (s.kind === "sticky") {
      const d = s.data as unknown as StickyData;
      const bg = STICKY_COLORS.find((c) => c.id === d.color)?.bg ?? STICKY_COLORS[0].bg;
      label = "Sticky note";
      body = (
        <div className="stn" style={{ background: bg, ["--tilt" as string]: `${tiltFor(s.id)}deg` }}>
          <div className="stn-text vl-text">{String(d.text ?? "")}</div>
        </div>
      );
    } else {
      const d = s.data as unknown as ImageData & { has_file?: boolean };
      label = `Picture: ${d.alt || d.caption || "sticker"}`;
      const src = d.source === "upload" ? (d.has_file ? `/s/${token}/media?w=${s.id}` : null)
        : typeof d.url === "string" && /^https:\/\//i.test(d.url) ? d.url : null;
      body = <ImageStickerBody data={d} src={src} />;
    }
    return (
      <div key={s.id} data-sid={s.id} role="group" aria-label={label}
        className={`st vl-st ${s.kind === "text" ? "st-text" : s.kind === "sticky" ? "st-sticky" : "st-image"}${tint ? ` st-tinted cw-tint-${tint}` : ""}${abs ? " is-abs" : ""}`}
        style={style}>
        {body}
      </div>
    );
  };

  return (
    <div ref={root} className="st-root vl-stickers" aria-label="Stickers on this space's home page" role="region" style={height ? { minHeight: height } : undefined}>
      {mobile ? <div className="st-flow">{widgets.map(render)}</div> : widgets.map(render)}
    </div>
  );
}
