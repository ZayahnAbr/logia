"use client";

import { useEffect, useState } from "react";
import { completeOnboarding, savePersona } from "@/app/actions";
import { onboardingSteps } from "@/lib/onboardingSteps";
import { Dialog } from "@/components/Dialog";
import type { DriveStep } from "driver.js";
import "driver.js/dist/driver.css";

const PERSONAS = [
  { id: "high_school", label: "High school student", hint: "Notes, flashcards & the maths solver" },
  { id: "university", label: "University student", hint: "Past papers, pain points & flashcards" },
  { id: "teacher", label: "Teacher or tutor", hint: "Shared decks & notes for a class" },
  { id: "self_learner", label: "Self-learner", hint: "Notes, mind maps & spaced review" },
];

export function OnboardingTour({ show, askPersona = false }: { show: boolean; askPersona?: boolean }) {
  const [stage, setStage] = useState<"idle" | "persona" | "welcome" | "running">("idle");

  useEffect(() => {
    if (show) setStage(askPersona ? "persona" : "welcome");
  }, [show, askPersona]);

  const pickPersona = (id: string) => {
    savePersona(id);
    setStage("welcome");
  };

  const finish = () => {
    setStage("idle");
    completeOnboarding();
  };

  const startTour = async () => {
    setStage("running");
    const { driver } = await import("driver.js");
    const d = driver({
      showProgress: true,
      progressText: "{{current}} of {{total}}",
      nextBtnText: "Next",
      prevBtnText: "Back",
      doneBtnText: "Start studying",
      popoverClass: "logia-tour",
      stagePadding: 8,
      stageRadius: 14,
      overlayColor: "#140f0d",
      overlayOpacity: 0.55,
      smoothScroll: true,
      animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      allowClose: true,
      steps: onboardingSteps.filter((s) => document.querySelector(s.element)) as DriveStep[],
      onDestroyed: finish,
      onCloseClick: () => d.destroy(),
    });
    d.drive();
  };

  if (stage === "persona") {
    return (
      // No onClose: this is a one-time setup step, not dismissible by clicking outside — "Skip" below is the exit.
      <Dialog title="Why are you using Logia?" width={440}>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 18px" }}>We&apos;ll point you to the tools that fit. You can use everything either way.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {PERSONAS.map((p) => (
            <button key={p.id} type="button" onClick={() => pickPersona(p.id)}
              style={{ textAlign: "left", padding: "12px 14px", borderRadius: "var(--r-sm)", border: "none", background: "var(--surface-2)", cursor: "pointer", fontFamily: "inherit", color: "var(--text)" }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{p.label}</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{p.hint}</div>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => setStage("welcome")} style={{ marginTop: 12 }}>Skip</button>
      </Dialog>
    );
  }

  if (stage === "welcome") {
    return (
      <Dialog title="Welcome to Logia" width={380} onClose={finish}>
        <p style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: 20 }}>
          Want a quick tour of the key features? It takes about 30 seconds.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost" onClick={finish}>Skip, I&apos;ll explore myself</button>
          <button type="button" className="btn btn-primary" onClick={startTour}>Show me around</button>
        </div>
      </Dialog>
    );
  }

  return null;
}
