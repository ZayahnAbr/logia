# StudySpace — Next.js + Supabase (foundation slice)

The real, multi-user version of the v1 loop: sign in, create/join a Space, author cards, and run recall sessions where **each person has their own spaced-repetition schedule** — all enforced by Supabase RLS.

## What's in here
This is **not** a whole standalone project — it's the StudySpace-specific files that sit on top of the official Supabase starter, which already gives you auth pages, sign-out, and the base layout.

```
lib/supabase/client.ts      browser Supabase client
lib/supabase/server.ts      server client (Server Components / Actions)
lib/supabase/middleware.ts  session refresh helper
middleware.ts               wires the refresh into every request
lib/types.ts                domain types
lib/scheduler.ts            spaced-repetition ladder (pure, testable)
lib/queries.ts              server-side reads (spaces, decks, due cards)
app/actions.ts              server actions (create/join, decks, cards, rate, focus log)
app/globals.css             StudySpace theme (dark)
app/layout.tsx              root layout (imports globals.css)
app/page.tsx                redirects to /spaces
app/spaces/…                spaces list + create/join
app/spaces/[id]/…           one space: due count, focus timer, review, decks
app/spaces/[id]/decks/…     deck editor (author/delete cards)
supabase/migration-02-card-reviews.sql   the per-user schedule table
```

## Setup (once)
1. **Base project** — if you haven't already:
   ```bash
   npx create-next-app -e with-supabase studyspace
   cd studyspace
   npm install lucide-react
   ```
2. **Drop these files in**, overwriting where names match (`app/layout.tsx`,
   `app/globals.css`, `app/page.tsx`, and the `lib/supabase/*` helpers if the
   template's differ). Keep the template's `login` / `auth` routes as-is.
3. **Environment** — copy `.env.local.example` to `.env.local` and paste your
   Supabase URL + publishable key. (The template may name the key variable
   slightly differently — match its `.env.example`; the key value is the same.)
4. **Database** — in the Supabase SQL Editor run, in order:
   - your first migration (schema + RLS), then
   - `supabase/migration-02-card-reviews.sql`
5. **Login route** — the server pages redirect to `/auth/login` when signed
   out. If your template uses `/login`, do a find-and-replace across these files.
6. `npm run dev` → open http://localhost:3000.

## First run
Sign up → you land on **/spaces** → create a Peer Space → open it → **New deck**
→ open the deck → author a card or two → back on the space, hit **Review due
cards**. Rate them and watch the due count and mastery move. Start a focus
timer; when it ends you get a recall break with your due cards.

## What this slice does NOT include yet
Lecture upload / transcription, on-device AI card generation, the teacher
cohort-analytics dashboard, billing, and light mode. Each is an additive layer
on this same foundation.
