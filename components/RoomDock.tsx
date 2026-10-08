"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, ChevronDown, LogOut, ArrowUpRight, MicOff } from "lucide-react";
import { useRoom } from "@/components/RoomProvider";
import { Avatar } from "@/components/Avatar";
import { RoomChat } from "@/components/RoomChat";
import { VoiceControls } from "@/components/VoiceControls";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// Floating mini-room shown on every page except the room itself, so chat and voice follow you.
export function RoomDock() {
  const { room, people, unread, remaining, leave } = useRoom();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  if (!room) return null;
  const href = `/spaces/${room.space_id}/rooms/${room.id}`;
  if (pathname === href) return null;
  const running = !!room.timer_started_at && remaining > 0;

  return (
    <aside className="room-dock" aria-label={`Study room: ${room.title}`}>
      <div className="room-dock-bar">
        <span style={{ display: "flex" }}>
          {people.slice(0, 4).map((p, i) => (
            <span key={p.id} style={{ marginLeft: i ? -8 : 0, position: "relative" }}>
              <Avatar name={p.name} color={p.color} icon={p.icon} size={28} ring title={p.name} />
              {p.voice && p.muted && <MicOff size={10} aria-hidden="true" className="room-dock-muted" />}
            </span>
          ))}
        </span>
        <Link href={href} style={{ minWidth: 0, flex: 1 }} title="Open room">
          <span className="truncate" style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{room.title}</span>
          <span style={{ display: "block", fontSize: 12, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
            <span className="live-dot" aria-hidden="true" /> {people.length} studying{running ? ` · ${fmt(remaining)} left` : ""}
          </span>
        </Link>
        <VoiceControls size="sm" />
        {room.chat_enabled && (
          <button className="btn btn-sm btn-ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="dock-chat"
            aria-label={open ? "Hide chat" : unread ? `Show chat, ${unread} new` : "Show chat"} style={{ position: "relative" }}>
            {open ? <ChevronDown size={15} aria-hidden="true" /> : <MessageSquare size={15} aria-hidden="true" />}
            {!open && unread > 0 && <span className="room-dock-unread" aria-hidden="true">{unread}</span>}
          </button>
        )}
        <Link href={href} className="btn btn-sm btn-ghost" aria-label="Open room page"><ArrowUpRight size={15} aria-hidden="true" /></Link>
        <button className="btn btn-sm btn-ghost" onClick={leave} aria-label="Leave room"><LogOut size={15} aria-hidden="true" /></button>
      </div>
      {open && room.chat_enabled && <div id="dock-chat" className="room-dock-chat"><RoomChat compact /></div>}
    </aside>
  );
}
