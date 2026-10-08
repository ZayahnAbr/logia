import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RoomView, type Message } from "./RoomView";
import type { Room } from "@/components/RoomProvider";

export default async function RoomPage({ params }: { params: Promise<{ id: string; roomId: string }> }) {
  const { id, roomId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [{ data: room }, { data: msgs }] = await Promise.all([
    supabase.from("study_rooms").select("*").eq("id", roomId).eq("space_id", id).maybeSingle(),
    supabase.from("room_messages").select("*").eq("room_id", roomId).order("created_at").limit(200),
  ]);
  if (!room) notFound();

  return (
    <RoomView spaceId={id} room={room as Room} initialMessages={(msgs ?? []) as Message[]} />
  );
}
