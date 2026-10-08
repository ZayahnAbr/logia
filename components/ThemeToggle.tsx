"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

// Light / dark theme, stored on this device and applied before paint by the script in layout.tsx.
export function setTheme(t: "light" | "dark") {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("logia.theme", t); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event("logia:theme"));
}

export function useTheme() {
  const [theme, set] = useState<"light" | "dark">("light");
  useEffect(() => {
    const read = () => set(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    read();
    window.addEventListener("logia:theme", read);
    return () => window.removeEventListener("logia:theme", read);
  }, []);
  return theme;
}

export function ThemeToggle({ className = "sidebar-nav-item" }: { className?: string }) {
  const theme = useTheme();
  const dark = theme === "dark";
  return (
    <button type="button" className={className} onClick={() => setTheme(dark ? "light" : "dark")} aria-pressed={dark}>
      {dark ? <Sun size={15} strokeWidth={1.75} aria-hidden="true" /> : <Moon size={15} strokeWidth={1.75} aria-hidden="true" />}
      <span>{dark ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}
