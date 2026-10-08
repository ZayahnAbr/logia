// Logia School Sync: service worker.
// The only place that talks to Logia. It sends the extracted items and the connection code, nothing else.
// Your school cookies, tokens and page content never reach this file.

const DEFAULT_ORIGIN = "http://localhost:3000";
const TYPES = ["assignment", "quiz", "discussion", "checklist", "event", "other"];
const MAX_ITEMS = 500;
const PLATFORMS = ["brightspace", "canvas", "moodle", "blackboard"];

const clip = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);

// A link is kept only if it is https and on the school origin the user connected.
function allowedUrl(raw, school) {
  if (!school) return "";
  try {
    const u = new URL(String(raw || ""));
    if (u.protocol === "https:" && u.origin === school) return u.toString().slice(0, 600);
  } catch (e) { /* not a url */ }
  return "";
}

function schoolOriginOf(raw) {
  try {
    const u = new URL(String(raw || "").trim().includes("://") ? String(raw).trim() : "https://" + String(raw || "").trim());
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) return null;
    return u.origin;
  } catch (e) { return null; }
}

// Rebuild every item from the allowed fields only, so nothing extra can ride along.
function cleanItems(items, school, platform) {
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== "object") continue;
    const sourceId = clip(it.sourceId, 200);
    const title = clip(it.title, 300);
    const due = new Date(it.dueAt);
    if (!sourceId || !title || Number.isNaN(due.getTime())) continue;
    const row = {
      source: platform,
      sourceId,
      title,
      course: clip(it.course, 200),
      type: TYPES.indexOf(it.type) >= 0 ? it.type : "other",
      dueAt: due.toISOString(),
      url: allowedUrl(it.url, school),
    };
    const code = clip(it.courseCode, 40);
    if (code) row.courseCode = code;
    if (typeof it.completed === "boolean") row.completed = it.completed;
    out.push(row);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function normaliseOrigin(raw) {
  try {
    const u = new URL(String(raw || DEFAULT_ORIGIN));
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
    return u.origin;
  } catch (e) { return null; }
}

async function getConfig() {
  const s = await chrome.storage.local.get(["code", "logiaOrigin", "schoolOrigin", "platform"]);
  return { code: s.code || "", origin: normaliseOrigin(s.logiaOrigin) || DEFAULT_ORIGIN, school: schoolOriginOf(s.schoolOrigin), platform: s.platform || "" };
}

async function post(origin, code, body) {
  if (!code) return { ok: false, error: "Not connected. Paste your connection code first." };
  const granted = await chrome.permissions.contains({ origins: [origin + "/*"] });
  if (!granted) return { ok: false, error: "The extension isn't allowed to talk to " + origin + " yet. Open the popup, choose Disconnect, and connect again to grant it." };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  let res;
  try {
    res = await fetch(origin + "/api/lms/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + code },
      body: JSON.stringify(body),
      credentials: "omit",
      cache: "no-store",
      signal: ctl.signal,
    });
  } catch (e) {
    return { ok: false, error: "Couldn't reach Logia at " + origin + ". Check the address and that Logia is running." };
  } finally {
    clearTimeout(timer);
  }
  let data = {};
  try { data = await res.json(); } catch (e) { /* not json */ }
  if (res.ok && data && data.ok) return { ok: true, count: typeof data.count === "number" ? data.count : 0 };
  if (res.status === 401) return { ok: false, error: (data && data.error) || "Logia doesn't recognise that connection code. Make a new one in Settings, School sync.", invalidCode: true };
  return { ok: false, error: (data && data.error) || "Logia couldn't save the sync (error " + res.status + ")." };
}

async function handleSend(msg) {
  const { code, origin, school, platform: stored } = await getConfig();
  const platform = PLATFORMS.indexOf(msg.platform) >= 0 ? msg.platform : stored;
  if (PLATFORMS.indexOf(platform) < 0) return { ok: false, error: "Logia does not know which learning platform your school uses yet. Choose Sync now once on your school site first." };
  if (!school) return { ok: false, error: "No school address saved. Disconnect and connect again." };
  const items = cleanItems(msg.items, school, platform);
  const body = { items, origin: school, platform };
  if (msg.complete === true && msg.windowStart && msg.windowEnd) {
    const s = new Date(msg.windowStart), e = new Date(msg.windowEnd);
    if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime())) {
      body.complete = true;
      body.windowStart = s.toISOString();
      body.windowEnd = e.toISOString();
    }
  }
  const result = await post(origin, code, body);
  if (result.ok) {
    await chrome.storage.local.set({
      lastSync: { at: new Date().toISOString(), count: result.count, method: clip(msg.method, 20), auto: msg.auto === true },
      lastError: null,
      platform,
    });
  } else {
    await chrome.storage.local.set({ lastError: { at: new Date().toISOString(), message: result.error } });
  }
  return result;
}

// Check a code before saving it: an empty sync proves the code works and changes nothing.
async function handleVerify(msg) {
  const origin = normaliseOrigin(msg.origin);
  if (!origin) return { ok: false, error: "Use an https address, or http://localhost for local development." };
  const school = schoolOriginOf(msg.school);
  if (!school) return { ok: false, error: "Enter your school's learning site address, for example learn.myschool.edu." };
  return post(origin, String(msg.code || "").trim(), { items: [], origin: school, platform: PLATFORMS.indexOf(msg.platform) >= 0 ? msg.platform : null });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string" || sender.id !== chrome.runtime.id) return;
  if (msg.type === "logia:send") {
    handleSend(msg).then(sendResponse, () => sendResponse({ ok: false, error: "Something went wrong sending to Logia." }));
    return true;
  }
  if (msg.type === "logia:moodleCfg") {
    // Moodle keeps its session key and site root in a page variable (M.cfg) that content scripts cannot see.
    // Read just those two values from the page world of the tab that asked. They are not sent anywhere but back to that tab.
    const tabId = sender.tab && sender.tab.id;
    if (tabId == null) { sendResponse(null); return; }
    chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => (window.M && window.M.cfg && window.M.cfg.sesskey ? { sesskey: String(window.M.cfg.sesskey), wwwroot: String(window.M.cfg.wwwroot || "") } : null),
    }).then((r) => sendResponse((r && r[0] && r[0].result) || null), () => sendResponse(null));
    return true;
  }
  if (msg.type === "logia:verify") {
    handleVerify(msg).then(sendResponse, () => sendResponse({ ok: false, error: "Something went wrong checking the code." }));
    return true;
  }
});
