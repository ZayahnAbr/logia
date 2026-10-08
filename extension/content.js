// Logia School Sync: content script.
// Runs on your school learning site (registered only for the address you gave), reads your deadlines with YOUR existing session, same-origin,
// and hands only {title, course, due date, link} back to the extension. It never reads or sends cookies,
// tokens, grades, page HTML or file contents. The XSRF token (Brightspace) or session key (Moodle) is read only
// to authorise the request to your own school site and is never passed on.
(() => {
  "use strict";
  if (window.__logiaSchoolSyncLoaded) return;
  window.__logiaSchoolSyncLoaded = true;

  const DAY = 86400000;
  const BACK_DAYS = 30;
  const AHEAD_DAYS = 120;
  const MAX_ITEMS = 500;
  const AUTO_MIN_GAP = 20 * 60 * 1000;
  const TYPES = ["assignment", "quiz", "discussion", "checklist", "event", "other"];

  const clip = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);

  // ---------- D2L API (assumed routes, see README) ----------

  function xsrfToken() {
    try { return localStorage.getItem("XSRF.Token") || ""; } catch (e) { return ""; }
  }

  async function d2lGet(path) {
    const headers = { Accept: "application/json" };
    const t = xsrfToken();
    if (t) headers["X-Csrf-Token"] = t;
    const res = await fetch(path, { method: "GET", credentials: "include", headers, redirect: "follow" });
    if (res.status === 401 || res.status === 403) {
      const err = new Error(res.status === 401 ? "not signed in" : "access denied");
      err.status = res.status;
      throw err;
    }
    if (!res.ok) {
      const err = new Error("HTTP " + res.status);
      err.status = res.status;
      throw err;
    }
    const ct = res.headers.get("content-type") || "";
    if (!/json/i.test(ct)) {
      // A login redirect returns HTML. Treat it as "not signed in" rather than a parse error.
      const err = new Error("not signed in");
      err.status = 401;
      throw err;
    }
    return res.json();
  }

  function cmpVersion(a, b) {
    const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  async function discoverVersions() {
    const list = await d2lGet("/d2l/api/versions/");
    const out = {};
    for (const p of Array.isArray(list) ? list : []) {
      if (!p || !p.ProductCode) continue;
      const sup = Array.isArray(p.SupportedVersions) ? p.SupportedVersions.slice() : [];
      if (p.LatestVersion && sup.indexOf(p.LatestVersion) < 0) sup.push(p.LatestVersion);
      sup.sort(cmpVersion).reverse();
      out[p.ProductCode] = sup;
    }
    if (!out.lp || !out.lp.length || !out.le || !out.le.length) throw new Error("API versions not listed");
    return out;
  }

  // Try the newest few supported versions of a product until one accepts the call.
  async function withVersion(versions, fn) {
    let last = null;
    for (const v of versions.slice(0, 4)) {
      try { return await fn(v); } catch (e) {
        if (e && (e.status === 404 || e.status === 400)) { last = e; continue; }
        throw e;
      }
    }
    throw last || new Error("no usable API version");
  }

  function sameOriginPath(next) {
    try {
      const u = new URL(next, location.origin);
      return u.origin === location.origin ? u.pathname + u.search : null;
    } catch (e) { return null; }
  }

  async function getCourses(ver) {
    const courses = new Map();
    let bookmark = "";
    for (let page = 0; page < 20; page++) {
      const q = "/d2l/api/lp/" + ver + "/enrollments/myenrollments/?orgUnitTypeId=3" + (bookmark ? "&bookmark=" + encodeURIComponent(bookmark) : "");
      const data = await d2lGet(q);
      const items = Array.isArray(data) ? data : (data.Items || (data.PagedResultSet && data.PagedResultSet.Items) || []);
      for (const it of items) {
        const ou = it && it.OrgUnit;
        if (!ou || ou.Id == null) continue;
        const t = ou.Type || {};
        const isCourse = t.Id === 3 || t.Code === "Course Offering" || /course offering/i.test(t.Name || "");
        if (!isCourse) continue;
        const access = it.Access || {};
        if (access.IsActive === false || access.CanAccess === false) continue;
        courses.set(String(ou.Id), { id: String(ou.Id), name: clip(ou.Name, 200), code: clip(ou.Code, 40) });
      }
      const paging = data.PagingInfo || (data.PagedResultSet && data.PagedResultSet.PagingInfo);
      if (paging && paging.HasMoreItems && paging.Bookmark) bookmark = paging.Bookmark; else break;
    }
    return courses;
  }

  async function getEvents(ver, ids, start, end) {
    const out = [];
    for (let i = 0; i < ids.length; i += 20) {
      const chunk = ids.slice(i, i + 20);
      let path = "/d2l/api/le/" + ver + "/calendar/events/myEvents/?orgUnitIdsCSV=" + chunk.join(",") +
        "&startDateTime=" + encodeURIComponent(start.toISOString()) + "&endDateTime=" + encodeURIComponent(end.toISOString());
      for (let page = 0; path && page < 10; page++) {
        const data = await d2lGet(path);
        const objs = Array.isArray(data) ? data : (data.Objects || data.Items || []);
        for (const o of objs) out.push(o);
        path = !Array.isArray(data) && data.Next ? sameOriginPath(data.Next) : null;
      }
    }
    return out;
  }

  // ---------- Helpers shared by both methods ----------

  function absoluteUrl(link) {
    if (!link) return "";
    try {
      const u = new URL(link, location.origin);
      if (u.protocol !== "https:" || u.hostname !== location.hostname) return "";
      return u.toString().slice(0, 600);
    } catch (e) { return ""; }
  }

  function classify(entityType, link) {
    const s = (String(entityType || "") + " " + String(link || "")).toLowerCase();
    if (/dropbox|assignment|folder_submit/.test(s)) return "assignment";
    if (/quiz|assessment/.test(s)) return "quiz";
    if (/discussion|topic/.test(s)) return "discussion";
    if (/checklist/.test(s)) return "checklist";
    if (!String(entityType || "").trim() && !String(link || "").trim()) return "event";
    return "other";
  }

  // One stable id per activity, so API and page readings of the same item never duplicate in Logia.
  function canonicalId(link) {
    try {
      const u = new URL(link, location.origin);
      const p = u.searchParams;
      const ou = p.get("ou") || p.get("orgUnitId") || "";
      let m;
      if (/\/dropbox\//i.test(u.pathname) && p.get("db")) return ou + ":dropbox:" + p.get("db");
      if (/\/quizzing\//i.test(u.pathname) && p.get("qi")) return ou + ":quiz:" + p.get("qi");
      if ((m = u.pathname.match(/\/d2l\/le\/(\d+)\/discussions\/(?:topics|threads)\/(\d+)/i))) return m[1] + ":discussion:" + m[2];
      if ((m = u.pathname.match(/\/d2l\/le\/content\/(\d+)\/(?:viewContent|Home)\/(\d+)/i))) return m[1] + ":content:" + m[2];
      if ((m = u.pathname.match(/\/ultra\/courses\/(_\d+_\d+)\/outline\/(?:assessment|assignment|discussion)\/(_\d+_\d+)/i))) return "bb:" + m[1] + ":" + m[2];
      if (/\/checklist\//i.test(u.pathname) && (p.get("checklistId") || p.get("cl"))) return ou + ":checklist:" + (p.get("checklistId") || p.get("cl"));
    } catch (e) { /* no id */ }
    return "";
  }

  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16);
  }

  function finish(map) {
    const items = Array.from(map.values()).sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
    return items.slice(0, MAX_ITEMS);
  }

  // ---------- Method 1: the D2L API ----------

  function normaliseEvent(ev, courses) {
    if (!ev) return null;
    const dueRaw = ev.EndDateTime || ev.StartDateTime || ev.EndDay || ev.StartDay;
    const due = new Date(dueRaw);
    if (!dueRaw || Number.isNaN(due.getTime())) return null;
    const title = clip(ev.Title || ev.Name, 300);
    if (!title) return null;
    const ou = ev.OrgUnitId != null ? String(ev.OrgUnitId) : "";
    const course = ou ? courses.get(ou) : null;
    const ae = ev.AssociatedEntity || {};
    const link = ae.Link || ae.Url || ev.Url || ev.Link || "";
    const url = absoluteUrl(link) || (ou ? absoluteUrl("/d2l/le/calendar/" + ou) : "");
    const type = classify(ae.AssociatedEntityType, link);
    let sourceId = canonicalId(link);
    if (!sourceId && ae.AssociatedEntityType && ae.AssociatedEntityId != null) sourceId = ou + ":" + ae.AssociatedEntityType + ":" + ae.AssociatedEntityId;
    if (!sourceId) sourceId = "cal:" + (ev.CalendarEventId != null ? ev.CalendarEventId : hash(title + due.toISOString())) + ":" + due.toISOString().slice(0, 10);
    const item = {
      source: "brightspace",
      sourceId: clip(sourceId, 200),
      title,
      course: course ? course.name : "",
      type: TYPES.indexOf(type) >= 0 ? type : "other",
      dueAt: due.toISOString(),
      url,
    };
    if (course && course.code) item.courseCode = course.code;
    return item;
  }

  async function collectViaApi(start, end) {
    const versions = await discoverVersions();
    const courses = await withVersion(versions.lp, (v) => getCourses(v));
    const ids = Array.from(courses.keys());
    const map = new Map();
    if (ids.length) {
      const events = await withVersion(versions.le, (v) => getEvents(v, ids, start, end));
      for (const ev of events) {
        const it = normaliseEvent(ev, courses);
        if (it && !map.has(it.sourceId)) map.set(it.sourceId, it);
      }
    }
    return { items: finish(map), courseCount: courses.size };
  }

  // ---------- Method 2: read the Work To Do page (open shadow roots) ----------

  const BS_ACTIVITY = /\/d2l\/(?:lms\/(?:dropbox|quizzing|checklist|survey)|le\/(?:\d+\/discussions|content|\d+\/lessons|lessons))/i;
  const BB_ACTIVITY = /\/ultra\/courses\/[^/]+\/outline\/(?:assessment|assignment|discussion)|\/webapps\/(?:assignment|blackboard\/content|discussionboard|blackboard\/execute)/i;
  let activityPath = BS_ACTIVITY;
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  function walkAnchors(root, out) {
    const visit = (node) => {
      if (node.nodeType === 1) {
        if (node.tagName === "A" && node.href) out.push(node);
        if (node.shadowRoot) for (const c of node.shadowRoot.children) visit(c);
      }
      const kids = node.children;
      if (kids) for (const c of kids) visit(c);
    };
    if (root.nodeType === 11) { for (const c of root.children) visit(c); } else visit(root);
    return out;
  }

  function isActivity(a) {
    try { const u = new URL(a.href); return u.hostname === location.hostname && activityPath.test(u.pathname); } catch (e) { return false; }
  }

  function activityAnchors(root) {
    return walkAnchors(root, []).filter(isActivity);
  }

  function parentOf(el) {
    if (el.parentElement) return el.parentElement;
    const r = el.getRootNode && el.getRootNode();
    return r && r.host ? r.host : null;
  }

  function containerFor(a) {
    let cur = a, best = a;
    for (let i = 0; i < 10; i++) {
      const p = parentOf(cur);
      if (!p || p === document.body || p === document.documentElement) break;
      const distinct = new Set(activityAnchors(p).map((x) => x.href));
      if (distinct.size > 1) break;
      best = p; cur = p;
    }
    return best;
  }

  // Visible text lines and ISO date attributes inside a container, crossing open shadow roots.
  function readContainer(el) {
    const lines = [], isoDates = [];
    const visit = (node) => {
      if (node.nodeType === 3) {
        const t = clip(node.nodeValue, 300);
        if (t) lines.push(t);
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "SLOT") return;
      for (const name of ["datetime", "date", "due-date", "end-date", "value"]) {
        const v = node.getAttribute && node.getAttribute(name);
        if (v && /^\d{4}-\d{2}-\d{2}T/.test(v)) isoDates.push(v);
      }
      if (node.shadowRoot) for (const c of node.shadowRoot.childNodes) visit(c);
      for (const c of node.childNodes) visit(c);
    };
    visit(el);
    return { lines, isoDates };
  }

  function parseLine(line, now) {
    const tm = line.match(/(\d{1,2}):(\d{2})\s*([ap])\.?m\.?/i) || line.match(/(\d{1,2}):(\d{2})/);
    let hh = 23, mm = 59;
    if (tm) {
      hh = Number(tm[1]); mm = Number(tm[2]);
      if (tm[3]) { const pm = tm[3].toLowerCase() === "p"; if (pm && hh < 12) hh += 12; if (!pm && hh === 12) hh = 0; }
    }
    let y, mo, d;
    const m1 = line.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?(?:\s+(\d{4}))?/i);
    const m2 = line.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i);
    if (m1) { d = Number(m1[1]); mo = MONTHS.indexOf(m1[2].toLowerCase()); y = m1[3] ? Number(m1[3]) : null; }
    else if (m2) { mo = MONTHS.indexOf(m2[1].toLowerCase()); d = Number(m2[2]); y = m2[3] ? Number(m2[3]) : null; }
    else if (/\btomorrow\b/i.test(line)) { const t = new Date(now.getTime() + DAY); y = t.getFullYear(); mo = t.getMonth(); d = t.getDate(); }
    else if (/\btoday\b/i.test(line)) { y = now.getFullYear(); mo = now.getMonth(); d = now.getDate(); }
    else return null;
    if (d < 1 || d > 31 || mo < 0 || hh > 23 || mm > 59) return null;
    let guessedYear = false;
    if (y == null) { y = now.getFullYear(); guessedYear = true; }
    let date = new Date(y, mo, d, hh, mm, 0, 0);
    if (guessedYear && date.getTime() < now.getTime() - 180 * DAY) date = new Date(y + 1, mo, d, hh, mm, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function parseDue(info, now) {
    for (const iso of info.isoDates) { const d = new Date(iso); if (!Number.isNaN(d.getTime())) return d; }
    const preferred = info.lines.filter((l) => /due|ends?|closes?|deadline/i.test(l));
    for (const l of preferred.concat(info.lines)) { const d = parseLine(l, now); if (d) return d; }
    return null;
  }

  const GENERIC = /^(due|overdue|today|tomorrow|assignment|quiz|discussion|checklist|survey|view|open|submitted|not submitted|completed|incomplete|work to do|upcoming|\d+)$/i;

  function guessCourse(lines, title) {
    const code = /\b[A-Z]{3,4}\d{3,4}[A-Z]?\b/;
    const rest = lines.filter((l) => l !== title && !GENERIC.test(l) && !parseLine(l, new Date(0)) && l.length <= 120);
    const withCode = rest.find((l) => code.test(l));
    return clip(withCode || rest[0] || "", 200);
  }

  function collectViaPage(now) {
    const seen = new Set();
    const map = new Map();
    let skipped = 0;
    for (const a of activityAnchors(document)) {
      if (seen.has(a.href)) continue;
      seen.add(a.href);
      const title = clip(a.textContent || a.getAttribute("aria-label") || a.title, 300);
      if (!title) continue;
      const info = readContainer(containerFor(a));
      const due = parseDue(info, now);
      if (!due) { skipped++; continue; }
      const url = absoluteUrl(a.href);
      const type = classify("", a.href);
      const course = guessCourse(info.lines, title);
      const codeMatch = course.match(/\b[A-Z]{3,4}\d{3,4}[A-Z]?\b/);
      const item = {
        source: "brightspace",
        sourceId: clip(canonicalId(a.href) || "dom:" + hash(title + "|" + due.toISOString()), 200),
        title, course, type, dueAt: due.toISOString(), url,
      };
      if (codeMatch) item.courseCode = codeMatch[0];
      if (!map.has(item.sourceId)) map.set(item.sourceId, item);
    }
    return { items: finish(map), skipped };
  }

  function waitFor(fn, ms) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        let ok = false;
        try { ok = fn(); } catch (e) { ok = false; }
        if (ok || Date.now() - t0 > ms) resolve(ok); else setTimeout(tick, 250);
      };
      tick();
    });
  }

  async function readPage(waitMs) {
    await waitFor(() => activityAnchors(document).length > 0, waitMs);
    return collectViaPage(new Date());
  }

  const isWorkToDoPage = () => /work.?to.?do/i.test(location.pathname);

  // ---------- Other platforms: Canvas, Moodle, Blackboard ----------

  const PLATFORMS = ["brightspace", "canvas", "moodle", "blackboard"];
  const PLATFORM_LABEL = { brightspace: "Brightspace", canvas: "Canvas", moodle: "Moodle", blackboard: "Blackboard (experimental)" };

  function makeItem(o) {
    const due = new Date(o.due);
    const title = clip(o.title, 300);
    if (!title || !o.sourceId || Number.isNaN(due.getTime())) return null;
    const item = {
      source: o.platform,
      sourceId: clip(o.sourceId, 200),
      title,
      course: clip(o.course, 200),
      type: TYPES.indexOf(o.type) >= 0 ? o.type : "other",
      dueAt: due.toISOString(),
      url: absoluteUrl(o.url),
    };
    if (o.courseCode) item.courseCode = clip(o.courseCode, 40);
    if (typeof o.completed === "boolean") item.completed = o.completed;
    return item;
  }

  // Canvas (and some Blackboard) JSON may start with "while(1);". Strip it before parsing.
  async function jsonGet(path, init) {
    const res = await fetch(path, Object.assign({ method: "GET", credentials: "include", redirect: "follow", headers: { Accept: "application/json" } }, init || {}));
    if (res.status === 401 || res.status === 403) {
      const err = new Error(res.status === 401 ? "not signed in" : "access denied");
      err.status = res.status;
      throw err;
    }
    if (!res.ok) {
      const err = new Error("HTTP " + res.status);
      err.status = res.status;
      throw err;
    }
    const text = (await res.text()).replace(/^\s*while\(1\);?/, "");
    let data;
    try { data = JSON.parse(text); } catch (e) {
      const err = new Error("not signed in");
      err.status = 401;
      throw err;
    }
    return { data, link: res.headers.get("link") || "" };
  }

  function nextFromLinkHeader(link) {
    const part = link.split(",").map((s) => s.trim()).find((s) => /rel="?next"?/.test(s));
    const m = part && part.match(/<([^>]+)>/);
    return m ? sameOriginPath(m[1]) : null;
  }

  // Canvas: planner items (the same list the Canvas to-do sidebar uses).
  async function collectCanvas(start, end) {
    const sd = start.toISOString().slice(0, 10), ed = end.toISOString().slice(0, 10);
    let path = "/api/v1/planner/items?start_date=" + sd + "&end_date=" + ed + "&per_page=100";
    const map = new Map();
    const courses = new Set();
    const typeMap = { assignment: "assignment", quiz: "quiz", discussion_topic: "discussion", calendar_event: "event", planner_note: "other", wiki_page: "other", assessment_request: "other" };
    for (let page = 0; path && page < 20; page++) {
      const { data, link } = await jsonGet(path);
      for (const it of Array.isArray(data) ? data : []) {
        if (!it || it.plannable_type === "announcement") continue;
        const p = it.plannable || {};
        const sub = it.submissions && typeof it.submissions === "object" ? it.submissions : null;
        const ov = it.planner_override && typeof it.planner_override === "object" ? it.planner_override : null;
        const rawId = p.id != null ? p.id : it.plannable_id;
        const item = makeItem({
          platform: "canvas",
          sourceId: (it.plannable_type || "item") + ":" + rawId,
          title: p.title || p.name,
          course: it.context_name,
          type: typeMap[it.plannable_type] || "other",
          due: it.plannable_date || p.due_at || p.todo_date,
          url: it.html_url || p.html_url,
          completed: sub ? !!(sub.submitted || sub.excused) || !!(ov && ov.marked_complete) : (ov ? !!ov.marked_complete : undefined),
        });
        if (it.course_id != null) courses.add(String(it.course_id));
        if (item && rawId != null && !map.has(item.sourceId)) map.set(item.sourceId, item);
      }
      path = nextFromLinkHeader(link);
    }
    return { items: finish(map), courseCount: courses.size };
  }

  // Moodle: session key and site root. Content scripts cannot see page variables, so ask the page world
  // (through the service worker), then fall back to the logout link. The key is only used for the request to Moodle.
  async function moodleConfig() {
    try {
      const cfg = await chrome.runtime.sendMessage({ type: "logia:moodleCfg" });
      if (cfg && cfg.sesskey && cfg.wwwroot) return cfg;
    } catch (e) { /* fall through */ }
    const a = document.querySelector('a[href*="/login/logout.php"][href*="sesskey="]');
    if (a) {
      try {
        const u = new URL(a.getAttribute("href"), location.href);
        const key = u.searchParams.get("sesskey");
        if (key) return { sesskey: key, wwwroot: u.origin + u.pathname.replace(/\/login\/logout\.php$/, "") };
      } catch (e) { /* none */ }
    }
    return null;
  }

  async function collectMoodle(start, end) {
    const cfg = await moodleConfig();
    if (!cfg) { const err = new Error("not signed in"); err.status = 401; throw err; }
    let root;
    try {
      const u = new URL(cfg.wwwroot);
      if (u.origin !== location.origin) throw new Error("other origin");
      root = u.origin + u.pathname.replace(/\/$/, "");
    } catch (e) { throw new Error("could not work out the Moodle address"); }
    const url = root + "/lib/ajax/service.php?sesskey=" + encodeURIComponent(cfg.sesskey) + "&info=core_calendar_get_action_events_by_timesort";
    const map = new Map();
    const courses = new Set();
    let after = 0;
    const typeOf = (m) => (m === "assign" ? "assignment" : m === "quiz" ? "quiz" : m === "forum" ? "discussion" : m ? "other" : "event");
    for (let page = 0; page < 10; page++) {
      const args = { timesortfrom: Math.floor(start.getTime() / 1000), timesortto: Math.floor(end.getTime() / 1000), limitnum: 50, limittononsuspendedevents: true };
      if (after) args.aftereventid = after;
      const res = await fetch(url, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify([{ index: 0, methodname: "core_calendar_get_action_events_by_timesort", args }]),
      });
      if (!res.ok) { const err = new Error("HTTP " + res.status); err.status = res.status; throw err; }
      let arr;
      try { arr = await res.json(); } catch (e) { const err = new Error("not signed in"); err.status = 401; throw err; }
      const r = Array.isArray(arr) ? arr[0] : null;
      if (!r || r.error) {
        const code = r && r.exception && r.exception.errorcode;
        const err = new Error(code === "servicerequireslogin" || code === "requireloginerror" ? "not signed in" : (r && r.exception && r.exception.message) || "unexpected reply");
        err.status = code === "servicerequireslogin" || code === "requireloginerror" ? 401 : 0;
        throw err;
      }
      const events = (r.data && r.data.events) || [];
      for (const ev of events) {
        const course = ev.course || {};
        if (course.id != null) courses.add(String(course.id));
        const item = makeItem({
          platform: "moodle",
          sourceId: String(ev.id),
          title: ev.activityname || ev.name,
          course: course.fullname,
          courseCode: course.shortname,
          type: typeOf(ev.modulename),
          due: Number(ev.timesort) * 1000,
          url: ev.url || (ev.action && ev.action.url),
        });
        if (item && !map.has(item.sourceId)) map.set(item.sourceId, item);
      }
      if (events.length < 50 || !r.data.lastid) break;
      after = r.data.lastid;
    }
    return { items: finish(map), courseCount: courses.size };
  }

  // Blackboard Learn (experimental): REST calendar items with the browser session. Often refused for sessions.
  async function collectBlackboardApi(start, end) {
    const q = "since=" + encodeURIComponent(start.toISOString()) + "&until=" + encodeURIComponent(end.toISOString());
    let last = null;
    for (const base of ["/learn/api/public/v1/calendars/items", "/learn/api/v1/calendars/items"]) {
      try {
        const { data } = await jsonGet(base + "?" + q);
        const arr = Array.isArray(data) ? data : (data.results || []);
        const map = new Map();
        const courses = new Set();
        for (const it of arr) {
          if (!it) continue;
          if (it.calendarId) courses.add(String(it.calendarId));
          const item = makeItem({
            platform: "blackboard",
            sourceId: "bb:" + it.id,
            title: it.title,
            course: it.calendarName || (it.calendarNameLocalizable && it.calendarNameLocalizable.rawValue) || "",
            type: it.type === "GradebookColumn" ? "assignment" : "event",
            due: it.end || it.start,
            url: "/ultra/calendar",
          });
          if (item && !map.has(item.sourceId)) map.set(item.sourceId, item);
        }
        return { items: finish(map), courseCount: courses.size };
      } catch (e) {
        last = e;
        if (!(e && (e.status === 401 || e.status === 403 || e.status === 404))) throw e;
      }
    }
    throw last || new Error("calendar API unavailable");
  }

  // ---------- Platform detection ----------

  async function detectPlatform() {
    const path = location.pathname;
    if (/^\/d2l\//i.test(path)) return "brightspace";
    if (/^\/(ultra|webapps)\//i.test(path)) return "blackboard";
    if (document.querySelector('meta[name="generator"][content*="Moodle" i]') || document.querySelector('a[href*="/login/logout.php"]')) return "moodle";
    try {
      const cfg = await chrome.runtime.sendMessage({ type: "logia:moodleCfg" });
      if (cfg && cfg.sesskey) return "moodle";
    } catch (e) { /* not moodle */ }
    try {
      const r = await fetch("/api/v1/courses?per_page=1", { credentials: "include", headers: { Accept: "application/json" } });
      if (/^\s*while\(1\);/.test(await r.text())) return "canvas";
    } catch (e) { /* not canvas */ }
    try {
      const r = await fetch("/d2l/api/versions/", { credentials: "include", headers: { Accept: "application/json" } });
      if (r.ok && /json/i.test(r.headers.get("content-type") || "")) return "brightspace";
    } catch (e) { /* not brightspace */ }
    return null;
  }

  // ---------- Entry point ----------

  function errorText(e) { return e && e.message ? e.message : "unknown error"; }

  async function collect(opts) {
    const wait = opts && opts.pageWaitMs != null ? opts.pageWaitMs : 3000;
    let platform = opts && PLATFORMS.indexOf(opts.platform) >= 0 ? opts.platform : null;
    if (!platform) platform = await detectPlatform();
    if (!platform) {
      return { ok: false, error: "Couldn't tell which learning platform this site uses. Disconnect, connect again and pick your platform from the list." };
    }
    const now = new Date();
    const start = new Date(now.getTime() - BACK_DAYS * DAY);
    const end = new Date(now.getTime() + AHEAD_DAYS * DAY);
    const base = { windowStart: start.toISOString(), windowEnd: end.toISOString(), origin: location.origin, platform, platformLabel: PLATFORM_LABEL[platform] };
    const apiOk = (r, label) => Object.assign({}, base, { ok: true, method: "api", methodLabel: label, items: r.items, complete: true, skipped: 0, courseCount: r.courseCount });
    const fail = (msg, signedOut) => ({ ok: false, error: signedOut ? "Your school site says you are not signed in. Sign in, then try again." : msg });
    let apiError = null;

    if (platform === "canvas" || platform === "moodle") {
      try {
        const r = platform === "canvas" ? await collectCanvas(start, end) : await collectMoodle(start, end);
        return apiOk(r, platform === "canvas" ? "Canvas planner API" : "Moodle calendar service");
      } catch (e) {
        const msg = errorText(e);
        return fail("Couldn't read your deadlines from " + PLATFORM_LABEL[platform] + ". It said: " + msg + ". Make sure you are on your school's " + PLATFORM_LABEL[platform] + " site and signed in.", /not signed in/.test(msg));
      }
    }

    if (platform === "blackboard") {
      activityPath = BB_ACTIVITY;
      try {
        const r = await collectBlackboardApi(start, end);
        return apiOk(r, "Blackboard calendar API (experimental)");
      } catch (e) { apiError = errorText(e); }
      const page = await readPage(wait);
      if (page.items.length) {
        page.items.forEach((i) => { i.source = "blackboard"; });
        return Object.assign({}, base, { ok: true, method: "page", methodLabel: "Blackboard page (experimental; the calendar API said: " + apiError + ")", items: page.items, complete: false, skipped: page.skipped, courseCount: 0 });
      }
      return fail("Blackboard support is experimental. The calendar API said: " + apiError + ", and no deadlines were readable on this page. Open your Blackboard calendar or activity stream and try again.", /not signed in/.test(apiError));
    }

    // Brightspace
    activityPath = BS_ACTIVITY;
    try {
      const api = await collectViaApi(start, end);
      if (api.items.length === 0 && isWorkToDoPage()) {
        const page = await readPage(wait);
        if (page.items.length) {
          return Object.assign({}, base, { ok: true, method: "page", methodLabel: "Work To Do page (the calendar API listed nothing)", items: page.items, complete: false, skipped: page.skipped, courseCount: api.courseCount });
        }
      }
      return apiOk(api, "Brightspace calendar API");
    } catch (e) {
      apiError = errorText(e);
    }
    const page = await readPage(wait);
    if (page.items.length) {
      return Object.assign({}, base, { ok: true, method: "page", methodLabel: "Work To Do page (the API was unavailable: " + apiError + ")", items: page.items, complete: false, skipped: page.skipped, courseCount: 0 });
    }
    return fail(
      "Couldn't read your deadlines. The API said: " + apiError + ". The page reading found nothing" +
      (page.skipped ? " it could use (" + page.skipped + " item" + (page.skipped === 1 ? "" : "s") + " had no readable date)" : "") +
      ". Open the Work To Do page and try again.",
      /not signed in/.test(apiError)
    );
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || sender.id !== chrome.runtime.id) return;
    if (msg.type === "logia:ping") { sendResponse({ ok: true }); return; }
    if (msg.type === "logia:collect") {
      collect({ pageWaitMs: 3000, platform: msg.platform }).then(sendResponse, (e) => sendResponse({ ok: false, error: e && e.message ? e.message : "Something went wrong." }));
      return true;
    }
  });

  // ---------- Optional auto-sync on the platform's to-do page (off by default) ----------

  function isAutoPage(platform) {
    const p = location.pathname;
    if (platform === "brightspace") return isWorkToDoPage();
    if (platform === "canvas") return p === "/" || /^\/(calendar|planner)/.test(p);
    if (platform === "moodle") return /\/(my|calendar)(\/|$)/.test(p);
    if (platform === "blackboard") return /\/ultra\/(stream|calendar)/.test(p);
    return false;
  }

  async function maybeAutoSync() {
    let s;
    try { s = await chrome.storage.local.get(["autoSync", "code", "lastAuto", "platform"]); } catch (e) { return; }
    if (!s.autoSync || !s.code || PLATFORMS.indexOf(s.platform) < 0) return;
    if (!isAutoPage(s.platform)) return;
    if (s.lastAuto && Date.now() - s.lastAuto < AUTO_MIN_GAP) return;
    await chrome.storage.local.set({ lastAuto: Date.now() });
    const res = await collect({ pageWaitMs: 8000, platform: s.platform });
    if (!res.ok) { await chrome.storage.local.set({ lastError: { at: new Date().toISOString(), message: res.error } }); return; }
    // Same default as the manual review: skip anything more than a week overdue.
    const cutoff = Date.now() - 7 * DAY;
    const items = res.items.filter((i) => new Date(i.dueAt).getTime() >= cutoff);
    chrome.runtime.sendMessage({
      type: "logia:send",
      items,
      complete: res.complete,
      windowStart: new Date(cutoff).toISOString(),
      windowEnd: res.windowEnd,
      method: res.method,
      platform: res.platform,
      auto: true,
    });
  }
  maybeAutoSync().catch(() => {});
})();
