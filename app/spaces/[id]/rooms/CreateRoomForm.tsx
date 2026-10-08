"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createRoom } from "@/app/room-actions";

export function CreateRoomForm({ spaceId }: { spaceId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [minutes, setMinutes] = useState(50);
  const [silent, setSilent] = useState(true);
  const [chat, setChat] = useState(true);
  const [voice, setVoice] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true); setError(null);
    const res = await createRoom(spaceId, { title, goal, silent, chat, voice, minutes });
    if ("error" in res && res.error) { setError(res.error); setPending(false); return; }
    router.push(`/spaces/${spaceId}/rooms/${res.id}`);
  };

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
      <label className="field">
        <span className="field-label">Room name</span>
        <input className="input" required maxLength={80} placeholder="e.g. Psych 2 revision" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Session goal <span className="field-hint">(optional)</span></span>
        <input className="input" maxLength={300} placeholder="e.g. Revise Lecture 6 and complete the practice questions." value={goal} onChange={(e) => setGoal(e.target.value)} />
      </label>
      <fieldset style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
        <legend className="field-label" style={{ marginBottom: 8 }}>Room format</legend>
        <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}>
          <input type="checkbox" checked={silent} onChange={(e) => setSilent(e.target.checked)} /> Silent co-study
        </label>
        <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, flexWrap: "wrap" }}>
          <input type="checkbox" checked disabled aria-describedby="timer-len" /> Shared
          <input id="timer-len" className="input" type="number" min={5} max={180} step={5} value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))} aria-label="Timer length in minutes" style={{ width: 80, height: 34 }} />
          minute timer
        </label>
        <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}>
          <input type="checkbox" checked={chat} onChange={(e) => setChat(e.target.checked)} /> Chat available
        </label>
        <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}>
          <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> Voice chat available
        </label>
      </fieldset>
      {error && <div role="alert" className="err">{error}</div>}
      <div>
        <button className="btn btn-primary" disabled={pending || !title.trim()}>
          {pending && <Loader2 size={14} className="spin" aria-hidden="true" />} Start room
        </button>
      </div>
    </form>
  );
}
