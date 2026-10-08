// Shared types and pure helpers for "Set up from a course outline". No "use client", no server-only,
// so server actions, server components and client components can all import it.

export const ASSESSMENT_TYPES = ["test", "exam", "assignment", "quiz", "other"] as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

export type OutlineTopic = { name: string; week?: string; source?: string };
export type OutlineAssessment = { title: string; type: AssessmentType; weightPercent?: number; dueDate?: string; notes?: string; source?: string };
export type OutlineTextbook = { title: string; author?: string };
export type OutlineResult = {
  courseCode?: string; courseName?: string; lecturerName?: string; notes?: string;
  topics: OutlineTopic[]; assessments: OutlineAssessment[]; textbooks: OutlineTextbook[];
};

export type AssessmentRow = { id: string; title: string; type: AssessmentType; weight_percent: number | null; due_at: string | null; mark_percent: number | null };
export type TopicRow = { id: string; name: string; week: string | null; done: boolean };

export type CourseData = {
  id: string; code: string; name: string; lecturer: string; books: { title: string; author?: string }[];
  assessments: AssessmentRow[]; topics: TopicRow[];
};
export const courseLabel = (c: Pick<CourseData, "code" | "name">) => [c.code, c.name].filter(Boolean).join(" · ") || "Untitled course";

// Calendar colour and urgency by assessment type (calendar kinds are test, assignment, task, other).
export const TYPE_STYLE: Record<AssessmentType, { kind: "test" | "assignment" | "other"; urgency: "low" | "medium" | "high" | "urgent"; color: string; label: string }> = {
  exam: { kind: "test", urgency: "urgent", color: "#c62a2f", label: "Exam" },
  test: { kind: "test", urgency: "high", color: "#f2836b", label: "Test" },
  quiz: { kind: "test", urgency: "medium", color: "#e0a03a", label: "Quiz" },
  assignment: { kind: "assignment", urgency: "medium", color: "#3f8f8a", label: "Assignment" },
  other: { kind: "other", urgency: "low", color: "#6b6f76", label: "Other" },
};

export type MarkSummary = {
  weightSum: number; markedWeight: number; earned: number; remainingWeight: number;
  needed: { target: number; required: number | null; status: "done" | "ok" | "impossible" | "unknown" }[];
};

// Weighted total so far: sum(mark * weight / 100) over marked assessments that have a weight.
// Needed average on the rest for a target T (out of 100 final): (T - earned) / (remainingWeight / 100),
// where remaining weight is what is left of 100 once the marked weight is taken off. Never guesses
// weights: assessments without a weight are ignored, and the caller shows a note if weights do not sum to 100.
export function summarise(rows: AssessmentRow[], targets = [50, 60, 75]): MarkSummary {
  const weighted = rows.filter((r) => r.weight_percent != null);
  const weightSum = weighted.reduce((s, r) => s + Number(r.weight_percent), 0);
  const marked = weighted.filter((r) => r.mark_percent != null);
  const markedWeight = marked.reduce((s, r) => s + Number(r.weight_percent), 0);
  const earned = marked.reduce((s, r) => s + (Number(r.mark_percent) * Number(r.weight_percent)) / 100, 0);
  const remainingWeight = Math.max(0, 100 - markedWeight);
  const sumOk = Math.abs(weightSum - 100) < 0.01;
  const needed = targets.map((target) => {
    if (!sumOk || weighted.length === 0) return { target, required: null, status: "unknown" as const };
    if (earned >= target) return { target, required: 0, status: "done" as const };
    if (remainingWeight <= 0) return { target, required: null, status: "impossible" as const };
    const required = ((target - earned) / remainingWeight) * 100;
    return required > 100 ? { target, required, status: "impossible" as const } : { target, required, status: "ok" as const };
  });
  return { weightSum, markedWeight, earned, remainingWeight, needed };
}
