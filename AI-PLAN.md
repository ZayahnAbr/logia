# Logia AI plan

How Logia's AI capacity, limits and plans work, what we decided and why, and what is left to do before launch.

Last updated 9 October 2026.

---

## 1. The problem

Logia runs on free AI provider tiers. Groq's free allowance for the chat model is roughly **200,000 tokens a day**, which is about **5 to 8 active students**. A single student could previously use more than the whole app's daily allowance by themselves, and there was nothing stopping every Logia server from calling the provider at once until it refused.

So we needed three things:

1. **More capacity**, by pooling several providers instead of relying on one.
2. **Fair sharing**, so one student cannot use up everyone else's day.
3. **A paid plan**, so students who want more can have it without taking it from the free pool.

---

## 2. What a student actually costs

Measured from the code, not guessed:

| Action | Rough tokens |
| --- | --- |
| Ask AI question | 3,000 to 4,000 |
| Flashcards from a note | 1,000 to 2,000 |
| Generate notes from a file | 5,000 to 15,000 |
| Timetable photo | 5,000 to 10,000 |
| Mark a past paper | 15,000 to 30,000 |
| Read a course outline | 20,000 to 30,000 |

- **A normal study session** is 10,000 to 20,000 tokens.
- **A setup day** (outline, timetable, a marked paper) is 50,000 to 80,000.
- **Plan on about 25,000 per active student per day.**

**Capacity formula:**

```
Active students a day = (pooled daily tokens x 0.7) / 25,000
```

The 0.7 leaves room for spikes. With Groq alone that is about 5 students. With Groq, NVIDIA and Cerebras it is roughly 30 to 40.

---

## 3. Several providers instead of one

Adding a provider is one environment variable plus one entry in `lib/server/providers.ts`.

| Provider | Free allowance (verify before relying on it) | Used for |
| --- | --- | --- |
| **Groq** | 30 requests a minute, 1,000 a day, about 200,000 tokens a day | Everything. The only one that does vision and audio. |
| **NVIDIA NIM** | 40 a minute, 10,000 a day | Best overflow for questions |
| **Cerebras** | about 1M tokens a day, 5 a minute | Big jobs: outlines, paper marking |
| **Cloudflare Workers AI** | 10,000 "neurons" a day | Cheap failover |

**Deliberately not used:**

- **Cohere:** non-commercial only, so it cannot be used in a paid product.
- **Gemini and Mistral free tiers:** prompts may be used for training. Students upload notes and marked papers, so this is a privacy problem and a POPIA risk.

**How a call is routed:**

1. Pick providers that are switched on, can do the job, and have room.
2. **Quick things** (Ask AI, flashcards) go to whichever has the most requests to spare.
3. **Big jobs** (outlines, paper marking) go to whichever has the most tokens to spare.
4. On a rate limit or an outage, wait the moment the provider suggests, then try the next one. Students see nothing.
5. If everything is full: "Logia's AI is busy right now. Try again in a few minutes."

**Shared counter.** Every Logia server shares one set of counters in the database (`ai_slots`), so they cannot collectively overshoot a provider's limit.

---

## 4. Per-student limits

Checked in order: minute, then hour, then day. Admins are exempt.

| Window | Free | Pro |
| --- | --- | --- |
| Per minute | 6,000 tokens / 8 requests | 20,000 / 20 |
| Per hour | 25,000 tokens / 60 requests | 150,000 / 200 |
| Per day | 60,000 tokens / 300 requests | 600,000 / 1,000 |

- **First week:** new students get 100,000 a day for their first 7 days, so setting up a course never fails. That is when a failure loses someone.
- **The minute limit** exists for fairness at busy times, not thrift. Nobody reads faster than 6,000 tokens a minute.
- **The day limit** is a ceiling for the heaviest day, not expected use. Typical is 15,000 to 25,000.
- **Pro's limits** are a fair-use ceiling only. A normal student will never meet them.

---

## 5. Never running out mid-day

The pooled daily budget is spread across the day rather than used first come, first served.

- **Weighted by when students study** (South African time): 00:00 to 06:00 is light, 07:00 to 16:00 moderate, 17:00 to 23:00 heaviest.
- **Quiet hours carry forward.** An unused share passes to the next hour.
- **Borrowing is capped.** A big job may borrow up to half of the next hour's share, a quick one up to all of it. One spike cannot eat the evening.
- **15% is held back until 5pm,** so late studiers always have something.
- **Under 30% left:** free students' hour and day limits halve.
- **Under 10% left:** big jobs pause, questions and flashcards keep working.
- **Busy, not broken.** When an hour is tight but the day is not, calls wait briefly and say the app is busy. A real refusal only happens when the day is genuinely gone.

---

## 6. What students see

**Rule: never expose the mechanics.** No tokens, credits, limits, quotas, providers, models or queues in anything a student reads.

| Situation | Message |
| --- | --- |
| Used their own share, over 2 minutes | "You've done a lot of AI work this hour. It's back at 14:20." |
| Used their own share, under 2 minutes | "Try again in about 40 seconds." |
| Used their day | "You've done a lot of AI work today. It's back tomorrow morning." |
| The app is under pressure | "Logia's AI is busy right now. Try again in a few minutes." |
| A big job cannot start | "There isn't enough AI time left to mark a whole paper right now. It's back at 14:20." |
| Big jobs paused | "Marking papers, reading course outlines and transcribing lectures are paused until tomorrow morning. Notes, flashcards and questions still work." |

Two rules kept throughout: it never says "busy" when it is the student's own usage, and it never blames the student when it is the pool. Free students' limit messages end with one short line, "Logia Pro removes the wait."

**Pro students see none of this.** No meter, no messages, no waiting. Settings shows their plan and renewal date. That silence is the product.

---

## 7. Ask AI

We considered deleting it. We kept it and fixed it instead.

**What was wrong:** when its search found nothing it gave up without answering, and its search matched keywords rather than meaning, so any paraphrase failed.

**What changed:**

- **No dead ends.** If nothing in the student's material matches, it answers from general knowledge and says plainly that the answer is not from their notes.
- **A third cheaper per question:** context cut from 7,000 to 5,000 characters, history from 6 messages to 4, answer cap from 900 to 600 tokens.

---

## 8. Pro

**Pro does not mean unlimited.** It means much higher limits, priority, and its own budget. Even ChatGPT and Claude Pro have ceilings.

**The key decision: Pro runs on a paid key.** Free students use the free tiers. Pro students use a paid provider key, where you pay per token. So Pro students never queue behind free ones, free students are never crowded out, and the cost scales exactly with revenue.

**The economics.** Open models like `gpt-oss-120b` cost cents per million tokens on a paid tier. A heavy Pro student at 60,000 tokens a day is under 2 million a month, well under a dollar. At R99 the margin is comfortable. Check current per-million prices and redo the sum before setting the price.

**Pro also skips** the pacing, the evening reserve and the fair-share halving, because those exist to ration the free pool.

**Granting Pro:** by hand for now, at `/discover/admin` in the **Plans** section. Look the student up by email, pick an end date, grant. They drop back to free automatically when it expires, with no job needed.

**Pricing page** describes Pro honestly: no waiting at busy times, big jobs always available, priority when the app is busy. It does not promise "unlimited".

---

## 9. Launch checklist

### Must do

**Run these migrations in the Supabase SQL editor, in order.** All are safe to re-run. Only 22 has been confirmed as run.

| Migration | What it does |
| --- | --- |
| 23 user cafés | Student-hosted study rooms (needs 22) |
| 24 café backgrounds | Picture or colour room backgrounds (needs 23) |
| 25 space widgets | Image, text and sticker widgets, widget colours |
| 26 notebooks | Notebooks with covers, replacing note folders (needs 25) |
| 27 saved stickers | Personal sticker library (needs 25) |
| 28 sticky stickers | Sticky notes become movable stickers (needs 16 and 25) |
| 29 school sync | Brightspace, Canvas, Moodle, Blackboard, Google Classroom |
| 30 course outline | Course setup, assessments, topics (needs 25 and 26) |
| 31 timetable | Weekly classes |
| 32 timetable style | Class colours and notes (needs 31) |
| 33 multi-course | Several courses per space (needs 30) |
| **34 ai slots** | **Shared provider counters and pacing. Needed for everything in this document.** |
| **35 plans** | **Free, Pro and admin plans** |

**Environment variables.** Only `GROQ_API_KEY` is set today.

| Variable | Needed for | Where to get it |
| --- | --- | --- |
| `GROQ_API_KEY` | Already set | console.groq.com |
| `NVIDIA_API_KEY` | More capacity | build.nvidia.com, free developer account |
| `NVIDIA_BASE_URL`, `NVIDIA_MODEL` | Optional. Only if your endpoint or model name differs from the default | Shown on your NVIDIA endpoint page |
| `NVIDIA_VISION_MODEL` | Optional. Turns on NVIDIA as a vision fallback (needs `NVIDIA_API_KEY` too). Example: `meta/llama-3.2-11b-vision-instruct` | Shown on your NVIDIA endpoint page |
| `CEREBRAS_API_KEY` | Big jobs | cloud.cerebras.ai |
| `CLOUDFLARE_API_KEY` and `CLOUDFLARE_ACCOUNT_ID` | Failover | dash.cloudflare.com |
| `GROQ_PAID_API_KEY` | Pro students | A Groq account with billing enabled |
| `GIPHY_API_KEY` | Not needed. GIF search was removed. | - |

Vision (Scan, timetable photos, handwriting) and audio (Whisper) now go through the router like chat: slot reservation, Retry-After once, failover, and Pro/admin prefer the paid Groq key. NVIDIA vision is a fallback only (an 11B model is likely weaker than Groq's qwen vision), tried after both Groq entries. NVIDIA's free limit is per account, so its chat and vision entries share one slot bucket (`slotKey: "nvidia"`). Audio has only Groq Whisper today.

**Check each provider's terms before switching it on.** Two things matter:

1. **Commercial use.** Logia is a paid product. Some free tiers are for personal projects only.
2. **Data handling.** Whether prompts are retained or used for training. Student notes and marked papers go through these calls, so this affects your privacy policy and POPIA position.

**Google sign-in** (already discussed, not yet done):

- Supabase, Authentication, Providers, Google: paste the client ID and secret, and enable it.
- Google Cloud, Credentials, your OAuth client: add `http://localhost:3000` as an authorised origin, and `https://lbgfokbnzifgupfzdysi.supabase.co/auth/v1/callback` as a redirect URI. Add your live site too when it exists.
- Supabase, Authentication, URL Configuration: set the site URL and add `http://localhost:3000/auth/callback**` to the redirect list.

**For Google Classroom** (optional, same Google Cloud project):

- Enable the **Google Classroom API**.
- Add the three read-only Classroom scopes to the consent screen.
- Add yourself and testers as test users. Until Google reviews the app, students see an "unverified app" warning and it is capped at 100 users.
- In Supabase, turn on manual identity linking.

### Should do before real students arrive

- **Pick your pooled budget.** With Groq alone you can serve about 5 students a day. Add at least NVIDIA and Cerebras before launch.
- **Test the limits.** Grant yourself Pro at `/discover/admin` and confirm the meter disappears and big jobs run without waiting.
- **Watch the first week.** `getAiPoolStatus()` returns today's spend, the current hour's share, the reserve and a projected run-out time. Build the admin page on top of it, or just call it, to see the squeeze coming before a student does.
- **Re-measure.** After a week of real use, work out tokens per active student per day from the `llm_usage` table and plan with the 90th percentile, not the average. A few heavy students will use more than everyone else combined.

### Not done, and deliberately so

- **Payments.** `grantProFromPayment(userId, until, source)` in `lib/server/plans.ts` is the seam a future webhook will call. Nothing calls it yet. Paystack, Payfast and Yoco are the usual South African choices; check Stripe's current local support. The webhook will also need a trusted path to set a plan, since it has no admin session.
- **Direct provider calls.** None left outside `lib/server`. Every AI call (chat, vision, audio, lecture notes, mind-map chunking) goes through the router.
- **An admin usage page.** The data function exists; the page does not.

---

## 10. Known gaps

- **Provider numbers are unverified.** Especially Cloudflare's neuron quota and NVIDIA's account limits. They are flagged in `lib/server/providers.ts`.
- **Pacing is approximate.** Concurrent calls can overshoot an hour slightly. The per-provider reservation itself is exact.
- **Two different day boundaries.** Pacing resets at South African midnight; provider counters reset on the UTC date, which is 02:00 locally.
- **Nothing here has been run against a live provider or a real database.** The code typechecks and the pages load, but the first real test will be yours.
