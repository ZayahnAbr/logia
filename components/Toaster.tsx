"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, BellRing, X } from "lucide-react";

// Non-blocking notifications instead of window.alert(). Call toast("…") from any client code.
type Action = { label: string; run: () => void };
type Toast = { id: number; message: string; kind: "success" | "error" | "poke"; action?: Action };
const EVENT = "logia:toast";

export function toast(message: string, kind: Toast["kind"] = "success", action?: Action) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT, { detail: { message, kind, action } }));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const { message, kind, action } = (e as CustomEvent).detail;
      const id = Date.now() + Math.random();
      setItems((t) => [...t.slice(-2), { id, message, kind, action }]);
      setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : kind === "poke" ? 9000 : 4000);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  return (
    <div className="toaster" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
          {t.kind === "error" ? <AlertCircle size={16} aria-hidden="true" /> : t.kind === "poke" ? <BellRing size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
          <span style={{ flex: 1 }}>
            {t.message}
            {t.action && <button type="button" className="toast-action" onClick={() => { t.action!.run(); setItems((x) => x.filter((i) => i.id !== t.id)); }}>{t.action.label}</button>}
          </span>
          <button className="btn-icon" aria-label="Dismiss" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))}><X size={14} aria-hidden="true" /></button>
        </div>
      ))}
    </div>
  );
}
