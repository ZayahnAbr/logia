// Spotlight steps for the first-run tour. `element` selectors target data-tour attributes in AppShell and the
// page components. A step whose element isn't on the page is skipped.
// `opens` clicks the element when the student presses Next (to open a dialog); `closes` closes any open dialog
// first; `click` presses the element as it is highlighted (to show a tab); `inSidebar` scrolls the sidebar to it.
export type TourStep = {
  element: string;
  popover: { title: string; description: string };
  opens?: boolean;
  closes?: boolean;
  click?: boolean;
  inSidebar?: boolean;
};

export const onboardingSteps: TourStep[] = [
  { element: '[data-tour="spaces"]', popover: { title: "Spaces", description: "Your study spaces live here. Come back any time to switch between them." } },
  { element: '[data-tour="library"]', popover: { title: "Library", description: "Keep your textbooks and PDFs together, with your highlights and bookmarks saved." } },
  { element: '[data-tour="discover"]', popover: { title: "Discover", description: "Find live study rooms and public spaces from other students, and join one in a click." } },
  { element: '[data-tour="timetable"]', popover: { title: "Timetable", description: "Add your lectures and labs once and see your week at a glance. Photograph a printed timetable and Logia reads it for you." } },
  { element: '[data-tour="focus"]', popover: { title: "Focus timer", description: "A simple timer for focused sessions with short breaks, so you can see how long you've really studied." } },
  { element: '[data-tour="overview"]', inSidebar: true, popover: { title: "Space home", description: "Each space has a home page that shows what's due, your progress and anything you pin there." } },
  { element: '[data-tour="notes"]', inSidebar: true, popover: { title: "Notes", description: "Write or paste your notes, embed images and videos, and add PDFs." } },
  { element: '[data-tour="chat"]', inSidebar: true, popover: { title: "Ask Logia", description: "Ask questions about your own notes and files and get answers that point back to them." } },
  { element: '[data-tour="flashcards"]', inSidebar: true, popover: { title: "Flashcards and voice recall", description: "Review on a smart schedule. Answer by speaking, typing or writing, and Logia checks what you got and missed." } },
  { element: '[data-tour="papers"]', inSidebar: true, popover: { title: "Past papers", description: "Upload an answered paper and see where you lost marks. Weak topics become pain points you can target." } },
  { element: '[data-tour="maps"]', inSidebar: true, popover: { title: "Mind maps", description: "See how topics connect. Build one from your notes or from scratch." } },
  { element: '[data-tour="solver"]', inSidebar: true, popover: { title: "Maths solver", description: "Type an equation and get the working, step by step." } },
  { element: '[data-tour="rooms"]', inSidebar: true, popover: { title: "Study rooms", description: "Study alongside classmates: see who's in, share a goal and a timer, and chat if you need to." } },

  // Making the space your own
  { element: '[data-tour="customise"]', popover: { title: "Make it yours", description: "Reorder the cards on your space home, hide the ones you don't need, and change their colours. Your layout is saved." } },
  { element: '[data-tour="add-widget"]', opens: true, popover: { title: "Add widgets", description: "Press Next and we'll open this so you can see what you can add." } },
  { element: '#cw-tab-image', click: true, popover: { title: "Pictures", description: "Add a photo, a screenshot or a diagram from your device or a link." } },
  { element: '#cw-tab-text', click: true, popover: { title: "Text and headings", description: "Add a free text block for a heading, a goal or a reminder. Type right on the page." } },
  { element: '#cw-tab-sticky', click: true, popover: { title: "Sticky notes", description: "A paper note you can type on, in the colour you choose. Drag it anywhere on the page." } },
  { element: '#cw-tab-sticker', click: true, closes: true, popover: { title: "Stickers", description: "Cut a person or object out of a photo, or search for a sticker, and place it on your space." } },
  { element: '.st-text', popover: { title: "Edit a heading", description: "Click the text to change it. Use the toolbar that appears below it to switch between heading and body size, align it, change its colour or remove it." } },
  { element: '.st-text .st-resize', popover: { title: "Resize with the corner", description: "Drag the round handle at the corner to make a sticker bigger or smaller. The text grows with it." } },
  { element: '.st-sticky', popover: { title: "Move a sticky note", description: "Drag a sticky note by its top edge. Click it to type, and use the dots to change its colour." } },

  { element: '[data-tour="settings"]', inSidebar: true, popover: { title: "Settings", description: "Change your theme, profile, connected school sites and plan here. You can run this tour again from Settings." } },
];
