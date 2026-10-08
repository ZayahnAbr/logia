"use client";

import { useRef, useState } from "react";
import { MathKeypad } from "@/components/MathKeypad";
import { ExportButtons } from "@/components/ExportButtons";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, Search, Sigma } from "lucide-react";
import "../../../workspace-layout.css";
import katex from "katex";
import "katex/dist/katex.min.css";
import { addFormula, deleteFormula } from "@/app/actions";
import type { Formula } from "@/lib/types";

function Rendered({ tex, block = false }: { tex: string; block?: boolean }) {
  const html = katex.renderToString(tex, { throwOnError: false, displayMode: block });
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

export function FormulaSheet({ spaceId, formulas }: { spaceId: string; formulas: Formula[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [latex, setLatex] = useState("");
  const [topic, setTopic] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<string | null>(null);
  const latexRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    setPending(true);
    setError(null);
    const res = await addFormula(spaceId, label, latex, topic);
    setPending(false);
    if ("error" in res && res.error) { setError(res.error); return; }
    setLabel(""); setLatex(""); setTopic("");
    router.refresh();
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this formula? This can't be undone.")) return;
    await deleteFormula(spaceId, id);
    router.refresh();
  };

  const topics = [...new Set(formulas.map((f) => f.topic || "Ungrouped"))];
  const needle = q.trim().toLowerCase();
  const visibleFormulas = formulas.filter((f) =>
    (!only || (f.topic || "Ungrouped") === only) && (!needle || `${f.label} ${f.topic ?? ""} ${f.latex}`.toLowerCase().includes(needle)));
  const groups = new Map<string, Formula[]>();
  for (const f of visibleFormulas) {
    const key = f.topic || "Ungrouped";
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }

  return (
    <div className="wk-formulas">
      <section className="card no-print wk-add" aria-labelledby="add-formula-h">
        <h2 id="add-formula-h" className="wk-h2">Add a formula</h2>
        <label className="field"><span className="field-label">Name</span><input className="input" placeholder="e.g. Kinetic energy" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <label className="field"><span className="field-label">Topic <span className="field-hint">(optional)</span></span>
          <input className="input" list="formula-topics" placeholder="e.g. Mechanics" value={topic} onChange={(e) => setTopic(e.target.value)} />
          <datalist id="formula-topics">{topics.filter((t) => t !== "Ungrouped").map((t) => <option key={t} value={t} />)}</datalist>
        </label>
        <div className="field">
          <label className="field-label" htmlFor="formula-latex">Formula</label>
          <input id="formula-latex" ref={latexRef} className="input" placeholder="Tap symbols below, or type LaTeX"
            value={latex} onChange={(e) => setLatex(e.target.value)} onFocus={() => setShowKeypad(true)} />
          <span className="field-hint">Example: E = \frac{1}{2}mv^2</span>
        </div>
        {showKeypad && <MathKeypad latex targetRef={latexRef} value={latex} onChange={setLatex} />}
        <div className="wk-preview" aria-live="polite">
          {latex.trim() ? <Rendered tex={latex} block /> : <span>Your formula previews here as you type.</span>}
        </div>
        {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
        <button className="btn btn-primary" onClick={submit} disabled={pending || !label.trim() || !latex.trim()} style={{ justifyContent: "center" }}>
          {pending ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />} Add to sheet
        </button>
      </section>

      <div className="wk-sheet">
        {formulas.length > 0 && (
          <div className="wk-sheet-bar no-print">
            <div className="wk-toolbar" style={{ marginBottom: 0 }}>
              <div className="nb-search wk-search">
                <Search size={15} aria-hidden="true" />
                <label htmlFor="formula-q" className="sr-only">Search formulas</label>
                <input id="formula-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, topic or LaTeX" />
              </div>
              <ExportButtons filename="formula-sheet"
                markdown={() => formulas.map((f) => `**${f.label}**${f.topic ? ` _(${f.topic})_` : ""}\n\n$$${f.latex}$$\n`).join("\n")} />
            </div>
            {topics.length > 1 && (
              <div className="wk-chips" role="group" aria-label="Filter by topic">
                <button type="button" className="wk-chip" aria-pressed={only === null} onClick={() => setOnly(null)}>All <span>{formulas.length}</span></button>
                {topics.map((t) => (
                  <button key={t} type="button" className="wk-chip" aria-pressed={only === t} onClick={() => setOnly(only === t ? null : t)}>
                    {t} <span>{formulas.filter((f) => (f.topic || "Ungrouped") === t).length}</span>
                  </button>
                ))}
              </div>
            )}
            <span className="wk-count" role="status">{visibleFormulas.length} of {formulas.length} formula{formulas.length === 1 ? "" : "s"}</span>
          </div>
        )}

        {formulas.length === 0 ? (
          <div className="wk-empty">
            <span className="wk-empty-ico"><Sigma size={22} aria-hidden="true" /></span>
            <strong>Your formula sheet is empty</strong>
            <p>Collect the equations you need for this module, grouped by topic. Add one on the left, and it appears here as a card you can search and print for open-book exams.</p>
            <div className="wk-example" aria-label="Example of how a formula card looks">
              <small>Example</small>
              <Rendered tex="E_k = \frac{1}{2}mv^2" block />
              <span>Kinetic energy</span>
            </div>
          </div>
        ) : visibleFormulas.length === 0 ? (
          <div className="wk-empty"><strong>No formulas match</strong><p>Try a topic name, part of the title, or clear the filter.</p></div>
        ) : (
          [...groups.entries()].map(([name, items]) => (
            <section key={name} className="wk-topic" aria-label={name}>
              <h2 className="wk-group-h">{name} <span>{items.length}</span></h2>
              <div className="wk-formula-grid">
                {items.map((f) => (
                  <article key={f.id} className="card wk-formula">
                    <div className="wk-formula-tex"><Rendered tex={f.latex} block /></div>
                    <div className="wk-formula-foot">
                      <span className="truncate">{f.label}</span>
                      <button aria-label={`Delete formula ${f.label}`} className="btn btn-ghost btn-icon btn-sm no-print" onClick={() => remove(f.id)}><Trash2 size={13} /></button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
