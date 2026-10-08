# Logia — UX cohesion & feature discovery audit

The existing visual identity is unchanged: warm off-white page, white cards, coral/pink grainy header, near-black primary buttons. This audit only strengthens hierarchy, flows and discoverability.

## 1. Design-system inventory (app/globals.css)
| Area | Tokens / classes |
|---|---|
| Colour | `--bg #f4f2f0`, `--surface #fff`, sidebar `#faf9f8`, `--primary-bg #18181b`, `--accent`/`--accent-text` (coral), `--success/--warning/--danger/--info`, `--border-input #8e8e95` |
| Spacing / radius | `--space-*`, `--r-sm/md/lg`, `--control-h` |
| Buttons | `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-sm`, `.btn-icon`, `.btn-danger` |
| Forms | `.input`, `.field`, `.field-label`, `.field-hint`, `.field-error` |
| Surfaces | `.card`, `.card-i` (interactive), `.empty`, `.dash-row`, `.mesh-warm` / `.mesh-brand` headers |
| Type | `.phead` + `.eyebrow` (space name) → `h1` (page name) |
| Feedback | `.notice-*`, `.err`, `role="status"` bars, `.spin`, `.skeleton` (new, respects reduced motion) |
| Utility | `.sr-only`, `.truncate`, `.filename`, `.stretched` |

## 2. Navigation hierarchy
Sidebar (same on every page): **Dashboard · Library · Focus timer** → **Space switcher** → grouped space tools:
- *Space home*
- **Learn:** Notes, Files, Lectures, Scan, Ask AI
- **Practise:** Flashcards *(new entry)*, Past papers, Pain points, Solver
- **Organise:** Mind maps, Formula sheet
- *Progress*

Space tools are shown but disabled until a space is chosen. Page titles now match nav labels.

## 3. Core flows (Entry → Action → Feedback → Next step)
| Flow | Entry | Action | Feedback | Next step |
|---|---|---|---|---|
| First time | Sign up → tour + persona | Create/join space | Space appears in list | Next-step card: "Mark a past paper" |
| Returning | Dashboard | Next-step card | — | Pain point / continue reading / flashcards |
| Join space | Dashboard → Create or join | Paste invite code | Space opens | Space home |
| Invite | Space home → **Invite classmates** *(new)* | Copies code | "Code copied" | Share with classmate |
| Upload paper | Past papers | Upload answered paper + memo | Score + wrong topics | **Added to your pain points →** *(new)* / Generate similar |
| Create flashcards | Note → Make flashcards | AI generates | Status bar | **Study them now** *(new)* |
| Voice recall | Deck → Study → Speak | Hold to answer | Recall %, included/missed | Suggested rating → next card |
| End of review | Last card | — | **Session summary** *(new)*: avg recall, weak cards | Quiz / Back to flashcards |
| Ask AI | Sidebar → Ask AI, or note → Ask | Question | Answer grounded in notes/files | Follow-up |

## 4. Feature priority
| Level | Features |
|---|---|
| CORE | Spaces, Notes, Flashcards (+ voice recall), Past papers |
| IMPORTANT | Pain points, Ask AI, Library reader, Progress |
| DISCOVERABLE | Lectures, Mind maps, Quiz, Scan, Invite classmates |
| SECONDARY | Solver, Formula sheet, Focus timer, Export, Dashboard customisation |
| HIDDEN (settings) | Persona, language, reset onboarding |

## 5. Feature spotlight
| Feature | Primary entry | Secondary entry | First-use intro | Contextual prompt | Primary CTA |
|---|---|---|---|---|---|
| Study spaces | Dashboard | Space switcher | Tour step "Spaces" | Next-step card when none | Create a space |
| Shared resources | Space home → Invite | Dashboard invite code on card | — | Empty "Your spaces" mentions invite codes | Invite classmates |
| Notes | Sidebar → Notes | Space home "Notes" widget | Tour step | Empty state explains notes → cards | New note |
| Flashcards | Sidebar → Flashcards | Space home decks | "How flashcards work here" | After note generation | Study them now |
| Quizzes | Deck page | Session summary | — | End of review | Test yourself with a quiz |
| AI assistance | Sidebar → Ask AI | Note → Ask | Tour step | Files empty state | Ask |
| Group study | — | — | — | — | **Not built** (see §7) |
| Voice recall | Deck → Speak | Notes generation message | Tour step *(new)* | Dashboard next step | Hold to answer |
| Progress | Sidebar → Progress | Dashboard "This week" | Tour step | — | — |
| Onboarding | Auto on first login | Settings → reset | Welcome + persona | — | Start |

## 6. Changes made (with UX reason)
- **Grouped sidebar + Flashcards entry** — the core feature had no nav entry; groups cut scanning.
- **Eyebrow = space, h1 = page** — the page you're on should be the loudest text.
- **Useful empty states** (notes, files, lectures, formulas, space home widgets) — each says what the area does and offers a CTA.
- **Dashboard next-step card** — adapts to state: no space → create; pain points → fix; reading → continue; no papers → mark one; else → flashcards.
- **Invite classmates button** — sharing was only visible as a small code on the dashboard card.
- **Dead-end fixes** — "Study them now", "Added to your pain points →", review session summary.
- **Route skeletons** (dashboard, space, library) — loading is visible, without layout jumps; no animation under reduced motion.
- **Tour** — now covers flashcards/voice recall and past papers accurately.

## 7. Final product test
- *Can a new user tell what to do first?* Yes — tour, then the next-step card.
- *Can every feature be reached?* Yes, from the sidebar; key ones also from contextual prompts.
- *Does every action end with a next step?* Main flows yes; mind maps and solver still end in place (acceptable for tools).
- **Not built — flagged, not faked:** group study sessions, browsing other students' public resources, and a named AI tutor persona. Today, "social" means shared peer spaces via invite code plus card upvotes. These are the biggest gaps against the brief.
