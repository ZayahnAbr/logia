"use client";

import { Headphones, Mic, MicOff, PhoneOff, Loader2 } from "lucide-react";
import { useRoom } from "@/components/RoomProvider";

// Join / mute / leave voice. Shared by the room page and the floating dock.
export function VoiceControls({ size = "md" }: { size?: "sm" | "md" }) {
  const { room, voice, people } = useRoom();
  if (!room || room.voice_enabled === false) return null;
  const sm = size === "sm" ? " btn-sm" : "";
  const inVoice = people.filter((p) => p.voice).length;

  if (!voice.joined) {
    return (
      <button className={`btn${sm}`} onClick={voice.join} disabled={voice.connecting}>
        {voice.connecting ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Headphones size={14} aria-hidden="true" />}
        Join voice{inVoice > 0 ? ` (${inVoice})` : ""}
      </button>
    );
  }
  return (
    <span style={{ display: "inline-flex", gap: 6 }}>
      <button className={`btn${sm}${voice.muted ? "" : " btn-primary"}`} onClick={voice.toggleMute} aria-pressed={voice.muted}
        aria-label={voice.muted ? "Unmute microphone" : "Mute microphone"}>
        {voice.muted ? <MicOff size={14} aria-hidden="true" /> : <Mic size={14} aria-hidden="true" />}
        {size === "md" && (voice.muted ? "Muted" : "Mic on")}
      </button>
      <button className={`btn btn-ghost${sm}`} onClick={voice.leave} aria-label="Leave voice">
        <PhoneOff size={14} aria-hidden="true" />{size === "md" && " Leave voice"}
      </button>
    </span>
  );
}
