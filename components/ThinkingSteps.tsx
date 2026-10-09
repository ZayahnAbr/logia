"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";

// Shows what is happening while an answer is being prepared, so a wait never feels stuck.
// Steps advance on a gentle schedule (the server does not report real progress); the last one holds.
export function ThinkingSteps({ steps, every = 3500, className = "" }: { steps: string[]; every?: number; className?: string }) {
  const [i, setI] = useState(0);
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const tick = window.setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      setSecs(s);
      setI(Math.min(steps.length - 1, Math.floor((s * 1000) / every)));
    }, 500);
    return () => window.clearInterval(tick);
  }, [steps.length, every]);

  return (
    <div className={`think ${className}`} role="status" aria-live="polite">
      <ol className="think-steps">
        {steps.slice(0, i + 1).map((s, n) => (
          <li key={s} className={n < i ? "done" : "now"}>
            {n < i ? <Check size={13} aria-hidden="true" /> : <Loader2 size={13} className="spin" aria-hidden="true" />}
            <span>{s}</span>
          </li>
        ))}
      </ol>
      {secs >= 20 && <p className="think-slow">Taking a little longer than usual. Hang on, it is still working.</p>}
      <span className="think-bar" aria-hidden="true"><i style={{ width: `${Math.min(92, 8 + (secs / 30) * 84)}%` }} /></span>
    </div>
  );
}
