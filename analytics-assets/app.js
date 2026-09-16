// The analytics workspace: navigation, dashboards, the chart builder, people
// and the event catalogue. Queries live in engine.js and drawing in charts.js;
// this file owns state, routing and the controls that edit a spec.

import * as E from "./engine.js";
import * as C from "./charts.js";
import { TEMPLATES, OVERVIEW, NEW_SPECS } from "./templates.js";

const { h } = C;

const SUPABASE_URL = "https://syqqxogkqmuojchbglle.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Zcxmg3htO9UvumePY6U3bw_wQrh7X6K";
// Same sessionStorage key as dev-tools.html and alerts.html, so moving between
// the pages doesn't ask for the password again.
const SESSION_KEY = "fiammo_devtools_pw";
const SESSION_ID = crypto.randomUUID();
const APP_TZ = "America/Los_Angeles";
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || APP_TZ;
const PREFS_KEY = "fiammo_analytics_prefs_v2";

const SIZES = { "1/6": 2, "1/4": 3, "1/3": 4, "1/2": 6, "2/3": 8, full: 12 };
const TYPE_TAGS = { segmentation: "SEG", funnel: "FNL", retention: "RET", lifecycle: "LIF", stickiness: "STK", journeys: "JRN", heatmap: "HMP", users: "USR" };
const TYPE_BLURBS = {
  segmentation: "Totals, uniques and properties of events over time",
  funnel: "How many people move through steps, in order",
  retention: "Who comes back after a first event",
  lifecycle: "New, current, resurrected and dormant people",
  stickiness: "How many days a week or month people come back",
  journeys: "The paths people take after an event",
  heatmap: "Events by weekday and hour",
  users: "One row per person, with the metrics you choose",
};
const VIZ = {
  segmentation: [["line", "Line"], ["area", "Stacked area"], ["bar", "Bar"], ["stacked", "Stacked bar"], ["hbar", "Totals, horizontal"], ["number", "Number"], ["table", "Table"]],
  categorical: [["bar", "Bar"], ["hbar", "Horizontal"], ["table", "Table"]],
  funnel: [["steps", "Steps"], ["trend", "Conversion over time"], ["table", "Table"]],
  retention: [["curve", "Curve"], ["cohorts", "Cohort grid"], ["table", "Table"]],
  lifecycle: [["stacked", "Stacked bar"], ["table", "Table"]],
  stickiness: [["bar", "Bar"], ["hbar", "Horizontal"], ["table", "Table"]],
  journeys: [["tree", "Tree"], ["table", "Table"]],
  heatmap: [["heatmap", "Heatmap"], ["table", "Table"]],
  users: [["table", "Table"]],
};
const INTERVALS = { segmentation: ["day", "week", "month"], funnel: ["day", "week", "month"], retention: ["day", "week"], lifecycle: ["day", "week", "month"], stickiness: ["week", "month"] };
const INTERVAL_NAMES = { day: "Daily", week: "Weekly", month: "Monthly" };
const WINDOWS = [[3600, "1 hour"], [86400, "1 day"], [3 * 86400, "3 days"], [7 * 86400, "7 days"], [14 * 86400, "14 days"], [30 * 86400, "30 days"], [0, "No limit"]];

const state = {
  raw: null,
  ds: null,
  loadedAt: null,
  loadError: null,
  saved: new Map(),
  savedError: null,
  prefs: { range: { preset: "30d" }, zone: "app", includeTest: false, activeTypes: [...E.DEFAULT_ACTIVE] },
  drafts: new Map(),
  draftSeq: 0,
  hidden: new Map(),
  sorts: new Map(),
  cardTables: new Set(),
  navFilter: "",
};

const $ = id => document.getElementById(id);
const clone = v => JSON.parse(JSON.stringify(v));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ── prefs ─────────────────────────────────────────────────────────────────── */

function restorePrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    if (p.range && (E.RANGE_PRESETS[p.range.preset] || (p.range.preset === "custom" && p.range.from))) state.prefs.range = p.range;
    if (p.zone === "app" || p.zone === "local") state.prefs.zone = p.zone;
    if (typeof p.includeTest === "boolean") state.prefs.includeTest = p.includeTest;
    if (Array.isArray(p.activeTypes) && p.activeTypes.length) state.prefs.activeTypes = p.activeTypes.filter(t => E.EVENTS[t]);
  } catch (e) { /* storage blocked: defaults stand */ }
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)); } catch (e) { /* storage blocked */ }
}
const tz = () => (state.prefs.zone === "local" ? LOCAL_TZ : APP_TZ);

/* ── server ────────────────────────────────────────────────────────────────── */

async function call(name, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
      "x-admin-password": sessionStorage.getItem(SESSION_KEY) || "",
    },
    body: JSON.stringify({ ...(body || {}), _requestId: crypto.randomUUID(), _sessionId: SESSION_ID }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    sessionStorage.removeItem(SESSION_KEY);
    lock("Session expired. Enter the password again.");
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error(data.error || data.message || `request failed (${res.status})`);
  return data;
}
const api = (action, body) => call("admin-analytics", { action, ...body });

/* ── gate ──────────────────────────────────────────────────────────────────── */

function lock(message) {
  $("app").hidden = true;
  $("gate").hidden = false;
  $("gate-error").textContent = message || "";
}

async function tryPassword(pw) {
  if (!pw) return;
  $("gate-submit").disabled = true;
  $("gate-error").textContent = "";
  sessionStorage.setItem(SESSION_KEY, pw);
  try {
    await call("admin-check-password");
    $("gate").hidden = true;
    $("app").hidden = false;
    start();
  } catch (e) {
    if (e.message !== "unauthorized") {
      sessionStorage.removeItem(SESSION_KEY);
      $("gate-error").textContent = "Incorrect password";
    }
  } finally {
    $("gate-submit").disabled = false;
  }
}

$("gate-submit").addEventListener("click", () => tryPassword($("gate-password").value));
$("gate-password").addEventListener("keydown", e => { if (e.key === "Enter") tryPassword($("gate-password").value); });
if (sessionStorage.getItem(SESSION_KEY)) tryPassword(sessionStorage.getItem(SESSION_KEY));

/* ── loading ───────────────────────────────────────────────────────────────── */

let started = false;
function start() {
  if (started) return;
  started = true;
  restorePrefs();
  window.addEventListener("hashchange", () => { closePopover(); renderView(); });
  window.addEventListener("resize", debounce(() => { if (!document.querySelector(".modal")) renderView(); }, 180));
  $("nav-toggle").addEventListener("click", () => $("app").classList.toggle("nav-open"));
  renderNav();
  renderTopbar();
  load();
}

async function load() {
  state.loadError = null;
  $("app").classList.add("loading");
  renderTopbar();
  const [events, saved] = await Promise.allSettled([api("events"), api("saved.list")]);
  if (events.status === "fulfilled") {
    state.raw = events.value;
    state.loadedAt = new Date();
    rebuild();
  } else if (events.reason?.message !== "unauthorized") {
    state.loadError = events.reason?.message || "couldn't load events";
  }
  if (saved.status === "fulfilled") {
    state.saved = new Map((saved.value.items || []).map(it => [it.id, it]));
    state.savedError = null;
  } else if (saved.reason?.message !== "unauthorized") {
    state.savedError = saved.reason?.message || "couldn't load saved charts";
  }
  $("app").classList.remove("loading");
  renderNav();
  renderTopbar();
  renderView();
}

function rebuild() {
  if (!state.raw) return;
  state.ds = E.buildDataset(state.raw, { tz: tz(), includeTest: state.prefs.includeTest, activeTypes: state.prefs.activeTypes });
}

const effective = spec => ({ ...spec, range: spec.range || state.prefs.range });

/* ── popovers, modals, notices ─────────────────────────────────────────────── */

let openPop = null;
function closePopover() { if (openPop) openPop.close(); }

function popover(anchor, build, { align = "left", onClose, cls } = {}) {
  closePopover();
  const el = h("div", { class: `pop${cls ? ` ${cls}` : ""}` });
  document.body.append(el);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    el.remove();
    openPop = null;
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", esc, true);
    if (onClose) onClose();
  };
  const outside = e => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
  const esc = e => { if (e.key === "Escape") { e.stopPropagation(); close(); anchor.focus?.(); } };
  el.append(...[build(close)].flat().filter(Boolean));
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  let x = align === "right" ? r.right - w : r.left;
  x = Math.max(8, Math.min(x, innerWidth - w - 8));
  let y = r.bottom + 4;
  if (y + el.offsetHeight > innerHeight - 8) y = Math.max(8, Math.min(innerHeight - el.offsetHeight - 8, r.top - el.offsetHeight - 4));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  setTimeout(() => {
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", esc, true);
  });
  openPop = { el, close };
  return close;
}

function menu(anchor, items, opts) {
  return popover(anchor, close => h("div", { class: "menu" }, items.filter(Boolean).map(it => it === "-" ? h("div", { class: "menu-sep" })
    : it.heading ? h("div", { class: "menu-head", text: it.heading })
    : h("button", {
      class: `menu-item${it.danger ? " danger" : ""}${it.checked ? " checked" : ""}`, type: "button", disabled: it.disabled,
      onclick: () => { close(); it.onClick(); },
    }, h("span", { class: "menu-check", text: it.checked ? "✓" : "" }), h("span", { text: it.label }), it.hint ? h("span", { class: "menu-hint", text: it.hint }) : null))), opts);
}

function modal({ title, body, actions, wide }) {
  return new Promise(resolve => {
    const prev = document.activeElement;
    const root = h("div", { class: "modal-backdrop" });
    const done = value => { root.remove(); document.removeEventListener("keydown", esc, true); prev?.focus?.(); resolve(value); };
    const esc = e => { if (e.key === "Escape") { e.stopPropagation(); done(null); } };
    const box = h("div", { class: `modal${wide ? " wide" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": title },
      h("div", { class: "modal-head" }, h("span", { text: title }), h("button", { class: "icon-btn", type: "button", "aria-label": "Close", text: "×", onclick: () => done(null) })),
      h("div", { class: "modal-body" }, body),
      actions ? h("div", { class: "modal-foot" }, actions.map(a => h("button", {
        class: `btn${a.primary ? " primary" : ""}${a.danger ? " danger" : ""}`, type: "button",
        onclick: () => { const v = a.value ? a.value() : true; if (v !== undefined) done(v); },
      }, a.label))) : null);
    root.append(box);
    root.addEventListener("pointerdown", e => { if (e.target === root) done(null); });
    document.body.append(root);
    document.addEventListener("keydown", esc, true);
    (box.querySelector("input, select, textarea") || box.querySelector(".btn.primary"))?.focus();
  });
}

async function promptName(title, initial, confirmLabel = "Save") {
  const input = h("input", { class: "input wide", value: initial || "", maxlength: 120, placeholder: "Name" });
  const error = h("div", { class: "field-error" });
  const value = () => {
    const v = input.value.trim();
    if (!v) { error.textContent = "Give it a name."; return undefined; }
    return v;
  };
  input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); box().querySelector(".btn.primary").click(); } });
  const box = () => input.closest(".modal");
  setTimeout(() => input.select());
  return modal({ title, body: [input, error], actions: [{ label: "Cancel", value: () => null }, { label: confirmLabel, primary: true, value }] });
}

const confirmDialog = (title, text, label, danger) =>
  modal({ title, body: h("p", { class: "modal-text", text }), actions: [{ label: "Cancel", value: () => false }, { label, primary: !danger, danger, value: () => true }] });

function notify(text, kind = "ok") {
  const el = h("div", { class: `toast ${kind}`, role: "status", text });
  $("toasts").append(el);
  setTimeout(() => el.classList.add("out"), 2600);
  setTimeout(() => el.remove(), 3000);
}

function select(options, value, onChange, attrs = {}) {
  const el = h("select", { class: "select", ...attrs, onchange: e => onChange(e.target.value) },
    options.map(o => Array.isArray(o) ? h("option", { value: o[0], selected: String(o[0]) === String(value) }, o[1])
      : h("optgroup", { label: o.group }, o.options.map(([v, l]) => h("option", { value: v, selected: String(v) === String(value) }, l)))));
  return el;
}

const iconBtn = (text, label, onClick, cls = "") => h("button", { class: `icon-btn ${cls}`, type: "button", title: label, "aria-label": label, text, onclick: onClick });
const emptyBox = text => h("div", { class: "empty", text });
const errorBox = text => h("div", { class: "error-box" }, h("b", { text: "Can't draw this chart. " }), text);

/* ── saved items ───────────────────────────────────────────────────────────── */

const savedOf = kind => [...state.saved.values()].filter(it => it.kind === kind).sort((a, b) => a.name.localeCompare(b.name));

async function upsertSaved(item) {
  try {
    const { item: saved } = await api("saved.upsert", { item });
    state.saved.set(saved.id, saved);
    renderNav();
    return saved;
  } catch (err) {
    if (err.message !== "unauthorized") notify(`Couldn't save: ${err.message}`, "bad");
    return null;
  }
}

async function deleteSaved(id) {
  try {
    await api("saved.delete", { id });
    state.saved.delete(id);
    renderNav();
    return true;
  } catch (err) {
    if (err.message !== "unauthorized") notify(`Couldn't delete: ${err.message}`, "bad");
    return false;
  }
}

function resolveRef(ref) {
  const [kind, id] = String(ref).split(/:(.+)/);
  if (kind === "template" && TEMPLATES[id]) {
    const { name, ...spec } = TEMPLATES[id];
    return { kind, id, name, spec, href: `template/${id}` };
  }
  if (kind === "chart" && state.saved.has(id)) {
    const it = state.saved.get(id);
    return { kind, id, name: it.name, spec: it.spec, href: `chart/${id}` };
  }
  return null;
}

/* ── routing ───────────────────────────────────────────────────────────────── */

function route() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, qs] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(qs || ""));
  return { parts: parts.length ? parts.map(decodeURIComponent) : ["dashboard", "overview"], query, key: path || "dashboard/overview" };
}
const go = path => { location.hash = `#/${path}`; };

function renderView() {
  C.hideTip();
  const view = $("view");
  const { parts, query, key } = route();
  $("app").classList.remove("nav-open");
  B = null; // renderBuilder sets it again when the route is a chart
  renderNav();
  if (state.loadError && !state.ds) {
    view.replaceChildren(h("div", { class: "page" }, errorBox(`Couldn't load analytics: ${state.loadError}. If admin-analytics isn't deployed yet, nothing here can load.`)));
    return;
  }
  if (!state.ds) { view.replaceChildren(h("div", { class: "page" }, h("div", { class: "loading-box", text: "Loading events…" }))); return; }
  try {
    switch (parts[0]) {
      case "dashboard": return renderDashboard(parts[1] || "overview");
      case "chart":
        if (parts[1] === "new") return newDraft(parts[2] || "segmentation");
        return renderBuilder(key, query);
      case "template":
      case "draft": return renderBuilder(key, query);
      case "user": return renderUser(Number(parts[1]));
      case "events": return renderEvents();
      default: return renderDashboard("overview");
    }
  } catch (err) {
    console.error(err);
    view.replaceChildren(h("div", { class: "page" }, errorBox(err.message)));
  }
}

function newDraft(type, init) {
  const spec = (NEW_SPECS[type] || NEW_SPECS.segmentation)();
  if (init) init(spec);
  const n = ++state.draftSeq;
  state.drafts.set(`draft/${n}`, { id: null, template: null, name: "Untitled chart", spec, dirty: true });
  location.replace(`#/draft/${n}`);
}

/* ── navigation ────────────────────────────────────────────────────────────── */

function renderNav() {
  const { key } = route();
  const q = state.navFilter.toLowerCase();
  const match = name => !q || name.toLowerCase().includes(q);
  const link = (href, label, tag, extra) => h("a", { class: `nav-link${key === href || key.startsWith(`${href}?`) ? " on" : ""}`, href: `#/${href}` },
    tag ? h("span", { class: "tag", text: tag }) : null, h("span", { class: "nav-label", text: label }), extra || null);

  const dashboards = savedOf("dashboard").filter(d => match(d.name));
  const charts = savedOf("chart").filter(c => match(c.name));
  const templates = Object.entries(TEMPLATES).filter(([, t]) => match(t.name));

  const newBtn = h("button", { class: "btn primary block", type: "button", onclick: e => menu(e.currentTarget, Object.keys(E.CHART_TYPES).map(t => ({
    label: E.CHART_TYPES[t].label, hint: TYPE_TAGS[t], onClick: () => go(`chart/new/${t}`),
  }))) }, "+ New chart");

  $("nav").replaceChildren(
    h("div", { class: "nav-brand" }, h("img", { src: "flame.svg?v=2", alt: "" }), h("span", { text: "fiammo" }), h("span", { class: "nav-badge", text: "analytics" })),
    h("div", { class: "nav-actions" }, newBtn,
      h("input", { class: "input nav-search", type: "search", placeholder: "Filter charts and dashboards", value: state.navFilter,
        oninput: debounce(e => { state.navFilter = e.target.value; renderNav(); const el = $("nav").querySelector(".nav-search"); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 120) })),
    h("div", { class: "nav-scroll" },
      h("div", { class: "nav-section" }, h("div", { class: "nav-head" }, h("span", { text: "Dashboards" }), h("button", { class: "nav-add", type: "button", title: "New dashboard", text: "+", onclick: newDashboard })),
        match(OVERVIEW.name) ? link("dashboard/overview", OVERVIEW.name, null, h("span", { class: "nav-note", text: "built-in" })) : null,
        dashboards.map(d => link(`dashboard/${d.id}`, d.name))),
      h("div", { class: "nav-section" }, h("div", { class: "nav-head" }, h("span", { text: "Saved charts" }), h("span", { class: "nav-count", text: savedOf("chart").length })),
        charts.length ? charts.map(c => link(`chart/${c.id}`, c.name, TYPE_TAGS[c.spec.type])) : h("div", { class: "nav-empty", text: state.savedError ? "Saving is unavailable" : q ? "No matches" : "Build a chart and save it" })),
      h("div", { class: "nav-section" }, h("div", { class: "nav-head" }, h("span", { text: "Templates" })),
        templates.map(([k, t]) => link(`template/${k}`, t.name, TYPE_TAGS[t.type]))),
      h("div", { class: "nav-section" }, h("div", { class: "nav-head" }, h("span", { text: "Data" })),
        link("template/people", "People", TYPE_TAGS.users),
        link("events", "Event catalogue", "EVT"))),
    h("div", { class: "nav-foot" },
      state.savedError ? h("div", { class: "nav-warn", title: state.savedError, text: `Saving unavailable: ${state.savedError}` }) : null,
      h("div", { class: "nav-links" }, h("a", { href: "dev-tools.html", text: "dev tools" }), h("a", { href: "alerts.html", text: "alerts" }))),
  );
}

/* ── top bar ───────────────────────────────────────────────────────────────── */

function rangeLabel(r) {
  if (r.preset === "custom") return `${r.from} → ${r.to || "today"}`;
  return E.RANGE_PRESETS[r.preset]?.label || "Last 30 days";
}

function renderTopbar() {
  const ds = state.ds;
  const status = state.loadError ? `load failed: ${state.loadError}` : ds
    ? `${ds.users.length} people · ${ds.events.length.toLocaleString()} events · ${state.loadedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
    : "loading…";

  const rangeBtn = h("button", { class: "ctl", type: "button", onclick: e => rangePopover(e.currentTarget) },
    h("span", { class: "ctl-k", text: "Range" }), h("span", { text: rangeLabel(state.prefs.range) }), h("span", { class: "caret", text: "▾" }));
  const testBtn = h("button", { class: `ctl toggle${state.prefs.includeTest ? " on" : ""}`, type: "button", "aria-pressed": state.prefs.includeTest ? "true" : "false",
    onclick: () => { state.prefs.includeTest = !state.prefs.includeTest; savePrefs(); rebuild(); renderTopbar(); renderView(); } },
    h("span", { class: "switch" }), h("span", { text: "Test accounts" }));
  const zoneBtn = h("button", { class: "ctl", type: "button", title: "Where a day starts and ends", onclick: e => menu(e.currentTarget, [
    { heading: "Days and hours in" },
    { label: "Pacific time (the app's day)", checked: state.prefs.zone === "app", onClick: () => setZone("app") },
    { label: `This browser (${LOCAL_TZ})`, checked: state.prefs.zone === "local", onClick: () => setZone("local") },
  ], { align: "right" }) }, h("span", { class: "ctl-k", text: "TZ" }), h("span", { text: state.prefs.zone === "app" ? "Pacific" : LOCAL_TZ.split("/").pop().replace(/_/g, " ") }), h("span", { class: "caret", text: "▾" }));
  const activeBtn = h("button", { class: "ctl", type: "button", title: "Which events count as being active", onclick: e => activePopover(e.currentTarget) },
    h("span", { class: "ctl-k", text: "$active" }), h("span", { text: `${state.prefs.activeTypes.length} events` }), h("span", { class: "caret", text: "▾" }));

  $("topbar-controls").replaceChildren(rangeBtn, zoneBtn, activeBtn, testBtn,
    h("button", { class: "ctl", type: "button", disabled: $("app").classList.contains("loading"), onclick: load }, "↻ Refresh"),
    h("span", { class: `status${state.loadError ? " bad" : ""}`, text: status }));
}

function setZone(zone) {
  state.prefs.zone = zone;
  savePrefs();
  rebuild();
  renderTopbar();
  renderView();
}

function rangePopover(anchor) {
  popover(anchor, close => {
    const from = h("input", { class: "input", type: "date", value: state.prefs.range.from || (state.ds ? E.dnToISO(state.ds.todayDn - 29) : "") });
    const to = h("input", { class: "input", type: "date", value: state.prefs.range.to || (state.ds ? E.dnToISO(state.ds.todayDn) : "") });
    const apply = r => { state.prefs.range = r; savePrefs(); close(); renderTopbar(); renderView(); };
    return h("div", { class: "range-pop" },
      Object.entries(E.RANGE_PRESETS).map(([k, p]) => h("button", { class: `menu-item${state.prefs.range.preset === k ? " checked" : ""}`, type: "button", onclick: () => apply({ preset: k }) },
        h("span", { class: "menu-check", text: state.prefs.range.preset === k ? "✓" : "" }), h("span", { text: p.label }))),
      h("div", { class: "menu-sep" }),
      h("div", { class: "range-custom" }, h("span", { class: "k", text: "From" }), from, h("span", { class: "k", text: "to" }), to,
        h("button", { class: "btn small primary", type: "button", onclick: () => { if (from.value) apply({ preset: "custom", from: from.value, to: to.value || undefined }); } }, "Apply")));
  });
}

function activePopover(anchor) {
  popover(anchor, () => {
    const chosen = new Set(state.prefs.activeTypes);
    const commit = () => { state.prefs.activeTypes = [...chosen]; savePrefs(); rebuild(); renderTopbar(); renderView(); };
    const groups = groupEvents(Object.entries(E.EVENTS));
    return h("div", { class: "active-pop" },
      h("div", { class: "pop-title", text: "Any active event ($active) means any of:" }),
      h("div", { class: "pop-list" }, groups.map(([g, items]) => [h("div", { class: "pop-group", text: g }), items.map(([key, meta]) => h("label", { class: "pop-opt" },
        h("input", { type: "checkbox", checked: chosen.has(key), onchange: e => { if (e.target.checked) chosen.add(key); else if (chosen.size > 1) chosen.delete(key); else e.target.checked = true; commit(); } }),
        h("span", { class: "opt-label", text: meta.label }), h("code", { text: key })))])),
      h("div", { class: "pop-foot" }, h("button", { class: "btn small", type: "button", onclick: () => { chosen.clear(); E.DEFAULT_ACTIVE.forEach(t => chosen.add(t)); commit(); closePopover(); } }, "Reset to default")));
  }, { align: "right", cls: "wide" });
}

function groupEvents(entries) {
  const map = new Map();
  for (const [key, meta] of entries) { let l = map.get(meta.group); if (!l) map.set(meta.group, (l = [])); l.push([key, meta]); }
  return [...map];
}

function setTitle(parts) {
  $("crumbs").replaceChildren(...parts.flatMap((p, i) => [i ? h("span", { class: "crumb-sep", text: "/" }) : null, typeof p === "string" ? h("span", { class: "crumb", text: p }) : p]).filter(Boolean));
}

/* ── drawing a result ──────────────────────────────────────────────────────── */

function hiddenFor(key) {
  let set = state.hidden.get(key);
  if (!set) state.hidden.set(key, (set = new Set()));
  return set;
}

function vizOptions(spec, result) {
  if (spec.type === "segmentation" && result && result.kind === "categorical") return VIZ.categorical;
  if (spec.type === "segmentation" && E.MEASURES[spec.series?.[0]?.measure]?.categorical) return VIZ.categorical;
  return VIZ[spec.type] || [["table", "Table"]];
}

function drawInto(host, spec, result, { key, height = 260, redraw }) {
  C.hideTip();
  host.replaceChildren();
  if (!result || result.kind === "empty") { host.append(emptyBox(result?.message || "Nothing to show.")); return; }
  const options = vizOptions(spec, result).map(o => o[0]);
  const viz = options.includes(spec.viz) ? spec.viz : options[0];
  const hidden = hiddenFor(key);
  const onToggle = id => { if (hidden.has(id)) hidden.delete(id); else hidden.add(id); redraw(); };
  const onUsers = (users, title) => usersModal(users, title);
  if (viz === "table" || result.kind === "users") { host.append(tableNode(key, tableFor(spec, result))); return; }

  let nodes = [];
  switch (result.kind) {
    case "kpi":
      nodes = C.drawKpi(host, result);
      break;
    case "timeseries": {
      const series = result.series.map((sr, i) => ({ ...sr, color: C.colorAt(i) }));
      const labels = result.buckets.map(b => b.label);
      const heads = result.buckets.map(b => `${b.long}${b.partial ? " (partial)" : ""}`);
      if (viz === "hbar") {
        nodes = C.drawBarRows(host, { rows: series.map(sr => ({ label: sr.name, values: { total: sr.total } })), series: [{ id: "total", name: "Total", color: "var(--s1)" }], format: result.format });
      } else if (viz === "bar" || viz === "stacked") {
        nodes = C.drawColumns(host, { labels, heads, series, format: result.format, stacked: viz === "stacked", height, hidden, onToggle });
      } else {
        nodes = C.drawLines(host, { labels, heads, series, format: result.format, area: viz === "area", height, hidden, onToggle });
      }
      break;
    }
    case "categorical": {
      const series = result.series.map((sr, i) => ({ ...sr, color: C.colorAt(i) }));
      if (viz === "hbar") {
        nodes = C.drawBarRows(host, { rows: result.categories.map((c, ci) => ({ label: `${c} ${result.axisLabel}`, values: Object.fromEntries(series.map(sr => [sr.id, sr.values[ci]])) })), series, format: result.format, hidden, onToggle });
      } else {
        nodes = C.drawColumns(host, {
          labels: result.categories, heads: result.categories.map(c => `${c} ${result.axisLabel}`), series, format: result.format, height, hidden, onToggle,
          extra: result.sticky ? i => `${series[0].counts[i]} of ${result.pairs} ${result.valueLabel.replace(/^of /, "")}` : null,
        });
      }
      break;
    }
    case "funnel":
      if (viz === "trend") {
        nodes = C.drawLines(host, {
          labels: result.buckets.map(b => b.label), heads: result.buckets.map(b => `Started ${b.long}`),
          series: [{ id: "rate", name: "Converted to the last step", color: "var(--s1)", values: result.trend.map(t => t.rate) }],
          format: { pct: true }, height, hidden, onToggle, extra: i => `${result.trend[i].converted} of ${result.trend[i].entered} people`,
        });
      } else {
        nodes = C.drawFunnel(host, result, { height, hidden, onToggle, onUsers });
      }
      break;
    case "retention":
      if (viz === "cohorts") { host.append(cohortGrid(result)); return; }
      {
        const unit = result.interval === "week" ? "Week" : "Day";
        const curves = result.groups ? result.groups.map((g, i) => ({ id: `g${i}`, name: `${g.key} (${g.entered})`, color: C.colorAt(i), values: g.curve.map(c => c.rate), cells: g.curve }))
          : [{ id: "all", name: `${result.entered} people`, color: "var(--s1)", values: result.curve.map(c => c.rate), cells: result.curve }];
        nodes = C.drawLines(host, {
          labels: result.curve.map(c => `${unit} ${c.n}`), series: curves, format: { pct: true }, height, hidden, onToggle,
          extra: i => curves.length === 1 ? `${curves[0].cells[i].retained} of ${curves[0].cells[i].eligible} people · ${result.exact ? "exactly on" : "on or after"} ${unit.toLowerCase()} ${i}` : null,
        });
      }
      break;
    case "lifecycle":
      nodes = C.drawLifecycle(host, result, { height, hidden, onToggle });
      break;
    case "heatmap":
      nodes = C.drawHeatmap(host, result);
      break;
    case "tree":
      nodes = C.drawTree(host, result, { eventLabel: E.eventLabel, onUsers });
      break;
    default:
      nodes = [emptyBox(`No drawing for ${result.kind}.`)];
  }
  host.append(...nodes.filter(Boolean));
}

function cohortGrid(r) {
  const unit = r.interval === "week" ? "Wk" : "Day";
  const columns = [{ label: "Joined week of", align: "left" }, { label: "People" }, ...Array.from({ length: r.maxN + 1 }, (_, n) => ({ label: `${unit} ${n}` }))];
  const rowFor = (label, size, cells) => {
    const styles = [null, null];
    const cls = [null, null];
    const titles = [null, null];
    const shown = cells.map(c => {
      if (!c.eligible) { styles.push(null); cls.push("na"); titles.push(null); return ""; }
      const { bg, ink } = C.rampCell(c.rate);
      styles.push(`background:${bg};color:${ink}`);
      cls.push("cell");
      titles.push(`${c.retained} of ${c.eligible}`);
      return C.fmtValue(c.rate, { pct: true });
    });
    return { cells: [label, C.fmtValue(size), ...shown], raw: [label, size, ...cells.map(c => c.eligible ? c.rate : null)], styles, cls, titles };
  };
  const table = { columns, rows: [rowFor("All people", r.entered, r.curve), ...r.cohorts.map(c => rowFor(c.label, c.size, c.cells))] };
  return C.drawTable(table, {});
}

function tableNode(key, table) {
  const wrap = h("div", { class: "table-host" });
  const draw = () => {
    const sort = state.sorts.get(key);
    let rows = table.rows;
    if (sort) {
      rows = [...rows].sort((a, b) => {
        const x = (a.raw || a.cells)[sort.col], y = (b.raw || b.cells)[sort.col];
        if (x === y) return 0;
        if (x === null || x === undefined || x === "") return 1;
        if (y === null || y === undefined || y === "") return -1;
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir;
      });
    }
    wrap.replaceChildren(C.drawTable({ ...table, rows }, {
      sort,
      onSort: col => {
        const cur = state.sorts.get(key);
        state.sorts.set(key, { col, dir: cur && cur.col === col ? -cur.dir : col === 0 ? 1 : -1 });
        draw();
      },
    }));
  };
  draw();
  return wrap;
}

function seriesKey(name, i) {
  return h("span", { class: "series-key" }, h("i", { style: `background:${C.colorAt(i)}` }), h("span", { text: name }));
}

function tableFor(spec, r) {
  const ds = state.ds;
  switch (r.kind) {
    case "timeseries": {
      const rolling = r.series.some(sr => E.MEASURES[sr.measure]?.rolling);
      return {
        columns: [{ label: "Series", align: "left" }, { label: rolling ? "Average" : "Total" }, ...r.buckets.map(b => ({ label: b.label, title: b.long }))],
        rows: r.series.map((sr, i) => ({ cells: [seriesKey(sr.name, i), C.fmtValue(sr.total, r.format), ...sr.values.map(v => C.fmtValue(v, r.format))], raw: [sr.name, sr.total, ...sr.values] })),
      };
    }
    case "categorical":
      return {
        columns: [{ label: "Series", align: "left" }, { label: r.sticky ? "People-periods" : "Total" }, ...r.categories.map(c => ({ label: c }))],
        rows: r.series.map((sr, i) => ({ cells: [seriesKey(sr.name, i), C.fmtValue(sr.total), ...sr.values.map(v => C.fmtValue(v, r.format))], raw: [sr.name, sr.total, ...sr.values] })),
      };
    case "kpi": {
      const change = r.previous ? (r.value - r.previous) / Math.abs(r.previous) : null;
      return {
        columns: [{ label: "Metric", align: "left" }, { label: "Value" }, { label: "Previous period" }, { label: "Change" }],
        rows: [{ cells: [r.name || "", C.fmtValue(r.value, r.format), C.fmtValue(r.previous, r.format), C.fmtValue(change, { pct: true })], raw: [r.name, r.value, r.previous, change] }],
      };
    }
    case "funnel": {
      const rowsFor = (steps, prefix) => steps.map((st, i) => ({
        cells: [`${prefix}${i + 1}. ${st.label}`, C.fmtValue(st.count), C.fmtValue(st.pctFirst, { pct: true }), i ? C.fmtValue(st.pctPrev, { pct: true }) : "–",
          i ? C.fmtValue(st.dropped.length) : "–", i ? C.fmtValue(st.open) : "–", C.fmtDuration(st.fromPrev), C.fmtDuration(st.fromStart),
          st.dropped.length ? h("button", { class: "link-btn", type: "button", onclick: () => usersModal(st.dropped, `Dropped before step ${i + 1}`) }, st.dropped.slice(0, 4).map(u => `@${u.handle}`).join(", ") + (st.dropped.length > 4 ? "…" : "")) : ""],
        raw: [`${prefix}${i + 1}. ${st.label}`, st.count, st.pctFirst, st.pctPrev, st.dropped.length, st.open, st.fromPrev, st.fromStart, st.dropped.map(u => u.handle).join(" ")],
      }));
      return {
        columns: [{ label: "Step", align: "left" }, { label: "People" }, { label: "% of step 1" }, { label: "% of previous" }, { label: "Dropped" }, { label: "Still in window" }, { label: "Median from previous" }, { label: "Median from step 1" }, { label: "Who dropped", align: "left" }],
        rows: r.groups ? r.groups.flatMap(g => rowsFor(g.steps, `${g.key} · `)) : rowsFor(r.steps, ""),
      };
    }
    case "retention": {
      const unit = r.interval === "week" ? "Week" : "Day";
      const cols = Array.from({ length: r.maxN + 1 }, (_, n) => ({ label: `${unit} ${n}` }));
      const row = (label, size, cells) => ({ cells: [label, C.fmtValue(size), ...cells.map(c => c.eligible ? `${C.fmtValue(c.rate, { pct: true })} (${c.retained}/${c.eligible})` : "")], raw: [label, size, ...cells.map(c => c.eligible ? c.rate : null)] });
      return {
        columns: [{ label: "Group", align: "left" }, { label: "People" }, ...cols],
        rows: [row("All people", r.entered, r.curve), ...(r.groups || []).map(g => row(g.key, g.entered, g.curve)), ...r.cohorts.map(c => row(`Joined week of ${c.label}`, c.size, c.cells))],
      };
    }
    case "lifecycle":
      return {
        columns: [{ label: r.interval === "day" ? "Day" : r.interval === "month" ? "Month" : "Week of", align: "left" }, { label: "New" }, { label: "Current" }, { label: "Resurrected" }, { label: "Dormant" }],
        rows: r.buckets.map((b, i) => ({ cells: [`${b.label}${b.partial ? " *" : ""}`, r.new[i], r.current[i], r.resurrected[i], r.dormant[i]], raw: [b.label, r.new[i], r.current[i], r.resurrected[i], r.dormant[i]] })),
      };
    case "heatmap":
      return {
        columns: [{ label: "Day", align: "left" }, ...Array.from({ length: 24 }, (_, hr) => ({ label: C.hourName(hr) })), { label: "Total" }],
        rows: r.grid.map((line, d) => ({ cells: [C.DOW[d], ...line.map(v => v || ""), line.reduce((a, b) => a + b, 0)], raw: [C.DOW[d], ...line, line.reduce((a, b) => a + b, 0)] })),
      };
    case "tree": {
      const rows = [];
      const walk = (node, path) => {
        for (const [t, kid] of [...node.kids.entries()].sort((a, b) => b[1].count - a[1].count)) {
          const p = [...path, E.eventLabel(t)];
          rows.push({ cells: [p.join(" → "), kid.count, C.fmtValue(kid.count / r.root.count, { pct: true })], raw: [p.join(" → "), kid.count, kid.count / r.root.count] });
          walk(kid, p);
        }
      };
      walk(r.root, [r.startLabel]);
      return { columns: [{ label: "Path", align: "left" }, { label: "People" }, { label: "Share" }], rows };
    }
    case "users": {
      const fmtCol = (c, v) => c.time ? (v ? C.fmtTime(v, ds.tz) : "–") : C.fmtValue(v, { decimals: c.decimals });
      return {
        columns: [{ label: "Person", align: "left" }, { label: "Status", align: "left" }, { label: "Joined" }, { label: "Last active" }, { label: "Invited by", align: "left" },
          ...r.columns.map((c, i) => ({ label: c.name, title: `${E.LETTERS[i]}: ${c.name}` }))],
        rows: r.rows.map(row => {
          const u = row.user;
          const inviter = u.props.invited_by;
          return {
            onClick: () => go(`user/${u.i}`),
            cells: [personCell(u), statusChip(u.status), E.fmtDay(u.joinDn), u.lastActive ? `${C.fmtDuration(ds.nowS - u.lastActive.s)} ago` : "never",
              inviter === "(none)" ? "–" : `@${inviter}`, ...row.values.map((v, i) => fmtCol(r.columns[i], v))],
            raw: [u.handle, u.status, u.joined, u.lastActive ? u.lastActive.s : null, inviter === "(none)" ? "" : inviter, ...row.values],
            cls: [null, null, null, null, null, ...row.values.map(v => v === 0 || v === null ? "zero" : null)],
          };
        }),
      };
    }
    default:
      return null;
  }
}

const personCell = u => h("span", { class: "person" }, h("b", { text: `@${u.handle}` }), u.test ? h("span", { class: "chip", text: "test" }) : null);
const statusChip = status => h("span", { class: `status s-${status.replace(/\s/g, "-")}` }, h("i"), status);

function usersModal(users, title) {
  const ds = state.ds;
  const list = [...new Set(users)].sort((a, b) => (b.lastActive?.s || 0) - (a.lastActive?.s || 0));
  const table = {
    columns: [{ label: "Person", align: "left" }, { label: "Status", align: "left" }, { label: "Joined" }, { label: "Last active" }],
    rows: list.map(u => ({ onClick: () => { document.querySelector(".modal-backdrop")?.remove(); go(`user/${u.i}`); },
      cells: [personCell(u), statusChip(u.status), E.fmtDay(u.joinDn), u.lastActive ? `${C.fmtDuration(ds.nowS - u.lastActive.s)} ago` : "never"],
      raw: [u.handle, u.status, u.joined, u.lastActive?.s || null] })),
  };
  modal({ title: `${title} · ${list.length} ${list.length === 1 ? "person" : "people"}`, body: C.drawTable(table, {}), wide: true });
}

function downloadCSV(name, table) {
  if (!table) return;
  const blob = new Blob([C.toCSV(table)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: `${name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "chart"}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ── dashboards ────────────────────────────────────────────────────────────── */

function dashboardById(id) {
  if (id === "overview") return OVERVIEW;
  const it = state.saved.get(id);
  return it && it.kind === "dashboard" ? it : null;
}

async function newDashboard() {
  const name = await promptName("New dashboard", "", "Create");
  if (!name) return;
  const saved = await upsertSaved({ kind: "dashboard", name, spec: { items: [] } });
  if (saved) go(`dashboard/${saved.id}`);
}

async function saveDashboardItems(dash, items) {
  const saved = await upsertSaved({ id: dash.id, kind: "dashboard", name: dash.name, spec: { ...dash.spec, items } });
  if (saved) renderView();
}

function renderDashboard(id) {
  const dash = dashboardById(id);
  const view = $("view");
  if (!dash) { view.replaceChildren(h("div", { class: "page" }, emptyBox("That dashboard doesn't exist any more."))); return; }
  const editable = !dash.builtin;
  const items = dash.spec.items || [];
  setTitle(["Dashboards", dash.name]);

  const title = editable
    ? h("input", { class: "title-input", value: dash.name, maxlength: 120, "aria-label": "Dashboard name",
      onchange: async e => { const name = e.target.value.trim(); if (name && name !== dash.name) { await upsertSaved({ id: dash.id, kind: "dashboard", name, spec: dash.spec }); setTitle(["Dashboards", name]); } } })
    : h("h1", { class: "title", text: dash.name });

  const actions = h("div", { class: "page-actions" },
    h("button", { class: "btn", type: "button", onclick: e => addChartMenu(e.currentTarget, dash) }, "+ Add chart"),
    h("button", { class: "btn", type: "button", onclick: async () => {
      const name = await promptName(editable ? "Duplicate dashboard" : "Make an editable copy", `${dash.name}${editable ? " copy" : ""}`, "Create");
      if (!name) return;
      const saved = await upsertSaved({ kind: "dashboard", name, spec: clone(dash.spec) });
      if (saved) go(`dashboard/${saved.id}`);
    } }, editable ? "Duplicate" : "Copy to edit"),
    editable ? h("button", { class: "btn danger-ghost", type: "button", onclick: async () => {
      if (await confirmDialog("Delete dashboard", `Delete “${dash.name}”? Its charts stay saved.`, "Delete", true) && await deleteSaved(dash.id)) go("dashboard/overview");
    } }, "Delete") : null);

  const grid = h("div", { class: "dash-grid" });
  view.replaceChildren(h("div", { class: "page wide" },
    h("div", { class: "page-head" }, h("div", null, title,
      h("div", { class: "page-sub", text: editable ? `${items.length} charts · charts without their own range follow the range above` : "Built in and read-only. Open any chart to change it, or copy the dashboard to arrange your own." })), actions),
    items.length ? grid : emptyBox("No charts yet. Add a saved chart or a template.")));

  const cards = items.map((item, index) => {
    const ref = resolveRef(item.ref);
    const card = h("section", { class: "card", "data-size": SIZES[item.size] ? item.size : "1/2" });
    grid.append(card);
    return { item, index, ref, card };
  });
  for (const c of cards) drawCard(dash, c, editable);
}

function drawCard(dash, { item, index, ref, card }, editable) {
  const key = `dash:${dash.id}:${index}`;
  if (!ref) {
    card.replaceChildren(h("div", { class: "card-head" }, h("div", { class: "card-title", text: "Missing chart" })),
      h("div", { class: "card-body" }, emptyBox("This chart was deleted."), editable ? h("button", { class: "btn small", type: "button", onclick: () => saveDashboardItems(dash, dash.spec.items.filter((_, i) => i !== index)) }, "Remove card") : null));
    return;
  }
  const spec = effective(ref.spec);
  const href = `${ref.href}${editable ? `?dash=${dash.id}&i=${index}` : ""}`;
  const body = h("div", { class: "card-body" });
  const showTable = state.cardTables.has(key);
  const sizeItems = editable ? Object.keys(SIZES).map(sz => ({ label: `Width ${sz === "full" ? "full" : sz}`, checked: item.size === sz, onClick: () => { const items = clone(dash.spec.items); items[index].size = sz; saveDashboardItems(dash, items); } })) : [];
  let result = null;
  const moreBtn = iconBtn("⋯", "Chart options", e => menu(e.currentTarget, [
    { label: "Open in builder", onClick: () => go(href) },
    { label: showTable ? "Show the chart" : "Show the data table", onClick: () => { if (showTable) state.cardTables.delete(key); else state.cardTables.add(key); drawCard(dash, { item, index, ref, card }, editable); } },
    { label: "Download CSV", onClick: () => downloadCSV(ref.name, result && tableFor(spec, result)) },
    ...(editable ? ["-", ...sizeItems, "-",
      { label: "Move earlier", disabled: index === 0, onClick: () => { const items = clone(dash.spec.items); [items[index - 1], items[index]] = [items[index], items[index - 1]]; saveDashboardItems(dash, items); } },
      { label: "Move later", disabled: index === dash.spec.items.length - 1, onClick: () => { const items = clone(dash.spec.items); [items[index + 1], items[index]] = [items[index], items[index + 1]]; saveDashboardItems(dash, items); } },
      { label: "Remove from dashboard", danger: true, onClick: () => saveDashboardItems(dash, dash.spec.items.filter((_, i) => i !== index)) }] : []),
  ], { align: "right" }));

  card.replaceChildren(
    h("div", { class: "card-head" },
      h("div", { class: "card-titles" },
        h("a", { class: "card-title", href: `#/${href}`, text: ref.name }),
        h("div", { class: "card-meta" }, h("span", { class: "tag", text: TYPE_TAGS[spec.type] }), h("code", { title: E.describeSpec(ref.spec), text: rangeLabelFor(ref.spec) }))),
      moreBtn),
    body);

  const kpi = spec.type === "segmentation" && spec.viz === "number";
  const draw = () => {
    try {
      result = E.run(state.ds, spec);
      if (showTable) body.replaceChildren(tableNode(key, tableFor(spec, result)));
      else drawInto(body, spec, result, { key, height: kpi ? 0 : 230, redraw: draw });
    } catch (err) {
      body.replaceChildren(errorBox(err.message));
    }
  };
  card.classList.toggle("kpi-card", kpi && !showTable);
  draw();
}

const rangeLabelFor = spec => (spec.range ? rangeLabel(spec.range) : rangeLabel(state.prefs.range)) + (spec.interval && spec.type !== "heatmap" && spec.type !== "journeys" && spec.type !== "users" && spec.viz !== "number" ? ` · ${INTERVAL_NAMES[spec.interval].toLowerCase()}` : "");

function addChartMenu(anchor, dash) {
  if (dash.builtin) {
    notify("The Overview is read-only. Copy it to add charts.", "bad");
    return;
  }
  popover(anchor, close => {
    let size = "1/2";
    const search = h("input", { class: "input pop-search", type: "search", placeholder: "Search charts and templates" });
    const list = h("div", { class: "pop-list" });
    const add = ref => { close(); saveDashboardItems(dash, [...(dash.spec.items || []), { ref, size }]); };
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const charts = savedOf("chart").filter(c => !q || c.name.toLowerCase().includes(q));
      const templates = Object.entries(TEMPLATES).filter(([, t]) => !q || t.name.toLowerCase().includes(q));
      list.replaceChildren(...[
        h("div", { class: "pop-group", text: "Saved charts" }),
        charts.length ? charts.map(c => h("button", { class: "pop-opt", type: "button", onclick: () => add(`chart:${c.id}`) }, h("span", { class: "tag", text: TYPE_TAGS[c.spec.type] }), h("span", { class: "opt-label", text: c.name }))) : h("div", { class: "pop-empty", text: "None saved yet" }),
        h("div", { class: "pop-group", text: "Templates" }),
        templates.map(([k, t]) => h("button", { class: "pop-opt", type: "button", onclick: () => add(`template:${k}`) }, h("span", { class: "tag", text: TYPE_TAGS[t.type] }), h("span", { class: "opt-label", text: t.name })))].flat(Infinity));
    };
    search.addEventListener("input", draw);
    draw();
    setTimeout(() => search.focus());
    return [h("div", { class: "pop-row" }, search, select(Object.keys(SIZES).map(sz => [sz, `width ${sz}`]), size, v => { size = v; })), list,
      h("div", { class: "pop-foot" }, h("button", { class: "btn small", type: "button", onclick: () => { close(); go("chart/new/segmentation"); } }, "Build a new chart"))];
  }, { cls: "wide" });
}

/* ── builder ───────────────────────────────────────────────────────────────── */

let B = null; // the open builder: { key, query, draft, def, chart, table, head }

function draftFor(key) {
  let draft = state.drafts.get(key);
  if (draft) return draft;
  const [kind, id] = key.split("/");
  if (kind === "chart" && state.saved.has(id)) {
    const it = state.saved.get(id);
    draft = { id: it.id, template: null, name: it.name, spec: clone(it.spec), dirty: false };
  } else if (kind === "template" && TEMPLATES[id]) {
    const { name, ...spec } = clone(TEMPLATES[id]);
    draft = { id: null, template: id, name, spec, dirty: false };
  } else {
    return null;
  }
  state.drafts.set(key, draft);
  return draft;
}

function renderBuilder(key, query) {
  const draft = draftFor(key);
  if (!draft) { $("view").replaceChildren(h("div", { class: "page" }, emptyBox("That chart doesn't exist any more."))); return; }
  const spec = draft.spec;
  setTitle([draft.id ? "Saved charts" : draft.template ? "Templates" : "New chart", draft.name || "Untitled chart"]);

  const dirty = h("span", { class: `dirty${draft.dirty ? " on" : ""}`, text: draft.id ? "unsaved changes" : draft.template ? "template, save to keep changes" : "not saved" });
  const nameInput = h("input", { class: "title-input", value: draft.name, maxlength: 120, "aria-label": "Chart name",
    oninput: e => { draft.name = e.target.value; markDirty(); } });

  const typeTabs = h("div", { class: "type-tabs", role: "tablist" }, Object.entries(E.CHART_TYPES).map(([t, meta]) => h("button", {
    class: `type-tab${spec.type === t ? " on" : ""}`, type: "button", role: "tab", "aria-selected": spec.type === t ? "true" : "false", title: TYPE_BLURBS[t],
    onclick: () => switchType(t),
  }, h("span", { class: "tag", text: TYPE_TAGS[t] }), meta.label)));

  const head = h("div", { class: "builder-head" },
    h("div", { class: "builder-title" }, nameInput, dirty),
    h("div", { class: "page-actions" },
      h("button", { class: "btn primary", type: "button", onclick: () => saveDraft(false) }, draft.id ? "Save" : "Save chart"),
      draft.id ? h("button", { class: "btn", type: "button", onclick: () => saveDraft(true) }, "Save as new") : null,
      h("button", { class: "btn", type: "button", onclick: e => addToDashboard(e.currentTarget) }, "Add to dashboard"),
      iconBtn("⋯", "More", e => menu(e.currentTarget, [
        { label: "Download CSV", onClick: () => downloadCSV(draft.name, B.result && tableFor(effective(draft.spec), B.result)) },
        { label: "Copy definition JSON", onClick: () => navigator.clipboard.writeText(JSON.stringify(draft.spec, null, 2)).then(() => notify("Copied the definition"), () => notify("Couldn't copy", "bad")) },
        draft.dirty && (draft.id || draft.template) ? { label: "Discard changes", onClick: () => { state.drafts.delete(key); renderView(); } } : null,
        draft.id ? "-" : null,
        draft.id ? { label: "Delete chart", danger: true, onClick: () => deleteChart(draft) } : null,
      ], { align: "right" }))));

  const def = h("div", { class: "def" });
  const toolbar = h("div", { class: "canvas-bar" });
  const chart = h("div", { class: "canvas-chart" });
  const table = h("div", { class: "canvas-table" });
  $("view").replaceChildren(h("div", { class: "page builder" }, head, typeTabs,
    h("div", { class: "builder-body" }, def, h("div", { class: "canvas" }, toolbar, chart, h("div", { class: "canvas-sub" }, h("span", { text: "Data" }), h("span", { class: "canvas-desc", text: "" })), table))));

  B = { key, query, draft, def, toolbar, chart, table, dirty, result: null };
  renderDefinition();
  renderToolbar();
  refreshChart();
}

function markDirty() {
  if (!B) return;
  B.draft.dirty = true;
  B.dirty.classList.add("on");
  B.dirty.textContent = B.draft.id ? "unsaved changes" : B.draft.template ? "template, save to keep changes" : "not saved";
}

const scheduleChart = debounce(() => refreshChart(), 60);

function update(fn, { panel = false, toolbar = false } = {}) {
  if (!B) return;
  fn(B.draft.spec);
  markDirty();
  if (panel) renderDefinition();
  if (toolbar) renderToolbar();
  scheduleChart();
}

function refreshChart() {
  if (!B) return;
  const spec = effective(B.draft.spec);
  let result;
  try {
    result = E.run(state.ds, spec);
  } catch (err) {
    B.result = null;
    B.chart.replaceChildren(errorBox(err.message));
    B.table.replaceChildren();
    return;
  }
  B.result = result;
  drawInto(B.chart, spec, result, { key: B.key, height: 340, redraw: refreshChart });
  const showsTable = result.kind === "users" || spec.viz === "table" || (result.kind === "retention" && spec.viz === "cohorts");
  const table = showsTable || result.kind === "empty" ? null : tableFor(spec, result);
  B.table.replaceChildren(table ? tableNode(`${B.key}:table`, table) : h("div", { class: "muted small", text: showsTable ? "The chart above is the table." : "" }));
  const desc = B.table.parentElement.querySelector(".canvas-desc");
  if (desc) desc.textContent = E.describeSpec(B.draft.spec);
  const vizOpts = vizOptions(spec, result).map(o => o[0]);
  const current = B.toolbar.querySelector("select[data-role=viz]");
  if (current && current.options.length !== vizOpts.length) renderToolbar();
}

function renderToolbar() {
  if (!B) return;
  const spec = B.draft.spec;
  const vizOpts = vizOptions(spec, B.result);
  const interval = INTERVALS[spec.type] && !(spec.type === "segmentation" && (E.MEASURES[spec.series?.[0]?.measure]?.categorical || spec.viz === "number" || spec.viz === "hbar"))
    ? h("label", { class: "field" }, h("span", { class: "k", text: "Interval" }), select(INTERVALS[spec.type].map(i => [i, INTERVAL_NAMES[i]]), spec.interval || INTERVALS[spec.type][0], v => update(sp => { sp.interval = v; })))
    : null;
  const rangeOpts = [["", `Follow the page (${rangeLabel(state.prefs.range)})`], ...Object.entries(E.RANGE_PRESETS).map(([k, p]) => [k, p.label])];
  B.toolbar.replaceChildren(...[
    h("label", { class: "field" }, h("span", { class: "k", text: "Chart" }), select(vizOpts, vizOpts.some(o => o[0] === spec.viz) ? spec.viz : vizOpts[0][0], v => update(sp => { sp.viz = v; }, { toolbar: true }), { "data-role": "viz" })),
    interval,
    h("label", { class: "field" }, h("span", { class: "k", text: "Range" }), select(rangeOpts, spec.range && spec.range.preset !== "custom" ? spec.range.preset : "", v => update(sp => { if (v) sp.range = { preset: v }; else delete sp.range; }))),
    h("span", { class: "spacer" }),
    h("button", { class: "btn small", type: "button", onclick: () => downloadCSV(B.draft.name, B.result && tableFor(effective(spec), B.result)) }, "CSV")].filter(Boolean));
}

function switchType(type) {
  const old = B.draft.spec;
  if (old.type === type) return;
  const next = NEW_SPECS[type]();
  if (old.range) next.range = old.range;
  if (old.segment) next.segment = old.segment;
  const events = old.series?.[0]?.events || old.steps?.[1]?.events || old.return?.events || old.start?.events;
  if (events && events.length) {
    if (next.series) next.series[0].events = [...events];
    if (type === "retention") next.return = { events: [...events] };
    if (type === "funnel") next.steps[1] = { events: [...events] };
  }
  B.draft.spec = next;
  B.draft.dirty = true;
  renderBuilder(B.key, B.query);
}

async function saveDraft(asNew) {
  const d = B.draft;
  const key = B.key;
  const query = B.query;
  let name = (d.name || "").trim();
  if (!d.id || asNew || !name) {
    name = await promptName(asNew ? "Save as a new chart" : "Save chart", asNew ? `${name} copy` : name === "Untitled chart" ? "" : name, "Save");
    if (!name) return;
  }
  const saved = await upsertSaved({ id: asNew ? undefined : d.id || undefined, kind: "chart", name, spec: d.spec });
  if (!saved) return;

  // Saving a template opened from one of your dashboards puts your chart in its place.
  if (!d.id && query.dash && query.i !== undefined) {
    const dash = state.saved.get(query.dash);
    const i = Number(query.i);
    if (dash && dash.spec.items?.[i] && dash.spec.items[i].ref.startsWith("template:")) {
      const items = clone(dash.spec.items);
      items[i].ref = `chart:${saved.id}`;
      await upsertSaved({ id: dash.id, kind: "dashboard", name: dash.name, spec: { ...dash.spec, items } });
    }
  }
  state.drafts.delete(key);
  notify(`Saved “${saved.name}”`);
  if (key === `chart/${saved.id}`) renderView();
  else go(`chart/${saved.id}${query.dash ? `?dash=${query.dash}&i=${query.i}` : ""}`);
}

async function deleteChart(draft) {
  const uses = savedOf("dashboard").filter(dash => (dash.spec.items || []).some(it => it.ref === `chart:${draft.id}`));
  const text = uses.length ? `Delete “${draft.name}”? It will also come off ${uses.map(u => `“${u.name}”`).join(", ")}.` : `Delete “${draft.name}”?`;
  if (!await confirmDialog("Delete chart", text, "Delete", true)) return;
  if (!await deleteSaved(draft.id)) return;
  for (const dash of uses) await upsertSaved({ id: dash.id, kind: "dashboard", name: dash.name, spec: { ...dash.spec, items: dash.spec.items.filter(it => it.ref !== `chart:${draft.id}`) } });
  state.drafts.delete(`chart/${draft.id}`);
  notify("Deleted");
  go("dashboard/overview");
}

async function addToDashboard() {
  const d = B.draft;
  const dashboards = savedOf("dashboard");
  let target = dashboards[0]?.id || "__new";
  let size = "1/2";
  const newName = h("input", { class: "input wide", placeholder: "New dashboard name", maxlength: 120 });
  const newWrap = h("div", { class: "field-col", hidden: target !== "__new" }, newName);
  const body = [
    h("label", { class: "field-col" }, h("span", { class: "k", text: "Dashboard" }),
      select([...dashboards.map(x => [x.id, x.name]), ["__new", "New dashboard…"]], target, v => { target = v; newWrap.hidden = v !== "__new"; })),
    newWrap,
    h("label", { class: "field-col" }, h("span", { class: "k", text: "Width" }), select(Object.keys(SIZES).map(sz => [sz, sz === "full" ? "Full width" : sz]), size, v => { size = v; })),
    !d.id ? h("p", { class: "modal-text", text: "The chart will be saved first." }) : null,
  ];
  const ok = await modal({ title: "Add to dashboard", body, actions: [{ label: "Cancel", value: () => null }, { label: "Add", primary: true, value: () => (target === "__new" && !newName.value.trim() ? undefined : true) }] });
  if (!ok) return;

  let chartId = d.id;
  if (!chartId || d.dirty) {
    let name = (d.name || "").trim();
    if (!chartId) {
      name = await promptName("Save chart", name === "Untitled chart" ? "" : name, "Save");
      if (!name) return;
    }
    const saved = await upsertSaved({ id: chartId || undefined, kind: "chart", name, spec: d.spec });
    if (!saved) return;
    chartId = saved.id;
    state.drafts.delete(B.key);
  }
  let dash;
  if (target === "__new") {
    dash = await upsertSaved({ kind: "dashboard", name: newName.value.trim(), spec: { items: [] } });
    if (!dash) return;
  } else {
    dash = state.saved.get(target);
  }
  const updated = await upsertSaved({ id: dash.id, kind: "dashboard", name: dash.name, spec: { ...dash.spec, items: [...(dash.spec.items || []), { ref: `chart:${chartId}`, size }] } });
  if (updated) { notify(`Added to “${updated.name}”`); go(`dashboard/${updated.id}`); }
}

/* ── definition panel ──────────────────────────────────────────────────────── */

function section(title, content, { hint, open = true } = {}) {
  const el = h("details", { class: "def-section", open });
  el.append(h("summary", { class: "def-head" }, h("span", { text: title }), hint ? h("span", { class: "def-hint", text: hint }) : null), h("div", { class: "def-body" }, content));
  return el;
}

function renderDefinition() {
  if (!B) return;
  const spec = B.draft.spec;
  const parts = [];
  switch (spec.type) {
    case "segmentation":
      parts.push(section("Events", seriesEditor(spec, E.MEASURES), { hint: "A to H" }));
      parts.push(section("Formula", formulaEditor(spec), { open: !!spec.formula, hint: "optional" }));
      parts.push(section("Breakdown", breakdownEditor(spec)));
      break;
    case "users":
      parts.push(section("Columns", seriesEditor(spec, E.USER_MEASURES), { hint: "one per metric" }));
      break;
    case "funnel":
      parts.push(section("Steps", stepsEditor(spec), { hint: "in order" }));
      parts.push(section("Conversion window", h("div", { class: "row" }, h("span", { class: "k", text: "Finish within" }), select(WINDOWS, spec.window ?? 0, v => update(sp => { sp.window = Number(v) || 0; }))), { hint: "from step 1" }));
      parts.push(section("Breakdown", userBreakdownEditor(spec)));
      break;
    case "retention":
      parts.push(section("Start event", selectionEditor(spec.start ||= { events: ["joined"] }), { hint: "first time in the range" }));
      parts.push(section("Return event", selectionEditor(spec.return ||= { events: ["$active"] })));
      parts.push(section("Counting", h("div", { class: "row" }, select([["unbounded", "On or after day N (unbounded)"], ["exact", "Exactly on day N (bounded)"]], spec.mode || "unbounded", v => update(sp => { sp.mode = v; })))));
      parts.push(section("Breakdown", userBreakdownEditor(spec)));
      break;
    case "lifecycle":
    case "stickiness":
      parts.push(section("Activity", selectionEditor((spec.series ||= [{ events: ["$active"] }])[0]), { hint: "what counts as active" }));
      break;
    case "heatmap": {
      const sr = (spec.series ||= [{ events: ["post"], measure: "totals" }])[0];
      parts.push(section("Event", [selectionEditor(sr), h("div", { class: "row" }, h("span", { class: "k", text: "Count" }), select([["totals", "Event totals"], ["uniques", "Uniques"]], sr.measure || "totals", v => update(() => { sr.measure = v; })))]));
      break;
    }
    case "journeys":
      parts.push(section("Start event", selectionEditor(spec.start ||= { events: ["joined"] }), { hint: "first time in the range" }));
      parts.push(section("Path", journeyEditor(spec)));
      break;
    default:
      break;
  }
  parts.push(section("People", segmentEditor(spec), { open: !!(spec.segment || []).length, hint: (spec.segment || []).length ? `${spec.segment.length} filter${spec.segment.length === 1 ? "" : "s"}` : "everyone" }));
  parts.push(section("Definition", jsonEditor(), { open: false, hint: "JSON" }));
  B.def.replaceChildren(...parts);
}

function eventChip(events, onChange) {
  const btn = h("button", { class: "event-chip", type: "button" });
  const paint = list => btn.replaceChildren(
    list.length ? h("span", { class: "chip-events" }, list.map((k, i) => [i ? h("span", { class: "or", text: "or" }) : null, h("span", { class: "chip-event" }, h("span", { text: E.eventLabel(k) }))]))
      : h("span", { class: "muted", text: "Select an event" }),
    h("span", { class: "caret", text: "▾" }));
  paint(events);
  btn.addEventListener("click", () => eventPicker(btn, events, next => { paint(next); onChange(next); }));
  return btn;
}

function eventCounts() {
  const counts = {};
  for (const [t, list] of state.ds.byType) counts[t] = list.length;
  return counts;
}

function eventPicker(anchor, selected, onChange) {
  popover(anchor, () => {
    const chosen = new Set(selected);
    const counts = eventCounts();
    const search = h("input", { class: "input pop-search", type: "search", placeholder: "Search events" });
    const list = h("div", { class: "pop-list" });
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const entries = [...Object.entries(E.PSEUDO_EVENTS), ...Object.entries(E.EVENTS)].filter(([k, m]) => !q || k.includes(q) || m.label.toLowerCase().includes(q));
      list.replaceChildren(...groupEvents(entries).map(([g, items]) => [h("div", { class: "pop-group", text: g }), items.map(([key, meta]) => h("label", { class: "pop-opt" },
        h("input", { type: "checkbox", checked: chosen.has(key), onchange: e => { if (e.target.checked) chosen.add(key); else chosen.delete(key); onChange([...chosen]); } }),
        h("span", { class: "opt-label", text: meta.label }), h("code", { text: key }), h("span", { class: "opt-count", text: key.startsWith("$") ? "" : (counts[key] || 0).toLocaleString() })))]).flat(Infinity));
    };
    search.addEventListener("input", draw);
    draw();
    setTimeout(() => search.focus());
    return [search, list, h("div", { class: "pop-foot" }, h("span", { class: "muted small", text: "Several events count as any of them." }))];
  }, { cls: "wide", onClose: () => renderDefinition() });
}

function propsForEvents(events) {
  const out = {};
  for (const t of E.resolveTypes(state.ds, events || [])) for (const p of state.raw.schema?.[t] || []) if (E.EVENT_PROPS[p]) out[p] = E.EVENT_PROPS[p];
  return out;
}

const valueCache = new Map();
function valuesOf(scope, prop) {
  const k = `${scope}:${prop}:${state.ds.events.length}:${state.ds.users.length}`;
  if (valueCache.has(k)) return valueCache.get(k);
  const set = new Set();
  if (scope === "user") for (const u of state.ds.users) { const v = u.props[prop]; if (v !== null && v !== undefined) set.add(String(v)); }
  else for (const e of state.ds.events) { const v = e.p[prop]; if (v !== null && v !== undefined) set.add(String(v)); }
  const list = [...set].sort().slice(0, 200);
  valueCache.set(k, list);
  return list;
}

const defaultValue = type => (type === "boolean" ? "true" : "");

function valueControl(type, value, onValue, suggestions) {
  if (type === "boolean") return select([["true", "true"], ["false", "false"]], String(value ?? "true"), onValue);
  if (type === "string") {
    const id = `dl-${Math.random().toString(36).slice(2)}`;
    return [h("input", { class: "input", list: id, value: value ?? "", placeholder: "value", oninput: debounce(e => onValue(e.target.value), 250) }), h("datalist", { id }, (suggestions || []).map(v => h("option", { value: v })))];
  }
  return h("input", { class: "input num", type: "number", value: value ?? "", placeholder: "0", oninput: debounce(e => onValue(e.target.value), 250) });
}

function filterEditor(filters, metaMap, scope) {
  const keys = Object.keys(metaMap);
  const rows = filters.map((f, fi) => {
    const meta = metaMap[f.prop] || { type: "string", label: f.prop };
    return h("div", { class: "filter-row" },
      h("span", { class: "k", text: fi ? "and" : "where" }),
      select(keys.map(k => [k, metaMap[k].label]).concat(metaMap[f.prop] ? [] : [[f.prop, f.prop]]), f.prop, v => update(() => { f.prop = v; f.op = E.OPS[metaMap[v]?.type || "string"][0]; f.value = defaultValue(metaMap[v]?.type); }, { panel: true })),
      select((E.OPS[meta.type] || E.OPS.string).map(o => [o, o]), f.op, v => update(() => { f.op = v; })),
      valueControl(meta.type, f.value, v => update(() => { f.value = v; }), meta.type === "string" ? valuesOf(scope, f.prop) : null),
      iconBtn("×", "Remove filter", () => update(() => filters.splice(fi, 1), { panel: true })));
  });
  return h("div", { class: "filters" }, rows,
    keys.length ? h("button", { class: "link-btn", type: "button", onclick: () => update(() => { const p = keys[0]; filters.push({ prop: p, op: E.OPS[metaMap[p].type][0], value: defaultValue(metaMap[p].type) }); }, { panel: true }) }, "+ where") : null);
}

function selectionEditor(sel) {
  return h("div", { class: "selection" },
    eventChip(sel.events || [], next => update(() => { sel.events = next; })),
    filterEditor(sel.filters ||= [], propsForEvents(sel.events), "event"));
}

function seriesEditor(spec, measures) {
  const series = (spec.series ||= []);
  const users = measures === E.USER_MEASURES;
  const cards = series.map((sr, i) => {
    const mKey = measures[sr.measure] ? sr.measure : users ? "totals" : "uniques";
    const m = measures[mKey];
    const props = propsForEvents(sr.events);
    const propChoices = Object.entries(props).filter(([, p]) => m.prop === "any" || p.type === "number");
    const measureSel = select(Object.entries(measures).map(([k, x]) => [k, x.label]), mKey, v => update(() => {
      sr.measure = v;
      const need = measures[v].prop;
      if (need) {
        const ok = Object.entries(propsForEvents(sr.events)).filter(([, p]) => need === "any" || p.type === "number");
        if (!ok.some(([k]) => k === sr.prop)) sr.prop = ok[0]?.[0];
      } else {
        delete sr.prop;
      }
      if (!users && i === 0) {
        if (measures[v].categorical && !["bar", "hbar", "table"].includes(spec.viz)) spec.viz = "bar";
        if (!measures[v].categorical && !VIZ.segmentation.some(o => o[0] === spec.viz)) spec.viz = "line";
      }
    }, { panel: true, toolbar: true }));
    const propSel = m.prop ? (propChoices.length
      ? select(propChoices.map(([k, p]) => [k, p.label]), sr.prop, v => update(() => { sr.prop = v; }))
      : h("span", { class: "muted small", text: "these events have no such property" })) : null;
    return h("div", { class: "series-card" },
      h("div", { class: "series-top" },
        h("span", { class: "letter", style: `--c:${C.colorAt(i)}`, text: E.LETTERS[i] }),
        eventChip(sr.events || [], next => update(() => { sr.events = next; })),
        series.length > 1 ? iconBtn("×", "Remove", () => update(sp => sp.series.splice(i, 1), { panel: true })) : null),
      h("div", { class: "row" }, h("span", { class: "k", text: "measured as" }), measureSel, propSel),
      filterEditor(sr.filters ||= [], props, "event"),
      h("input", { class: "input small-input", placeholder: "Name this series (optional)", value: sr.label || "", oninput: debounce(e => update(() => { if (e.target.value) sr.label = e.target.value; else delete sr.label; }), 300) }));
  });
  return h("div", { class: "series-list" }, cards,
    series.length < (users ? E.MAX_COLUMNS : E.MAX_SERIES) ? h("button", { class: "btn small ghost", type: "button", onclick: () => update(sp => sp.series.push({ events: [], measure: users ? "totals" : (sp.series[0]?.measure && !E.MEASURES[sp.series[0].measure]?.categorical ? sp.series[0].measure : "uniques") }), { panel: true }) }, users ? "+ Add column" : "+ Add event") : null);
}

function formulaEditor(spec) {
  return h("div", { class: "formula" },
    h("input", { class: "input mono wide", placeholder: "e.g. A / B * 100", value: spec.formula || "",
      oninput: debounce(e => update(sp => { if (e.target.value.trim()) sp.formula = e.target.value; else delete sp.formula; }), 300) }),
    h("div", { class: "muted small", text: "Combine series by letter with + − * / and parentheses. While a formula is set, only its result is drawn and breakdowns are off." }));
}

function breakdownEditor(spec) {
  const events = (spec.series || []).flatMap(sr => sr.events || []);
  const eventProps = Object.entries(propsForEvents(events)).filter(([, p]) => p.type !== "number" && !p.noBreakdown);
  const b = spec.breakdown || { kind: "none" };
  const value = b.kind === "none" || !b.kind ? "none" : b.kind === "event" ? "event" : `${b.kind}:${b.prop}`;
  const options = [["none", "No breakdown"], ["event", "Event type"],
    ...(eventProps.length ? [{ group: "Event property", options: eventProps.map(([k, p]) => [`event_prop:${k}`, p.label]) }] : []),
    { group: "User property", options: Object.entries(E.USER_PROPS).filter(([, p]) => p.type !== "number").map(([k, p]) => [`user_prop:${k}`, p.label]) }];
  return h("div", null,
    h("div", { class: "row" }, h("span", { class: "k", text: "Group by" }), select(options, value, v => update(sp => {
      if (v === "none") delete sp.breakdown;
      else if (v === "event") sp.breakdown = { kind: "event" };
      else { const [kind, prop] = v.split(":"); sp.breakdown = { kind, prop }; }
    }))),
    h("div", { class: "muted small", text: "Groups are ranked by the measure; past eight series the rest fold into Other." }));
}

function userBreakdownEditor(spec) {
  const b = spec.breakdown;
  const value = b && b.kind === "user_prop" ? b.prop : "";
  return h("div", { class: "row" }, h("span", { class: "k", text: "Group by" }),
    select([["", "No breakdown"], ...Object.entries(E.USER_PROPS).filter(([, p]) => p.type !== "number").map(([k, p]) => [k, p.label])], value,
      v => update(sp => { if (v) sp.breakdown = { kind: "user_prop", prop: v }; else delete sp.breakdown; })));
}

function stepsEditor(spec) {
  const steps = (spec.steps ||= []);
  return h("div", { class: "series-list" },
    steps.map((st, i) => h("div", { class: "series-card" },
      h("div", { class: "series-top" },
        h("span", { class: "letter step", text: String(i + 1) }),
        eventChip(st.events || [], next => update(() => { st.events = next; })),
        h("span", { class: "spacer" }),
        i > 0 ? iconBtn("↑", "Move up", () => update(sp => { [sp.steps[i - 1], sp.steps[i]] = [sp.steps[i], sp.steps[i - 1]]; }, { panel: true })) : null,
        steps.length > 2 ? iconBtn("×", "Remove step", () => update(sp => sp.steps.splice(i, 1), { panel: true })) : null),
      filterEditor(st.filters ||= [], propsForEvents(st.events), "event"))),
    steps.length < 10 ? h("button", { class: "btn small ghost", type: "button", onclick: () => update(sp => sp.steps.push({ events: [] }), { panel: true }) }, "+ Add step") : null);
}

function journeyEditor(spec) {
  const skip = new Set(spec.exclude || E.JOURNEY_SKIP);
  const skipBtn = h("button", { class: "event-chip", type: "button" }, h("span", { text: skip.size ? `${skip.size} event types skipped` : "Nothing skipped" }), h("span", { class: "caret", text: "▾" }));
  skipBtn.addEventListener("click", () => eventPicker(skipBtn, [...skip], next => update(sp => { sp.exclude = next.filter(k => !k.startsWith("$")); })));
  return h("div", { class: "stack" },
    h("div", { class: "row" }, h("span", { class: "k", text: "Steps" }), select([1, 2, 3, 4, 5, 6].map(n => [n, `${n} after the start`]), spec.depth || 3, v => update(sp => { sp.depth = Number(v); }))),
    h("label", { class: "row check" }, h("input", { type: "checkbox", checked: spec.unique !== false, onchange: e => update(sp => { sp.unique = e.target.checked; }) }), h("span", { text: "Count each kind of event once per person" })),
    h("div", { class: "row" }, h("span", { class: "k", text: "Skip" }), skipBtn));
}

function segmentEditor(spec) {
  const seg = (spec.segment ||= []);
  const rows = seg.map((f, fi) => {
    const remove = iconBtn("×", "Remove", () => update(sp => sp.segment.splice(fi, 1), { panel: true }));
    if (f.kind === "did") {
      return h("div", { class: "seg-row" },
        h("span", { class: "k", text: fi ? "and did" : "who did" }),
        eventChip(f.events || [], next => update(() => { f.events = next; })),
        select(["≥", "=", "≤", ">", "<"].map(o => [o, o]), f.op || "≥", v => update(() => { f.op = v; })),
        h("input", { class: "input num", type: "number", min: 0, value: f.count ?? 1, oninput: debounce(e => update(() => { f.count = Number(e.target.value); }), 250) }),
        h("span", { class: "k", text: "times" }),
        select([["all", "ever"], ["range", "in the range"]], f.within || "all", v => update(() => { f.within = v; })),
        remove);
    }
    const meta = E.USER_PROPS[f.prop] || { type: "string", label: f.prop };
    return h("div", { class: "seg-row" },
      h("span", { class: "k", text: fi ? "and" : "where" }),
      select(Object.entries(E.USER_PROPS).map(([k, p]) => [k, p.label]), f.prop, v => update(() => { f.prop = v; f.op = E.OPS[E.USER_PROPS[v].type][0]; f.value = defaultValue(E.USER_PROPS[v].type); }, { panel: true })),
      select((E.OPS[meta.type] || E.OPS.string).map(o => [o, o]), f.op, v => update(() => { f.op = v; })),
      valueControl(meta.type, f.value, v => update(() => { f.value = v; }), meta.type === "string" ? valuesOf("user", f.prop) : null),
      remove);
  });
  return h("div", { class: "stack" }, rows.length ? rows : h("div", { class: "muted small", text: "Everyone the page includes." }),
    h("div", { class: "row" },
      h("button", { class: "link-btn", type: "button", onclick: () => update(sp => sp.segment.push({ prop: "status", op: "is", value: "active" }), { panel: true }) }, "+ user property"),
      h("button", { class: "link-btn", type: "button", onclick: () => update(sp => sp.segment.push({ kind: "did", events: ["post"], op: "≥", count: 1, within: "all" }), { panel: true }) }, "+ did an event")));
}

function jsonEditor() {
  const area = h("textarea", { class: "json", spellcheck: "false", rows: 14 }, JSON.stringify(B.draft.spec, null, 2));
  const error = h("div", { class: "field-error" });
  return h("div", { class: "stack" }, area, error,
    h("div", { class: "row" },
      h("button", { class: "btn small", type: "button", onclick: () => {
        try {
          const next = JSON.parse(area.value);
          if (!next || typeof next !== "object" || !E.CHART_TYPES[next.type]) throw new Error(`"type" must be one of ${Object.keys(E.CHART_TYPES).join(", ")}`);
          B.draft.spec = next;
          B.draft.dirty = true;
          renderBuilder(B.key, B.query);
        } catch (err) {
          error.textContent = err.message;
        }
      } }, "Apply JSON"),
      h("span", { class: "muted small", text: "Everything a chart is. Paste one in to reuse it." })));
}

/* ── a person ──────────────────────────────────────────────────────────────── */

function renderUser(i) {
  const ds = state.ds;
  const u = ds.byI.get(i);
  const view = $("view");
  if (!u) { view.replaceChildren(h("div", { class: "page" }, emptyBox(state.prefs.includeTest ? "No such person." : "No such person, or it's a test account and test accounts are hidden."))); return; }
  setTitle(["People", `@${u.handle}`]);
  const range = E.resolveRange(ds, state.prefs.range);
  const inRange = u.events.filter(e => e.dn >= range.startDn && e.dn <= range.endDn);
  const count = (t, list = inRange) => list.filter(e => e.t === t).length;
  const peers = new Set(inRange.filter(e => e.t === "dm").map(e => e.p.peer)).size;
  const active = new Set(inRange.filter(e => ds.activeTypes.has(e.t)).map(e => e.dn)).size;
  const words = inRange.filter(e => (e.t === "post" || e.t === "journal") && !e.p.voice).reduce((a, e) => a + (e.p.words || 0), 0);

  const props = [["Status", statusChip(u.status)], ["Joined", `${E.fmtDayLong(u.joinDn)} (${u.props.days_since_joined}d ago)`], ["Founding", u.founding !== null ? `#${u.founding}` : "–"],
    ["Invited by", u.props.invited_by === "(none)" ? "–" : `@${u.props.invited_by}`], ["Friends", u.props.friends], ["Photo", u.photo ? "yes" : "no"], ["Notifications", u.push ? "on" : "off"],
    ["Last active", u.lastActive ? `${C.fmtTime(u.lastActive.s, ds.tz)} · ${E.eventLabel(u.lastActive.t)}` : "never"], ["Test account", u.test ? "yes" : "no"]];

  const tiles = [["Active days", active], ["Posts", count("post")], ["Taps", count("tap")], ["Journal", count("journal")], ["Words written", words], ["DMs sent", count("dm")], ["People messaged", peers], ["Echoes given", count("echo")], ["Echoes got", count("echoed")]];

  // Activity grid: 26 weeks, Monday on top.
  const perDay = new Map();
  for (const e of u.events) if (ds.activeTypes.has(e.t)) perDay.set(e.dn, (perDay.get(e.dn) || 0) + 1);
  const max = Math.max(1, ...perDay.values());
  const lastW = E.weekOf(ds.todayDn);
  const cell = 12, gap = 2, left = 30, weeks = 26;
  const grid = C.s("svg", { class: "chart", width: left + weeks * (cell + gap), height: 7 * (cell + gap) + 16, viewBox: `0 0 ${left + weeks * (cell + gap)} ${7 * (cell + gap) + 16}` });
  [0, 2, 4, 6].forEach(r => grid.append(C.s("text", { x: left - 6, y: r * (cell + gap) + cell - 2, "text-anchor": "end", class: "tick", text: C.DOW[r] })));
  for (let k = 0; k < weeks; k++) {
    const w = lastW - weeks + 1 + k;
    if (k % 4 === 0) grid.append(C.s("text", { x: left + k * (cell + gap), y: 7 * (cell + gap) + 12, class: "tick", text: E.fmtDay(E.weekStart(w)) }));
    for (let r = 0; r < 7; r++) {
      const dn = E.weekStart(w) + r;
      if (dn > ds.todayDn) continue;
      const v = perDay.get(dn) || 0;
      const before = dn < u.joinDn;
      const step = v > 0 ? Math.min(5, Math.floor((v / max) * 5.999)) : -1;
      const rect = C.s("rect", { x: left + k * (cell + gap), y: r * (cell + gap), width: cell, height: cell, rx: 2, fill: before ? "transparent" : step < 0 ? "var(--q0)" : C.RAMP[step], stroke: before ? "var(--grid)" : null });
      rect.addEventListener("pointermove", evt => C.tip(evt, E.fmtDayLong(dn), [{ value: before ? "–" : String(v), label: before ? "before joining" : "active events" }]));
      rect.addEventListener("pointerleave", C.hideTip);
      grid.append(rect);
    }
  }

  const byType = [...new Set(u.events.map(e => e.t))].map(t => {
    const all = u.events.filter(e => e.t === t);
    return { cells: [h("span", null, h("code", { text: t }), " ", E.eventLabel(t)), count(t), all.length, C.fmtTime(all[0].s, ds.tz), C.fmtTime(all[all.length - 1].s, ds.tz)], raw: [t, count(t), all.length, all[0].s, all[all.length - 1].s] };
  });

  let shown = 150;
  const stream = h("div", { class: "stream" });
  const drawStream = () => {
    const list = [...u.events].reverse().slice(0, shown);
    let lastDay = null;
    const rows = [];
    for (const e of list) {
      if (e.dn !== lastDay) { rows.push(h("div", { class: "stream-day", text: E.fmtDayLong(e.dn) })); lastDay = e.dn; }
      rows.push(h("div", { class: "stream-row" },
        h("span", { class: "stream-time", text: new Date(e.s * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ds.tz }) }),
        h("code", { class: "stream-key", text: e.t }),
        h("span", { class: "stream-label", text: E.eventLabel(e.t) }),
        h("span", { class: "stream-props" }, Object.entries(e.p).filter(([, v]) => v !== null && v !== false).map(([k, v]) => h("span", { class: "prop", text: E.EVENT_PROPS[k]?.perUser ? `${E.EVENT_PROPS[k].label} #${v}` : `${E.EVENT_PROPS[k]?.label || k}=${v === true ? "yes" : v}` })))));
    }
    stream.replaceChildren(...rows.filter(Boolean), ...(u.events.length > shown ? [ h("button", { class: "btn small ghost", type: "button", onclick: () => { shown += 300; drawStream(); } }, `Show more (${u.events.length - shown} older)`)] : []));
  };
  drawStream();

  view.replaceChildren(h("div", { class: "page wide" },
    h("div", { class: "page-head" }, h("div", null,
      h("h1", { class: "title" }, `@${u.handle}`, u.test ? h("span", { class: "chip", text: "test" }) : null),
      h("div", { class: "page-sub", text: `${u.name || ""}${u.name ? " · " : ""}${u.events.length.toLocaleString()} events all time · counts below are for ${rangeLabel(state.prefs.range).toLowerCase()}` })),
      h("div", { class: "page-actions" }, h("button", { class: "btn", type: "button", onclick: () => newDraft("segmentation", sp => { sp.segment = [{ prop: "handle", op: "is", value: u.handle }]; sp.series = [{ events: ["$active"], measure: "totals" }]; sp.viz = "bar"; }) }, "Chart this person"))),
    h("div", { class: "dash-grid" },
      h("section", { class: "card", "data-size": "1/3" }, h("div", { class: "card-head" }, h("div", { class: "card-title", text: "Properties" })),
        h("dl", { class: "props" }, props.map(([k, v]) => [h("dt", { text: k }), h("dd", null, v)]))),
      h("section", { class: "card", "data-size": "2/3" }, h("div", { class: "card-head" }, h("div", { class: "card-title", text: "In the range" })),
        h("div", { class: "mini-kpis" }, tiles.map(([k, v]) => h("div", { class: "mini-kpi" }, h("div", { class: "mini-k", text: k }), h("div", { class: "mini-v", text: C.fmtValue(v) })))),
        h("div", { class: "card-sub", text: "Active events per day, 26 weeks" }), h("div", { class: "scroll-x" }, grid)),
      h("section", { class: "card", "data-size": "1/2" }, h("div", { class: "card-head" }, h("div", { class: "card-title", text: "Events by type" })),
        tableNode(`user:${u.i}:types`, { columns: [{ label: "Event", align: "left" }, { label: "In range" }, { label: "All time" }, { label: "First" }, { label: "Last" }], rows: byType })),
      h("section", { class: "card", "data-size": "1/2" }, h("div", { class: "card-head" }, h("div", { class: "card-title", text: "Event stream" })), stream))));
}

/* ── event catalogue ───────────────────────────────────────────────────────── */

function renderEvents() {
  const ds = state.ds;
  setTitle(["Data", "Event catalogue"]);
  const range = E.resolveRange(ds, state.prefs.range);
  const rows = Object.entries(E.EVENTS).map(([t, meta]) => {
    const all = ds.byType.get(t) || [];
    const inRange = all.filter(e => e.dn >= range.startDn && e.dn <= range.endDn);
    const people = new Set(inRange.map(e => e.user)).size;
    return {
      onClick: () => newDraft("segmentation", sp => { sp.series = [{ events: [t], measure: "totals" }]; }),
      cells: [h("code", { text: t }), meta.label, meta.group, C.fmtValue(inRange.length), C.fmtValue(people), C.fmtValue(all.length), all.length ? C.fmtTime(all[all.length - 1].s, ds.tz) : "–",
        (state.raw.schema?.[t] || []).join(", ") || "–", ds.activeTypes.has(t) ? "yes" : ""],
      raw: [t, meta.label, meta.group, inRange.length, people, all.length, all.length ? all[all.length - 1].s : null, (state.raw.schema?.[t] || []).join(" "), ds.activeTypes.has(t) ? "yes" : ""],
    };
  });
  const table = {
    columns: [{ label: "Event", align: "left" }, { label: "Name", align: "left" }, { label: "Group", align: "left" }, { label: "In range" }, { label: "People" }, { label: "All time" }, { label: "Last seen" }, { label: "Properties", align: "left" }, { label: "$active", align: "left" }],
    rows,
  };
  $("view").replaceChildren(h("div", { class: "page wide" },
    h("div", { class: "page-head" }, h("div", null, h("h1", { class: "title", text: "Event catalogue" }),
      h("div", { class: "page-sub", text: "Every event the database gives this page, with its properties. Click one to chart it. Nothing here carries post or message text." })),
      h("div", { class: "page-actions" }, h("button", { class: "btn", type: "button", onclick: () => downloadCSV("fiammo-events", table) }, "CSV"))),
    h("section", { class: "card" }, tableNode("events", table)),
    h("section", { class: "card" }, h("div", { class: "card-head" }, h("div", { class: "card-title", text: "Properties" })),
      C.drawTable({ columns: [{ label: "Property", align: "left" }, { label: "Label", align: "left" }, { label: "Type", align: "left" }, { label: "On events", align: "left" }],
        rows: Object.entries(E.EVENT_PROPS).map(([k, p]) => ({ cells: [h("code", { text: k }), p.label, p.type, Object.entries(state.raw.schema || {}).filter(([, list]) => list.includes(k)).map(([t]) => t).join(", ")] })) }, {})),
    h("section", { class: "card" }, h("div", { class: "card-head" }, h("div", { class: "card-title", text: "User properties" })),
      C.drawTable({ columns: [{ label: "Property", align: "left" }, { label: "Label", align: "left" }, { label: "Type", align: "left" }],
        rows: Object.entries(E.USER_PROPS).map(([k, p]) => ({ cells: [h("code", { text: k }), p.label, p.type] })) }, {}))));
}
