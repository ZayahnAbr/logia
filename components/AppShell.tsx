"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Users,
  BarChart3,
  BookOpen,
  Calculator,
  CalendarDays,
  Layers,
  Library,
  Compass,
  FileText,
  Files,
  FileQuestion,
  Flame,
  ScanLine,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Mic,
  Settings,
  Sigma,
  SquareRadical,
  Timer,
  Workflow,
  X,
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";
import { OnboardingTour } from "@/components/OnboardingTour";
import { FocusTimer } from "@/components/FocusTimer";
import { SidebarUser } from "@/components/SidebarUser";
import { SidebarUsage } from "@/components/SidebarUsage";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SpaceSwitcher } from "@/components/SpaceSwitcher";
import { LogoMark } from "@/components/LogoMark";

type NavItem = { label: string; icon: LucideIcon; href: string };

type NavGroup = { label?: string; items: (NavItem & { tour?: string })[] };

// Space tools grouped by what the student is doing. Names match each page's heading.
function getSpaceNav(spaceId: string): NavGroup[] {
  const h = (p = "") => `/spaces/${spaceId}${p}`;
  return [
    { items: [{ label: "Space home", icon: BookOpen, href: h(), tour: "overview" }] },
    { label: "Learn", items: [
      { label: "Notes", icon: FileText, href: h("/notes"), tour: "notes" },
      { label: "Files", icon: Files, href: h("/files") },
      { label: "Lectures", icon: Mic, href: h("/lectures") },
      { label: "Scan", icon: ScanLine, href: h("/scan") },
      { label: "Ask Logia", icon: MessageSquare, href: h("/chat"), tour: "chat" },
    ] },
    { label: "Practise", items: [
      { label: "Flashcards", icon: Layers, href: h("/decks"), tour: "flashcards" },
      { label: "Past papers", icon: FileQuestion, href: h("/papers"), tour: "papers" },
      { label: "Pain points", icon: Flame, href: h("/pain-points") },
      { label: "Solver", icon: Sigma, href: h("/solver"), tour: "solver" },
    ] },
    { label: "Organise", items: [
      { label: "Course and marks", icon: Calculator, href: h("/course") },
      { label: "Mind maps", icon: Workflow, href: h("/maps"), tour: "maps" },
      { label: "Formula sheet", icon: SquareRadical, href: h("/formulas") },
    ] },
    { label: "Together", items: [
      { label: "Study rooms", icon: Users, href: h("/rooms"), tour: "rooms" },
    ] },
    { items: [{ label: "Progress", icon: BarChart3, href: h("/analytics") }] },
  ];
}

// Desktop sidebar visibility, remembered per device.
function setSidebar(show: boolean) {
  document.documentElement.dataset.sidebar = show ? "shown" : "hidden";
  try { localStorage.setItem("logia.sidebar", show ? "shown" : "hidden"); } catch { /* storage blocked */ }
}

function NavLink({ item, onClick }: { item: NavItem & { tour?: string }; onClick?: () => void }) {
  const pathname = usePathname();
  const isActive =
    item.href === `/spaces/${item.href.split("/")[2]}`
      ? pathname === item.href
      : pathname.startsWith(item.href);

  return (
    <Link
      href={item.href}
      onClick={onClick}
      data-tour={item.tour}
      className={`sidebar-nav-item${isActive ? " active" : ""}`}
    >
      <item.icon size={15} strokeWidth={1.75} style={{ flexShrink: 0 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {item.label}
      </span>
    </Link>
  );
}

function Sidebar({
  spaceId,
  spaceName,
  onClose,
  onFocusClick,
}: {
  spaceId?: string;
  spaceName?: string;
  onClose?: () => void;
  onFocusClick?: () => void;
}) {
  const pathname = usePathname();
  const space = spaceId ? { id: spaceId, name: spaceName ?? "Space" } : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "20px 16px", background: "var(--sidebar-bg)" }}>
      {/* Logo */}
      <Link href="/spaces" onClick={onClose}
        style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 700, fontSize: 16, letterSpacing: "-.02em", color: "inherit", textDecoration: "none", padding: "0 8px" }}>
        <LogoMark size={28} />
        logia
      </Link>
      <button type="button" className="sidebar-hide btn btn-ghost btn-icon btn-sm" onClick={() => setSidebar(false)} aria-label="Hide sidebar" title="Hide sidebar (Ctrl+\)">
        <PanelLeftClose size={16} aria-hidden="true" />
      </button>

      <nav aria-label="Main" style={{ flex: 1, overflowY: "auto", marginTop: 24, display: "flex", flexDirection: "column", gap: 20 }}>
        {/* General — identical on every page */}
        <div className="sidebar-nav-list">
          <Link href="/spaces" onClick={onClose} data-tour="all-spaces"
            className={`sidebar-nav-item${pathname === "/spaces" ? " active" : ""}`} aria-current={pathname === "/spaces" ? "page" : undefined}>
            <LayoutDashboard size={15} strokeWidth={1.75} style={{ flexShrink: 0 }} aria-hidden="true" />
            <span>Dashboard</span>
          </Link>
          <Link href="/library" onClick={onClose} data-tour="library"
            className={`sidebar-nav-item${pathname.startsWith("/library") ? " active" : ""}`} aria-current={pathname.startsWith("/library") ? "page" : undefined}>
            <Library size={15} strokeWidth={1.75} style={{ flexShrink: 0 }} aria-hidden="true" />
            <span>Library</span>
          </Link>
          <Link href="/discover" onClick={onClose} data-tour="discover"
            className={`sidebar-nav-item${pathname.startsWith("/discover") ? " active" : ""}`} aria-current={pathname.startsWith("/discover") ? "page" : undefined}>
            <Compass size={15} strokeWidth={1.75} style={{ flexShrink: 0 }} aria-hidden="true" />
            <span>Discover</span>
          </Link>
          <Link href="/timetable" onClick={onClose} data-tour="timetable"
            className={`sidebar-nav-item${pathname.startsWith("/timetable") ? " active" : ""}`} aria-current={pathname.startsWith("/timetable") ? "page" : undefined}>
            <CalendarDays size={15} strokeWidth={1.75} style={{ flexShrink: 0 }} aria-hidden="true" />
            <span>Timetable</span>
          </Link>
          <button type="button" className="sidebar-nav-item" data-tour="focus" onClick={() => { onFocusClick?.(); onClose?.(); }}>
            <Timer size={15} strokeWidth={1.75} style={{ flexShrink: 0 }} aria-hidden="true" />
            <span>Focus timer</span>
          </button>
        </div>

        {/* Space — always shown: current space, or the last one you visited */}
        <div>
          <div className="sidebar-section-label">Space</div>
          <SpaceSwitcher currentId={space?.id} currentName={space?.name} onNavigate={onClose} />
          {getSpaceNav(space?.id ?? "").map((group, gi) => (
            <div key={gi} style={{ marginTop: group.label ? 12 : 8 }}>
              {group.label && <div className="sidebar-subgroup-label" id={`navgroup-${gi}`}>{group.label}</div>}
              <div className="sidebar-nav-list" role={group.label ? "group" : undefined} aria-labelledby={group.label ? `navgroup-${gi}` : undefined}>
                {group.items.map((item) => space
                  ? <NavLink key={item.label} item={item} onClick={onClose} />
                  : (
                    // Same items, shown but inert until a space is chosen (keeps the sidebar's shape).
                    <span key={item.label} className="sidebar-nav-item is-disabled" aria-disabled="true" title="Choose a space first">
                      <item.icon size={15} strokeWidth={1.75} style={{ flexShrink: 0 }} aria-hidden="true" />
                      <span>{item.label}</span>
                    </span>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </nav>

      {/* Footer — identical on every page */}
      <div className="sidebar-nav-list" style={{ paddingTop: 12, marginTop: 12, boxShadow: "0 -1px 0 var(--sidebar-border)" }}>
        <ThemeToggle />
        <Link href="/spaces/settings" data-tour="settings" onClick={onClose}
          className={`sidebar-nav-item${pathname.startsWith("/spaces/settings") ? " active" : ""}`} aria-current={pathname.startsWith("/spaces/settings") ? "page" : undefined}>
          <Settings size={15} strokeWidth={1.75} style={{ flexShrink: 0 }} aria-hidden="true" />
          <span>Settings</span>
        </Link>
      </div>
      <SidebarUsage />
      <SidebarUser />
    </div>
  );
}

// Persistent bottom tab bar for phones: the four pages students reach for constantly, plus a
// "Menu" tab that opens the same drawer as before for everything else (space tools, settings).
const TABS: { label: string; icon: LucideIcon; href: string }[] = [
  { label: "Home", icon: LayoutDashboard, href: "/spaces" },
  { label: "Library", icon: Library, href: "/library" },
  { label: "Discover", icon: Compass, href: "/discover" },
  { label: "Timetable", icon: CalendarDays, href: "/timetable" },
];

function MobileTabBar({ onMenu, menuOpen }: { onMenu: () => void; menuOpen: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="app-tabbar">
      {TABS.map((t) => {
        const active = t.href === "/spaces" ? pathname === "/spaces" : pathname.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={`app-tab${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
            <t.icon size={20} strokeWidth={active ? 2.1 : 1.75} aria-hidden="true" />
            <span>{t.label}</span>
          </Link>
        );
      })}
      <button type="button" className={`app-tab${menuOpen ? " active" : ""}`} onClick={onMenu} aria-expanded={menuOpen} aria-label="More">
        <MoreHorizontal size={20} strokeWidth={menuOpen ? 2.1 : 1.75} aria-hidden="true" />
        <span>Menu</span>
      </button>
    </nav>
  );
}

export function AppShell({
  children,
  spaceId,
  spaceName,
  showTour,
  askPersona,
}: {
  children: ReactNode;
  spaceId?: string;
  spaceName?: string;
  showTour?: boolean;
  askPersona?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);

  // Ctrl/Cmd + \ toggles the sidebar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "\\") { e.preventDefault(); setSidebar(document.documentElement.dataset.sidebar === "hidden"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg)" }}>
      {showTour && <OnboardingTour show={showTour} askPersona={askPersona} />}
      {focusOpen && <FocusTimer spaceId={spaceId} onClose={() => setFocusOpen(false)} />}

      {/* ── Desktop sidebar ── */}
      <aside
        style={{
          position: "fixed", inset: "0 auto 0 0",
          width: "var(--sidebar-w)",
          borderRight: "1px solid var(--sidebar-border)",
          zIndex: 30,
          display: "none",    // overridden by the media-query class below
        }}
        className="app-sidebar-desktop"
      >
        <Sidebar spaceId={spaceId} spaceName={spaceName} onFocusClick={() => setFocusOpen(true)} />
      </aside>

      {/* ── Mobile overlay ── */}
      {open && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 39, background: "rgba(17,17,17,.25)" }}
          onClick={() => setOpen(false)}
        />
      )}

      {/* ── Mobile sidebar drawer (above the tab bar's z-index 41, so it isn't clipped at the bottom) ── */}
      <aside
        style={{
          position: "fixed", inset: "0 auto 0 0",
          width: 272,
          borderRight: "1px solid var(--sidebar-border)",
          zIndex: 42,
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition: "transform .25s cubic-bezier(.2,.8,.2,1)",
          display: "block",
        }}
        className="app-sidebar-mobile"
      >
        <Sidebar spaceId={spaceId} spaceName={spaceName} onClose={() => setOpen(false)} onFocusClick={() => setFocusOpen(true)} />
      </aside>

      {/* ── Content ── */}
      <div
        style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}
        className="app-content-area"
      >
        {/* Mobile topbar */}
        <header
          className="app-mobile-header"
          style={{
            display: "none",
            alignItems: "center", gap: 12,
            padding: "12px 16px",
            borderBottom: "1px solid var(--border-soft)",
            background: "var(--surface)",
            position: "sticky", top: 0, zIndex: 20,
          }}
        >
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="btn btn-ghost"
            style={{ width: 36, height: 36, padding: 0, flexShrink: 0 }}
            aria-label="Toggle navigation"
          >
            {open ? <X size={16} /> : <Menu size={16} />}
          </button>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-.02em" }}>
            logia
          </span>
        </header>

        <button type="button" className="sidebar-show btn btn-icon" onClick={() => setSidebar(true)} aria-label="Show sidebar" title="Show sidebar (Ctrl+\)">
          <PanelLeftOpen size={16} aria-hidden="true" />
        </button>

        {/* Page content */}
        <main id="main"
          style={{
            flex: 1, padding: "40px 32px 80px",
            maxWidth: "var(--page-max)", width: "100%", margin: "0 auto", boxSizing: "border-box",
          }}
          className="app-page-main"
        >
          <div key={pathname} className="page-enter">{children}</div>
        </main>
      </div>

      {/* ── Mobile bottom tab bar: the primary way to move around on a phone ── */}
      <MobileTabBar onMenu={() => setOpen((o) => !o)} menuOpen={open} />

      {/* Responsive styles injected inline so no extra CSS file needed */}
      <style>{`
        @media (min-width: 1024px) {
          .app-sidebar-desktop { display: block !important; }
          .app-sidebar-mobile { display: none !important; }
          .app-content-area { padding-left: var(--sidebar-w); }
          .app-mobile-header { display: none !important; }
          .app-tabbar { display: none !important; }
          html[data-sidebar="hidden"] .app-sidebar-desktop { display: none !important; }
          html[data-sidebar="hidden"] .app-content-area { padding-left: 0; }
          html[data-sidebar="hidden"] .app-page-main { margin: 0 auto; }
          html[data-sidebar="hidden"] .sidebar-show { display: grid !important; }
        }
        @media (max-width: 1023px) {
          .app-sidebar-desktop { display: none !important; }
          .app-mobile-header { display: flex !important; }
          .app-page-main { padding: 16px 16px calc(78px + env(safe-area-inset-bottom, 0px)) !important; }
          .app-tabbar {
            display: flex; position: fixed; inset: auto 0 0 0; z-index: 41;
            padding: 6px 4px calc(6px + env(safe-area-inset-bottom, 0px));
            background: var(--surface); border-top: 1px solid var(--border-soft);
            box-shadow: 0 -2px 10px rgba(0,0,0,.05);
          }
          .app-tab {
            flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 3px; padding: 6px 2px; border: 0; background: none; color: var(--muted);
            font-size: 10.5px; font-weight: 500; text-decoration: none; cursor: pointer; border-radius: 10px;
          }
          .app-tab span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .app-tab.active { color: var(--accent-text); }
          .app-tab:active { background: var(--hover, var(--surface-2)); }
        }
      `}</style>
    </div>
  );
}