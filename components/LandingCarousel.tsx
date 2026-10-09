"use client";

import { useState } from "react";
import Link from "next/link";
import { ThemeColors } from "./GradientBackground";
import { LogoMark } from "@/components/LogoMark";

export interface ThemeOption {
  id: string;
  name: string;
  colors: [string, string];
  accent: string;
  palette: ThemeColors;
}

export const THEMES: ThemeOption[] = [
  {
    id: "dusty-pink",
    name: "Dusty Pink",
    colors: ["#c98a9e", "#a75d7b"],
    accent: "#a75d7b",
    palette: {
      bg: "#9c6274",
      a1: "#c98a92", a2: "#cf9aa4", a3: "#d1a08f",
      b1: "#d8b3a8", b2: "#cf9a8f", b3: "#cbb0b8",
      c1: "#cf9aa4", c2: "#c98a92",
    },
  },
  {
    id: "lavender",
    name: "Lavender",
    colors: ["#e0d7f5", "#b39ddb"],
    accent: "#8e7cc3",
    palette: {
      bg: "#6b5b95",
      a1: "#b39ddb", a2: "#c8b6e2", a3: "#e0d7f5",
      b1: "#d1c4e9", b2: "#b39ddb", b3: "#9575cd",
      c1: "#c8b6e2", c2: "#b39ddb",
    },
  },
  {
    id: "coral",
    name: "Coral",
    colors: ["#ff8a65", "#f4511e"],
    accent: "#c95835",
    palette: {
      bg: "#a33e2b",
      a1: "#ff8a65", a2: "#ffab91", a3: "#ff7043",
      b1: "#ffccbc", b2: "#ff8a65", b3: "#f4511e",
      c1: "#ffab91", c2: "#ff8a65",
    },
  },
  {
    id: "grey",
    name: "Slate Grey",
    colors: ["#9aa0a8", "#5b616b"],
    accent: "#5b616b",
    palette: {
      bg: "#323740",
      a1: "#5b616b", a2: "#787e87", a3: "#9aa0a8",
      b1: "#818791", b2: "#686e78", b3: "#4d535c",
      c1: "#787e87", c2: "#5b616b",
    },
  },
  {
    id: "mono",
    name: "Monochrome",
    colors: ["#e8e8e8", "#1a1a1a"],
    accent: "#222225",
    palette: {
      bg: "#18181b",
      a1: "#3f3f46", a2: "#52525b", a3: "#71717a",
      b1: "#3f3f46", b2: "#27272a", b3: "#18181b",
      c1: "#52525b", c2: "#27272a",
    },
  },
];

const features = ["Lecture transcription", "Active recall", "Shared spaces", "Private by design"];

interface LandingCarouselProps {
  selectedThemeId: string;
  onSelectTheme: (theme: ThemeOption) => void;
}

export function LandingCarousel({ selectedThemeId, onSelectTheme }: LandingCarouselProps) {
  const [step, setStep] = useState<0 | 1 | 2>(0);

  const activeTheme = THEMES.find((t) => t.id === selectedThemeId) || THEMES[0];

  const panelStyle: React.CSSProperties = {
    position: "relative",
    width: "100%",
    maxWidth: 560,
    minHeight: 520,
    borderRadius: 28,
    background: "rgba(18, 18, 20, 0.78)",
    backdropFilter: "blur(24px) saturate(1.2)",
    WebkitBackdropFilter: "blur(24px) saturate(1.2)",
    // Anti-aliasing fixes for rounded corner blur clipping
    isolation: "isolate",
    WebkitBackfaceVisibility: "hidden",
    MozBackfaceVisibility: "hidden",
    transform: "translateZ(0)",
    WebkitTransform: "translateZ(0)",
    // Mask ensures backdrop blur doesn't overflow outside rounded corners
    maskImage: "radial-gradient(white, black)",
    WebkitMaskImage: "-webkit-radial-gradient(white, black)",
    overflow: "hidden",
    boxShadow: `
      0 0 0 1px rgba(255, 255, 255, 0.12) inset,
      0 1px 0 rgba(255, 255, 255, 0.18) inset,
      0 20px 48px rgba(0, 0, 0, 0.4),
      0 32px 64px rgba(0, 0, 0, 0.3)
    `,
    padding: "34px 38px 40px",
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
  };

  return (
    <div style={{ width: "100%", maxWidth: 560, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          width: "300%",
          transform: `translateX(-${(step * 100) / 3}%)`,
          transition: "transform 0.6s cubic-bezier(0.5,0,0.2,1)",
        }}
      >
        {/* Step 1 */}
        <div style={{ width: "33.333%", boxSizing: "border-box", display: "flex", justifyContent: "center" }}>
          <div style={panelStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#fff" }}>
                <LogoMark size={18} color="#fff" />
                <span style={{ fontSize: 14, fontWeight: 500 }}>logia</span>
              </div>
              <span style={{ fontSize: 12, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>
                for students
              </span>
            </div>

            <div style={{ marginTop: 40 }}>
              <p style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.7)", margin: "0 0 14px" }}>
                Private, active-recall study space
              </p>
              <h1 style={{ fontSize: "clamp(34px, 6vw, 48px)", fontWeight: 400, letterSpacing: "-0.045em", lineHeight: 1.05, color: "#fff", margin: 0 }}>
                Study smarter.<br />Recall it yourself.
              </h1>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: "rgba(255,255,255,0.72)", margin: "18px 0 0", maxWidth: 420 }}>
                Turn lectures into transcripts, notes, and flashcards — then let Logia quiz you, instead of doing the thinking for you.
              </p>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 24 }}>
              {features.map((f) => (
                <span key={f} style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.85)", padding: "6px 12px", borderRadius: 999, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}>
                  {f}
                </span>
              ))}
            </div>

            <button onClick={() => setStep(1)} className="l-link" style={{ marginTop: "auto", height: 52, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 16, border: "none", cursor: "pointer", background: "#fff", color: "#000", fontSize: 14, fontWeight: 600, letterSpacing: "0.01em", boxShadow: "0 4px 18px rgba(0,0,0,0.25)" }}>
              Get started
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        </div>

        {/* Step 2 */}
        <div style={{ width: "33.333%", boxSizing: "border-box", display: "flex", justifyContent: "center" }}>
          <div style={panelStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <button onClick={() => setStep(0)} className="l-link" style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 500 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M19 12H5M11 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Back
              </button>
              <span style={{ fontSize: 12, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>Step 1 of 2</span>
            </div>

            <div style={{ marginTop: 24 }}>
              <p style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.7)", margin: "0 0 8px" }}>Personalise</p>
              <h2 style={{ fontSize: "clamp(28px, 5vw, 38px)", fontWeight: 400, letterSpacing: "-0.04em", lineHeight: 1.05, color: "#fff", margin: 0 }}>
                Choose dashboard theme
              </h2>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 20 }}>
              {THEMES.map((t) => {
                const active = selectedThemeId === t.id;
                return (
                  <button key={t.id} onClick={() => onSelectTheme(t)} className="l-link" style={{ cursor: "pointer", textAlign: "left", padding: 10, borderRadius: 16, background: active ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)", border: active ? "1.5px solid rgba(255,255,255,0.7)" : "1px solid rgba(255,255,255,0.08)", transition: "all 0.2s ease" }}>
                    <div style={{ height: 36, borderRadius: 10, marginBottom: 8, background: `linear-gradient(135deg, ${t.colors[0]}, ${t.colors[1]})`, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3)" }} />
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12.5, fontWeight: 500, color: "#fff" }}>{t.name}</span>
                      {active && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                    </div>
                  </button>
                );
              })}
            </div>

            <button onClick={() => setStep(2)} className="l-link" style={{ marginTop: "auto", height: 50, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 14, border: "none", cursor: "pointer", background: "#fff", color: "#000", fontSize: 14, fontWeight: 600, boxShadow: "0 4px 18px rgba(0,0,0,0.25)" }}>
              Continue with {activeTheme.name}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        </div>

        {/* Step 3 */}
        <div style={{ width: "33.333%", boxSizing: "border-box", display: "flex", justifyContent: "center" }}>
          <div style={panelStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <button onClick={() => setStep(1)} className="l-link" style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 500 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M19 12H5M11 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Change theme
              </button>
              <span style={{ fontSize: 12, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>Step 2 of 2</span>
            </div>

            <div style={{ marginTop: 32 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "4px 12px", borderRadius: 999, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", marginBottom: 14 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: activeTheme.colors[0] }} />
                <span style={{ fontSize: 12, fontWeight: 500, color: "#fff" }}>Theme: {activeTheme.name}</span>
              </div>
              <h2 style={{ fontSize: "clamp(30px, 5vw, 42px)", fontWeight: 400, letterSpacing: "-0.04em", lineHeight: 1.05, color: "#fff", margin: 0 }}>
                Ready to study?
              </h2>
              <p style={{ fontSize: 14, lineHeight: 1.5, color: "rgba(255,255,255,0.7)", marginTop: 12 }}>
                Create a new workspace or log in to resume where you left off.
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: "auto" }}>
              <Link href={`/auth/sign-up?theme=${selectedThemeId}`} className="l-link" style={{ height: 50, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 14, background: "#fff", color: "#000", fontSize: 14, fontWeight: 600, boxShadow: "0 4px 18px rgba(0,0,0,0.25)" }}>
                Create new account
              </Link>
              <Link href={`/auth/signin?theme=${selectedThemeId}`} className="l-link" style={{ height: 50, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 14, color: "#fff", fontSize: 14, fontWeight: 500, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.16)" }}>
                I already have an account
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}