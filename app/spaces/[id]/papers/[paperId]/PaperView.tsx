"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Sparkles, ArrowLeft } from "lucide-react";
import { generateMoreFromPaper } from "@/app/actions";
import { PracticeCard } from "./QuestionBank";
import { CompareView } from "./CompareView";
import { ExportButtons } from "@/components/ExportButtons";
import type { PaperQuestion, QuestionAttempt } from "@/lib/types";

export function PaperView({
  spaceId, paperId, title, questions, attempts,
}: {
  spaceId: string; paperId: string; title: string; questions: PaperQuestion[]; attempts: QuestionAttempt[];
}) {
  const [practice, setPractice] = useState<PaperQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latest = new Map<string, QuestionAttempt>();
  for (const a of attempts) if (!latest.has(a.question_id)) latest.set(a.question_id, a);

  const marked = questions.filter((q) => latest.has(q.id));
  const unmarked = questions.filter((q) => !latest.has(q.id));
  const correct = marked.filter((q) => latest.get(q.id)!.is_correct).length;
  const pct = marked.length ? Math.round((correct / marked.length) * 100) : 0;
  const wrongTopics = [...new Set(marked.filter((q) => !latest.get(q.id)!.is_correct).map((q) => q.topic).filter(Boolean))] as string[];

  const generate = async () => {
    setLoading(true);
    setError(null);
    const res = await generateMoreFromPaper(spaceId, paperId);
    setLoading(false);
    if ("error" in res && res.error) { setError(res.error); return; }
    setPractice((prev) => [...prev, ...((res.questions as PaperQuestion[]) ?? [])]);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Link href={`/spaces/${spaceId}/papers`} className="btn btn-ghost">
          <ArrowLeft size={14} /> All papers
        </Link>
        <ExportButtons />
      </div>

      <div className="pr-review">
        <aside className="pr-side" aria-label="Paper summary">
          {marked.length > 0 && (
            <div className="pr-panel" style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-start" }}>
              <div style={{
                width: 92, height: 92, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center",
                background: `conic-gradient(var(--accent) ${pct * 3.6}deg, var(--surface-2) 0deg)`,
              }}>
                <div style={{ width: 74, height: 74, borderRadius: "50%", background: "var(--surface)", display: "grid", placeItems: "center", fontSize: 20, fontWeight: 700 }}>
                  {pct}%
                </div>
              </div>
              <div>
                <div className="eyebrow" style={{ color: "var(--accent-text)" }}>Marked · {title}</div>
                <div style={{ fontSize: 18, fontWeight: 700, margin: "4px 0 6px" }}>{correct} of {marked.length} correct</div>
                {wrongTopics.length > 0 ? (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Work on:</span>
                    {wrongTopics.map((t) => (
                      <span key={t} style={{ fontSize: 12, fontWeight: 500, padding: "3px 9px", borderRadius: 999, background: "var(--destructive-soft)", color: "var(--destructive)" }}>{t}</span>
                    ))}
                    <Link href={`/spaces/${spaceId}/pain-points`} style={{ fontSize: 13, fontWeight: 600, color: "var(--accent-text)", width: "100%", marginTop: 4 }}>
                      Added to your pain points →
                    </Link>
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>Full marks. Nothing to fix.</div>
                )}
              </div>
            </div>
          )}

          <div className="pr-panel" style={{ textAlign: "center" }}>
            <Sparkles size={22} style={{ color: "var(--accent-text)", margin: "0 auto 10px", display: "block" }} />
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Want more practice?</div>
            <div style={{ fontSize: 13, color: "var(--muted)", margin: "0 auto 16px", lineHeight: 1.5 }}>
              {wrongTopics.length > 0
                ? "Generate 5 new questions targeting the topics you got wrong."
                : "Generate 5 new questions on the same topics as this paper."}
            </div>
            <button className="btn btn-primary" onClick={generate} disabled={loading}>
              {loading ? <><Loader2 size={14} className="spin" /> Generating…</> : "Generate similar questions"}
            </button>
            {error && <div style={{ color: "var(--amber)", fontSize: 12.5, marginTop: 12 }}>{error}</div>}
          </div>
        </aside>

        <div className="pr-main" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {marked.length > 0 && <CompareView questions={marked} latest={latest} />}

          {unmarked.length > 0 && (
            <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Practice questions</h2>
              {unmarked.map((q, i) => <PracticeCard key={q.id} index={i} spaceId={spaceId} q={q} />)}
            </section>
          )}

          {practice.length > 0 && (
            <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>New practice questions</h2>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: -6 }}>Also saved under Past papers as “{title} · practice”.</div>
              {practice.map((q, i) => <PracticeCard key={q.id} index={i} spaceId={spaceId} q={q} />)}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
