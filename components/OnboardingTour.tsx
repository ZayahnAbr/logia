"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, Sparkles } from "lucide-react";
import { SpiralLoader } from "@/components/SpiralLoader";
import { completeOnboarding, createSpace } from "@/app/actions";
import { OnboardingUploads, type UploadKind } from "@/components/OnboardingUploads";
import { saveOnboarding, getMyInviteLink, createDemoSpace } from "@/app/onboarding-actions";
import { onboardingSteps } from "@/lib/onboardingSteps";
import { Dialog } from "@/components/Dialog";
import { ShareButton } from "@/components/ShareSheet";
import type { DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import "./onboarding.css";

type Stage = "idle" | "loading" | "about" | "goals" | "setup" | "upload" | "plan" | "design" | "running" | "invite" | "done";
const ORDER: Stage[] = ["about", "goals", "setup", "upload", "plan", "design", "invite", "done"];

const ROLES = [
  { id: "student", label: "Student", hint: "School or college" },
  { id: "undergrad", label: "Undergrad student", hint: "Working towards a first degree" },
  { id: "postgrad", label: "Postgrad student", hint: "Honours, masters or doctorate" },
  { id: "other", label: "Other", hint: "Teacher, tutor or learning on your own" },
];
const GOALS = [
  { id: "notes", label: "Take and organise notes" },
  { id: "flashcards", label: "Turn notes into flashcards" },
  { id: "papers", label: "Practise with past papers" },
  { id: "exams", label: "Get ready for exams" },
  { id: "lectures", label: "Keep up with lectures" },
  { id: "together", label: "Study with friends or classmates" },
  { id: "maths", label: "Get help with maths" },
];
const SETUP = [
  { id: "files", label: "Import my files", hint: "Notes, documents and slides" },
  { id: "extension", label: "Connect my school site", hint: "With the browser extension" },
  { id: "recordings", label: "Add lecture recordings", hint: "Audio from your lectures" },
  { id: "outlines", label: "Add my course outline", hint: "So Logia knows your syllabus" },
  { id: "pdfs", label: "Add PDFs and slides", hint: "Readings, slides and past papers" },
  { id: "none", label: "None of these for now", hint: "You can do any of it later" },
];

function useChecks(initial: string[] = []) {
  const [on, setOn] = useState<string[]>(initial);
  const set = setOn;
  const toggle = (id: string, exclusive?: string) =>
    setOn((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (exclusive && id === exclusive) return [id];
      return [...cur.filter((x) => x !== exclusive), id];
    });
  return [on, toggle, set] as const;
}

export function OnboardingTour({ show }: { show: boolean; askPersona?: boolean }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("idle");
  const [firstSpace, setFirstSpace] = useState("");
  const [spaceBusy, setSpaceBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoErr, setDemoErr] = useState("");
  const [role, setRole] = useState("");
  const roles = role ? [role] : [];
  const [goals, toggleGoal, setGoals] = useChecks();
  const [setup, toggleSetup, setSetup] = useChecks();
  const [plan, setPlan] = useState<"standard" | "pro">("standard");
  const [code, setCode] = useState("");
  const [codeMsg, setCodeMsg] = useState("");
  const [invite, setInvite] = useState("");
  const [copied, setCopied] = useState(false);

  // Keep their place, so a reload or a hiccup never sends them back to the start.
  useEffect(() => {
    if (!show || stage === "idle" || stage === "running") return;
    try { sessionStorage.setItem("logia.ob.state", JSON.stringify({ stage, role, goals, setup, plan, firstSpace })); } catch { /* private mode */ }
  }, [show, stage, role, goals, setup, plan, firstSpace]);

  useEffect(() => {
    if (!show) return;
    let resume = false;
    try { resume = sessionStorage.getItem("logia.ob") === "tour"; } catch { /* private mode */ }
    if (resume) {
      setStage("loading");
      // Arrived in the demo space: wait for the sidebar to render, then spotlight it.
      const t = setTimeout(() => { try { sessionStorage.removeItem("logia.ob"); } catch { /* private mode */ } startTour(); }, 1200);
      return () => clearTimeout(t);
    }
    try {
      const saved = JSON.parse(sessionStorage.getItem("logia.ob.state") || "null");
      if (saved && ORDER.includes(saved.stage)) {
        setRole(saved.role || ""); setGoals(saved.goals || []); setSetup(saved.setup || []); setPlan(saved.plan || "standard"); setFirstSpace(saved.firstSpace || "");
        setStage(saved.stage); return;
      }
    } catch { /* ignore */ }
    setStage("about");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  // Make a demo space, go there, and run the tour on it so every tool can be spotlighted.
  const startDemo = async () => {
    setDemoBusy(true); setDemoErr("");
    const r = await createDemoSpace(firstSpace || undefined);
    if ("error" in r) { setDemoBusy(false); setDemoErr(r.error); return; }
    try {
      sessionStorage.setItem("logia.ob", "tour");
      // Leave the right half of the first row free, so the demo stickers sit in clear space.
      localStorage.setItem(`logia.space.${r.id}.layout`, JSON.stringify([{ id: "outline", visible: false }, { id: "stats", visible: true, half: true }, { id: "tools", visible: true }]));
    } catch { /* private mode */ }
    setStage("loading");
    router.push(`/spaces/${r.id}`);
  };

  const finish = () => { setStage("idle"); try { sessionStorage.removeItem("logia.ob.state"); } catch { /* private mode */ } completeOnboarding(); };
  const go = (to: Stage) => setStage(to);

  const startTour = async () => {
    setStage("running");
    // Stickers draw a moment after the page, so give them a few seconds before deciding which steps exist.
    for (let i = 0; i < 12 && !document.querySelector(".st-text"); i++) await new Promise((r) => setTimeout(r, 250));
    const { driver } = await import("driver.js");
    const d = driver({
      showProgress: true,
      progressText: "{{current}} of {{total}}",
      nextBtnText: "Next",
      prevBtnText: "Back",
      doneBtnText: "Done",
      popoverClass: "logia-tour",
      stagePadding: 8,
      stageRadius: 14,
      overlayColor: "#140f0d",
      overlayOpacity: 0.55,
      smoothScroll: true,
      animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      allowClose: true,
      steps: onboardingSteps.filter((s) => document.querySelector(s.element) || s.opens || s.click).map((s): DriveStep => {
        const step: DriveStep = { element: s.element, popover: { ...s.popover } };
        // Steps that open or close a dialog do it as Next is pressed, then wait a beat for it to render.
        if (s.opens || s.closes) {
          step.popover!.onNextClick = async () => {
            if (s.opens) document.querySelector<HTMLElement>(s.element)?.click();
            else document.querySelector<HTMLElement>('[role="dialog"] [aria-label="Close"]')?.click();
            await new Promise((r) => setTimeout(r, 450));
            d.moveNext();
          };
        }
        if (s.inSidebar || s.click) {
          // The sidebar scrolls on its own, so bring the item into view before it is spotlighted.
          step.onHighlightStarted = (el) => {
            if (s.click) (el as HTMLElement | undefined)?.click();
            else (el as HTMLElement | undefined)?.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
          };
        }
        return step;
      }),
      onDestroyed: () => setStage("invite"),
      onCloseClick: () => d.destroy(),
    });
    d.drive();
  };

  useEffect(() => {
    if (stage !== "invite" || invite) return;
    getMyInviteLink().then((r) => { if ("code" in r) setInvite(`${window.location.origin}/?ref=${r.code}`); });
  }, [stage, invite]);

  if (stage === "loading") return <SpiralLoader />;
  if (stage === "idle" || stage === "running") return null;

  const idx = ORDER.indexOf(stage);
  const top = (
    <div className="ob-top">
      <div className="ob-dots" aria-hidden="true">{ORDER.map((s, i) => <i key={s} className={i <= idx ? (i === idx ? "on now" : "on") : ""} />)}</div>
      <span className="ob-step">Step {idx + 1} of {ORDER.length}</span>
      <button type="button" className="ob-skip" onClick={finish}>Skip setup</button>
    </div>
  );

  if (stage === "about") {
    return (
      <Dialog hideTitle title="Tell us about yourself" width={520} onClose={finish}>
        {top}
        <h2 className="ob-h" aria-hidden="true">Tell us about yourself</h2>
        <p className="ob-sub">I am a…</p>
        <fieldset className="ob-opts">
          <legend className="sr-only">I am a</legend>
          {ROLES.map((r) => (
            <label key={r.id} className="ob-opt">
              <input type="radio" name="ob-role" checked={role === r.id} onChange={() => setRole(r.id)} />
              <div><b>{r.label}</b><span>{r.hint}</span></div>
            </label>
          ))}
        </fieldset>
        <div className="ob-nav"><span />
          <button type="button" className="btn btn-primary" onClick={() => { saveOnboarding({ roles }); go("goals"); }}>Next</button>
        </div>
      </Dialog>
    );
  }

  if (stage === "goals") {
    return (
      <Dialog hideTitle title="What do you want to use Logia for?" width={520} onClose={finish}>
        {top}
        <h2 className="ob-h" aria-hidden="true">What do you want to use Logia for?</h2>
        <p className="ob-sub">Choose as many as you like.</p>
        <fieldset className="ob-opts">
          <legend className="sr-only">Goals</legend>
          {GOALS.map((g) => (
            <label key={g.id} className="ob-opt">
              <input type="checkbox" checked={goals.includes(g.id)} onChange={() => toggleGoal(g.id)} />
              <div><b>{g.label}</b></div>
            </label>
          ))}
        </fieldset>
        <div className="ob-nav">
          <button type="button" className="btn btn-ghost" onClick={() => go("about")}>Back</button>
          <button type="button" className="btn btn-primary" onClick={() => { saveOnboarding({ goals }); go("setup"); }}>Next</button>
        </div>
      </Dialog>
    );
  }

  if (stage === "setup") {
    return (
      <Dialog hideTitle title="Let's get you set up" width={520} onClose={finish}>
        {top}
        <h2 className="ob-h" aria-hidden="true">Let&apos;s get you set up</h2>
        <p className="ob-sub">Tick what you would like to bring in. You can add it on the next screen, or skip it.</p>
        <fieldset className="ob-opts">
          <legend className="sr-only">Set up</legend>
          {SETUP.map((s) => (
            <div key={s.id} className="ob-opt-wrap">
              <label className="ob-opt" htmlFor={`ob-setup-${s.id}`}>
                <input id={`ob-setup-${s.id}`} type="checkbox" checked={setup.includes(s.id)} onChange={() => toggleSetup(s.id, "none")} />
                <div>
                  <b>{s.label}</b><span>{s.hint}</span>
                </div>
              </label>
              {/* Outside the label on purpose: a link nested inside a <label> can have its click swallowed
                  by the label's own click-forwards-to-checkbox behaviour, which looked like "nothing happens". */}
              {s.id === "extension" && setup.includes("extension") && (
                <a href="/spaces/settings#school-sync" target="_blank" rel="noopener noreferrer" className="ob-inline-link">Get the browser extension</a>
              )}
            </div>
          ))}
        </fieldset>
        <div className="ob-nav">
          <button type="button" className="btn btn-ghost" onClick={() => go("goals")}>Back</button>
          <button type="button" className="btn btn-primary" disabled={spaceBusy} onClick={async () => {
            saveOnboarding({ setup });
            // Anything they want to bring in needs somewhere to go, so make their first space now.
            if (setup.some((x) => x === "files" || x === "outlines" || x === "pdfs" || x === "recordings") && !firstSpace) {
              setSpaceBusy(true);
              const r = await createSpace("My first space", "", "peer");
              setSpaceBusy(false);
              if (r.id) setFirstSpace(r.id);
            }
            go(setup.some((x) => x === "files" || x === "outlines" || x === "pdfs" || x === "recordings") ? "upload" : "plan");
          }}>{spaceBusy ? "Setting up…" : "Next"}</button>
        </div>
      </Dialog>
    );
  }

  if (stage === "upload") {
    const kinds = setup.filter((x): x is UploadKind => x === "files" || x === "outlines" || x === "pdfs" || x === "recordings");
    return (
      <Dialog hideTitle title="Add your things" width={520} onClose={finish}>
        {top}
        <h2 className="ob-h" aria-hidden="true">Add your things</h2>
        <p className="ob-sub">They go into your first space. Add as many as you like, or carry on and do it later.</p>
        {firstSpace
          ? <OnboardingUploads spaceId={firstSpace} kinds={kinds} />
          : <p className="ob-msg" role="alert">We couldn&apos;t set up your space just now. You can add files once you&apos;re in.</p>}
        {setup.includes("extension") && (
          <p className="ob-msg">To connect your school site, install the browser extension. You will find it in <Link href="/spaces/settings" target="_blank">Settings</Link> under School sync.</p>
        )}
        <div className="ob-nav">
          <button type="button" className="btn btn-ghost" onClick={() => go("setup")}>Back</button>
          <button type="button" className="btn btn-primary" onClick={() => go("plan")}>Next</button>
        </div>
      </Dialog>
    );
  }

  if (stage === "plan") {
    const applyCode = () => {
      const c = code.trim();
      if (!c) { setCodeMsg("Type a code first."); return; }
      saveOnboarding({ code: c });
      setCodeMsg("Code saved. We will apply it when you check out.");
    };
    return (
      <Dialog hideTitle title="Choose your plan" width={560} onClose={finish}>
        {top}
        <h2 className="ob-h" aria-hidden="true">Choose your plan</h2>
        <p className="ob-beta"><Sparkles size={16} aria-hidden="true" style={{ flex: "none", marginTop: 2 }} /> <span>Logia is in beta. Everything on Standard is free while we build it, and you can switch any time.</span></p>
        <div className="ob-plans" role="group" aria-label="Plan">
          <button type="button" className="ob-plan" aria-pressed={plan === "standard"} onClick={() => setPlan("standard")}>
            <h3>Standard</h3>
            <div className="ob-price">Free <small>during the beta</small></div>
            <ul><li>Notes, flashcards, past papers</li><li>Study rooms and Discover</li><li>Study help with a fair hourly allowance</li></ul>
          </button>
          <button type="button" className="ob-plan" aria-pressed={plan === "pro"} onClick={() => setPlan("pro")}>
            <span className="ob-tag">Exam Season special</span>
            <h3>Pro</h3>
            <div className="ob-price">R250 <small>once-off, not monthly</small></div>
            <ul><li>Covers the exam period until December</li><li>More help each hour, no waiting at busy times</li><li>Everything in Standard</li></ul>
          </button>
        </div>
        {plan === "pro" && (
          <>
            <div className="ob-code">
              <div className="field">
                <label className="field-label" htmlFor="ob-code">Discount code (optional)</label>
                <input id="ob-code" className="input" value={code} onChange={(e) => { setCode(e.target.value); setCodeMsg(""); }} onKeyDown={(e) => { if (e.key === "Enter") applyCode(); }} autoComplete="off" />
              </div>
              <button type="button" className="btn" style={{ height: 40 }} onClick={applyCode}>Apply</button>
            </div>
            <p className="ob-msg" role="status">{codeMsg || "Payment is not open yet. Choosing Pro reserves your place and you will not be charged now."}</p>
          </>
        )}
        <div className="ob-nav">
          <button type="button" className="btn btn-ghost" onClick={() => go(firstSpace ? "upload" : "setup")}>Back</button>
          <button type="button" className="btn btn-primary" onClick={() => { saveOnboarding({ plan }); go("design"); }}>{plan === "pro" ? "Reserve Pro" : "Continue with Standard"}</button>
        </div>
      </Dialog>
    );
  }

  if (stage === "design") {
    const bringing = setup.filter((s) => s !== "none");
    return (
      <Dialog hideTitle title="We'll give you the tour" width={520} onClose={finish}>
        {top}
        <h2 className="ob-h" aria-hidden="true">We&apos;ll give you the tour</h2>
        <p className="ob-sub">Each module gets its own space. Here is how you make one yours: pick a colour, add notes and stickers, and keep your files together.</p>
        <div className="ob-demo" aria-hidden="true">
          <div className="ob-demo-head">Biology 201</div>
          <div className="ob-demo-grid">
            <div className="ob-tc a"><div className="ob-tc-art fc"><i>Your first card</i></div><b>Flashcards</b><span>Answer out loud and see what you missed.</span></div>
            <div className="ob-tc b"><div className="ob-tc-art rm"><u /><u /><u /><em>live</em></div><b>Study rooms</b><span>Shared goal, shared timer, chat and voice.</span></div>
            <div className="ob-tc c"><div className="ob-tc-art pp" /><b>Past papers</b><span>Upload a marked paper, see where the marks went.</span></div>
            <div className="ob-tc d"><div className="ob-tc-art mm"><s /><s /><s /></div><b>Mind maps</b><span>Turn a chapter into a map you can edit.</span></div>
          </div>
          <div className="ob-demo-card c">Revise ch. 4!</div>
          <span className="ob-demo-ptr" />
        </div>
        <p className="ob-sub" style={{ marginBottom: 0 }}>
          {bringing.length ? "Your uploads are in this space, under Files, Lectures and Settings." : "We will set up a small demo space, spotlight every tool in it and show you where Settings is. You can delete it any time."}
        </p>
        {demoErr && <p className="ob-msg" role="alert">{demoErr}</p>}
        <div className="ob-nav">
          <button type="button" className="btn btn-ghost" onClick={() => go("invite")}>Skip the tour</button>
          <button type="button" className="btn btn-primary" onClick={startDemo} disabled={demoBusy}>{demoBusy ? "Setting up…" : "Show me around"}</button>
        </div>
      </Dialog>
    );
  }

  if (stage === "invite") {
    const copy = async () => { try { await navigator.clipboard.writeText(invite); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* blocked */ } };
    return (
      <Dialog hideTitle title="Invite a friend" width={480} onClose={finish}>
        {top}
        <h2 className="ob-h" aria-hidden="true">Invite a friend</h2>
        <p className="ob-sub">Studying is easier together. When a friend joins with your link, you both get bonus study time.</p>
        {invite ? (
          <>
            <div className="field"><label className="field-label" htmlFor="ob-invite">Your link</label>
              <input id="ob-invite" className="input mono" readOnly value={invite} onFocus={(e) => e.currentTarget.select()} /></div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <button type="button" className="btn btn-primary" onClick={copy}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} {copied ? "Copied" : "Copy link"}</button>
              <ShareButton label="Share" className="btn" data={{ title: "Join me on Logia", text: "I'm using Logia to turn my notes into flashcards that test me. Join with my link.", url: invite }} />
            </div>
          </>
        ) : <p className="ob-msg">Your link is loading. You can always find it under <Link href="/invite">Invite friends</Link>.</p>}
        <div className="ob-nav">
          <button type="button" className="btn btn-ghost" onClick={() => go("done")}>Maybe later</button>
          <button type="button" className="btn btn-primary" onClick={() => go("done")}>Next</button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog hideTitle title="You're all set" width={440} onClose={finish}>
      {top}
      <div className="ob-yay">
        <div className="dots" aria-hidden="true"><span /><span /><span /></div>
        <h2 className="ob-h" aria-hidden="true">You&apos;re all set</h2>
        <p className="ob-sub" style={{ marginBottom: 0 }}>Create your first space and start studying. You can run this tour again any time from Settings.</p>
      </div>
      <div className="ob-nav" style={{ justifyContent: "center" }}>
        <button type="button" className="btn btn-primary btn-lg" onClick={finish}>Get started</button>
      </div>
    </Dialog>
  );
}
