// Logia School Sync: popup.
// Flow: connect with a code -> Sync now (asks the school tab to read your deadlines) -> review -> send.
// Page text is only ever put on screen with textContent.

const DEFAULT_ORIGIN = "http://localhost:3000";
const DAY = 86400000;
const PLATFORM_NAME = { brightspace: "Brightspace", canvas: "Canvas", moodle: "Moodle", blackboard: "Blackboard, experimental" };
const TYPE_LABEL = { assignment: "Assignment", quiz: "Quiz", discussion: "Discussion", checklist: "Checklist", event: "Event", other: "Item" };

const $ = (id) => document.getElementById(id);
let collected = null; // { items, complete, windowStart, windowEnd, method, methodLabel }
let busy = false;

function status(text, kind) {
  const el = $("status");
  el.textContent = text || "";
  el.className = "status" + (kind ? " " + kind : "");
}

function setBusy(b) {
  busy = b;
  $("sync").disabled = b;
  $("send").disabled = b;
  $("connect-btn").disabled = b;
}

function normaliseOrigin(raw) {
  try {
    const u = new URL(String(raw || "").trim() || DEFAULT_ORIGIN);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
    return u.origin;
  } catch (e) { return null; }
}

const fmtDate = (iso) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtWhen = (iso) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// ---------- Rendering ----------

async function render() {
  const s = await chrome.storage.local.get(["code", "logiaOrigin", "schoolOrigin", "platform", "lastSync", "lastError", "autoSync"]);
  const connected = !!s.code && !!s.schoolOrigin;
  schoolOrigin = s.schoolOrigin || "";
  $("connect").hidden = connected;
  $("home").hidden = !connected;
  if (!connected) {
    if (!$("origin").value) $("origin").value = s.logiaOrigin || DEFAULT_ORIGIN;
    return;
  }
  $("conn-line").textContent = "Connected to Logia at " + (s.logiaOrigin || DEFAULT_ORIGIN) + ". School site: " + s.schoolOrigin + (PLATFORM_NAME[s.platform] ? " (" + PLATFORM_NAME[s.platform] + ")" : "");
  const ls = s.lastSync;
  $("last-line").textContent = ls
    ? "Last sync " + fmtWhen(ls.at) + ", " + ls.count + " item" + (ls.count === 1 ? "" : "s") + (ls.method === "api" ? ", from the calendar API" : ls.method === "page" ? ", read from the page" : "") + (ls.auto ? " (auto)" : "")
    : "Not synced yet.";
  $("auto").checked = !!s.autoSync;
  if (s.lastError && s.lastError.message && !$("status").textContent) status("Last attempt failed: " + s.lastError.message, "error");
  await updateTabState();
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

let schoolOrigin = "";

// A school address typed by the user: adds https:// if missing, rejects anything that is not https.
function normaliseSchool(raw) {
  const t = String(raw || "").trim();
  if (!t) return null;
  try {
    const u = new URL(t.includes("://") ? t : "https://" + t);
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) return null;
    return u.origin;
  } catch (e) { return null; }
}

function tabIsLms(tab) {
  if (!tab || !tab.url || !schoolOrigin) return false;
  try { return new URL(tab.url).origin === schoolOrigin; } catch (e) { return false; }
}

// The reader script is registered only for the school's own origin. Brightspace lives under /d2l/; the other
// platforms (and a not-yet-detected one) can live anywhere on the origin, including a Moodle subfolder.
async function registerSchoolScript(origin, platform) {
  try { await chrome.scripting.unregisterContentScripts({ ids: ["school-sync"] }); } catch (e) { /* none yet */ }
  const match = platform === "brightspace" ? origin + "/d2l/*" : origin + "/*";
  await chrome.scripting.registerContentScripts([{ id: "school-sync", matches: [match], js: ["content.js"], runAt: "document_idle", persistAcrossSessions: true }]);
}

// The address as typed (with any subfolder, for example a Moodle at /moodle), https only.
function fullUrl(raw) {
  const t = String(raw || "").trim();
  if (!t) return null;
  try {
    const u = new URL(t.includes("://") ? t : "https://" + t);
    return u.protocol === "https:" ? u.origin + u.pathname.replace(/\/$/, "") : null;
  } catch (e) { return null; }
}

// Best effort: read the school's public sign-in page and look for each platform's markers.
// Returns null when the page can't be read (for example it sends you to another sign-in site).
async function detectPlatform(url) {
  if (!url) return null;
  try {
    const r = await fetch(url + "/", { credentials: "omit", redirect: "follow" });
    if (new URL(r.url).origin !== new URL(url).origin) return null;
    const t = (await r.text()).slice(0, 400000);
    if (/\/d2l\//i.test(r.url) || /\/d2l\/(lp|lms|le|home|login)/i.test(t)) return "brightspace";
    if (/M\.cfg\s*=|\/lib\/javascript\.php|\/theme\/yui_combo\.php|name="generator" content="Moodle/i.test(t)) return "moodle";
    if (/instructure-uploads|\/login\/canvas|ic-app|canvas-fonts|window\.ENV\s*=/i.test(t)) return "canvas";
    if (/\/ultra\/|\/webapps\//i.test(t) || /\/ultra\/|\/webapps\//i.test(r.url)) return "blackboard";
  } catch (e) { /* unreadable */ }
  return null;
}

async function updateTabState() {
  const tab = await activeTab();
  const ok = tabIsLms(tab);
  $("tab-note").hidden = ok;
  $("open-am").hidden = ok;
  $("sync").hidden = !ok;
  if (!ok) $("tab-note").textContent = "Open your school's learning site in this tab and sign in. Then reopen this popup and choose Sync now.";
}

function renderReview() {
  const { items } = collected;
  $("method").textContent = "Read from: " + collected.methodLabel + ". Tick what you want to send.";
  const list = $("list");
  list.textContent = "";
  const cutoff = Date.now() - 7 * DAY;
  items.forEach((it, i) => {
    const li = document.createElement("li");
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.dataset.i = String(i);
    cb.checked = new Date(it.dueAt).getTime() >= cutoff;
    cb.addEventListener("change", syncAll);
    const box = document.createElement("span");
    const t = document.createElement("span");
    t.className = "t";
    t.textContent = it.title;
    const m = document.createElement("span");
    const late = new Date(it.dueAt).getTime() < Date.now();
    m.className = "m" + (late ? " late" : "");
    m.textContent = [TYPE_LABEL[it.type] || "Item", it.course || it.courseCode, (late ? "Overdue, was due " : "Due ") + fmtDate(it.dueAt)].filter(Boolean).join(" · ");
    box.append(t, m);
    label.append(cb, box);
    li.append(label);
    list.append(li);
  });
  $("review").hidden = false;
  syncAll();
}

function boxes() { return Array.from($("list").querySelectorAll("input[type=checkbox]")); }

function syncAll() {
  const bs = boxes();
  const n = bs.filter((b) => b.checked).length;
  const all = $("all");
  all.checked = n === bs.length && n > 0;
  all.indeterminate = n > 0 && n < bs.length;
  $("all-label").textContent = "Select all (" + n + " of " + bs.length + " selected)";
  $("send").disabled = busy || n === 0;
  $("send").textContent = n === 0 ? "Send to Logia" : "Send " + n + " to Logia";
}

// ---------- Actions ----------

async function askTab(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch (e) {
    // The page was open before the extension was installed, or its script was not registered yet.
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return await chrome.tabs.sendMessage(tabId, msg);
  }
}

async function syncNow() {
  if (busy) return;
  const tab = await activeTab();
  if (!tabIsLms(tab)) { await updateTabState(); return; }
  setBusy(true);
  $("review").hidden = true;
  status("Reading your deadlines from your school site…");
  try {
    const stored = (await chrome.storage.local.get("platform")).platform;
    const res = await askTab(tab.id, { type: "logia:collect", platform: stored && stored !== "auto" ? stored : undefined });
    if (!res || !res.ok) { status((res && res.error) || "Couldn't read your school site.", "error"); return; }
    if (!res.items.length) {
      status("No deadlines found between 30 days ago and 120 days ahead. Read from: " + res.methodLabel + ".", "");
      collected = null;
      return;
    }
    collected = res;
    if (res.platform && res.platform !== stored) await chrome.storage.local.set({ platform: res.platform });
    status("Found " + res.items.length + " item" + (res.items.length === 1 ? "" : "s") + ". Nothing has been sent yet.", "");
    renderReview();
  } catch (e) {
    status("Couldn't talk to your school tab. Reload the page and try again.", "error");
  } finally {
    setBusy(false);
    syncAll();
  }
}

async function sendSelected() {
  if (busy || !collected) return;
  const bs = boxes();
  const chosen = bs.filter((b) => b.checked).map((b) => collected.items[Number(b.dataset.i)]);
  if (!chosen.length) return;
  const allChosen = chosen.length === collected.items.length;
  setBusy(true);
  status("Sending to Logia…");
  const res = await chrome.runtime.sendMessage({
    type: "logia:send",
    items: chosen,
    complete: allChosen && collected.complete,
    windowStart: collected.windowStart,
    windowEnd: collected.windowEnd,
    method: collected.method,
    platform: collected.platform,
  });
  setBusy(false);
  if (res && res.ok) {
    status("Sent " + res.count + " item" + (res.count === 1 ? "" : "s") + " to Logia.", "ok");
    collected = null;
    $("review").hidden = true;
    await render();
  } else {
    status((res && res.error) || "Couldn't send to Logia.", "error");
    syncAll();
  }
}

async function connect(ev) {
  ev.preventDefault();
  if (busy) return;
  const origin = normaliseOrigin($("origin").value);
  const code = $("code").value.trim();
  const school = normaliseSchool($("school").value);
  const schoolUrl = fullUrl($("school").value);
  if (!school) { status("Enter your school's learning site address, for example learn.myschool.edu. It must be https.", "error"); $("school").focus(); return; }
  if (!origin) { status("Use an https address, or http://localhost for local development.", "error"); $("origin").focus(); return; }
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(code)) { status("That doesn't look like a connection code. Copy it again from Logia.", "error"); $("code").focus(); return; }
  setBusy(true);
  try {
    const wanted = [origin + "/*", school + "/*"];
    const missing = [];
    for (const o of wanted) { if (!(await chrome.permissions.contains({ origins: [o] }))) missing.push(o); }
    if (missing.length) {
      status("Chrome will ask if the extension may use " + missing.map((m) => m.replace("/*", "")).join(" and ") + ".");
      const granted = await chrome.permissions.request({ origins: missing });
      if (!granted) { status("The extension needs access to your school site and to Logia to work. Nothing was connected.", "error"); return; }
    }
    let platform = $("platform").value;
    if (platform === "auto") { status("Looking for your learning platform…"); platform = (await detectPlatform(schoolUrl)) || "auto"; }
    status("Checking your code…");
    const res = await chrome.runtime.sendMessage({ type: "logia:verify", origin, code, school, platform: platform === "auto" ? undefined : platform });
    if (!res || !res.ok) { status((res && res.error) || "Couldn't check the code.", "error"); return; }
    await registerSchoolScript(school, platform);
    await chrome.storage.local.set({ code, logiaOrigin: origin, schoolOrigin: school, platform, lastError: null });
    $("code").value = "";
    status("Connected.", "ok");
    await render();
  } finally {
    setBusy(false);
  }
}

async function disconnect() {
  try { await chrome.scripting.unregisterContentScripts({ ids: ["school-sync"] }); } catch (e) { /* not registered */ }
  await chrome.storage.local.remove(["code", "schoolOrigin", "platform", "lastSync", "lastError", "lastAuto"]);
  await chrome.storage.local.set({ autoSync: false });
  collected = null;
  $("review").hidden = true;
  status("Disconnected. Revoke the code in Logia settings if you won't use it again.", "ok");
  await render();
}


// ---------- Wire up ----------

$("connect-form").addEventListener("submit", connect);
$("sync").addEventListener("click", syncNow);
$("send").addEventListener("click", sendSelected);
$("cancel").addEventListener("click", () => { collected = null; $("review").hidden = true; status("Nothing was sent."); $("sync").focus(); });
$("all").addEventListener("change", () => { const on = $("all").checked; boxes().forEach((b) => { b.checked = on; }); syncAll(); });
$("auto").addEventListener("change", async () => {
  await chrome.storage.local.set({ autoSync: $("auto").checked });
  status($("auto").checked ? "Auto-sync is on. It runs when you open the Work To Do page." : "Auto-sync is off.");
});
$("open-am").addEventListener("click", () => { if (schoolOrigin) chrome.tabs.create({ url: schoolOrigin + "/d2l/home" }); window.close(); });
$("disconnect").addEventListener("click", disconnect);

render();
