"use client";

import { useState, useId } from "react";
import { Loader2, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/Toaster";
import { uploadBlocked, checkUploaded } from "@/lib/uploadSafety";
import { CoverArt } from "@/components/NotebookCover";
import {
  COVER_COLORS, COVER_PATTERNS, COVER_EMOJIS, COVER_BUCKET, COVER_MAX_BYTES, COVER_TYPES,
  DEFAULT_COVER_COLOR, parseCover, patternValue, emojiValue, type Cover, type CoverKind,
} from "@/lib/notebookCovers";

const KINDS: { key: CoverKind; label: string }[] = [
  { key: "color", label: "Colour" }, { key: "pattern", label: "Pattern" }, { key: "emoji", label: "Emoji" }, { key: "image", label: "Image" },
];

// Cover chooser: solid colour, pattern, emoji on a colour, or an uploaded picture (JPG, PNG or WebP, up to 5 MB).
export function CoverPicker({ spaceId, userId, value, urls, onChange, onUploaded }: {
  spaceId: string; userId: string; value: Cover | null; urls: Record<string, string>;
  onChange: (c: Cover) => void; onUploaded: (path: string, url: string) => void;
}) {
  const uid = useId();
  const cur = parseCover(value);
  const [kind, setKind] = useState<CoverKind>(cur?.kind ?? "color");
  const [color, setColor] = useState(cur?.color && cur.kind !== "image" ? cur.color : DEFAULT_COVER_COLOR);
  const [pattern, setPattern] = useState<string>(cur?.pattern ?? "dots");
  const [emoji, setEmoji] = useState<string>(cur?.emoji ?? COVER_EMOJIS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const imagePath = cur?.kind === "image" ? cur.path : undefined;

  const emit = (k: CoverKind, c = color, p = pattern, e = emoji) => {
    if (k === "color") onChange({ kind: "color", value: c });
    else if (k === "pattern") onChange({ kind: "pattern", value: patternValue(p, c) });
    else if (k === "emoji") onChange({ kind: "emoji", value: emojiValue(c, e) });
  };
  const pickKind = (k: CoverKind) => { setKind(k); setErr(null); if (k !== "image") emit(k); };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    const ext = COVER_TYPES[file.type];
    if (!ext) { setErr("Use a JPG, PNG or WebP picture."); return; }
    if (file.size > COVER_MAX_BYTES) { setErr("That picture is over 5 MB. Choose a smaller one."); return; }
    setBusy(true);
    try {
      const blocked = await uploadBlocked("image");
      if (blocked) { setErr(blocked); return; }
      const sb = createClient();
      const path = `${userId}/${spaceId}/${crypto.randomUUID()}.${ext}`;
      const up = await sb.storage.from(COVER_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) { setErr(/bucket/i.test(up.error.message) ? "Cover uploads aren't set up yet. Run migration 26." : "The upload didn't work. Try again."); return; }
      const checked = await checkUploaded(COVER_BUCKET, path, "image");
      if (checked.message) toast(checked.message, checked.state === "unsafe" ? "error" : "success");
      const signed = await sb.storage.from(COVER_BUCKET).createSignedUrl(path, 3600);
      if (signed.data?.signedUrl) onUploaded(path, signed.data.signedUrl);
      onChange({ kind: "image", value: path });
    } finally { setBusy(false); }
  };

  const shown: Cover | null = value;
  return (
    <div className="nbk-picker">
      <div className="nbk-picker-prev" aria-hidden="true">
        <div className="nbk-book nbk-book-sm"><div className="nbk-art"><CoverArt cover={shown} imageUrl={imagePath ? urls[imagePath] : null} /></div></div>
      </div>
      <div className="nbk-picker-ctl">
        <div className="nbk-seg" role="group" aria-label="Cover type">
          {KINDS.map((k) => (
            <button key={k.key} type="button" aria-pressed={kind === k.key} onClick={() => pickKind(k.key)}>{k.label}</button>
          ))}
        </div>

        {kind !== "image" && (
          <div className="nbk-swatches" role="group" aria-label="Cover colour">
            {COVER_COLORS.map((c) => (
              <button key={c.hex} type="button" className="nbk-sw" style={{ background: c.hex }} aria-label={c.label} aria-pressed={color === c.hex}
                onClick={() => { setColor(c.hex); emit(kind, c.hex); }} />
            ))}
          </div>
        )}

        {kind === "pattern" && (
          <div className="nbk-choices" role="group" aria-label="Pattern">
            {COVER_PATTERNS.map((p) => (
              <button key={p.key} type="button" className="nbk-choice" aria-pressed={pattern === p.key} aria-label={p.label}
                onClick={() => { setPattern(p.key); emit("pattern", color, p.key); }}>
                <CoverArt cover={{ kind: "pattern", value: patternValue(p.key, color) }} />
              </button>
            ))}
          </div>
        )}

        {kind === "emoji" && (
          <div className="nbk-emojis" role="group" aria-label="Emoji">
            {COVER_EMOJIS.map((e) => (
              <button key={e} type="button" className="nbk-emoji" aria-pressed={emoji === e} aria-label={`Emoji ${e}`}
                onClick={() => { setEmoji(e); emit("emoji", color, pattern, e); }}><span aria-hidden="true">{e}</span></button>
            ))}
          </div>
        )}

        {kind === "image" && (
          <div>
            <label htmlFor={`${uid}-file`} className="btn nbk-upload">
              {busy ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Upload size={14} aria-hidden="true" />} {imagePath ? "Choose a different picture" : "Choose a picture"}
            </label>
            <input id={`${uid}-file`} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy}
              onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
            <p className="nbk-hint">JPG, PNG or WebP, up to 5 MB. Only members of this space can see it.</p>
          </div>
        )}
        {err && <p role="alert" className="nbk-err">{err}</p>}
      </div>
    </div>
  );
}
