"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, Check, X, Loader2 } from "lucide-react";

// Shows a title with a pencil button. Click → inline input; Enter saves, Escape cancels.
// `onRename` returns { error } on failure; the old title is restored and the error shown.
export function RenameableTitle({
  value, onRename, label = "item", className, style,
}: {
  value: string;
  onRename: (next: string) => Promise<{ error?: string } | void>;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Grow with the text so the whole name is always visible while renaming.
  const fit = () => { const el = inputRef.current; if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; } };

  useEffect(() => { setShown(value); }, [value]);
  useEffect(() => { if (editing) { fit(); inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);

  const cancel = () => { setDraft(shown); setEditing(false); setError(null); };
  const save = async () => {
    const next = draft.trim();
    if (!next) { setError("The name can't be empty."); return; }
    if (next === shown) { setEditing(false); return; }
    setSaving(true); setError(null);
    const prev = shown;
    setShown(next); // optimistic
    const res = await onRename(next);
    setSaving(false);
    if (res && "error" in res && res.error) { setShown(prev); setDraft(prev); setError(res.error); return; }
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="rename-box" style={{ position: "relative", zIndex: 3, display: "flex", flexDirection: "column", gap: 4, flex: 1 }}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 4 }}>
          <label className="sr-only" htmlFor={`rename-${label}`}>New name for {label}</label>
          <textarea id={`rename-${label}`} ref={inputRef} className="input rename-input" value={draft} maxLength={200} aria-invalid={!!error} rows={1}
            onChange={(e) => { setDraft(e.target.value.replace(/\n/g, " ")); fit(); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") { e.preventDefault(); cancel(); } }} />
          <button type="button" className="btn btn-primary btn-icon btn-sm" aria-label="Save name" onClick={save} disabled={saving}>
            {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
          </button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Cancel renaming" onClick={cancel} disabled={saving}>
            <X size={14} />
          </button>
        </div>
        {error && <span role="alert" className="field-error">{error}</span>}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, flex: 1 }}>
      <span className={className ?? "truncate"} title={shown} style={style}>{shown}</span>
      <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Rename ${label} "${shown}"`} title="Rename"
        style={{ position: "relative", zIndex: 3, flexShrink: 0 }}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDraft(shown); setEditing(true); }}>
        <Pencil size={13} />
      </button>
      {error && <span role="alert" className="field-error">{error}</span>}
    </div>
  );
}
