"use client";

import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { listSavedStickers, placeSavedSticker, deleteSavedSticker, type SavedSticker } from "../widget-actions";

export default function SavedStickers({ spaceId, busy, setBusy, done, setError }: {
  spaceId: string; busy: boolean; setBusy: (b: boolean) => void; done: (r: { error?: string }) => void; setError: (e: string | null) => void;
}) {
  const [items, setItems] = useState<SavedSticker[] | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let dead = false;
    listSavedStickers().then((r) => {
      if (dead) return;
      setItems(r.items);
      if (r.error) setError(r.error);
    });
    return () => { dead = true; };
  }, [setError]);

  const place = async (id: string) => {
    setError(null); setBusy(true);
    done(await placeSavedSticker(spaceId, id));
  };

  const remove = async (id: string) => {
    setError(null); setBusy(true);
    const r = await deleteSavedSticker(id);
    setBusy(false); setConfirm(null);
    if (r.error) { setError(r.error); return; }
    setItems((cur) => (cur ?? []).filter((s) => s.id !== id));
    setStatus("Deleted from your saved stickers. Stickers already on a space are not affected.");
  };

  if (items === null) return <p className="cw-note stk-load"><Loader2 size={14} className="spin" aria-hidden="true" /> Loading your saved stickers.</p>;
  if (items.length === 0) return <p className="cw-note">No saved stickers yet. Stickers you make in the Sticker tab are saved here so you can use them in any space.</p>;

  return (
    <div className="cw-form">
      <p className="cw-note">Choose a sticker to place it on this space. {items.length} of 100 saved.</p>
      <ul className="stk-lib" aria-label="Saved stickers">
        {items.map((s, i) => (
          <li key={s.id} className="stk-lib-item">
            <button type="button" className="stk-lib-pick" disabled={busy} onClick={() => place(s.id)} aria-label={`Place ${s.alt || `saved sticker ${i + 1}`} on this space`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.url} alt="" loading="lazy" decoding="async" />
            </button>
            {confirm === s.id ? (
              <span className="stk-lib-confirm" role="group" aria-label="Confirm delete">
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => remove(s.id)}>Delete</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(null)}>Keep</button>
              </span>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm stk-lib-del" disabled={busy} onClick={() => setConfirm(s.id)} aria-label={`Delete ${s.alt || `saved sticker ${i + 1}`} from saved stickers`}>
                <Trash2 size={14} aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="cw-note" role="status" aria-live="polite">{status}</p>
    </div>
  );
}
