// The query engine behind analytics.html. Pure functions over the event
// stream admin-analytics returns (migration 163 in the app repo): no DOM, so
// it runs in node as well as the page.
//
// A chart is a spec, plain JSON the page saves as-is:
//   { type, range, interval, series|steps|start/return, segment, breakdown, formula, … }
// and each run* function turns a spec plus the dataset into a result the
// charts module draws. Nothing here knows how a result will look.

export const DAY = 86400;
// Series letters. Segmentation stops at H (eight colours, and formulas use
// A to H); a user table has no colours, so its columns go on to X.
export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWX".split("");
export const MAX_COLUMNS = LETTERS.length;
export const MAX_SERIES = 8;

/* ── catalogue ─────────────────────────────────────────────────────────────── */

export const EVENTS = {
  joined:        { label: "Joined", group: "Account" },
  age_ok:        { label: "Confirmed age", group: "Account" },
  push_on:       { label: "Turned on notifications", group: "Account" },
  post:          { label: "Posted", group: "Writing" },
  tap:           { label: "Tapped a prompt", group: "Writing" },
  journal:       { label: "Wrote in journal", group: "Writing" },
  echo:          { label: "Echoed a post", group: "Echoes" },
  echoed:        { label: "Got an echo", group: "Echoes" },
  comment:       { label: "Commented", group: "Echoes" },
  dm:            { label: "Sent a message", group: "Messages" },
  dm_in:         { label: "Got a message", group: "Messages" },
  group_new:     { label: "Started a group", group: "Messages" },
  group_join:    { label: "Added to a group", group: "Messages" },
  group_msg:     { label: "Sent a group message", group: "Messages" },
  react:         { label: "Reacted", group: "Messages" },
  friend_req:    { label: "Sent a friend request", group: "Social" },
  friend:        { label: "Made a friend", group: "Social" },
  circle:        { label: "Made a circle", group: "Social" },
  invite:        { label: "Sent an invite", group: "Social" },
  invite_joined: { label: "Invitee joined", group: "Social" },
  catchup_add:   { label: "Added to catch up", group: "Catch up" },
  catchup_log:   { label: "Logged a catch up", group: "Catch up" },
  reading:       { label: "Got a constellation reading", group: "Constellation" },
};

export const PSEUDO_EVENTS = {
  $active: { label: "Any active event", group: "Computed" },
  $any:    { label: "Any event", group: "Computed" },
};

// Things a person chose to do. Getting an echo, a message or a reading
// happens to you; the page lets this be redefined.
export const DEFAULT_ACTIVE = [
  "post", "tap", "journal", "friend_req", "circle", "invite", "echo", "comment",
  "dm", "group_new", "group_msg", "react", "catchup_add", "catchup_log",
];

// Passive or set-up events a journey skips unless asked not to.
export const JOURNEY_SKIP = ["age_ok", "push_on", "reading", "dm_in", "echoed", "group_join", "invite_joined"];

export const EVENT_PROPS = {
  words:      { label: "words", type: "number" },
  chars:      { label: "characters", type: "number" },
  photos:     { label: "photos", type: "number" },
  voice:      { label: "voice note", type: "boolean" },
  prompt:     { label: "answers a prompt", type: "boolean" },
  scheduled:  { label: "scheduled", type: "boolean" },
  audience:   { label: "audience", type: "string" },
  peer:       { label: "recipient", type: "id", perUser: true, noBreakdown: true },
  group:      { label: "group", type: "id" },
  echo_reply: { label: "echo reply", type: "boolean" },
  reply:      { label: "reply", type: "boolean" },
  sealed:     { label: "sealed", type: "boolean" },
  edited:     { label: "edited", type: "boolean" },
  note:       { label: "has a note", type: "boolean" },
  is_reply:   { label: "is a reply", type: "boolean" },
  credited:   { label: "credited", type: "boolean" },
  emoji:      { label: "emoji", type: "string" },
  where:      { label: "where", type: "string" },
  on_fiammo:  { label: "on fiammo", type: "boolean" },
  kind:       { label: "kind", type: "string" },
  source:     { label: "source", type: "string" },
  entries:    { label: "entries", type: "number" },
};

export const USER_PROPS = {
  handle:            { label: "handle", type: "string" },
  status:            { label: "status", type: "string" },
  cohort_week:       { label: "joined week", type: "string" },
  cohort_month:      { label: "joined month", type: "string" },
  days_since_joined: { label: "days since joined", type: "number" },
  friends:           { label: "friends", type: "number" },
  founding:          { label: "founding member", type: "boolean" },
  photo:             { label: "has a photo", type: "boolean" },
  push:              { label: "notifications on", type: "boolean" },
  invited:           { label: "came through an invite", type: "boolean" },
  invited_by:        { label: "invited by", type: "string" },
  test:              { label: "test account", type: "boolean" },
};

export const OPS = {
  boolean: ["is"],
  string: ["is", "is not"],
  id: ["is", "is not"],
  number: ["=", "≠", ">", "≥", "<", "≤"],
};

export const MEASURES = {
  uniques:      { label: "Uniques", short: "uniques" },
  totals:       { label: "Event totals", short: "totals" },
  avg:          { label: "Average per user", short: "avg per user", decimals: 1 },
  pct_active:   { label: "% of active users", short: "% active", pct: true },
  uniques_r7:   { label: "Uniques, rolling 7 days", short: "uniques 7d", rolling: 7 },
  uniques_r30:  { label: "Uniques, rolling 30 days", short: "uniques 30d", rolling: 30 },
  sum:          { label: "Sum of a property", short: "sum", prop: "number" },
  avg_prop:     { label: "Average of a property", short: "avg", prop: "number", decimals: 1 },
  median_prop:  { label: "Median of a property", short: "median", prop: "number", decimals: 1 },
  max_prop:     { label: "Max of a property", short: "max", prop: "number" },
  distinct:     { label: "Distinct values of a property", short: "distinct", prop: "any" },
  frequency:    { label: "Frequency (people by times done)", short: "frequency", categorical: true },
  distribution: { label: "Distribution of a property", short: "distribution", prop: "number", categorical: true },
};

export const USER_MEASURES = {
  totals:      { label: "Event totals", short: "totals" },
  days:        { label: "Days done", short: "days" },
  sum:         { label: "Sum of a property", short: "sum", prop: "number" },
  avg_prop:    { label: "Average of a property", short: "avg", prop: "number", decimals: 1 },
  median_prop: { label: "Median of a property", short: "median", prop: "number", decimals: 1 },
  max_prop:    { label: "Max of a property", short: "max", prop: "number" },
  distinct:    { label: "Distinct values of a property", short: "distinct", prop: "any" },
  first:       { label: "First done", short: "first", time: true },
  last:        { label: "Last done", short: "last", time: true },
};

export const CHART_TYPES = {
  segmentation: { label: "Segmentation" },
  funnel:       { label: "Funnel" },
  retention:    { label: "Retention" },
  lifecycle:    { label: "Lifecycle" },
  stickiness:   { label: "Stickiness" },
  journeys:     { label: "Journeys" },
  heatmap:      { label: "Heatmap" },
  users:        { label: "User table" },
};

export const RANGE_PRESETS = {
  "7d": { label: "Last 7 days", days: 7 },
  "14d": { label: "Last 14 days", days: 14 },
  "30d": { label: "Last 30 days", days: 30 },
  "60d": { label: "Last 60 days", days: 60 },
  "90d": { label: "Last 90 days", days: 90 },
  "180d": { label: "Last 180 days", days: 180 },
  all: { label: "All time" },
};

export const eventLabel = key => (EVENTS[key] || PSEUDO_EVENTS[key])?.label || key;

/* ── time ──────────────────────────────────────────────────────────────────── */

// Calendar day number (days since 1970-01-01), hour and weekday of a moment
// in a time zone. Cached per quarter hour, fine enough for every real offset.
export function makeClock(tz) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric",
  });
  const cache = new Map();
  return sec => {
    const key = Math.floor(sec / 900);
    let hit = cache.get(key);
    if (!hit) {
      const parts = {};
      for (const part of fmt.formatToParts(new Date(key * 900000))) parts[part.type] = part.value;
      const dn = Math.floor(Date.UTC(+parts.year, +parts.month - 1, +parts.day) / 86400000);
      hit = { dn, hour: +parts.hour % 24, dow: (dn + 3) % 7 }; // dow 0 is Monday
      cache.set(key, hit);
    }
    return hit;
  };
}

export const weekOf = dn => Math.floor((dn + 3) / 7); // Monday-start weeks
export const weekStart = w => w * 7 - 3;
const dnDate = dn => new Date(dn * 86400000);
export const dnToISO = dn => dnDate(dn).toISOString().slice(0, 10);
export function isoToDn(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}
export const monthOf = dn => { const d = dnDate(dn); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
export const monthStart = mi => Math.floor(Date.UTC(Math.floor(mi / 12), mi % 12, 1) / 86400000);
export const monthEnd = mi => monthStart(mi + 1) - 1;
export const fmtDay = dn => dnDate(dn).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
export const fmtDayLong = dn => dnDate(dn).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export const fmtMonth = mi => new Date(Date.UTC(Math.floor(mi / 12), mi % 12, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/* ── dataset ───────────────────────────────────────────────────────────────── */

function normalizeProp(name, v) {
  if (v === null || v === undefined) return null;
  const type = EVENT_PROPS[name]?.type;
  if (type === "boolean") return v === 1 || v === true;
  if (type === "number" || type === "id") return Number(v);
  return String(v);
}

export function statusOf(user, todayDn) {
  if (todayDn - user.joinDn < 7) return "new";
  if (!user.lastActive) return "never active";
  const since = todayDn - user.lastActive.dn;
  if (since < 7) return "active";
  if (since < 28) return "cooling";
  return "dormant";
}

export function buildDataset(raw, { tz, includeTest = false, activeTypes = DEFAULT_ACTIVE, now } = {}) {
  const clock = makeClock(tz);
  const nowS = now ?? Date.now() / 1000;
  const todayDn = clock(nowS).dn;
  const everyone = new Map(raw.users.map(u => [u.i, u]));
  const users = [];
  const byI = new Map();
  for (const u of raw.users) {
    if (u.test && !includeTest) continue;
    const user = {
      i: u.i, handle: u.handle || `user${u.i}`, name: u.name || null, founding: u.founding ?? null,
      joined: u.joined, joinDn: clock(u.joined).dn, test: !!u.test, photo: !!u.photo, push: !!u.push,
      invitedBy: u.invited_by ?? null, events: [], lastActive: null, props: null,
    };
    users.push(user);
    byI.set(u.i, user);
  }

  const schema = raw.schema || {};
  const byType = new Map();
  const events = [];
  for (const row of raw.events) {
    const user = byI.get(row[0]);
    if (!user) continue;
    if (row[3] === 1 && !includeTest) continue;
    const t = row[1];
    const s = row[2];
    const c = clock(s);
    const names = schema[t] || [];
    const vals = row[4] || [];
    const p = {};
    for (let k = 0; k < names.length; k++) p[names[k]] = normalizeProp(names[k], vals[k]);
    const e = { user, t, s, dn: c.dn, hour: c.hour, dow: c.dow, p };
    events.push(e);
  }
  events.sort((a, b) => a.s - b.s);
  for (const e of events) {
    e.user.events.push(e);
    let list = byType.get(e.t);
    if (!list) byType.set(e.t, (list = []));
    list.push(e);
  }

  const active = new Set(activeTypes);
  for (const user of users) {
    let friends = 0;
    for (const e of user.events) {
      if (e.t === "friend") friends++;
      if (active.has(e.t)) user.lastActive = e;
    }
    const inviter = user.invitedBy !== null ? everyone.get(user.invitedBy) : null;
    user.status = statusOf(user, todayDn);
    user.props = {
      handle: user.handle,
      status: user.status,
      cohort_week: dnToISO(weekStart(weekOf(user.joinDn))),
      cohort_month: fmtMonth(monthOf(user.joinDn)),
      days_since_joined: todayDn - user.joinDn,
      friends,
      founding: user.founding !== null,
      photo: user.photo,
      push: user.push,
      invited: !!inviter,
      invited_by: inviter ? inviter.handle : "(none)",
      test: user.test,
    };
  }

  const firstDn = users.length ? Math.min(...users.map(u => u.joinDn)) : todayDn;
  return { raw, tz, clock, nowS, todayDn, firstDn, users, byI, events, byType, activeTypes: active };
}

/* ── selection and filters ─────────────────────────────────────────────────── */

export function resolveTypes(ds, keys) {
  const set = new Set();
  for (const k of keys || []) {
    if (k === "$any") for (const t of ds.byType.keys()) set.add(t);
    else if (k === "$active") for (const t of ds.activeTypes) set.add(t);
    else set.add(k);
  }
  return set;
}

function same(value, v, type) {
  if (value === null || value === undefined) return v === "(none)";
  if (type === "boolean") return value === (v === true || v === "true");
  if (type === "number" || type === "id") return value === Number(v);
  return String(value).toLowerCase() === String(v).toLowerCase();
}

export function testValue(value, f, type) {
  const list = Array.isArray(f.value) ? f.value : [f.value];
  const n = Number(f.value);
  const has = value !== null && value !== undefined;
  switch (f.op) {
    case "is": return list.some(v => same(value, v, type));
    case "is not": return !list.some(v => same(value, v, type));
    case "=": return has && value === n;
    case "≠": return !has || value !== n;
    case ">": return has && value > n;
    case "≥": return has && value >= n;
    case "<": return has && value < n;
    case "≤": return has && value <= n;
    default: return true;
  }
}

export function matchEventFilters(e, filters) {
  if (!filters || !filters.length) return true;
  for (const f of filters) {
    if (!f || !f.prop || f.value === undefined || f.value === "") continue;
    if (!(f.prop in e.p)) {
      // An event without the property can't satisfy a positive test.
      if (f.op === "is not" || f.op === "≠") continue;
      return false;
    }
    if (!testValue(e.p[f.prop], f, EVENT_PROPS[f.prop]?.type || "string")) return false;
  }
  return true;
}

function compare(a, op, b) {
  switch (op) {
    case "=": return a === b;
    case "≠": return a !== b;
    case ">": return a > b;
    case "≥": return a >= b;
    case "<": return a < b;
    case "≤": return a <= b;
    default: return a >= b;
  }
}

// Returns null for "everyone", else the Set of users who pass every filter.
// A filter is { prop, op, value } on a user property, or a behavioural
// { kind: "did", events, filters, op, count, within: "range" | "all" }.
export function segmentUsers(ds, segment, range) {
  const filters = (segment || []).filter(f => f && (f.kind === "did" ? (f.events || []).length : f.prop && f.value !== undefined && f.value !== ""));
  if (!filters.length) return null;
  const set = new Set();
  for (const u of ds.users) {
    const ok = filters.every(f => {
      if (f.kind === "did") {
        const types = resolveTypes(ds, f.events);
        let n = 0;
        for (const e of u.events) {
          if (!types.has(e.t)) continue;
          if (f.within === "range" && (e.dn < range.startDn || e.dn > range.endDn)) continue;
          if (matchEventFilters(e, f.filters)) n++;
        }
        return compare(n, f.op || "≥", Number(f.count ?? 1));
      }
      return testValue(u.props[f.prop], f, USER_PROPS[f.prop]?.type || "string");
    });
    if (ok) set.add(u);
  }
  return set;
}

const inSegment = (segment, user) => segment === null || segment.has(user);

export function selectEvents(ds, sel, fromDn, toDn, segment) {
  const out = [];
  for (const t of resolveTypes(ds, sel.events)) {
    for (const e of ds.byType.get(t) || []) {
      if (e.dn < fromDn || e.dn > toDn) continue;
      if (!inSegment(segment, e.user)) continue;
      if (!matchEventFilters(e, sel.filters)) continue;
      out.push(e);
    }
  }
  out.sort((a, b) => a.s - b.s);
  return out;
}

export function selectionLabel(sel) {
  if (!sel) return "";
  if (sel.label) return sel.label;
  const names = (sel.events || []).map(eventLabel);
  const base = names.length ? names.join(" or ") : "(pick an event)";
  const filters = (sel.filters || []).filter(f => f && f.prop && f.value !== undefined && f.value !== "");
  if (!filters.length) return base;
  return `${base} where ${filters.map(f => `${EVENT_PROPS[f.prop]?.label || f.prop} ${f.op} ${Array.isArray(f.value) ? f.value.join(", ") : f.value}`).join(" and ")}`;
}

/* ── ranges and buckets ────────────────────────────────────────────────────── */

export function resolveRange(ds, r) {
  const range = r || { preset: "30d" };
  let endDn = ds.todayDn;
  let startDn;
  let label;
  if (range.preset === "all") {
    startDn = Math.min(ds.firstDn, endDn);
    label = "All time";
  } else if (range.preset === "custom" && range.from) {
    startDn = isoToDn(range.from);
    if (range.to) endDn = Math.min(isoToDn(range.to), ds.todayDn);
    label = `${range.from} to ${range.to || "today"}`;
  } else {
    const preset = RANGE_PRESETS[range.preset] || RANGE_PRESETS["30d"];
    startDn = endDn - preset.days + 1;
    label = preset.label;
  }
  if (startDn > endDn) startDn = endDn;
  return { startDn, endDn, days: endDn - startDn + 1, label, preset: range.preset };
}

export function makeBuckets(range, interval) {
  const out = [];
  if (interval === "week") {
    for (let w = weekOf(range.startDn); w <= weekOf(range.endDn); w++) {
      out.push({ key: w, start: Math.max(weekStart(w), range.startDn), end: Math.min(weekStart(w) + 6, range.endDn),
        label: fmtDay(weekStart(w)), long: `Week of ${fmtDay(weekStart(w))}`, partial: weekStart(w) < range.startDn || weekStart(w) + 6 > range.endDn });
    }
  } else if (interval === "month") {
    for (let mi = monthOf(range.startDn); mi <= monthOf(range.endDn); mi++) {
      out.push({ key: mi, start: Math.max(monthStart(mi), range.startDn), end: Math.min(monthEnd(mi), range.endDn),
        label: fmtMonth(mi), long: fmtMonth(mi), partial: monthStart(mi) < range.startDn || monthEnd(mi) > range.endDn });
    }
  } else {
    for (let d = range.startDn; d <= range.endDn; d++) out.push({ key: d, start: d, end: d, label: fmtDay(d), long: fmtDayLong(d), partial: false });
  }
  return out;
}

function locator(buckets) {
  const first = buckets[0].start;
  const last = buckets[buckets.length - 1].end;
  const idx = new Int32Array(last - first + 1).fill(-1);
  buckets.forEach((b, i) => { for (let d = b.start; d <= b.end; d++) idx[d - first] = i; });
  return dn => (dn < first || dn > last ? -1 : idx[dn - first]);
}

const keyFor = interval => interval === "week" ? weekOf : interval === "month" ? monthOf : (dn => dn);

/* ── measures ──────────────────────────────────────────────────────────────── */

const uniqueUsers = evs => { const s = new Set(); for (const e of evs) s.add(e.user); return s.size; };
function numbers(evs, prop) {
  const out = [];
  for (const e of evs) { const v = e.p[prop]; if (typeof v === "number" && isFinite(v)) out.push(v); }
  return out;
}
export function median(arr) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function measure(key, evs, sr, ctx) {
  switch (key) {
    case "totals": return evs.length;
    case "uniques":
    case "uniques_r7":
    case "uniques_r30": return uniqueUsers(evs);
    case "avg": { const u = uniqueUsers(evs); return u ? evs.length / u : null; }
    case "pct_active": return ctx && ctx.active ? uniqueUsers(evs) / ctx.active : null;
    case "sum": return numbers(evs, sr.prop).reduce((a, b) => a + b, 0);
    case "avg_prop": { const n = numbers(evs, sr.prop); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null; }
    case "median_prop": return median(numbers(evs, sr.prop));
    case "max_prop": { const n = numbers(evs, sr.prop); return n.length ? Math.max(...n) : null; }
    case "distinct": {
      const perUser = EVENT_PROPS[sr.prop]?.perUser;
      const set = new Set();
      for (const e of evs) {
        const v = e.p[sr.prop];
        if (v === null || v === undefined) continue;
        set.add(perUser ? `${e.user.i}:${v}` : v);
      }
      return set.size;
    }
    case "days": { const set = new Set(); for (const e of evs) set.add(`${e.user.i}:${e.dn}`); return set.size; }
    case "first": return evs.length ? evs[0].s : null;
    case "last": return evs.length ? evs[evs.length - 1].s : null;
    default: return null;
  }
}

export function seriesName(sr, measures = MEASURES) {
  if (sr.label) return sr.label;
  const m = measures[sr.measure] || measures.uniques || measures.totals;
  const prop = m.prop && sr.prop ? ` of ${EVENT_PROPS[sr.prop]?.label || sr.prop}` : "";
  return `${selectionLabel(sr)} · ${m.short}${prop}`;
}

function groupKeyOf(e, b) {
  let v;
  if (b.kind === "event") return eventLabel(e.t);
  if (b.kind === "event_prop") v = e.p[b.prop];
  else if (b.kind === "user_prop") v = e.user.props[b.prop];
  else return null;
  if (v === null || v === undefined) return "(none)";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (b.prop === "group") return `group #${v}`;
  if (b.prop === "handle") return `@${v}`;
  return String(v);
}

const hasBreakdown = spec => spec.breakdown && spec.breakdown.kind && spec.breakdown.kind !== "none" && (spec.breakdown.kind === "event" || spec.breakdown.prop);

// Groups the events by the breakdown, ranked by the measure over the range,
// keeping `limit` groups and folding the rest into "Other" so its value is the
// measure over those events together (uniques stay unique).
function rankedGroups(evs, spec, limit, rank) {
  if (!hasBreakdown(spec) || spec.formula) return [{ key: null, events: evs }];
  const map = new Map();
  for (const e of evs) {
    const k = groupKeyOf(e, spec.breakdown);
    let list = map.get(k);
    if (!list) map.set(k, (list = []));
    list.push(e);
  }
  const groups = [...map].map(([key, events]) => ({ key, events, rank: rank(events) ?? 0 }))
    .sort((a, b) => b.rank - a.rank || String(a.key).localeCompare(String(b.key)));
  if (groups.length <= limit) return groups;
  const kept = groups.slice(0, limit - 1);
  const rest = groups.slice(limit - 1).flatMap(g => g.events).sort((a, b) => a.s - b.s);
  return [...kept, { key: "Other", events: rest }];
}

/* ── formulas ──────────────────────────────────────────────────────────────── */

// Arithmetic over series letters: A / B * 100, (A + B) / 2. Numbers, letters,
// + - * /, parentheses and unary minus; nothing else is accepted.
export function parseFormula(src) {
  const tokens = String(src).match(/\s*([A-Ha-h]|\d+(?:\.\d+)?|[()+\-*/])\s*/g);
  const joined = (tokens || []).join("");
  if (!tokens || joined.replace(/\s/g, "") !== String(src).replace(/\s/g, "")) throw new Error("Formulas use letters A to H, numbers, + - * / and parentheses");
  const list = tokens.map(t => t.trim());
  let i = 0;
  const peek = () => list[i];
  const expr = () => {
    let node = term();
    while (peek() === "+" || peek() === "-") node = { op: list[i++], a: node, b: term() };
    return node;
  };
  const term = () => {
    let node = factor();
    while (peek() === "*" || peek() === "/") node = { op: list[i++], a: node, b: factor() };
    return node;
  };
  const factor = () => {
    const t = list[i++];
    if (t === undefined) throw new Error("The formula ends too soon");
    if (t === "-") return { op: "neg", a: factor() };
    if (t === "(") { const node = expr(); if (list[i++] !== ")") throw new Error("A parenthesis isn't closed"); return node; }
    if (/^[A-Ha-h]$/.test(t)) return { v: t.toUpperCase() };
    if (/^\d/.test(t)) return { n: Number(t) };
    throw new Error(`Unexpected "${t}" in the formula`);
  };
  const tree = expr();
  if (i !== list.length) throw new Error(`Unexpected "${list[i]}" in the formula`);
  return tree;
}

export function evalFormula(node, vars) {
  if ("n" in node) return node.n;
  if ("v" in node) return vars[node.v] ?? null;
  const a = evalFormula(node.a, vars);
  if (node.op === "neg") return a === null ? null : -a;
  const b = evalFormula(node.b, vars);
  if (a === null || b === null) return null;
  switch (node.op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": return b === 0 ? null : a / b;
    default: return null;
  }
}

export function formulaLetters(node, out = new Set()) {
  if (!node) return out;
  if ("v" in node) out.add(node.v);
  if (node.a) formulaLetters(node.a, out);
  if (node.b) formulaLetters(node.b, out);
  return out;
}

/* ── segmentation ──────────────────────────────────────────────────────────── */

export function runSegmentation(ds, spec) {
  const series = (spec.series || []).filter(sr => sr && (sr.events || []).length);
  if (!series.length) return { kind: "empty", message: "Pick an event to measure." };
  const range = resolveRange(ds, spec.range);
  const segment = segmentUsers(ds, spec.segment, range);
  if (MEASURES[series[0].measure]?.categorical) return runCategorical(ds, spec, series, range, segment);

  const interval = spec.interval || "day";
  const buckets = makeBuckets(range, interval);
  const locate = locator(buckets);

  const activeSets = buckets.map(() => new Set());
  const activeAll = new Set();
  if (series.some(sr => sr.measure === "pct_active")) {
    for (const t of ds.activeTypes) for (const e of ds.byType.get(t) || []) {
      if (!inSegment(segment, e.user)) continue;
      const bi = locate(e.dn);
      if (bi < 0) continue;
      activeSets[bi].add(e.user);
      activeAll.add(e.user);
    }
  }

  const limit = Math.max(2, Math.floor(MAX_SERIES / series.length));
  let out = [];
  series.forEach((sr, si) => {
    const key = sr.measure && MEASURES[sr.measure] && !MEASURES[sr.measure].categorical ? sr.measure : "uniques";
    const rolling = interval === "day" ? MEASURES[key].rolling || 0 : 0;
    const evs = selectEvents(ds, sr, range.startDn - (rolling ? rolling - 1 : 0), range.endDn, segment);
    const inRangeOf = list => list.filter(e => e.dn >= range.startDn);
    const groups = rankedGroups(evs, spec, limit, list => measure(key, inRangeOf(list), sr, { active: activeAll.size }));
    for (const g of groups) {
      const per = buckets.map(() => []);
      const inRange = [];
      const byDay = new Map();
      for (const e of g.events) {
        if (rolling) { let l = byDay.get(e.dn); if (!l) byDay.set(e.dn, (l = [])); l.push(e); }
        if (e.dn < range.startDn) continue;
        inRange.push(e);
        const bi = locate(e.dn);
        if (bi >= 0) per[bi].push(e);
      }
      const values = buckets.map((b, bi) => {
        if (rolling) {
          const win = [];
          for (let d = b.start - rolling + 1; d <= b.start; d++) { const l = byDay.get(d); if (l) win.push(...l); }
          return uniqueUsers(win);
        }
        return measure(key, per[bi], sr, { active: activeSets[bi].size });
      });
      const total = rolling
        ? avgOf(values)
        : measure(key, inRange, sr, { active: activeAll.size });
      const base = seriesName(sr);
      out.push({
        id: `${LETTERS[si]}|${g.key ?? ""}`, letter: LETTERS[si], group: g.key,
        name: g.key === null ? base : series.length > 1 ? `${g.key} · ${base}` : g.key,
        values, total, measure: key, count: inRange.length,
      });
    }
  });

  let formula = null;
  if (spec.formula && String(spec.formula).trim()) {
    const tree = parseFormula(spec.formula);
    const byLetter = Object.fromEntries(out.map(s => [s.letter, s]));
    for (const l of formulaLetters(tree)) if (!byLetter[l]) throw new Error(`The formula uses ${l}, which isn't a series`);
    const values = buckets.map((_, bi) => evalFormula(tree, Object.fromEntries(out.map(s => [s.letter, s.values[bi]]))));
    const total = evalFormula(tree, Object.fromEntries(out.map(s => [s.letter, s.total])));
    formula = String(spec.formula).trim().toUpperCase();
    out = [{ id: "formula", letter: "ƒ", group: null, name: formula, values, total, measure: "formula" }];
  }

  const pct = !formula && out.length && out.every(s => MEASURES[s.measure]?.pct);
  const decimals = formula ? 2 : Math.max(0, ...out.map(s => MEASURES[s.measure]?.decimals || 0));
  return { kind: "timeseries", range, interval, buckets, series: out, format: { pct, decimals }, formula, segmentSize: segment ? segment.size : ds.users.length };
}

const avgOf = values => {
  const n = values.filter(v => v !== null && v !== undefined);
  return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null;
};

const FREQ_BINS = [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 10], [11, 25], [26, 50], [51, 100], [101, Infinity]];
const binLabel = ([lo, hi]) => hi === Infinity ? `${lo}+` : lo === hi ? String(lo) : `${lo}–${hi}`;

function distributionBins(max) {
  const edges = [0, 1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000];
  const bins = [[0, 0]];
  for (let k = 1; k < edges.length; k++) {
    const lo = edges[k - 1] + 1;
    const hi = edges[k];
    if (lo > max) break;
    bins.push([lo, hi]);
  }
  if (max > edges[edges.length - 1]) bins.push([edges[edges.length - 1] + 1, Infinity]);
  return bins;
}

function runCategorical(ds, spec, series, range, segment) {
  const kind = series[0].measure;
  const limit = Math.max(2, Math.floor(MAX_SERIES / series.length));
  let bins;
  if (kind === "distribution") {
    let max = 0;
    for (const sr of series) for (const v of numbers(selectEvents(ds, sr, range.startDn, range.endDn, segment), sr.prop)) max = Math.max(max, v);
    bins = distributionBins(max);
  } else {
    bins = FREQ_BINS;
  }
  const binOf = v => bins.findIndex(([lo, hi]) => v >= lo && v <= hi);
  const out = [];
  series.forEach((sr, si) => {
    const evs = selectEvents(ds, sr, range.startDn, range.endDn, segment);
    const groups = rankedGroups(evs, spec, limit, list => kind === "distribution" ? list.length : uniqueUsers(list));
    for (const g of groups) {
      const values = bins.map(() => 0);
      if (kind === "distribution") {
        for (const v of numbers(g.events, sr.prop)) { const b = binOf(v); if (b >= 0) values[b]++; }
      } else {
        const per = new Map();
        for (const e of g.events) per.set(e.user, (per.get(e.user) || 0) + 1);
        for (const n of per.values()) { const b = binOf(n); if (b >= 0) values[b]++; }
      }
      const base = seriesName(sr);
      out.push({
        id: `${LETTERS[si]}|${g.key ?? ""}`, letter: LETTERS[si], group: g.key,
        name: g.key === null ? base : series.length > 1 ? `${g.key} · ${base}` : g.key,
        values, total: values.reduce((a, b) => a + b, 0), measure: kind,
      });
    }
  });
  const unit = kind === "distribution" ? `${EVENT_PROPS[series[0].prop]?.label || series[0].prop || "value"}` : "times done";
  return { kind: "categorical", range, categories: bins.map(binLabel), axisLabel: unit, valueLabel: kind === "distribution" ? "events" : "people", series: out, format: { pct: false, decimals: 0 } };
}

// A headline number and the same measure over the period before it.
export function runKpi(ds, spec) {
  const now = runSegmentation(ds, spec);
  if (now.kind !== "timeseries" || !now.series.length) return { kind: "kpi", value: null, previous: null, range: now.range };
  let previous = null;
  if (now.range.preset !== "all") {
    const prevRange = { preset: "custom", from: dnToISO(now.range.startDn - now.range.days), to: dnToISO(now.range.startDn - 1) };
    const before = runSegmentation(ds, { ...spec, range: prevRange });
    if (before.kind === "timeseries" && before.series.length && before.range.endDn >= ds.firstDn) previous = before.series[0].total;
  }
  return { kind: "kpi", value: now.series[0].total, previous, name: now.series[0].name, range: now.range, format: now.format, spark: now.series[0].values, buckets: now.buckets };
}

/* ── user table ────────────────────────────────────────────────────────────── */

export function runUserTable(ds, spec) {
  const range = resolveRange(ds, spec.range);
  const segment = segmentUsers(ds, spec.segment, range);
  const series = (spec.series || []).filter(sr => sr && (sr.events || []).length);
  const columns = series.map((sr, si) => {
    const key = USER_MEASURES[sr.measure] ? sr.measure : "totals";
    return { letter: LETTERS[si], name: seriesName({ ...sr, measure: key }, USER_MEASURES), measure: key, time: !!USER_MEASURES[key].time, decimals: USER_MEASURES[key].decimals || 0 };
  });
  const typeSets = series.map(sr => resolveTypes(ds, sr.events));
  const rows = [];
  for (const u of ds.users) {
    if (!inSegment(segment, u)) continue;
    const values = series.map((sr, si) => {
      const evs = u.events.filter(e => typeSets[si].has(e.t) && e.dn >= range.startDn && e.dn <= range.endDn && matchEventFilters(e, sr.filters));
      return measure(columns[si].measure, evs, sr, null);
    });
    rows.push({ user: u, values });
  }
  return { kind: "users", range, columns, rows };
}

/* ── funnel ────────────────────────────────────────────────────────────────── */

function lowerBound(evs, s) {
  let lo = 0, hi = evs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (evs[mid].s < s) lo = mid + 1; else hi = mid; }
  return lo;
}

const userGroupKey = (u, b) => {
  if (!b || b.kind !== "user_prop" || !b.prop) return null;
  const v = u.props[b.prop];
  if (v === null || v === undefined) return "(none)";
  if (typeof v === "boolean") return v ? "true" : "false";
  return b.prop === "handle" ? `@${v}` : String(v);
};

function rankUserGroups(entries, limit) {
  const map = new Map();
  for (const x of entries) { let l = map.get(x.group); if (!l) map.set(x.group, (l = [])); l.push(x); }
  const groups = [...map].map(([key, list]) => ({ key, list })).sort((a, b) => b.list.length - a.list.length || String(a.key).localeCompare(String(b.key)));
  if (groups.length <= limit) return groups;
  return [...groups.slice(0, limit - 1), { key: "Other", list: groups.slice(limit - 1).flatMap(g => g.list) }];
}

export function runFunnel(ds, spec) {
  const steps = (spec.steps || []).filter(st => st && (st.events || []).length);
  if (steps.length < 2) return { kind: "empty", message: "A funnel needs at least two steps." };
  const range = resolveRange(ds, spec.range);
  const segment = segmentUsers(ds, spec.segment, range);
  const types = steps.map(st => resolveTypes(ds, st.events));
  const windowS = Number(spec.window) > 0 ? Number(spec.window) : Infinity;

  const entries = [];
  for (const u of ds.users) {
    if (!inSegment(segment, u)) continue;
    const evs = u.events;
    let idx = evs.findIndex(e => e.dn >= range.startDn && e.dn <= range.endDn && types[0].has(e.t) && matchEventFilters(e, steps[0].filters));
    if (idx < 0) continue;
    const start = evs[idx];
    const times = [start.s];
    const used = new Set([idx]); // events sharing a second can't serve two steps
    for (let k = 1; k < steps.length; k++) {
      let found = -1;
      for (let j = lowerBound(evs, evs[idx].s); j < evs.length; j++) {
        const e = evs[j];
        if (used.has(j)) continue;
        if (e.s - start.s > windowS) break;
        if (types[k].has(e.t) && matchEventFilters(e, steps[k].filters)) { found = j; break; }
      }
      if (found < 0) break;
      idx = found;
      used.add(found);
      times.push(evs[found].s);
    }
    entries.push({ user: u, times, startDn: start.dn, open: times.length < steps.length && ds.nowS - start.s <= windowS, group: userGroupKey(u, spec.breakdown) });
  }

  const summarize = list => steps.map((st, k) => {
    const reached = list.filter(x => x.times.length > k);
    const before = k ? list.filter(x => x.times.length >= k) : list;
    const dropped = k ? before.filter(x => x.times.length === k) : [];
    return {
      label: selectionLabel(st),
      count: reached.length,
      users: reached.map(x => x.user),
      pctFirst: list.length ? reached.length / list.length : null,
      pctPrev: before.length ? reached.length / before.length : null,
      dropped: dropped.map(x => x.user),
      open: dropped.filter(x => x.open).length,
      fromPrev: k ? median(reached.map(x => x.times[k] - x.times[k - 1])) : null,
      fromStart: k ? median(reached.map(x => x.times[k] - x.times[0])) : null,
    };
  });

  const groups = rankUserGroups(entries, MAX_SERIES).map(g => ({ key: g.key, entered: g.list.length, steps: summarize(g.list) }));
  const interval = spec.interval || "week";
  const buckets = makeBuckets(range, interval);
  const locate = locator(buckets);
  const trend = buckets.map(() => ({ entered: 0, converted: 0 }));
  for (const x of entries) {
    const bi = locate(x.startDn);
    if (bi < 0) continue;
    trend[bi].entered++;
    if (x.times.length === steps.length) trend[bi].converted++;
  }
  return {
    kind: "funnel", range, interval, buckets, windowS,
    steps: summarize(entries), entered: entries.length, groups: hasUserBreakdown(spec) ? groups : null,
    trend: trend.map(t => ({ ...t, rate: t.entered ? t.converted / t.entered : null })),
  };
}

const hasUserBreakdown = spec => spec.breakdown && spec.breakdown.kind === "user_prop" && spec.breakdown.prop;

/* ── retention ─────────────────────────────────────────────────────────────── */

export function runRetention(ds, spec) {
  const range = resolveRange(ds, spec.range);
  const segment = segmentUsers(ds, spec.segment, range);
  const start = spec.start && (spec.start.events || []).length ? spec.start : { events: ["joined"] };
  const back = spec.return && (spec.return.events || []).length ? spec.return : { events: ["$active"] };
  const sTypes = resolveTypes(ds, start.events);
  const rTypes = resolveTypes(ds, back.events);
  const interval = spec.interval === "week" ? "week" : "day";
  const unit = interval === "week" ? 7 : 1;
  const exact = spec.mode === "exact";
  const cap = interval === "week" ? 12 : 30;
  const maxN = Math.max(1, Math.min(cap, Math.floor((ds.todayDn - range.startDn) / unit)));

  const entries = [];
  for (const u of ds.users) {
    if (!inSegment(segment, u)) continue;
    const first = u.events.find(e => e.dn >= range.startDn && e.dn <= range.endDn && sTypes.has(e.t) && matchEventFilters(e, start.filters));
    if (!first) continue;
    const offsets = new Set();
    for (const e of u.events) {
      if (e.s <= first.s || e === first) continue;
      if (rTypes.has(e.t) && matchEventFilters(e, back.filters)) offsets.add(e.dn - first.dn);
    }
    entries.push({ user: u, startDn: first.dn, offsets: [...offsets].sort((a, b) => a - b), group: userGroupKey(u, spec.breakdown) });
  }

  const cell = (list, n) => {
    const eligible = list.filter(x => ds.todayDn - x.startDn >= n * unit);
    const kept = eligible.filter(x => x.offsets.some(d => exact ? d >= n * unit && d < (n + 1) * unit : d >= n * unit));
    return { n, eligible: eligible.length, retained: kept.length, rate: eligible.length ? kept.length / eligible.length : null, users: kept.map(x => x.user) };
  };
  const curve = list => Array.from({ length: maxN + 1 }, (_, n) => cell(list, n));

  const byWeek = new Map();
  for (const x of entries) { const w = weekOf(x.startDn); let l = byWeek.get(w); if (!l) byWeek.set(w, (l = [])); l.push(x); }
  const cohorts = [...byWeek.keys()].sort((a, b) => a - b).map(w => ({ label: fmtDay(weekStart(w)), size: byWeek.get(w).length, cells: curve(byWeek.get(w)) }));

  return {
    kind: "retention", range, interval, unit, exact, maxN,
    startLabel: selectionLabel(start), returnLabel: selectionLabel(back),
    entered: entries.length, curve: curve(entries), cohorts,
    groups: hasUserBreakdown(spec) ? rankUserGroups(entries, MAX_SERIES).map(g => ({ key: g.key, entered: g.list.length, curve: curve(g.list) })) : null,
  };
}

/* ── lifecycle ─────────────────────────────────────────────────────────────── */

export function runLifecycle(ds, spec) {
  const range = resolveRange(ds, spec.range);
  const segment = segmentUsers(ds, spec.segment, range);
  const sel = spec.series && spec.series[0] && (spec.series[0].events || []).length ? spec.series[0] : { events: ["$active"] };
  const types = resolveTypes(ds, sel.events);
  const interval = ["day", "week", "month"].includes(spec.interval) ? spec.interval : "week";
  const keyOf = keyFor(interval);
  const buckets = makeBuckets(range, interval);
  const newc = [], current = [], resurrected = [], dormant = [];
  const people = ds.users.filter(u => inSegment(segment, u)).map(u => {
    const keys = new Set([keyOf(u.joinDn)]);
    for (const e of u.events) if (types.has(e.t) && matchEventFilters(e, sel.filters)) keys.add(keyOf(e.dn));
    return { u, joinKey: keyOf(u.joinDn), keys };
  });
  for (const b of buckets) {
    let a = 0, c = 0, r = 0, d = 0;
    for (const x of people) {
      if (x.joinKey > b.key) continue;
      const now = x.keys.has(b.key);
      const before = x.joinKey <= b.key - 1 && x.keys.has(b.key - 1);
      if (x.joinKey === b.key) a++;
      else if (now && before) c++;
      else if (now) r++;
      else if (before) d++;
    }
    newc.push(a); current.push(c); resurrected.push(r); dormant.push(d);
  }
  return { kind: "lifecycle", range, interval, buckets, label: selectionLabel(sel), new: newc, current, resurrected, dormant };
}

/* ── stickiness ────────────────────────────────────────────────────────────── */

export function runStickiness(ds, spec) {
  const range = resolveRange(ds, spec.range);
  const segment = segmentUsers(ds, spec.segment, range);
  const sel = spec.series && spec.series[0] && (spec.series[0].events || []).length ? spec.series[0] : { events: ["$active"] };
  const month = spec.interval === "month";
  const keyOf = month ? monthOf : weekOf;
  const days = new Map();
  for (const e of selectEvents(ds, sel, range.startDn, range.endDn, segment)) {
    const k = `${e.user.i}:${keyOf(e.dn)}`;
    let set = days.get(k);
    if (!set) days.set(k, (set = new Set()));
    set.add(e.dn);
  }
  const maxDays = month ? 31 : 7;
  const counts = Array(maxDays).fill(0);
  for (const set of days.values()) for (let n = 1; n <= Math.min(maxDays, set.size); n++) counts[n - 1]++;
  const pairs = days.size;
  const shown = month ? Math.max(1, counts.reduce((last, c, i) => c ? i + 1 : last, 1)) : 7;
  return {
    kind: "categorical", range, sticky: true,
    categories: Array.from({ length: shown }, (_, i) => `${i + 1}+`),
    axisLabel: `days in a ${month ? "month" : "week"}`, valueLabel: `of people-${month ? "months" : "weeks"} active`,
    series: [{ id: "A|", letter: "A", group: null, name: selectionLabel(sel), values: counts.slice(0, shown).map(c => pairs ? c / pairs : null), counts: counts.slice(0, shown), total: pairs, measure: "pct_active" }],
    format: { pct: true, decimals: 0 }, pairs,
  };
}

/* ── journeys ──────────────────────────────────────────────────────────────── */

export function runJourneys(ds, spec) {
  const range = resolveRange(ds, spec.range);
  const segment = segmentUsers(ds, spec.segment, range);
  const start = spec.start && (spec.start.events || []).length ? spec.start : { events: ["joined"] };
  const sTypes = resolveTypes(ds, start.events);
  const depth = Math.max(1, Math.min(6, Number(spec.depth) || 3));
  const skip = new Set(spec.exclude || JOURNEY_SKIP);
  const unique = spec.unique !== false;
  const root = { count: 0, users: [], kids: new Map() };
  for (const u of ds.users) {
    if (!inSegment(segment, u)) continue;
    const idx = u.events.findIndex(e => e.dn >= range.startDn && e.dn <= range.endDn && sTypes.has(e.t) && matchEventFilters(e, start.filters));
    if (idx < 0) continue;
    root.count++;
    root.users.push(u);
    const seen = new Set();
    let node = root;
    let last = null;
    let steps = 0;
    for (let j = idx + 1; j < u.events.length && steps < depth; j++) {
      const t = u.events[j].t;
      if (skip.has(t) || (unique ? seen.has(t) : t === last)) continue;
      seen.add(t);
      last = t;
      steps++;
      let kid = node.kids.get(t);
      if (!kid) node.kids.set(t, (kid = { count: 0, users: [], kids: new Map() }));
      kid.count++;
      kid.users.push(u);
      node = kid;
    }
  }
  return { kind: "tree", range, depth, root, startLabel: selectionLabel(start) };
}

/* ── heatmap ───────────────────────────────────────────────────────────────── */

export function runHeatmap(ds, spec) {
  const sel = spec.series && spec.series[0] && (spec.series[0].events || []).length ? spec.series[0] : null;
  if (!sel) return { kind: "empty", message: "Pick an event to map." };
  const range = resolveRange(ds, spec.range);
  const segment = segmentUsers(ds, spec.segment, range);
  const uniques = sel.measure === "uniques";
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => uniques ? new Set() : 0));
  for (const e of selectEvents(ds, sel, range.startDn, range.endDn, segment)) {
    if (uniques) cells[e.dow][e.hour].add(e.user);
    else cells[e.dow][e.hour]++;
  }
  const grid = cells.map(row => row.map(c => uniques ? c.size : c));
  return { kind: "heatmap", range, grid, label: selectionLabel(sel), unit: uniques ? "people" : "events" };
}

/* ── dispatch ──────────────────────────────────────────────────────────────── */

export function run(ds, spec) {
  switch (spec.type) {
    case "segmentation": return spec.viz === "number" ? runKpi(ds, spec) : runSegmentation(ds, spec);
    case "funnel": return runFunnel(ds, spec);
    case "retention": return runRetention(ds, spec);
    case "lifecycle": return runLifecycle(ds, spec);
    case "stickiness": return runStickiness(ds, spec);
    case "journeys": return runJourneys(ds, spec);
    case "heatmap": return runHeatmap(ds, spec);
    case "users": return runUserTable(ds, spec);
    default: return { kind: "empty", message: `Unknown chart type "${spec.type}".` };
  }
}

export function describeSpec(spec) {
  const range = spec.range ? (RANGE_PRESETS[spec.range.preset]?.label || "custom range") : "page range";
  const interval = spec.interval ? ` · ${spec.interval === "day" ? "daily" : spec.interval === "week" ? "weekly" : "monthly"}` : "";
  const by = hasBreakdown(spec) ? ` · by ${spec.breakdown.kind === "event" ? "event" : (spec.breakdown.kind === "event_prop" ? EVENT_PROPS : USER_PROPS)[spec.breakdown.prop]?.label || spec.breakdown.prop}` : "";
  const seg = (spec.segment || []).length ? ` · ${(spec.segment || []).length} user filter${spec.segment.length === 1 ? "" : "s"}` : "";
  let what = "";
  switch (spec.type) {
    case "segmentation":
    case "users":
      what = spec.formula ? `ƒ ${spec.formula}` : (spec.series || []).map((sr, i) => `${LETTERS[i]}: ${(sr.events || []).join("|")} ${(spec.type === "users" ? USER_MEASURES : MEASURES)[sr.measure]?.short || ""}${sr.prop ? `(${sr.prop})` : ""}`).join(", ");
      break;
    case "funnel": what = (spec.steps || []).map(st => (st.events || []).join("|")).join(" → "); break;
    case "retention": what = `${(spec.start?.events || ["joined"]).join("|")} → ${(spec.return?.events || ["$active"]).join("|")} ${spec.mode === "exact" ? "exact" : "on or after"}`; break;
    case "journeys": what = `from ${(spec.start?.events || ["joined"]).join("|")}, ${spec.depth || 3} steps`; break;
    default: what = (spec.series?.[0]?.events || ["$active"]).join("|");
  }
  return `${CHART_TYPES[spec.type]?.label || spec.type} · ${what}${by}${seg}${interval} · ${range}`;
}
