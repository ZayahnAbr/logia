"use client";

import { useState } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { useRoom } from "@/components/RoomProvider";
import { Avatar } from "@/components/Avatar";
import { AvatarPicker } from "@/components/AvatarPicker";

// The signed-in user's avatar, name and email. Click the avatar to restyle it.
export function SidebarUser() {
  const { me } = useRoom();
  const [picking, setPicking] = useState(false);

  return (
    <div className="sidebar-user">
      <button type="button" className="sidebar-avatar-btn" onClick={() => setPicking(true)} disabled={!me} aria-label="Change your avatar">
        {me ? <Avatar name={me.name} color={me.color} icon={me.icon} size={32} /> : <span className="sidebar-avatar" />}
        <span className="sidebar-avatar-edit" aria-hidden="true"><Pencil size={9} /></span>
      </button>
      <Link href="/spaces/settings" style={{ minWidth: 0, flex: 1, textDecoration: "none", color: "inherit" }} aria-label="Account settings">
        {/* Reserved heights so the footer doesn't jump when the name loads */}
        <span className="truncate" style={{ display: "block", fontSize: 13, fontWeight: 600, minHeight: 18 }}>{me?.name ?? ""}</span>
        <span className="truncate" style={{ display: "block", fontSize: 12, color: "var(--faint)", minHeight: 16 }}>{me?.email ?? ""}</span>
      </Link>
      {picking && <AvatarPicker onClose={() => setPicking(false)} />}
    </div>
  );
}
