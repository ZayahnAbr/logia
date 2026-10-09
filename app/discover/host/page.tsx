import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { signCafeMedia } from "@/app/cafe-actions";
import type { UserCafe } from "@/lib/userCafes";
import { HostForm, type HostInitial } from "./HostForm";

export const metadata: Metadata = { title: "Host a study-with-me · Logia" };

export default async function HostPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/signin");

  let initial: HostInitial | undefined;
  if (edit) {
    const { data } = await supabase.from("user_cafes").select("*").eq("id", edit).eq("owner_id", user.id).maybeSingle();
    if (!data) redirect("/discover/host");
    const c = data as UserCafe;
    const [loopUrl, audioUrl, coverUrl] = await signCafeMedia([c.loop_path, c.music_path, c.cover_path ?? null]);
    initial = {
      id: c.id, name: c.name, description: c.description, loopKind: c.loop_kind, preset: c.loop_preset ?? "rain-roof", loopPath: c.loop_path, loopUrl, bgColor: c.bg_color,
      musicKind: c.music_kind, musicUrl: c.music_url ?? "", musicPath: c.music_path, audioUrl,
      focus: c.focus_minutes, brk: c.break_minutes, listing: c.status === "pending" ? "pending" : "unlisted",
      coverPath: c.cover_path ?? null, coverUrl, coverDoc: c.cover_doc ?? null,
    };
  }

  return (
    <AppShell>
      <div className="phead mesh-warm">
        <div className="eyebrow">Discover</div>
        <h1>{initial ? "Edit your room" : "Host a study-with-me"}</h1>
        <div className="sub">Set the scene, the music and the timer, then invite people to focus alongside you.</div>
      </div>
      <Link href="/discover?tab=streams" className="btn btn-sm" style={{ marginBottom: 16 }}><ArrowLeft size={14} aria-hidden="true" /> Back to Discover</Link>
      <HostForm uid={user.id} initial={initial} />
    </AppShell>
  );
}
