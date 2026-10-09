import { redirect } from "next/navigation";
import { isSceneId } from "@/lib/loopScenes";
import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { CafeRoom, type CafeMessage, type PublicRoom } from "./CafeRoom";

export const metadata: Metadata = { title: "Live room · Logia" };

export default async function CafeRoomPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/signin");

  const { data: room, error } = await supabase.from("public_rooms")
    .select("id, slug, name, scene, focus_minutes, break_minutes, anchor").eq("slug", slug).eq("is_active", true).maybeSingle();

  if (error && /schema cache|does not exist/i.test(error.message)) {
    return (
      <main id="main" style={{ padding: 32, maxWidth: 520, margin: "0 auto" }}>
        <div className="card" style={{ padding: 24 }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>Live rooms need a database update</h1>
          <p style={{ color: "var(--muted)" }}>Run supabase/migration-22-discover.sql in the Supabase SQL editor, then reload.</p>
          <Link href="/discover" className="btn" style={{ marginTop: 12 }}>Back to Discover</Link>
        </div>
      </main>
    );
  }
  // Old or unknown rooms (the retired Rainy café, Night library and so on) go back to Discover.
  if (!room || !isSceneId(room.scene)) redirect("/discover");

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: msgs } = await supabase.from("cafe_messages")
    .select("id, user_id, author, author_color, author_icon, body, created_at")
    .eq("room_id", room.id).eq("hidden", false).gt("created_at", since).order("created_at", { ascending: false }).limit(60);

  return <CafeRoom room={room as PublicRoom} initialMessages={((msgs ?? []) as CafeMessage[]).reverse()} />;
}
