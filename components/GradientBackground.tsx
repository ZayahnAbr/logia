"use client";

export interface ThemeColors {
  bg: string;
  a1: string; a2: string; a3: string;
  b1: string; b2: string; b3: string;
  c1: string; c2: string;
}

export function GradientBackground() {
  return (
    <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: -1, overflow: "hidden", background: "var(--bg)" }}>
      <div className="logia-layer logia-a" />
      <div className="logia-layer logia-b" />
      <div className="logia-layer logia-c" />
      <div className="logia-grain" />
      <style>{`
        .logia-layer { position: absolute; inset: -35%; filter: blur(90px) saturate(1.2); }
        .logia-a {
          background:
            radial-gradient(55% 55% at 25% 30%, var(--grad-a) 0%, transparent 68%),
            radial-gradient(60% 60% at 75% 25%, var(--grad-b) 0%, transparent 70%),
            radial-gradient(70% 70% at 60% 75%, var(--grad-c) 0%, transparent 72%);
          animation: logiaOozeA 28s ease-in-out infinite alternate;
          opacity: .55;
        }
        .logia-b {
          background:
            radial-gradient(50% 50% at 70% 45%, var(--grad-c) 0%, transparent 66%),
            radial-gradient(55% 55% at 30% 65%, var(--grad-a) 0%, transparent 70%);
          opacity: .4;
          animation: logiaOozeB 36s ease-in-out infinite alternate;
        }
        .logia-c {
          background: radial-gradient(50% 50% at 50% 50%, var(--grad-b) 0%, transparent 70%);
          opacity: .3;
          animation: logiaOozeC 44s ease-in-out infinite alternate;
        }
        @keyframes logiaOozeA { 0%{transform:translate(-6%,-5%) scale(1);} 50%{transform:translate(5%,4%) scale(1.3);} 100%{transform:translate(6%,-6%) scale(1.35);} }
        @keyframes logiaOozeB { 0%{transform:translate(7%,6%) scale(1.25);} 100%{transform:translate(-6%,-4%) scale(1.05);} }
        @keyframes logiaOozeC { 0%{transform:translate(-4%,5%) scale(1.15);} 100%{transform:translate(6%,-5%) scale(1.4);} }
.logia-grain { position:absolute; inset:0; opacity:.32; mix-blend-mode:overlay;          background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
        @media (prefers-reduced-motion: reduce) { .logia-a,.logia-b,.logia-c { animation:none; } }
      `}</style>
    </div>
  );
}