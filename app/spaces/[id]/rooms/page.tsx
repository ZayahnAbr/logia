import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSpace } from "@/lib/queries";
import { CreateRoomForm } from "./CreateRoomForm";
import "../../../workspace-layout.css";
import { Users, Timer, MessageSquare, VolumeX, Headphones } from "lucide-react";

export type RoomRow = {
  id: string; title: string; goal: string | null; silent: boolean; chat_enabled: boolean;
  voice_enabled?: boolean; timer_minutes: number; timer_started_at: string | null; created_at: string; ended_at: string | null;
};

export default async function RoomsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [space, { data, error }] = await Promise.all([
    getSpace(id),
    supabase.from("study_rooms").select("*").eq("space_id", id).is("ended_at", null).order("created_at", { ascending: false }),
  ]);
  const rooms = (data ?? []) as RoomRow[];

  return (
    <div className="wk-rooms">
      <div className="phead phead-grad">
        <div className="eyebrow">{space?.name}</div>
        <h1>Study rooms</h1>
        <div className="sub">Study with classmates in this space, on one shared timer.</div>
      </div>

      {error ? (
        <div className="notice-warning card" style={{ padding: 18 }}>
          Study rooms need a one-time database update. Run <span className="mono">supabase/migration-12-study-rooms.sql</span> and <span className="mono">migration-13-avatars-voice.sql</span> in the Supabase SQL editor, then reload.
        </div>
      ) : (
        <div className="wk-lobby">
          <section aria-labelledby="new-room" className="card wk-hero">
            <div className="wk-hero-copy">
              <h2 id="new-room" className="wk-h2" style={{ fontSize: 20 }}>Start a study room</h2>
              <p>Set a goal and a timer, then share the space&apos;s invite code so classmates can join you.</p>
              <ul className="wk-feats">
                <li><Timer size={16} aria-hidden="true" /><span><strong>Shared timer</strong> Everyone sees the same countdown.</span></li>
                <li><Users size={16} aria-hidden="true" /><span><strong>One goal</strong> Say what you will finish before you begin.</span></li>
                <li><MessageSquare size={16} aria-hidden="true" /><span><strong>Chat and voice</strong> Optional, or keep it silent co-study.</span></li>
              </ul>
            </div>
            <div className="wk-hero-form"><CreateRoomForm spaceId={id} /></div>
          </section>

          <section aria-labelledby="open-rooms">
            <h2 id="open-rooms" className="wk-h2">Open rooms <span className="wk-count">{rooms.length}</span></h2>
            {rooms.length === 0 ? (
              <div className="wk-empty">
                <strong>No rooms open right now</strong>
                <p>A room is a shared study session for this space. Start one above and it appears here for everyone in the space.</p>
              </div>
            ) : (
              <ul className="wk-room-grid">
                {rooms.map((r) => {
                  // eslint-disable-next-line react-hooks/purity
                  const live = !!r.timer_started_at && Date.now() < new Date(r.timer_started_at).getTime() + r.timer_minutes * 60000;
                  return (
                    <li key={r.id}>
                      <Link href={`/spaces/${id}/rooms/${r.id}`} className="card-i wk-room-card">
                        <span className="wk-room-top">
                          <span aria-hidden="true" className="wk-room-ico"><Users size={16} /></span>
                          <span className={`wk-room-state${live ? " is-live" : ""}`}>{live && <span className="live-dot" aria-hidden="true" />}{live ? "Session running" : "Ready to start"}</span>
                        </span>
                        <span className="truncate wk-room-title">{r.title}</span>
                        <span className="wk-room-goal">{r.goal || "No goal set. Join and agree one together."}</span>
                        <span className="wk-room-tags">
                          {r.silent && <span title="Silent co-study"><VolumeX size={13} aria-hidden="true" /> Silent</span>}
                          <span><Timer size={13} aria-hidden="true" /> {r.timer_minutes} min</span>
                          {r.voice_enabled !== false && <span title="Voice available"><Headphones size={13} aria-hidden="true" /> Voice</span>}
                          {r.chat_enabled && <span title="Chat available"><MessageSquare size={13} aria-hidden="true" /> Chat</span>}
                        </span>
                        <span className="wk-room-join">Join room</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
