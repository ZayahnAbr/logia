"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { Avatar, AVATAR_COLORS, AVATAR_ICONS, inkFor } from "@/components/Avatar";
import { useRoom } from "@/components/RoomProvider";
import { updateAvatar } from "@/app/profile-actions";
import { toast } from "@/components/Toaster";

export function AvatarPicker({ onClose }: { onClose: () => void }) {
  const { me, setMe } = useRoom();
  const [color, setColor] = useState(me?.color ?? "blush");
  const [icon, setIcon] = useState(me?.icon ?? "initials");
  const [saving, setSaving] = useState(false);
  if (!me) return null;
  const hex = AVATAR_COLORS.find((c) => c.id === color)?.hex ?? "#f6c1c7";

  const save = async () => {
    setSaving(true);
    const res = await updateAvatar(color, icon);
    setSaving(false);
    if ("error" in res && res.error) { toast(res.error, "error"); return; }
    setMe({ color, icon });
    toast("Avatar updated. Classmates see it in study rooms and chat.");
    onClose();
  };

  return (
    <Dialog title="Your avatar" onClose={onClose} width={420}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
        <Avatar name={me.name} color={color} icon={icon} size={56} />
        <div style={{ minWidth: 0 }}>
          <div className="truncate" style={{ fontWeight: 600, fontSize: 15 }}>{me.name}</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Shown in the sidebar, study rooms and chat.</div>
        </div>
      </div>

      <fieldset className="avatar-set">
        <legend className="field-label">Colour</legend>
        <div className="avatar-grid">
          {AVATAR_COLORS.map((c) => (
            <label key={c.id} className="avatar-swatch" style={{ background: c.hex }} title={c.label}>
              <input type="radio" name="avatar-color" value={c.id} checked={color === c.id} onChange={() => setColor(c.id)} className="sr-only" />
              <span className="sr-only">{c.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="avatar-set">
        <legend className="field-label">Symbol</legend>
        <div className="avatar-grid">
          {AVATAR_ICONS.map(({ id, label, Icon }) => (
            <label key={id} className="avatar-swatch avatar-symbol" title={label} style={icon === id ? { background: hex, color: inkFor(hex) } : undefined}>
              <input type="radio" name="avatar-icon" value={id} checked={icon === id} onChange={() => setIcon(id)} className="sr-only" />
              {Icon ? <Icon size={16} aria-hidden="true" /> : <span aria-hidden="true" style={{ fontSize: 12, fontWeight: 700 }}>Aa</span>}
              <span className="sr-only">{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving && <Loader2 size={14} className="spin" aria-hidden="true" />} Save avatar</button>
      </div>
    </Dialog>
  );
}
