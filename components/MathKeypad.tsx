"use client";

import { useState, type RefObject } from "react";
import { Delete } from "lucide-react";

// `caret` = where the cursor lands inside `insert` (defaults to the end).
type Key = { label: string; insert: string; caret?: number };

const LATEX_TABS: Record<string, Key[]> = {
  Basic: [
    { label: "+", insert: "+" }, { label: "−", insert: "-" }, { label: "×", insert: "\\times " }, { label: "÷", insert: "\\div " },
    { label: "=", insert: "=" }, { label: "≠", insert: "\\neq " }, { label: "±", insert: "\\pm " }, { label: "a/b", insert: "\\frac{}{}", caret: 6 },
    { label: "x²", insert: "^{2}" }, { label: "xⁿ", insert: "^{}", caret: 2 }, { label: "xₙ", insert: "_{}", caret: 2 }, { label: "√", insert: "\\sqrt{}", caret: 6 },
    { label: "ⁿ√", insert: "\\sqrt[]{}", caret: 6 }, { label: "π", insert: "\\pi " }, { label: "°", insert: "^{\\circ}" }, { label: "( )", insert: "\\left(\\right)", caret: 6 },
  ],
  Algebra: [
    { label: "≤", insert: "\\leq " }, { label: "≥", insert: "\\geq " }, { label: "≈", insert: "\\approx " }, { label: "|x|", insert: "\\left|\\right|", caret: 6 },
    { label: "log", insert: "\\log " }, { label: "ln", insert: "\\ln " }, { label: "eˣ", insert: "e^{}", caret: 3 }, { label: "∞", insert: "\\infty " },
    { label: "→", insert: "\\to " }, { label: "∴", insert: "\\therefore " }, { label: "Δ", insert: "\\Delta " }, { label: "Σ", insert: "\\sum_{}^{}", caret: 6 },
    { label: "θ", insert: "\\theta " }, { label: "α", insert: "\\alpha " }, { label: "β", insert: "\\beta " }, { label: "λ", insert: "\\lambda " },
  ],
  Calculus: [
    { label: "d/dx", insert: "\\frac{d}{dx}" }, { label: "∂", insert: "\\partial " }, { label: "∫", insert: "\\int " }, { label: "∫ₐᵇ", insert: "\\int_{}^{}", caret: 6 },
    { label: "dx", insert: "\\,dx" }, { label: "lim", insert: "\\lim_{x \\to }", caret: 12 }, { label: "sin", insert: "\\sin " }, { label: "cos", insert: "\\cos " },
    { label: "tan", insert: "\\tan " }, { label: "vec", insert: "\\vec{}", caret: 5 }, { label: "x̄", insert: "\\bar{}", caret: 5 }, { label: "μ", insert: "\\mu " },
    { label: "σ", insert: "\\sigma " }, { label: "ω", insert: "\\omega " }, { label: "Ω", insert: "\\Omega " }, { label: "·", insert: "\\cdot " },
  ],
};

const TABS: Record<string, Key[]> = {
  Basic: [
    { label: "+", insert: "+" }, { label: "−", insert: "−" }, { label: "×", insert: "×" }, { label: "÷", insert: "÷" },
    { label: "=", insert: "=" }, { label: "≠", insert: "≠" }, { label: "±", insert: "±" }, { label: "( )", insert: "()" },
    { label: "x²", insert: "²" }, { label: "x³", insert: "³" }, { label: "xⁿ", insert: "^" }, { label: "√", insert: "√(" },
    { label: "∛", insert: "∛(" }, { label: "π", insert: "π" }, { label: "°", insert: "°" }, { label: "%", insert: "%" },
  ],
  Algebra: [
    { label: "x", insert: "x" }, { label: "y", insert: "y" }, { label: "≤", insert: "≤" }, { label: "≥", insert: "≥" },
    { label: "<", insert: "<" }, { label: ">", insert: ">" }, { label: "≈", insert: "≈" }, { label: "|x|", insert: "||" },
    { label: "log", insert: "log(" }, { label: "ln", insert: "ln(" }, { label: "eˣ", insert: "e^" }, { label: "a/b", insert: "/" },
    { label: "∞", insert: "∞" }, { label: "→", insert: "→" }, { label: "∴", insert: "∴ " }, { label: "₁", insert: "₁" },
  ],
  Calculus: [
    { label: "d/dx", insert: "d/dx " }, { label: "f′(x)", insert: "f′(x)" }, { label: "∫", insert: "∫ " }, { label: "∫ₐᵇ", insert: "∫ₐᵇ " },
    { label: "dx", insert: " dx" }, { label: "lim", insert: "lim(x→" }, { label: "Σ", insert: "Σ" }, { label: "Δ", insert: "Δ" },
    { label: "∂", insert: "∂" }, { label: "sin", insert: "sin(" }, { label: "cos", insert: "cos(" }, { label: "tan", insert: "tan(" },
    { label: "θ", insert: "θ" }, { label: "α", insert: "α" }, { label: "β", insert: "β" }, { label: "λ", insert: "λ" },
  ],
};

// Inserts symbols at the cursor of the referenced field. Buttons use onMouseDown + preventDefault
// so the textarea never loses focus (and its caret position) when a key is tapped.
export function MathKeypad({
  targetRef, value, onChange, latex = false,
}: {
  targetRef: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  value: string;
  onChange: (v: string) => void;
  latex?: boolean;
}) {
  const tabs = latex ? LATEX_TABS : TABS;
  const [tab, setTab] = useState<string>("Basic");

  const insert = (key: Key) => {
    const token = key.insert;
    const el = targetRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    // Paired brackets/bars land the caret between them.
    const offset = key.caret ?? (token === "()" || token === "||" ? 1 : token.length);
    const caret = start + offset;
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(caret, caret); });
  };

  const backspace = () => {
    const el = targetRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    if (start !== end) { onChange(value.slice(0, start) + value.slice(end)); return; }
    if (start === 0) return;
    onChange(value.slice(0, start - 1) + value.slice(start));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start - 1, start - 1); });
  };

  const hold = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div style={{ marginTop: 8, padding: 10, borderRadius: 12, background: "var(--surface-2)" }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {Object.keys(tabs).map((t) => (
          <button key={t} type="button" onMouseDown={hold} onClick={() => setTab(t)}
            className="btn btn-ghost"
            style={{ height: 28, fontSize: 12, padding: "0 10px", background: tab === t ? "var(--surface)" : "transparent", color: tab === t ? "var(--text)" : "var(--muted)", boxShadow: tab === t ? "var(--shadow)" : "none" }}>
            {t}
          </button>
        ))}
        <button type="button" onMouseDown={hold} onClick={backspace} className="btn btn-ghost" aria-label="Backspace"
          style={{ height: 28, padding: "0 10px", marginLeft: "auto" }}>
          <Delete size={14} />
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 5 }}>
        {tabs[tab].map((k) => (
          <button key={k.label} type="button" onMouseDown={hold} onClick={() => insert(k)} className="btn"
            style={{ height: 34, padding: 0, justifyContent: "center", fontSize: 14 }}>
            {k.label}
          </button>
        ))}
      </div>
    </div>
  );
}
