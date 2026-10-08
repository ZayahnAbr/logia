import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { signCafeMedia } from "@/app/cafe-actions";
import { toEmbed } from "@/lib/musicEmbed";
import type { UserCafe } from "@/lib/userCafes";
import { CafeRoomView, type CafeConfig, type CafeMessage } from "../../rooms/[slug]/CafeRoom";
import { UserCafeTools } from "./UserCafeTools";

export const metadata: Metadata = { title: "Study with me · Logia" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function UserCafePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/signin");
  if (!UUID.test(id)) notFound();

  const { data, error } = await supabase.from("user_cafes").select("*").eq("id", id).maybeSingle();
  if (error && /schema cache|does not exist/i.test(error.message)) {
    return (
      <main id="main" style={{ padding: 32, maxWidth: 520, margin: "0 auto" }}>
        <div className="card" style={{ padding: 24 }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>Hosted rooms need a database update</h1>
          <p style={{ color: "var(--muted)" }}>Run supabase/migration-23-user-cafes.sql in the Supabase SQL editor, then reload.</p>
          <Link href="/discover" className="btn" style={{ marginTop: 12 }}>Back to Discover</Link>
        </div>
      </main>
    );
  }
  const cafe = data as UserCafe | null;
  // Hidden rooms are only visible to their host.
  if (!cafe || (cafe.status === "hidden" && cafe.owner_id !== user.id)) notFound();

  const [loopUrl, audioUrl] = await signCafeMedia([cafe.loop_path, cafe.music_path]);
  const embed = cafe.music_kind === "link" && cafe.music_url ? toEmbed(cafe.music_url) : null;
  const owner = cafe.owner_id === user.id;

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: msgs } = await supabase.from("cafe_messages")
    .select("id, user_id, author, author_color, author_icon, body, created_at")
    .eq("cafe_id", cafe.id).eq("hidden", false).gt("created_at", since).order("created_at", { ascending: false }).limit(60);

  const audioSrc = cafe.music_kind === "upload" ? audioUrl : null;
  const config: CafeConfig = {
    kind: "user", id: cafe.id, name: cafe.name, focus_minutes: cafe.focus_minutes, break_minutes: cafe.break_minutes, anchor: cafe.anchor,
    channel: `ucafe:${cafe.id}`,
    loop: { preset: cafe.loop_preset ?? "lofi-desk", src: cafe.loop_kind === "upload" ? loopUrl ?? undefined : undefined,
      image: cafe.loop_kind === "image" ? loopUrl ?? undefined : undefined, color: cafe.loop_kind === "color" ? cafe.bg_color ?? undefined : undefined },
    ambient: cafe.loop_kind === "preset" ? cafe.loop_preset : null,
    music: embed || audioSrc ? { embed, audioSrc } : undefined,
    backHref: "/discover?tab=rooms",
    extra: <UserCafeTools id={cafe.id} name={cafe.name} description={cafe.description} owner={owner} status={cafe.status} />,
  };

  return <CafeRoomView room={config} initialMessages={((msgs ?? []) as CafeMessage[]).reverse()} />;
}
