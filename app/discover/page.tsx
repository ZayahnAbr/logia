import { redirect } from "next/navigation";
import type { Metadata } from "next";
import "../workspace-layout.css";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { isAdmin } from "@/lib/server/admin";
import { DiscoverTabs, type Tab } from "./DiscoverTabs";
import type { PublicRoom } from "./rooms/[slug]/CafeRoom";
import type { Stream } from "@/app/discover-actions";
import { loadUserCafes } from "@/app/cafe-actions";

export const metadata: Metadata = { title: "Discover · Logia" };

const TABS: Tab[] = ["rooms", "streams", "spaces"];

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/signin");

  const [cafes, roomsRes, streamsRes] = await Promise.all([
    loadUserCafes(),
    supabase.from("public_rooms").select("id, slug, name, scene, focus_minutes, break_minutes, anchor").eq("is_active", true).order("created_at"),
    supabase.from("study_streams").select("id, title, channel, youtube_id, kind, is_active, sort").eq("is_active", true).order("sort").order("created_at", { ascending: false }),
  ]);
  // Tables missing means migration 22 hasn't been run yet.
  const missing = [roomsRes.error, streamsRes.error].some((e) => e && /schema cache|does not exist/i.test(e.message));

  return (
    <AppShell>
      <div className="phead mesh-warm">
        <div className="eyebrow">Discover</div>
        <h1>Study with others</h1>
        <div className="sub">Join a cozy focus room, watch a study-with-me stream, or explore public study spaces.</div>
      </div>
      {missing && (
        <div className="notice notice-error" role="status" style={{ marginBottom: 16 }}>
          Discover needs a database update. Run supabase/migration-22-discover.sql in the Supabase SQL editor, then reload.
        </div>
      )}
      <DiscoverTabs
        initialTab={TABS.includes(tab as Tab) ? (tab as Tab) : "rooms"}
        rooms={(roomsRes.data ?? []) as PublicRoom[]}
        streams={(streamsRes.data ?? []) as Stream[]}
        hosted={cafes.listed}
        mine={cafes.mine}
        admin={isAdmin(user.email)}
      />
    </AppShell>
  );
}
