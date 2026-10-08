"use client";

// Small motion kit following scroll-craft's rules: reveals fire once (never re-hide),
// rise ~14px over ~620ms ease-out with 30–80ms stagger, pointer effects only on
// fine pointers, and everything collapses to static under reduced motion.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type ElementType } from "react";

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

/** Fade + rise once on entry; direct children stagger in reading order. */
export function Reveal({ children, as: Tag = "div", stagger = 70, className = "", style }: {
  children: ReactNode; as?: ElementType; stagger?: number; className?: string; style?: CSSProperties;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    [...el.children].forEach((c, i) => (c as HTMLElement).style.setProperty("--i", String(i)));
    el.style.setProperty("--stagger", `${stagger}ms`);
    if (reduced()) { el.classList.add("is-in"); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { el.classList.add("is-in"); io.disconnect(); } }, { rootMargin: "0px 0px -12% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [stagger]);
  return <Tag ref={ref} className={`reveal ${className}`} style={style}>{children}</Tag>;
}

/** 0..1 progress of a tall section while its sticky stage is pinned. */
export function useStickyProgress<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const travel = r.height - window.innerHeight;
      setP(travel > 0 ? Math.min(1, Math.max(0, -r.top / travel)) : 0);
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(read); };
    read();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on); window.removeEventListener("resize", on); cancelAnimationFrame(raf); };
  }, []);
  return { ref, p };
}

/** Independent depth planes: each child with data-depth moves at its own rate on
 *  scroll and leans toward the pointer. Interpolated (lerp), never direct-tracked. */
export function DepthStage({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || reduced()) return;
    const planes = [...root.querySelectorAll<HTMLElement>("[data-depth]")].map((el) => ({ el, d: Number(el.dataset.depth) || 0 }));
    const target = { x: 0, y: 0, s: 0 }, cur = { x: 0, y: 0, s: 0 };
    let raf = 0;
    const tick = () => {
      cur.x += (target.x - cur.x) * 0.08; cur.y += (target.y - cur.y) * 0.08; cur.s += (target.s - cur.s) * 0.14;
      for (const { el, d } of planes) el.style.transform = `translate3d(${(cur.x * d * 18).toFixed(2)}px, ${(cur.y * d * 14 - cur.s * d * 120).toFixed(2)}px, 0)`;
      const settled = Math.abs(target.x - cur.x) + Math.abs(target.y - cur.y) + Math.abs(target.s - cur.s) < 0.001;
      raf = settled ? 0 : requestAnimationFrame(tick);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
    const onScroll = () => {
      const r = root.getBoundingClientRect();
      target.s = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height)));
      kick();
    };
    const onMove = (e: PointerEvent) => {
      const r = root.getBoundingClientRect();
      target.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
      target.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
      kick();
    };
    const onLeave = () => { target.x = 0; target.y = 0; kick(); };
    window.addEventListener("scroll", onScroll, { passive: true });
    if (finePointer()) { root.addEventListener("pointermove", onMove); root.addEventListener("pointerleave", onLeave); }
    onScroll();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      root.removeEventListener("pointermove", onMove); root.removeEventListener("pointerleave", onLeave);
    };
  }, []);
  return <div ref={ref} className={className} style={style}>{children}</div>;
}
