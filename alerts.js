/* Fiammo — alert detection.
 *
 * Shared by alerts.html (which renders the full list) and dev-tools.html
 * (which renders only the unacknowledged count in its header). One module
 * rather than two copies because the number on the dev-tools badge and the
 * rows on the alerts page have to mean the same thing — a badge that says 3
 * next to a page that lists 5 is worse than no badge at all.
 *
 * No build step in this repo, so this attaches to window rather than exporting.
 */
(function () {
  "use strict";

  const WINDOWS = {
    "1h": 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
  };

  // admin-logs-list caps a page at 500 rows. Asking for the maximum and
  // filtering to warn+error server-side keeps a busy day inside one request;
  // when it doesn't, collect() reports the truncation rather than quietly
  // undercounting (see `truncated` on the result).
  const LOG_LIMIT = 500;

  // Health probes ride an app_logs row of their own, because every function
  // worth probing is wrapped in withLogging. Left unmarked, the probe's own
  // 401 would land in the log, get picked up by the 4xx detector on the next
  // refresh, and the page would spend the rest of the day alerting on itself.
  // withLogging reads _requestId out of the body, so prefixing it is enough to
  // recognise our own traffic and drop it.
  const PROBE_PREFIX = "healthprobe-";

  const ACK_KEY = "fiammo_alerts_ack";

  /* ── Acknowledgement ──────────────────────────────────────────────────────
   *
   * An ack stores the alert's fingerprint, not a boolean. The fingerprint is
   * the newest thing the alert is built from (highest log id, newest report,
   * the diagnostic run's id), so acking "ai-themes is 500ing" silences that
   * burst and nothing else: the next 500 changes the fingerprint and the alert
   * comes back on its own. A boolean would mean dismissing an alert once
   * dismissed the outage.
   */
  function readAcks() {
    try { return JSON.parse(localStorage.getItem(ACK_KEY) || "{}"); }
    catch (e) { return {}; }
  }

  function writeAcks(acks) {
    localStorage.setItem(ACK_KEY, JSON.stringify(acks));
  }

  function ack(alert) {
    const acks = readAcks();
    acks[alert.key] = alert.fingerprint;
    writeAcks(acks);
  }

  function unack(alert) {
    const acks = readAcks();
    delete acks[alert.key];
    writeAcks(acks);
  }

  function isAcked(alert, acks) {
    return (acks || readAcks())[alert.key] === alert.fingerprint;
  }

  function ackAll(alerts) {
    const acks = readAcks();
    alerts.forEach(a => { acks[a.key] = a.fingerprint; });
    writeAcks(acks);
  }

  /* ── Helpers ────────────────────────────────────────────────────────────── */

  const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };

  function isProbeRow(row) {
    const id = row && row.metadata && row.metadata.requestId;
    return typeof id === "string" && id.startsWith(PROBE_PREFIX);
  }

  // The function name for an edge row. function.invoke puts it in `message`
  // bare; function.error puts it there with the thrown error appended
  // ("notify-friends-on-post: ReferenceError: ..."), which is the half worth
  // grouping on.
  function edgeFunctionName(row) {
    const m = (row.message || "").trim();
    if (!m) return row.path || "unknown";
    return m.split(":")[0].trim();
  }

  function group(rows, keyFn) {
    const out = new Map();
    for (const row of rows) {
      const k = keyFn(row);
      if (k === null || k === undefined) continue;
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(row);
    }
    return out;
  }

  // Rows arrive newest-first (admin-logs-list orders by id desc), so the head
  // of a group is its most recent occurrence and its id is the fingerprint.
  function makeLogAlert(spec, rows) {
    const newest = rows[0];
    return {
      key: spec.key,
      severity: spec.severity,
      source: spec.source,
      title: spec.title,
      detail: spec.detail,
      count: rows.length,
      latestAt: newest.created_at,
      fingerprint: String(newest.id),
      samples: rows.slice(0, 8),
      action: spec.action || null,
    };
  }

  function plural(n, one, many) {
    return n === 1 ? one : (many || one + "s");
  }

  /* ── Detectors over the activity log ──────────────────────────────────────
   *
   * Every one of these reads the same single admin-logs-list response. The log
   * already knows about every failure the app and the backend have had; the
   * only thing missing was something to notice a pattern in it without a human
   * scrolling. Thresholds exist so an alert means "look at this", not "here is
   * the log again with a border around it".
   */
  function detectFromLogs(logs, windowMs) {
    const cutoff = Date.now() - windowMs;
    const rows = logs.filter(r =>
      !isProbeRow(r) && new Date(r.created_at).getTime() >= cutoff
    );
    const alerts = [];

    const edge = rows.filter(r => r.source === "edge");
    const ios = rows.filter(r => r.source === "ios");

    // Edge 5xx — one is enough. A function returning 500 is never expected
    // behaviour, and this is the detector that would have caught both the Groq
    // model retirement and the undefined json() in the push functions.
    for (const [fn, hits] of group(edge.filter(r => r.status >= 500), edgeFunctionName)) {
      // function.error rows carry the thrown message; function.invoke rows only
      // carry the status, because the handler caught its own error and returned
      // a 500 itself. Prefer a real message when one of the rows has it.
      const withMessage = hits.find(r => r.event === "function.error");
      const because = withMessage
        ? withMessage.message.slice(fn.length + 1).trim()
        : "the handler returned 500 itself — check the function's console logs in the Supabase dashboard for the thrown error";
      alerts.push(makeLogAlert({
        key: `edge-5xx:${fn}`,
        severity: "critical",
        source: "edge",
        title: `${fn} is failing`,
        detail: `${hits.length} ${plural(hits.length, "server error")} — ${because}`,
        action: { label: "activity log", href: "dev-tools.html#activity-log-card" },
      }, hits));
    }

    // Edge 4xx — noisy by nature (an expired session, a client sending a stale
    // body), so this needs a run of them before it counts as a signal.
    for (const [fn, hits] of group(edge.filter(r => r.status >= 400 && r.status < 500), edgeFunctionName)) {
      if (hits.length < 5) continue;
      const codes = [...new Set(hits.map(r => r.status))].sort().join(", ");
      alerts.push(makeLogAlert({
        key: `edge-4xx:${fn}`,
        severity: "warning",
        source: "edge",
        title: `${fn} is rejecting callers`,
        detail: `${hits.length} rejected ${plural(hits.length, "call")} (${codes}). Repeated 401s usually mean a client is holding a session the server has already dropped.`,
        action: { label: "activity log", href: "dev-tools.html#activity-log-card" },
      }, hits));
    }

    // iOS 5xx — the app's own view of a backend failure, grouped by endpoint
    // because most of these are PostgREST paths.
    //
    // A failing edge function shows up twice in the log: once as the edge row
    // the function wrote about itself, once as the iOS row the app wrote about
    // the same request. Reporting both turns one outage into two alerts and
    // makes the list exactly the thing this page exists to avoid. The edge row
    // wins — it is the side that knows what was actually thrown — so an iOS
    // path is only alerted on when nothing already covers that function. A
    // gateway-level failure, where the function never boots and so never logs,
    // still surfaces here, which is why this isn't a blanket skip of
    // /functions/v1.
    const coveredFunctions = new Set(alerts.filter(a => a.key.startsWith("edge-5xx:")).map(a => a.key.slice("edge-5xx:".length)));
    const iosPathFunction = path => {
      const m = /^\/functions\/v1\/([^/?]+)/.exec(path || "");
      return m ? m[1] : null;
    };

    for (const [path, hits] of group(ios.filter(r => r.status >= 500), r => r.path || "unknown")) {
      const fn = iosPathFunction(path);
      if (fn && coveredFunctions.has(fn)) continue;
      alerts.push(makeLogAlert({
        key: `ios-5xx:${path}`,
        severity: "critical",
        source: "ios",
        title: `the app is getting 500s from ${path}`,
        detail: `${hits.length} failed ${plural(hits.length, "request")} from the iOS app.`,
        action: { label: "activity log", href: "dev-tools.html#activity-log-card" },
      }, hits));
    }

    // iOS 4xx — a single 401 is a token refreshing. Ten of them against one
    // endpoint is a client stuck in a loop it can't get out of.
    for (const [k, hits] of group(
      ios.filter(r => r.status >= 400 && r.status < 500),
      r => `${r.status} ${r.path || "unknown"}`
    )) {
      if (hits.length < 10) continue;
      alerts.push(makeLogAlert({
        key: `ios-4xx:${k}`,
        severity: "warning",
        source: "ios",
        title: `the app keeps getting ${k}`,
        detail: `${hits.length} rejected requests from the iOS app against the same endpoint.`,
        action: { label: "activity log", href: "dev-tools.html#activity-log-card" },
      }, hits));
    }

    // A rejected password on a page that is linked from nowhere and indexed by
    // nobody is the one thing here that might be someone else.
    const authFails = rows.filter(r => r.event === "devtools.auth_failed");
    if (authFails.length) {
      alerts.push(makeLogAlert({
        key: "devtools-auth-failed",
        severity: "warning",
        source: "security",
        title: `${authFails.length} failed admin ${plural(authFails.length, "password attempt")}`,
        detail: "Someone entered the wrong password on this dev tools page. If it wasn't you, rotate ADMIN_DEV_TOOLS_PASSWORD.",
      }, authFails));
    }

    return alerts;
  }

  /* ── Reports ─────────────────────────────────────────────────────────────
   *
   * The reports table has no resolved/dismissed column, so "open" isn't a
   * thing it can tell us — every report is open forever. Acknowledgement is
   * therefore the only notion of "dealt with" available, and it works out
   * exactly right: ack the batch, and the alert returns when the next report
   * lands rather than the moment the page reloads.
   */
  function detectFromReports(reports) {
    if (!reports || !reports.length) return [];
    const newest = reports[0];
    const reasons = [...new Set(reports.slice(0, 20).map(r => r.reason))].join(", ");
    return [{
      key: "reports",
      severity: "critical",
      source: "reports",
      title: `${reports.length} user ${plural(reports.length, "report")}`,
      detail: `Reported content awaiting review (${reasons}). Newest from @${(newest.reporter && newest.reporter.handle) || "unknown"}.`,
      count: reports.length,
      latestAt: newest.reported_at,
      fingerprint: String(newest.id),
      samples: reports.slice(0, 5).map(r => ({
        created_at: r.reported_at,
        level: "warn",
        source: "reports",
        event: r.reason,
        message: (r.post && r.post.content ? String(r.post.content).slice(0, 160) : "(content deleted)"),
      })),
      action: { label: "reported posts", href: "dev-tools.html#reports" },
    }];
  }

  /* ── Diagnostics ────────────────────────────────────────────────────────── */

  const DIAGNOSTICS_STALE_DAYS = 7;

  function detectFromDiagnostics(runs) {
    if (!runs || !runs.length) {
      return [{
        key: "diagnostics-never-run",
        severity: "info",
        source: "diagnostics",
        title: "diagnostics have never been run",
        detail: "Nothing has ever checked the schema, RLS, or the messaging paths end to end.",
        count: 0,
        latestAt: null,
        fingerprint: "never",
        samples: [],
        action: { label: "run diagnostics", href: "dev-tools.html#diagnostics" },
      }];
    }

    const last = runs[0];
    const alerts = [];
    const ageMs = Date.now() - new Date(last.started_at).getTime();
    const ageDays = Math.floor(ageMs / 86400000);

    if (last.failed > 0) {
      alerts.push({
        key: "diagnostics-failed",
        severity: "critical",
        source: "diagnostics",
        title: `${last.failed} diagnostic ${plural(last.failed, "check")} failing`,
        detail: `The last run (${new Date(last.started_at).toLocaleString()}) passed ${last.passed} of ${last.total_checks}.`,
        count: last.failed,
        latestAt: last.started_at,
        fingerprint: String(last.id),
        samples: [],
        action: { label: "run diagnostics", href: "dev-tools.html#diagnostics" },
      });
    }

    if (last.aborted) {
      alerts.push({
        key: "diagnostics-aborted",
        severity: "warning",
        source: "diagnostics",
        title: "the last diagnostics run aborted",
        detail: "It stopped partway, so the checks after the abort never ran and their state is unknown.",
        count: 1,
        latestAt: last.started_at,
        fingerprint: String(last.id),
        samples: [],
        action: { label: "run diagnostics", href: "dev-tools.html#diagnostics" },
      });
    }

    // A green run from three weeks ago says nothing about today. Staleness is
    // its own, quieter alert: not a breakage, but a reason not to trust the
    // absence of one.
    if (ageDays >= DIAGNOSTICS_STALE_DAYS) {
      alerts.push({
        key: "diagnostics-stale",
        severity: "info",
        source: "diagnostics",
        title: `diagnostics last ran ${ageDays} days ago`,
        detail: "A passing run this old isn't evidence that anything still passes.",
        count: ageDays,
        latestAt: last.started_at,
        fingerprint: String(last.id),
        samples: [],
        action: { label: "run diagnostics", href: "dev-tools.html#diagnostics" },
      });
    }

    return alerts;
  }

  /* ── Health probes ───────────────────────────────────────────────────────
   *
   * Deliberately narrow. Each target is a function verified to reject an
   * unauthenticated, empty-bodied POST *before* it touches anything — so the
   * probe proves the isolate boots, the module graph resolves, and the handler
   * runs, and it changes nothing. An undefined identifier at the top of a
   * handler (which is how the push functions were dead for two days) shows up
   * here as a 500 the moment it is deployed, with nobody having to call it.
   *
   * Excluded on purpose: the invite and circle-SMS endpoints (a probe can send
   * a real message), twilio-inbound-sms (a webhook that flips consent state),
   * and the mutating admin-* tools (a probe would run them). admin-check-password
   * stands in for that whole family — it shares their module, their password
   * gate, and their service-role client, and it is the one endpoint in the set
   * that exists purely to be called with no effect.
   *
   * What this cannot see: anything downstream of the auth check. ai-themes
   * answering the probe only proves ai-themes is up — the Groq call is past the
   * point a probe reaches, and a retired model still surfaces as 5xx rows in
   * the log detector above, not here.
   */
  const HEALTH_TARGETS = [
    { name: "ai-themes", expect: [401], note: "constellation themes and insight" },
    { name: "send-push-notification", expect: [401], note: "one-off push delivery" },
    { name: "notify-friends-on-post", expect: [400], note: "push fan-out on a new post" },
    { name: "send-daily-notifications", expect: [401], note: "the daily prompt cron" },
    { name: "admin-check-password", expect: [200, 401], note: "dev tools + service role", withPassword: true },
  ];

  async function probeOne(cfg, target) {
    const started = performance.now();
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${cfg.anonKey}`,
      "apikey": cfg.anonKey,
    };
    if (target.withPassword) headers["x-admin-password"] = cfg.password || "";

    try {
      const res = await fetch(`${cfg.supabaseUrl}/functions/v1/${target.name}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ _requestId: PROBE_PREFIX + crypto.randomUUID() }),
      });
      return {
        target,
        status: res.status,
        ms: Math.round(performance.now() - started),
        // A 5xx is the function breaking. Anything else — including a status
        // we didn't expect — means code ran and answered, which is all a
        // liveness probe is entitled to conclude.
        down: res.status >= 500,
        unexpected: !target.expect.includes(res.status) && res.status < 500,
      };
    } catch (e) {
      // Network-level failure: DNS, TLS, CORS, or the function failing to boot
      // at all. Indistinguishable from here, and all of them mean unreachable.
      return { target, status: null, ms: Math.round(performance.now() - started), down: true, error: String(e.message || e) };
    }
  }

  async function runHealthProbes(cfg) {
    return Promise.all(HEALTH_TARGETS.map(t => probeOne(cfg, t)));
  }

  function detectFromHealth(results) {
    return results.filter(r => r.down).map(r => ({
      key: `health:${r.target.name}`,
      severity: "critical",
      source: "health",
      title: `${r.target.name} is down`,
      detail: r.status
        ? `The health probe got ${r.status} where it expected ${r.target.expect.join(" or ")}. This is ${r.target.note}.`
        : `The health probe couldn't reach it at all (${r.error}). This is ${r.target.note}.`,
      count: 1,
      latestAt: new Date().toISOString(),
      // Not time-based: acking a service that is down should keep it quiet
      // while it stays down, and speak up again if it recovers and re-breaks.
      fingerprint: `down:${r.status || "unreachable"}`,
      samples: [],
      action: null,
    }));
  }

  /* ── Collection ─────────────────────────────────────────────────────────── */

  /**
   * Gathers every alert from every source.
   *
   * @param {object}   opts
   * @param {function} opts.call    the page's callFunction(name, body)
   * @param {object}   opts.cfg     { supabaseUrl, anonKey, password } — probes only
   * @param {number}   opts.windowMs how far back the log detectors look
   * @param {boolean}  opts.probe   run the live health probes (see the note on
   *                                HEALTH_TARGETS — these are real requests, so
   *                                the dev-tools badge leaves them off)
   *
   * Each source is caught separately: reports being unreachable must not cost
   * you the log alerts. A source that failed is reported in `failures` so the
   * page can say "3 alerts, and I couldn't check reports" instead of implying
   * an all-clear it didn't earn.
   */
  async function collect(opts) {
    const call = opts.call;
    const windowMs = opts.windowMs || WINDOWS["24h"];
    const alerts = [];
    const failures = [];
    let truncated = false;

    const tasks = [
      (async () => {
        const data = await call("admin-logs-list", {
          levels: ["warn", "error"],
          limit: LOG_LIMIT,
        });
        const logs = data.logs || [];
        // A full page means there may be older warn/error rows inside the
        // window that this response never reached, so counts are floors.
        truncated = logs.length >= LOG_LIMIT && !!data.has_more;
        alerts.push(...detectFromLogs(logs, windowMs));
      })().catch(e => failures.push({ source: "activity log", error: String(e.message || e) })),

      (async () => {
        const data = await call("admin-list-reports");
        alerts.push(...detectFromReports(data.reports || []));
      })().catch(e => failures.push({ source: "reports", error: String(e.message || e) })),

      (async () => {
        const data = await call("admin-diagnostics-history");
        alerts.push(...detectFromDiagnostics(data.runs || []));
      })().catch(e => failures.push({ source: "diagnostics", error: String(e.message || e) })),
    ];

    let health = [];
    if (opts.probe) {
      tasks.push(
        (async () => {
          health = await runHealthProbes(opts.cfg);
          alerts.push(...detectFromHealth(health));
        })().catch(e => failures.push({ source: "health probes", error: String(e.message || e) }))
      );
    }

    await Promise.all(tasks);

    alerts.sort((a, b) => {
      const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (s !== 0) return s;
      return new Date(b.latestAt || 0) - new Date(a.latestAt || 0);
    });

    return { alerts, failures, health, truncated, checkedAt: new Date() };
  }

  window.FiammoAlerts = {
    WINDOWS,
    HEALTH_TARGETS,
    collect,
    ack, unack, ackAll, isAcked, readAcks,
  };
})();
