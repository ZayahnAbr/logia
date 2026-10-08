# Logia: working context

Handoff notes so a new session can pick up without re-reading the history. Keep this file current.

## Stack
- Next.js 16 App Router (Turbopack, server actions) and Supabase (RLS, Realtime, storage, RPC).
- Styling lives in a single file, `app/globals.css`:
  - Tokens: `--surface`, `--paper`, `--ink` / `--on-ink`, `--muted`.
  - Dark mode: `html[data-theme="dark"]`.
- Notes co-editing: Tiptap v3, Yjs, and `lib/collab/SupabaseYProvider.ts`.
- Ask AI: `lib/server/rag.ts` plus the `search_space` RPC (Postgres full-text search and trigrams).
- `proxy.ts` matcher excludes `/loops/` and media extensions so videos aren't redirected to sign-in.

## Hard rules
- **Admins:** zayahnabrahams1@gmail.com and zayahnabrahams2004@gmail.com. They are exempt from the AI token limit.
- **Marketing copy:** never show raw token numbers.
- **Accessibility:** WCAG 2.2 AA everywhere.
- **Wording:** no em dashes in user-visible text.
- **Look:** keep the coral identity.
  - Dark-mode headers use darker coral, never black.
  - Pages inside a space use gradient heading text (`.phead-grad`), not a header band.
- **Honesty:** don't fake or overstate features.
- **Loops:** no AI-generated loops. Use real Pixabay loops, self-hosted in `public/loops`, with credits in `public/loops/CREDITS.md`.
- **Safety:** no user webcams.
  - User-hosted rooms are link-only until an admin approves them.
  - Uploads are checked only by type and size, not by content.
- **Space covers:** solid colours the user picks, with no letters. The list is in `lib/coverColors.ts`.
- **Server components:** never import constants from "use client" files (they come back undefined).

## Discover (study-with-me)
- **Main files:**
  - Pages: `app/discover/*` (tabs: Rooms, Streams, Spaces)
  - Actions: `app/discover-actions.ts` and `app/cafe-actions.ts`
  - Room view: `CafeRoom` / `CafeRoomView`
  - Helpers: `lib/cafeClock.ts`, `lib/moderation.ts`, `lib/musicEmbed.ts`, `lib/userCafes.ts`
- **Logia rooms** live at `/discover/rooms/[slug]`. The slugs are rainy-cafe, night-library, forest-cabin and lofi-desk.
  - The scene ids (`components/CafeScene.tsx`) use `rain-cafe`.
- **User-hosted rooms:**
  - Create at `/discover/host` and view at `/discover/c/[id]`.
  - Admins review them at `/discover/admin`.
  - Uploads go to the private `cafe-media` bucket and are served through signed URLs.
- **Loops:** `components/LoopVideo.tsx` renders a muted video over the CSS scene (`.cafe-loop`).
  - With reduced motion it pauses on a still frame.
  - `.cafe-scene` must stay `position:absolute; inset:0`. Overriding it to `relative` collapses it to 0 height and hides the video.
- **Mobile:** Discover scrolls like Reels (`.dc-grid` with snap and full-height `.dc-card`).

## Migrations (`supabase/`)
- 19 search, 20 calendar, 21 space_prefs, 22 discover (confirmed run), 23 user cafés (needs to be run; requires 22), 24 café backgrounds (picture or colour; requires 23), 25 space widgets (needs to be run; GIPHY/image/text widgets, widget colours, private `space-widgets` bucket), 26 notebooks (needs to be run; requires 25): `notebooks` table, `notes.notebook_id` and note covers, private `notebook-covers` bucket. `notes.folder` stays as a mirror of the notebook name. UI in `app/spaces/[id]/notes/` (NotesBoard, CoverPicker, NotebookDialog); actions in `app/notebook-actions.ts`; covers in `lib/notebookCovers.ts` and `components/NotebookCover.tsx`.
- 27 saved stickers (needs to be run; requires 25): `saved_stickers` table (own-row RLS), files at `<user id>/library/<uuid>.png` in `space-widgets`. Every sticker made in the Sticker tab (`StickerMaker.tsx`, MediaPipe magic_touch, on device) is saved there, then copied into the space's folder when placed (`placeSavedSticker`), so deleting from the library never breaks placed stickers. "Saved" tab: `SavedStickers.tsx`. Cap 100.
- 28 sticky stickers (needs to be run; requires 16 and 25): sticky notes become `space_widgets` rows of kind `sticky` (free stickers, per person, `StickyStickerBody`); copies `sticky_notes` (table kept as backup) and writes a `migrations_applied` marker. Until the marker exists the old Sticky notes grid widget stays and the "Sticky note" tab is hidden.
- 29 School sync (Brightspace, Canvas, Moodle, experimental Blackboard via the extension; Google Classroom via Google sign-in; needs to be run; no dependencies): `lms_connections` (sha256 hash of a connection code, own-row RLS) and `lms_items` (read-only deadlines, own-row select/delete, `removed_at` for items a full sync no longer lists), `lms_connections.school_origin` and `platform` (the origin is fixed by the first sync; item links must be https and on that origin, others are rejected), plus the SECURITY DEFINER function `lms_sync(p_token, p_items, p_window_start, p_window_end, p_origin, p_platform)` granted to anon. There is no service-role key in this app, so that function is the only write path. Pieces:
  - `extension/` ("Logia School Sync", Chrome/Edge MV3, plain JS, excluded from tsconfig; see its README): popup, content script reading D2L same-origin, service worker that POSTs to Logia. No site is hard-coded: on Connect the user enters their school Brightspace address, the extension requests an optional host permission for that origin and registers the content script dynamically. Icons generated by `extension/scripts/make-icons.js`. The D2L endpoints are assumed from the docs and untested against a live Brightspace site (listed in the README).
  - Platforms: `lms_items.source` / `lms_connections.platform` hold brightspace|canvas|moodle|blackboard|google_classroom (labels in `lib/lmsPlatforms.ts`). The extension auto-detects the platform (popup fetch of the sign-in page, or page/API probes in `content.js`) and registers its content script for the school origin only. Readers: Brightspace calendar API (+page fallback), Canvas planner API, Moodle `core_calendar_get_action_events_by_timesort` (sesskey via a MAIN-world read in the service worker), Blackboard calendar API (+page fallback, experimental). All untested against live sites.
  - Google Classroom: no extension. Settings, School sync, `ClassroomCard.tsx` runs Supabase Google OAuth (`linkIdentity`, or `signInWithOAuth` if Google is already linked) with the read-only Classroom scopes in `lib/classroomScopes.ts`. `app/auth/callback/route.ts` (with `classroom=1`) uses `session.provider_token` once to sync via `lib/server/classroom.ts`; the token and refresh token are NOT stored (no server secret exists to encrypt them), so "Sync Classroom" in `app/classroom-actions.ts` only works while the session still carries the token (about an hour). Rows are written by the user under own-row insert/update policies limited to source google_classroom. Needs the Classroom API enabled in the Google Cloud project used for Supabase Google sign-in, the three scopes on its consent screen, and (for linking) Supabase manual linking enabled.
  - `app/api/lms/sync/route.ts`: Bearer code, strict validation, CORS for extension origins only. `proxy.ts` matcher excludes `api/lms/` (cookie-less, so it must not redirect to sign-in).
  - `app/lms-actions.ts` and `app/spaces/settings/LmsSection.tsx` (Settings, School sync: make/revoke codes, last sync). Items show in `CalendarWidget` (read-only, "Brightspace" badge, link out, struck through when completed; `hideLms` on the dashboard) and `components/SchoolSyncList.tsx` ("From your school" card on `/spaces`).
- 30 Course outline (needs to be run; requires 25 and 26): per-person tables `course_outlines`, `course_assessments` (weights, due date, mark) and `course_topics` (checklist tick), own-row RLS plus `is_space_member`. Flow: `components/CourseOutlineSetup.tsx` (card on space home, button in Files toolbar) extracts text in the browser (`lib/extractText.ts`), `analyseOutline` in `app/course-outline-actions.ts` makes one `groqChat` call (first 40k chars, admin exemption and hourly cap apply), the student reviews, then `createFromOutline` makes notebooks (`notebookIdForName`), deadlines via `saveEvent`, and the rows above. Widgets `marks` and `checklist` in `components/CourseTracker.tsx`; maths in `lib/courseOutline.ts` (`summarise`). Styles: `co-` block in `app/workspace-layout.css`.
- 31 Timetable from a photo (needs to be run; no dependencies): `timetable_classes` (own-row RLS, one recurring row per class, weekday 0=Mon, minutes since midnight, optional `space_id` and term dates, index on user/weekday/start). Actions `parseTimetable` / `listTimetable` / `saveTimetable` / `deleteTimetable` in `app/calendar-actions.ts`; helpers in `lib/timetable.ts`; UI `TimetableDialog.tsx` (photo/PDF/paste, review, Save) and `TimetableWidget.tsx` (This week card on `/spaces` and a "Timetable" space widget). `CalendarWidget` shows classes read-only in the selected-day view. Photos go straight to the vision model (`qwen/qwen3.8-27b`, same as Scan); PDF/pasted text goes to the chat model.
- 33 Multi-course (needs to be run; requires 30): `course_outlines` become course records (`sort`, `archived`), `course_assessments` and `course_topics` get `course_id` (cascade, backfilled to the newest outline per person and space). `createFromOutline(spaceId, input, courseId?)` adds a new course, or replaces only that course's rows when `courseId` is given; `renameCourse`, `deleteCourse` in `app/course-outline-actions.ts`. `lib/server/courses.ts` `loadCourses` probes for `course_id` and, before 33, returns one legacy course with a note. UI: `app/spaces/[id]/course/page.tsx` (tabs via `?c=`, All courses overview, combined average only when every course's weights total 100), `components/CourseManage.tsx`, home widgets `HomeMarks`/`HomeTopics` with a course switcher.
- **Env:** `GIPHY_API_KEY` (server only, from developers.giphy.com) powers GIF/sticker search for custom space-home widgets. Without it the picker says GIF search isn't set up.

## AI routing, limits and pacing (migration 34, needs to be run; no dependencies)
- **Migration 34** (`supabase/migration-34-ai-slots.sql`, safe to re-run): `ai_slots` (per-provider minute/day counters), `take_ai_slot()`, `record_ai_actual()`, `ai_slots_status()`, plus `ai_pace` (pooled spend per Africa/Johannesburg hour), `ai_pace_add()`, `ai_pace_status()`. No table access for users. Before it is run the app still works (slot checks fail open, pacing sees no spend).
- **Code:** `lib/server/providers.ts` (provider list; enabled only when its key is set), `lib/server/aiRoute.ts` (`callChat`, failover on 429/5xx after honouring Retry-After once, friendly "Logia's AI is busy right now" error), `lib/server/pacing.ts`, `app/ai-admin-actions.ts` (`getAiPoolStatus`, admin only, typed, for a future admin page). `groqChat(system, user, maxTokens, purpose = "batch", task?)` and `chatWithSpace` (interactive) go through `callChat`. `callVision` (Scan, timetable photos, handwriting) and `callAudio` (Whisper: lecture and spoken-answer transcription) mirror `callChat`: capability filter, `take_ai_slot`, Retry-After once, failover, `record_ai_actual` + `logUsage`, plan-aware, same busy error. Callers still run `enforceRateLimit` once and pass supabase/userId/plan so the router does not re-check. Vision and audio order follows `priority` (not speed). A timetable with only text uses `callChat`. Lecture-notes generation (`generateStudyMaterials`) and PDF mind-map chunking (`app/pdf-actions.ts`) use `callChat` (batch) too, so no AI call bypasses the router. `GROQ_CHAT_URL`, `GROQ_CHAT_MODEL` and `groqHeaders` are still exported from `llm.ts` but unused outside `lib/server`.
- **Slot buckets:** `Provider.slotKey` (default the provider id) names the `take_ai_slot` bucket. `nvidia` (chat) and `nvidia-vision` share `slotKey: "nvidia"` because NVIDIA's free limit is per account; Groq chat, vision and audio are one entry so already share. `poolBudget` counts a shared bucket once.
- **Env vars:** `GROQ_API_KEY` (existing), `CEREBRAS_API_KEY`, `NVIDIA_API_KEY`, `CLOUDFLARE_API_KEY` and `CLOUDFLARE_ACCOUNT_ID` (both needed). Optional NVIDIA overrides: `NVIDIA_BASE_URL`, `NVIDIA_MODEL` (chat, already existed) and `NVIDIA_VISION_MODEL` (e.g. `meta/llama-3.2-11b-vision-instruct`; vision entry is on only when this and `NVIDIA_API_KEY` are set; fallback only, priority 10, after both Groq entries). **Each provider's free-tier limits and commercial-use terms must be verified against its current docs before relying on it**; the numbers in `providers.ts` are placeholders to check.
- **Routing:** interactive prefers high requests-per-minute, batch prefers a large daily pool; 0 means unknown and ranks in the middle.
- **Per-student limits** (`AI_LIMITS` in `lib/server/llm.ts`, admins exempt): minute 6,000 tokens / 8 requests; hour 25,000 / 60; day 60,000 / 300 (Africa/Johannesburg day); first 7 days after sign-up the daily token limit is 100,000. Checked minute, then hour, then day, from `llm_usage`. Bonus credits (`ai_credits`) still let a call through. The minute window judges used tokens only, so one big job is not refused by its estimate.
- **Pre-flight:** `enforceRateLimit(supabase, user, { estimate, purpose, task })` and `checkBudget(estimate, purpose, task)` refuse up front. `groqChat` does it automatically; lecture transcription too.
- **Fair share** (pooled daily budget = sum of enabled providers' daily token limits): under 30% left, per-student hour and day limits are halved; under 10% left, batch jobs (outline, paper marking, transcription, notes) are paused until the day resets and interactive ones (Ask AI, flashcards) keep working.
- **Pacing:** pooled daily budget split by hour with weights quiet 00-06 = 1, moderate 07-16 = 3, peak 17-23 = 5 (SAST). 15% of the day is an evening reserve, invisible before 17:00. Unused share carries forward; a batch call may borrow up to 50% of the next hour's share, interactive up to 100%. A tight hour waits only a few seconds, then answers "Logia's AI is busy right now. Try again in a few minutes." The day resets at SAST midnight (provider counters reset on the UTC date, 02:00 SAST).
- **Wording rule:** students never see tokens, credits, limits, providers or costs. Messages are plain ("You've done a lot of AI work this hour. It's back at 14:20.", "Marking papers is paused until tomorrow morning. Notes, flashcards and questions still work."). The sidebar meter names its window ("AI left this hour / today").
- **Ask AI:** when no passage matches, `chatWithSpace` answers from general knowledge and returns `grounded:false, noMatch:true`; `ChatBoard` shows an honest line. Context budget 5000 chars, history last 4 messages, answer max 600 tokens.

## Saved Ask AI chat (migration 36, needs to be run; no dependencies)
- **Migration 36** (`supabase/migration-36-ai-chat.sql`, safe to re-run): `ai_chat_messages` (own-row select/insert/delete only, so history is private even in a shared space). `surface` 'space' (Ask AI page, `note_id` null) or 'note' (note Ask panel, per note); `sources`/`grounded` stored so citations survive a refresh.
- **Code:** `app/chat-history-actions.ts` (`loadChat` last 50, `appendChat` trims beyond 200, `clearChat`), all fail soft. Wired in `ChatBoard.tsx` and `NoteChat.tsx` (Clear chat with inline Clear/Keep confirm, polite status). Before it is run both chats stay in memory only and Clear chat stays hidden. The "nothing matched" flag is not stored; a reloaded general answer shows the shorter general-knowledge label.

## Plans: free / pro / admin (migration 35, needs to be run; no dependencies)
- **Migration 35** (`supabase/migration-35-plans.sql`, safe to re-run): `profiles.plan` ('free'|'pro'|'admin'), `plan_until`, `plan_source`, index on (plan, plan_until). Users can read their own plan; a trigger rejects any plan change by a non-admin. SECURITY DEFINER functions: `set_user_plan(user, plan, until, source)` and `admin_find_user(email)` (admin only, via `is_logia_admin()`), and `effective_plan(user)` (expired pro reads as free, no cron). Before it is run everyone is treated as free.
- **Limits** (`PLAN_LIMITS` in `lib/server/plans.ts`; `AI_LIMITS` is the free entry): free as above; pro minute 20,000 tokens / 20 requests, hour 150,000 / 200, day 600,000 / 1,000 (fair-use ceiling only); admin unmetered. `getPlan(db, user)` reads the profile and treats an expired `plan_until` as free. `enforceRateLimit` returns the plan, `groqChat` and `chatWithSpace` pass it to `callChat`.
- **Pro skips the free pool's rationing:** org pacing, evening reserve and fair-share halving apply to free students only. Pro spend is not added to the pooled pace.
- **Routing:** each provider has `tier: "free" | "paid"`. `groq-paid` uses `GROQ_PAID_API_KEY` (enabled only when set). Pro and admin try paid providers first, then fall back to free ones; free students only ever use free providers. The served tier is logged (`[ai] ... served by groq-paid (paid tier, pro plan)`). Vision and audio are tier aware too (Pro and admin get `groq-paid` first).
- **Granting Pro by hand:** `/discover/admin`, "Plans" section: look up by email, pick an end date, Grant Pro (source 'manual'). "Remove Pro" asks to confirm. Actions in `app/plan-admin-actions.ts`, UI `app/discover/admin/PlansSection.tsx`.
- **Student view:** Pro sees no sidebar meter and no limit messages; Settings shows a plain "You're on Logia Pro" line with the end date. Free limit messages end with "Logia Pro removes the wait."
- **PAYMENT SEAM:** `grantProFromPayment(userId, until, source)` in `lib/server/plans.ts`. A future webhook calls it. It goes through `set_user_plan`, which requires an admin session today, so payments must add a trusted path (service-role client or a secret-checked function) first. Nothing calls it yet; no payment code exists.

## Windows dev gotchas
- In bash, heredocs and inline node can strip backslashes. Write scripts with the Write tool instead.
- If Turbopack shows "module factory not available", stop the dev server, delete `.next`, and restart.
- Typecheck with `npx tsc --noEmit`.

## Open ideas (offered, not agreed)
- Log café focus minutes to weekly stats.
- Private Realtime channels for café chat.
- Deepen the coral gradient for heading-text contrast.
