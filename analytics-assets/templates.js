// Built-in charts and the Overview dashboard. Each is an ordinary spec: open
// one, change anything, and saving makes it a chart of your own. A chart with
// no `range` follows the range picked at the top of the page.

const WRITE = ["post", "tap", "journal"];

export const TEMPLATES = {
  "kpi-active": {
    name: "Active people", type: "segmentation", viz: "number", interval: "day",
    series: [{ events: ["$active"], measure: "uniques" }],
  },
  "kpi-new": {
    name: "New people", type: "segmentation", viz: "number", interval: "day",
    series: [{ events: ["joined"], measure: "uniques" }],
  },
  "kpi-posts": {
    name: "Posts", type: "segmentation", viz: "number", interval: "day",
    series: [{ events: ["post"], measure: "totals" }],
  },
  "kpi-journal": {
    name: "Journal entries", type: "segmentation", viz: "number", interval: "day",
    series: [{ events: ["journal"], measure: "totals" }],
  },
  "kpi-messages": {
    name: "Messages", type: "segmentation", viz: "number", interval: "day",
    series: [{ events: ["dm", "group_msg"], measure: "totals" }],
  },
  "kpi-words": {
    name: "Words written", type: "segmentation", viz: "number", interval: "day",
    series: [{ events: ["post", "journal"], measure: "sum", prop: "words", filters: [{ prop: "voice", op: "is", value: "false" }] }],
  },
  "active-users": {
    name: "Active people: daily, 7-day, 30-day", type: "segmentation", viz: "line", interval: "day",
    series: [
      { events: ["$active"], measure: "uniques", label: "Daily active" },
      { events: ["$active"], measure: "uniques_r7", label: "Weekly active (rolling 7d)" },
      { events: ["$active"], measure: "uniques_r30", label: "Monthly active (rolling 30d)" },
    ],
  },
  "stickiness": {
    name: "Stickiness: days active per week", type: "stickiness", viz: "bar", interval: "week",
    series: [{ events: ["$active"] }],
  },
  "lifecycle": {
    name: "Lifecycle", type: "lifecycle", viz: "stacked", interval: "week", range: { preset: "90d" },
    series: [{ events: ["$active"] }],
  },
  "activation-funnel": {
    name: "Activation funnel", type: "funnel", viz: "steps", interval: "week", window: 14 * 86400,
    steps: [{ events: ["joined"] }, { events: ["friend"] }, { events: WRITE }, { events: ["echoed"] }, { events: ["dm"] }],
  },
  "retention-curve": {
    name: "Retention after joining", type: "retention", viz: "curve", interval: "day", mode: "unbounded", range: { preset: "90d" },
    start: { events: ["joined"] }, return: { events: ["$active"] },
  },
  "retention-cohorts": {
    name: "Weekly retention cohorts", type: "retention", viz: "cohorts", interval: "week", mode: "exact", range: { preset: "90d" },
    start: { events: ["joined"] }, return: { events: ["$active"] },
  },
  "journeys": {
    name: "First steps after joining", type: "journeys", depth: 3, unique: true, range: { preset: "90d" },
    start: { events: ["joined"] },
  },
  "adoption": {
    name: "Feature adoption (% of active people)", type: "segmentation", viz: "hbar", interval: "day",
    series: [
      { events: ["dm"], measure: "pct_active", label: "Direct messages" },
      { events: ["tap"], measure: "pct_active", label: "Prompt taps" },
      { events: ["post"], measure: "pct_active", label: "Posts" },
      { events: ["echo"], measure: "pct_active", label: "Echoes" },
      { events: ["journal"], measure: "pct_active", label: "Journal" },
      { events: ["group_msg", "group_new"], measure: "pct_active", label: "Group chats" },
      { events: ["catchup_add", "catchup_log"], measure: "pct_active", label: "Catch up" },
      { events: ["invite"], measure: "pct_active", label: "Invites" },
    ],
  },
  "writing-daily": {
    name: "Writing per day", type: "segmentation", viz: "stacked", interval: "day",
    series: [{ events: ["post"], measure: "totals", label: "Posts" }, { events: ["tap"], measure: "totals", label: "Prompt taps" }, { events: ["journal"], measure: "totals", label: "Journal entries" }],
  },
  "messages-daily": {
    name: "Messages per day", type: "segmentation", viz: "stacked", interval: "day",
    series: [{ events: ["dm"], measure: "totals", label: "Direct" }, { events: ["group_msg"], measure: "totals", label: "Group" }],
  },
  "words-per-post": {
    name: "Words per post and journal entry", type: "segmentation", viz: "bar",
    series: [{ events: ["post", "journal"], measure: "distribution", prop: "words", filters: [{ prop: "voice", op: "is", value: "false" }] }],
  },
  "words-by-person": {
    name: "Words written, by person", type: "segmentation", viz: "hbar", interval: "day",
    breakdown: { kind: "user_prop", prop: "handle" },
    series: [{ events: ["post", "journal"], measure: "sum", prop: "words", filters: [{ prop: "voice", op: "is", value: "false" }] }],
  },
  "heatmap-writing": {
    name: "When people write", type: "heatmap",
    series: [{ events: WRITE, measure: "totals" }],
  },
  "heatmap-messages": {
    name: "When people message", type: "heatmap",
    series: [{ events: ["dm", "group_msg"], measure: "totals" }],
  },
  "dm-reach": {
    name: "Messages and people messaged, by person", type: "segmentation", viz: "table", interval: "week",
    breakdown: { kind: "user_prop", prop: "handle" },
    series: [{ events: ["dm"], measure: "totals" }, { events: ["dm"], measure: "distinct", prop: "peer" }],
  },
  "groups": {
    name: "Group chats", type: "segmentation", viz: "table", interval: "week", range: { preset: "all" },
    breakdown: { kind: "event_prop", prop: "group" },
    series: [{ events: ["group_msg"], measure: "totals" }, { events: ["group_msg"], measure: "uniques" }],
  },
  "invites": {
    name: "Invites sent and joined, by person", type: "segmentation", viz: "table", interval: "week", range: { preset: "all" },
    breakdown: { kind: "user_prop", prop: "handle" },
    series: [{ events: ["invite"], measure: "totals" }, { events: ["invite_joined"], measure: "totals" }],
  },
  "people": {
    name: "People", type: "users",
    series: [
      { events: ["$active"], measure: "days", label: "Active days" },
      { events: ["post"], measure: "totals", label: "Posts" },
      { events: ["post"], measure: "sum", prop: "words", label: "Post words" },
      { events: ["post"], measure: "sum", prop: "chars", label: "Post characters" },
      { events: ["tap"], measure: "totals", label: "Taps" },
      { events: ["journal"], measure: "totals", label: "Journal entries" },
      { events: ["journal"], measure: "sum", prop: "words", label: "Journal words" },
      { events: ["echo"], measure: "totals", label: "Echoes given" },
      { events: ["echoed"], measure: "totals", label: "Echoes got" },
      { events: ["dm"], measure: "totals", label: "DMs sent" },
      { events: ["dm_in"], measure: "totals", label: "DMs got" },
      { events: ["dm"], measure: "distinct", prop: "peer", label: "People messaged" },
      { events: ["group_msg"], measure: "totals", label: "Group messages" },
      { events: ["invite"], measure: "totals", label: "Invites" },
    ],
  },
};

export const OVERVIEW = {
  id: "overview",
  name: "Overview",
  builtin: true,
  spec: {
    items: [
      { ref: "template:kpi-active", size: "1/6" },
      { ref: "template:kpi-new", size: "1/6" },
      { ref: "template:kpi-posts", size: "1/6" },
      { ref: "template:kpi-journal", size: "1/6" },
      { ref: "template:kpi-messages", size: "1/6" },
      { ref: "template:kpi-words", size: "1/6" },
      { ref: "template:active-users", size: "2/3" },
      { ref: "template:stickiness", size: "1/3" },
      { ref: "template:activation-funnel", size: "1/2" },
      { ref: "template:retention-curve", size: "1/2" },
      { ref: "template:lifecycle", size: "1/2" },
      { ref: "template:retention-cohorts", size: "1/2" },
      { ref: "template:journeys", size: "1/2" },
      { ref: "template:adoption", size: "1/2" },
      { ref: "template:writing-daily", size: "1/2" },
      { ref: "template:messages-daily", size: "1/2" },
      { ref: "template:heatmap-writing", size: "1/2" },
      { ref: "template:heatmap-messages", size: "1/2" },
      { ref: "template:words-per-post", size: "1/2" },
      { ref: "template:words-by-person", size: "1/2" },
      { ref: "template:dm-reach", size: "1/2" },
      { ref: "template:invites", size: "1/2" },
      { ref: "template:people", size: "full" },
    ],
  },
};

export const NEW_SPECS = {
  segmentation: () => ({ type: "segmentation", viz: "line", interval: "day", series: [{ events: ["$active"], measure: "uniques" }] }),
  funnel: () => ({ type: "funnel", viz: "steps", interval: "week", window: 7 * 86400, steps: [{ events: ["joined"] }, { events: ["post"] }] }),
  retention: () => ({ type: "retention", viz: "curve", interval: "day", mode: "unbounded", start: { events: ["joined"] }, return: { events: ["$active"] } }),
  lifecycle: () => ({ type: "lifecycle", viz: "stacked", interval: "week", series: [{ events: ["$active"] }] }),
  stickiness: () => ({ type: "stickiness", viz: "bar", interval: "week", series: [{ events: ["$active"] }] }),
  journeys: () => ({ type: "journeys", depth: 3, unique: true, start: { events: ["joined"] } }),
  heatmap: () => ({ type: "heatmap", series: [{ events: ["post", "tap", "journal"], measure: "totals" }] }),
  users: () => ({ type: "users", series: [{ events: ["$active"], measure: "days" }, { events: ["post"], measure: "totals" }] }),
};
