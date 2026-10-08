"use client";

import { useState } from "react";
import { useRoom } from "@/components/RoomProvider";
import { Avatar } from "@/components/Avatar";
import { AvatarPicker } from "@/components/AvatarPicker";
import { setTheme, useTheme } from "@/components/ThemeToggle";
import { Moon, Sun } from "lucide-react";

export function ProfileRow({ email }: { email: string }) {
  const { me } = useRoom();
  const [open, setOpen] = useState(false);
  return (
    <div className="st-profile">
      {me ? <Avatar name={me.name} color={me.color} icon={me.icon} size={56} /> : <span className="st-av-blank" />}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="truncate" style={{ fontSize: 17, fontWeight: 700 }}>{me?.name ?? "…"}</div>
        <div className="truncate" style={{ fontSize: 13.5, color: "var(--muted)" }}>{email}</div>
      </div>
      <button type="button" className="btn" onClick={() => setOpen(true)} disabled={!me}>Edit avatar</button>
      {open && <AvatarPicker onClose={() => setOpen(false)} />}
    </div>
  );
}

export function ThemeSwitch() {
  const theme = useTheme();
  return (
    <div className="st-seg" role="radiogroup" aria-label="Theme">
      {(["light", "dark"] as const).map((t) => (
        <button key={t} type="button" role="radio" aria-checked={theme === t} className={theme === t ? "on" : ""} onClick={() => setTheme(t)}>
          {t === "light" ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />} {t === "light" ? "Light" : "Dark"}
        </button>
      ))}
    </div>
  );
}
