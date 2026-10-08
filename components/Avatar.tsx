import { BookOpen, Brain, Leaf, Star, Moon, Coffee, Music, Flame, Sparkles, Atom, PenLine, Sun, type LucideIcon } from "lucide-react";

// Shared avatar: colour swatch + initials or a symbol. Used in the sidebar, study rooms and chat.
export const AVATAR_COLORS: { id: string; label: string; hex: string }[] = [
  { id: "coral", label: "Coral", hex: "#f2836b" },
  { id: "blush", label: "Blush", hex: "#f6c1c7" },
  { id: "peach", label: "Peach", hex: "#fbd3b0" },
  { id: "amber", label: "Amber", hex: "#f2b84b" },
  { id: "sage", label: "Sage", hex: "#a9c6a2" },
  { id: "teal", label: "Teal", hex: "#3f8f8a" },
  { id: "sky", label: "Sky", hex: "#9cc3e6" },
  { id: "lavender", label: "Lavender", hex: "#c6b8ea" },
  { id: "plum", label: "Plum", hex: "#7d4b7a" },
  { id: "charcoal", label: "Charcoal", hex: "#2b2b30" },
];

export const AVATAR_ICONS: { id: string; label: string; Icon: LucideIcon | null }[] = [
  { id: "initials", label: "Initials", Icon: null },
  { id: "book", label: "Book", Icon: BookOpen },
  { id: "brain", label: "Brain", Icon: Brain },
  { id: "pen", label: "Pen", Icon: PenLine },
  { id: "atom", label: "Atom", Icon: Atom },
  { id: "leaf", label: "Leaf", Icon: Leaf },
  { id: "star", label: "Star", Icon: Star },
  { id: "sun", label: "Sun", Icon: Sun },
  { id: "moon", label: "Moon", Icon: Moon },
  { id: "coffee", label: "Coffee", Icon: Coffee },
  { id: "music", label: "Music", Icon: Music },
  { id: "flame", label: "Flame", Icon: Flame },
  { id: "sparkles", label: "Sparkles", Icon: Sparkles },
];

const hexFor = (color?: string | null) => AVATAR_COLORS.find((c) => c.id === color)?.hex ?? AVATAR_COLORS[1].hex;

// Dark text on light swatches, white on dark — keeps initials/icons at AA contrast.
export function inkFor(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.32 ? "#1a1a1a" : "#ffffff";
}

export const initialsOf = (name: string) => name.trim().split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase() || "?";

export function Avatar({ name, color, icon, size = 32, ring = false, title }: {
  name: string; color?: string | null; icon?: string | null; size?: number; ring?: boolean; title?: string;
}) {
  const bg = hexFor(color);
  const ink = inkFor(bg);
  const Icon = AVATAR_ICONS.find((i) => i.id === icon)?.Icon ?? null;
  return (
    <span aria-hidden="true" title={title} style={{
      width: size, height: size, borderRadius: Math.round(size * 0.32), background: bg, color: ink, flexShrink: 0,
      display: "grid", placeItems: "center", fontSize: Math.round(size * 0.38), fontWeight: 700, letterSpacing: "-.01em",
      boxShadow: ring ? "0 0 0 2px #fff" : undefined,
    }}>
      {Icon ? <Icon size={Math.round(size * 0.5)} strokeWidth={2.2} /> : initialsOf(name)}
    </span>
  );
}
