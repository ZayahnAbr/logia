// Spotlight steps for the first-login tour. `element` selectors target
// data-tour attributes placed in AppShell / page components. If an element
// isn't in the DOM (e.g. a space-only nav item while on the plain dashboard),
// driver.js simply skips that step.
export const onboardingSteps = [
  {
    element: '[data-tour="spaces"]',
    popover: {
      title: "Spaces",
      description: "Your study spaces live here, one per module. Come back any time to switch between them.",
    },
  },
  {
    element: '[data-tour="create-space"]',
    popover: {
      title: "Create or join a space",
      description: "Start a new space, or join a classmate's with an invite code. Notes, flashcards and papers all live inside a space.",
    },
  },
  {
    element: '[data-tour="spaces-list"]',
    popover: {
      title: "Your spaces",
      description: "Every space you've created or joined shows up here. Open one to get to its notes, flashcards, and study tools.",
    },
  },
  {
    element: '[data-tour="notes"]',
    popover: {
      title: "Notes editor",
      description: "Write or paste your notes here. You can embed videos, images, and upload PDFs.",
    },
  },
  {
    element: '[data-tour="papers"]',
    popover: {
      title: "Past papers",
      description: "Upload a marked paper to see where you lost marks. Weak topics become pain points you can target.",
    },
  },
  {
    element: '[data-tour="flashcards"]',
    popover: {
      title: "Flashcards & voice recall",
      description: "Review cards on a smart schedule. Answer by speaking, typing or writing, and Logia checks what you got and missed.",
    },
  },
  {
    element: '[data-tour="maps"]',
    popover: {
      title: "Mind Maps",
      description: "Visualise how topics connect. Auto-generate from your notes or build from scratch.",
    },
  },
  {
    element: '[data-tour="chat"]',
    popover: {
      title: "AI Chat",
      description: "Ask questions about your uploaded materials. Logia searches your notes to answer.",
    },
  },
  {
    element: '[data-tour="solver"]',
    popover: {
      title: "Math Solver",
      description: "Type an equation and get step-by-step solutions.",
    },
  },
  {
    element: '[data-tour="rooms"]',
    popover: {
      title: "Study rooms",
      description: "Study alongside classmates: see who's in, share a session goal and a timer, and chat if you need to.",
    },
  },
  {
    element: '[data-tour="overview"]',
    popover: {
      title: "Study Dashboard",
      description: "Track your streaks, review stats, and see what's due today.",
    },
  },
];
