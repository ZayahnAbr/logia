"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Plus, Settings2 } from "lucide-react";
import type { UserCafeCard } from "@/lib/userCafes";
import type { PublicRoom } from "./rooms/[slug]/CafeRoom";
import type { Stream } from "@/app/discover-actions";
import { RoomsTab } from "./RoomsTab";
import { StreamsTab } from "./StreamsTab";
import { SpacesTab } from "./SpacesTab";

export type Tab = "rooms" | "streams" | "spaces";
const TABS: { id: Tab; label: string }[] = [
  { id: "rooms", label: "Live rooms" },
  { id: "spaces", label: "Public spaces" },
];

export function DiscoverTabs({ initialTab, rooms, streams, hosted, mine, admin }: { initialTab: Tab; rooms: PublicRoom[]; streams: Stream[]; hosted: UserCafeCard[]; mine: UserCafeCard[]; admin: boolean }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const choose = (t: Tab) => {
    setTab(t);
    // Keep the tab in the URL without a server round trip.
    window.history.replaceState(null, "", `/discover?tab=${t}`);
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const to = e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : step ? (i + step + TABS.length) % TABS.length : -1;
    if (to < 0) return;
    e.preventDefault();
    choose(TABS[to].id);
    refs.current[TABS[to].id]?.focus();
  };

  return (
    <div>
      <div className="dc-tabbar">
        <div role="tablist" aria-label="Discover" className="dc-tabs">
          {TABS.map((t, i) => (
            <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1} className="dc-tab" onClick={() => choose(t.id)} onKeyDown={(e) => onKey(e, i)}>{t.label}</button>
          ))}
        </div>
        <div className="dc-bar-actions">
          {tab === "rooms" && <Link href="/discover/host" className="btn btn-primary btn-sm"><Plus size={14} aria-hidden="true" /> Create your own room</Link>}
        {admin && <Link href="/discover/admin" className="btn btn-sm"><Settings2 size={14} aria-hidden="true" /> Manage</Link>}
        </div>
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0} className="dc-panel">
        {tab === "rooms" && <RoomsTab rooms={rooms} hosted={hosted} mine={mine} />}
        {tab === "streams" && <StreamsTab streams={streams} />}
        {tab === "spaces" && <SpacesTab />}
      </div>
    </div>
  );
}
