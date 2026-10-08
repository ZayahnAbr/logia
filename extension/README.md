# Logia School Sync (browser extension)

Syncs the deadlines from your school's learning site into Logia. Works in Chrome and Edge (Manifest V3). Plain JavaScript, no build step.

**Works with:** Brightspace (D2L), Canvas, Moodle. **Experimental:** Blackboard Learn. **Google Classroom** is not synced by this extension; connect it in Logia under Settings, School sync (it uses your Google sign-in instead).

**Your school login stays in this browser.** The extension reads your school site using the session you are already signed in with, and sends only the items it found to Logia.

## Install (unpacked)

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on Developer mode.
3. Choose Load unpacked and select this `extension` folder.
4. Pin the extension from the puzzle-piece menu so the popup is one click away.

The PNG icons are already in `icons/`. To regenerate them: `node scripts/make-icons.js`.

## Connect

1. In Logia open Settings, then School sync (browser extension), and choose New connection code. The code is shown once. Logia stores only a hash of it.
2. Open the extension popup. Enter your Logia address (Logia shows it next to the code; default `http://localhost:3000` for local development), your school's learning site address (for example `learn.myschool.edu`, https only; for a Moodle in a subfolder use the full address such as `myschool.edu/moodle`), the platform (or leave it on Detect automatically) and the code.
3. Choose Connect. Chrome asks whether the extension may use your Logia address and your school site. Allow both. If the popup closes while the prompt is open, reopen it and choose Connect again.
4. Sign in to your school site in a tab, open the popup there and choose Sync now.

The extension has no site hard-coded. It asks for access to the one school address you enter, and its reader script is registered only for that address (`/d2l/*` for Brightspace, the whole address for the others).

A connection code is tied to the first school site and platform it syncs. To switch, disconnect, revoke the code in Logia and make a new one.

### Platform detection

With Detect automatically the popup reads your school's public sign-in page and looks for markers: `/d2l/` (Brightspace), `M.cfg` or Moodle's `/lib/javascript.php` (Moodle), Instructure assets or `/login/canvas` (Canvas), `/ultra/` or `/webapps/` (Blackboard). If your school sends you to another sign-in site first, it can't tell. Then the first Sync now works it out from the page you are on (path and API probes), or you can pick the platform in the list.

## Sync

- **Sync now** reads your deadlines and shows a list. Nothing is sent until you choose Send. Items more than a week overdue start unticked.
- The popup says which method worked, for example the Canvas planner API or reading the page.
- **Auto-sync** (off by default): when on, opening your platform's to-do page (Brightspace Work To Do, Canvas dashboard or calendar, Moodle dashboard or calendar, Blackboard Ultra activity stream or calendar) sends your deadlines without the review step, at most every 20 minutes.
- Re-syncing never duplicates: each item has a stable id and is updated in place. If you send everything the API found, items in that window that are no longer listed are hidden in Logia.
- Disconnect removes the code and school address from this browser. To stop it for good, also revoke the code in Logia settings.

## What is sent

For each item you send: `source` (the platform), `sourceId`, `title`, `course`, `courseCode` (if known), `type` (assignment, quiz, discussion, checklist, event, other), `dueAt`, `url` (a link on your school site) and `completed` (only if known). Plus your school's address (so Logia can check links), the platform and, for a full sync, the time window that was read.

Never sent: your password, cookies, session, XSRF token or Moodle session key, page HTML, grades, descriptions, submissions or file contents. The service worker rebuilds every item from that list of fields, and Logia's server and database check them again. Links must be https and on your school's address, or the item is rejected.

## Permissions

- `http://localhost:3000/*`: Logia during local development. Any other Logia address is requested from you when you connect.
- Optional `https://*/*`: lets the extension ask for exactly two addresses when you connect, your Logia address and your school's site. Nothing else is granted.
- `storage`: keeps your connection code, addresses, platform and last sync on this device.
- `scripting`: registers the reader script for your school's address, injects it into a school tab that was already open, and (Moodle only) reads Moodle's `M.cfg.sesskey` and `wwwroot` from the page. The key is used only for the request to your own Moodle.

## Endpoints assumed (not tested against live sites)

I could not sign in to real school sites while building this. These routes are written from each platform's documentation and need checking on a real account. Every request is same-origin with your session cookie.

**Brightspace**
- `GET /d2l/api/versions/`, then `GET /d2l/api/lp/{ver}/enrollments/myenrollments/?orgUnitTypeId=3` (active course offerings) and `GET /d2l/api/le/{ver}/calendar/events/myEvents/?orgUnitIdsCSV=...&startDateTime=...&endDateTime=...` (due date is `EndDateTime`). Header `X-Csrf-Token` from `localStorage["XSRF.Token"]`. The newest few versions are tried in turn.
- Fallback: the Work To Do page, reading links and nearby text through open shadow roots (best effort; course names can be wrong).

**Canvas**
- `GET /api/v1/planner/items?start_date=..&end_date=..&per_page=100`, following the `Link: rel="next"` header on the same origin. Responses may start with `while(1);`, which is stripped. Uses `plannable_type`, `plannable.title`, `context_name`, `plannable_date` or `plannable.due_at`, `html_url`, and `submissions.submitted` or `planner_override.marked_complete` for done. Announcements are skipped.

**Moodle**
- `POST {wwwroot}/lib/ajax/service.php?sesskey=..&info=core_calendar_get_action_events_by_timesort` with `[{index:0, methodname:"core_calendar_get_action_events_by_timesort", args:{timesortfrom, timesortto, limitnum:50, aftereventid}}]`, paged with `lastid`. `wwwroot` and `sesskey` come from `M.cfg` (page world) or the logout link, so a Moodle in a subfolder works. This lists items that still need action, so finished items drop off.

**Blackboard Learn (experimental)**
- `GET /learn/api/public/v1/calendars/items?since=..&until=..`, then `GET /learn/api/v1/calendars/items?since=..&until=..`. Many sites refuse session cookies on these routes. If both fail, it reads the Ultra page for links to assessments, assignments and discussions and a nearby date. Expect gaps.

## Limitations

- Brightspace, Canvas and Moodle are the supported platforms; Blackboard is experimental and may find nothing. Heavily customised sites may differ from the documented routes.
- Brightspace and Moodle calendar routes do not report whether you have submitted something, so Brightspace items are not marked done.
- Calendar events that are not deadlines (for example lectures) can appear. Untick them in the review list.
- Page reading needs the list visible and English-style dates (`12 Oct 2026`, `Oct 12`, `Today`).
- Max 500 items per sync.
- It does not sign in for you and does not work if you are signed out.
- Chrome and Edge only. Not packaged for the Chrome Web Store.
