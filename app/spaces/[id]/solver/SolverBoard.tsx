"use client";

import { useRef, useState } from "react";
import { Loader2, Sigma, Delete } from "lucide-react";
import katex from "katex";
import "katex/dist/katex.min.css";

const KEYPAD_ROWS: { label: string; insert: string }[][] = [
  [{ label: "sin", insert: "sin(" }, { label: "cos", insert: "cos(" }, { label: "tan", insert: "tan(" }, { label: "√", insert: "sqrt(" }, { label: "π", insert: "pi" }],
  [{ label: "(", insert: "(" }, { label: ")", insert: ")" }, { label: "^", insert: "^" }, { label: "x", insert: "x" }, { label: "÷", insert: "/" }],
  [{ label: "7", insert: "7" }, { label: "8", insert: "8" }, { label: "9", insert: "9" }, { label: "×", insert: "*" }, { label: "log", insert: "log(" }],
  [{ label: "4", insert: "4" }, { label: "5", insert: "5" }, { label: "6", insert: "6" }, { label: "−", insert: "-" }, { label: "e", insert: "e" }],
  [{ label: "1", insert: "1" }, { label: "2", insert: "2" }, { label: "3", insert: "3" }, { label: "+", insert: "+" }, { label: "=", insert: "=" }],
  [{ label: "0", insert: "0" }, { label: ".", insert: "." }, { label: ",", insert: "," }],
];

const OPERATIONS = [
  { value: "simplify", label: "Simplify" },
  { value: "factor", label: "Factor" },
  { value: "derive", label: "Derivative" },
  { value: "integrate", label: "Integral" },
  { value: "zeroes", label: "Zeroes" },
  { value: "tangent", label: "Tangent line" },
  { value: "area", label: "Area under curve" },
  { value: "cos", label: "Cosine" },
  { value: "sin", label: "Sine" },
  { value: "tan", label: "Tangent" },
  { value: "abs", label: "Absolute value" },
  { value: "log", label: "Logarithm" },
];

const EXAMPLES: { op: string; expr: string }[] = [
  { op: "simplify", expr: "2x^2+4x-3+x^2" },
  { op: "factor", expr: "x^2+2x-3" },
  { op: "derive", expr: "x^2+3x" },
  { op: "integrate", expr: "x^2" },
  { op: "zeroes", expr: "x^2-4" },
  { op: "area", expr: "2:4|x^2" },
];

const OP_HELP: Record<string, string> = {
  simplify: "Collects like terms and tidies an expression.",
  factor: "Writes a polynomial as a product of factors.",
  derive: "Finds the derivative with respect to x.",
  integrate: "Finds the indefinite integral.",
  zeroes: "Finds where the expression equals zero.",
  tangent: "Tangent line at a point, written point|expression (for example 2|x^3).",
  area: "Area under a curve between bounds: a:b|expression.",
  cos: "Cosine of a value.",
  sin: "Sine of a value.",
  tan: "Tangent of a value.",
  abs: "Absolute value.",
  log: "Logarithm of a value.",
};

function Rendered({ tex }: { tex: string }) {
  const html = katex.renderToString(tex, { throwOnError: false, displayMode: true });
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

export function SolverBoard() {
  const [operation, setOperation] = useState("simplify");
  const [expression, setExpression] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const insert = (token: string) => {
    const input = inputRef.current;
    if (!input) { setExpression((e) => e + token); return; }
    const start = input.selectionStart ?? expression.length;
    const end = input.selectionEnd ?? expression.length;
    const next = expression.slice(0, start) + token + expression.slice(end);
    setExpression(next);
    requestAnimationFrame(() => {
      input.focus();
      const pos = start + token.length;
      input.setSelectionRange(pos, pos);
    });
  };

  const backspace = () => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? expression.length;
    const end = input?.selectionEnd ?? expression.length;
    if (start !== end) { setExpression(expression.slice(0, start) + expression.slice(end)); return; }
    if (start === 0) return;
    setExpression(expression.slice(0, start - 1) + expression.slice(start));
    requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start - 1, start - 1); });
  };

  const solve = async () => {
    const expr = expression.trim();
    if (!expr || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const encoded = encodeURIComponent(expr.replace(/\s+/g, ""));
      const res = await fetch(`https://newton.vercel.app/api/v2/${operation}/${encoded}`);
      if (!res.ok) throw new Error("Newton API could not solve that expression.");
      const data = await res.json();
      if (!data?.result) throw new Error("No result. Check your expression.");
      setResult(String(data.result));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the solver. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const pickExample = (e: { op: string; expr: string }) => { setOperation(e.op); setExpression(e.expr); setResult(null); setError(null); inputRef.current?.focus(); };
  const opLabel = (v: string) => OPERATIONS.find((o) => o.value === v)?.label ?? v;

  return (
    <div className="sv">
      <nav className="sv-ops" aria-label="Operation">
        <h2 className="sv-h">Operation</h2>
        <div className="sv-op-list" role="radiogroup" aria-label="Operation">
          {OPERATIONS.map((op) => (
            <button key={op.value} type="button" role="radio" aria-checked={operation === op.value}
              className="sv-op" onClick={() => setOperation(op.value)}>
              <span className="sv-op-name">{op.label}</span>
              <span className="sv-op-help">{OP_HELP[op.value]}</span>
            </button>
          ))}
        </div>
      </nav>

      <section className="sv-work" aria-label="Expression">
        <div className="sv-input">
          <span className="sv-input-op">{opLabel(operation)}</span>
          <input ref={inputRef} value={expression} onChange={(e) => setExpression(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") solve(); }}
            placeholder="Type an expression, e.g. 2x^2+4x-3" aria-label="Expression" spellCheck={false} autoComplete="off" />
          <button className="btn btn-primary" onClick={solve} disabled={loading || !expression.trim()}>
            {loading ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Sigma size={16} aria-hidden="true" />} Solve
          </button>
        </div>

        <div className="sv-result" aria-live="polite">
          {loading && <div className="sv-state"><Loader2 size={18} className="spin" aria-hidden="true" /> Solving</div>}
          {error && !loading && <div className="sv-state sv-err">{error}</div>}
          {result && !loading && (
            <>
              <div className="sv-result-label">{opLabel(operation)} of <code>{expression}</code></div>
              <div className="sv-result-tex"><Rendered tex={result} /></div>
            </>
          )}
          {!result && !error && !loading && (
            <div className="sv-state sv-idle">
              <Sigma size={22} aria-hidden="true" />
              <span>Your answer appears here. Press Enter or Solve.</span>
            </div>
          )}
        </div>

        <div className="sv-pad" aria-label="Keypad">
          {KEYPAD_ROWS.flat().map((k) => (
            <button key={k.label} type="button" className="sv-key" onClick={() => insert(k.insert)}>{k.label}</button>
          ))}
          <button type="button" className="sv-key" aria-label="Delete last character" onClick={backspace}><Delete size={15} aria-hidden="true" /></button>
          <button type="button" className="sv-key sv-key-clear" onClick={() => { setExpression(""); setResult(null); setError(null); }}>Clear</button>
        </div>
      </section>

      <aside className="sv-side" aria-labelledby="sv-ex-h">
        <div>
          <h2 id="sv-ex-h" className="sv-h">Try an example</h2>
          <ul className="sv-ex">
            {EXAMPLES.map((e) => (
              <li key={e.op + e.expr}>
                <button type="button" onClick={() => pickExample(e)}>
                  <span>{opLabel(e.op)}</span><code>{e.expr}</code>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="sv-tips">
          <h2 className="sv-h">Writing expressions</h2>
          <ul>
            <li><code>^</code> for powers, like <code>x^2</code></li>
            <li><code>*</code> and <code>/</code> to multiply and divide</li>
            <li>Bounds for area: <code>a:b|expression</code></li>
            <li>Point for a tangent: <code>2|x^3</code></li>
          </ul>
          <p className="sv-note">Powered by Newton API. Covers algebra through first-year calculus.</p>
        </div>
      </aside>
    </div>
  );
}
