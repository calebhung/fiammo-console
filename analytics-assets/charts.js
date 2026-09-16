// Drawing for analytics.html. Every function takes a host element and a
// result from engine.js and draws into it; nothing here queries data.
//
// Marks follow one set of rules: 2px lines with round joins, columns at most
// 24px wide with a 4px rounded data end and a square foot, a 2px surface gap
// between touching fills, hairline solid gridlines, text in text colours only.
// Series colours are the data-viz reference palette in its validated order,
// assigned by position and never recycled past eight (the engine folds the
// rest into "Other"). Every chart has a table twin.

import { fmtDay } from "./engine.js";

/* ── DOM ───────────────────────────────────────────────────────────────────── */

const NS = "http://www.w3.org/2000/svg";
function put(node, attrs, kids) {
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (v === null || v === undefined || v === false) continue;
    if (k === "text") node.textContent = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}
export const h = (tag, attrs, ...kids) => put(document.createElement(tag), attrs, kids);
export const s = (tag, attrs, ...kids) => put(document.createElementNS(NS, tag), attrs, kids);

/* ── palette and formats ───────────────────────────────────────────────────── */

export const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)", "var(--s7)", "var(--s8)"];
export const RAMP = ["var(--q1)", "var(--q2)", "var(--q3)", "var(--q4)", "var(--q5)", "var(--q6)"];
export const colorAt = i => SERIES[i % SERIES.length];

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
export function fmtValue(v, format = {}) {
  if (v === null || v === undefined || !isFinite(v)) return "–";
  if (format.pct) {
    const p = v * 100;
    return `${Math.abs(p) < 10 && p !== 0 && !Number.isInteger(p) ? p.toFixed(1) : Math.round(p)}%`;
  }
  const d = format.decimals || 0;
  if (!Number.isInteger(v)) return new Intl.NumberFormat("en-US", { maximumFractionDigits: Math.max(d, 1) }).format(v);
  return nf.format(v);
}
export function fmtAxis(v, format = {}) {
  if (format.pct) return `${Math.round(v * 100)}%`;
  const a = Math.abs(v);
  if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${+(v / 1e3).toFixed(1)}K`;
  if (Number.isInteger(v)) return nf.format(v);
  return String(+v.toFixed(2));
}
export function fmtDuration(sec) {
  if (sec === null || sec === undefined || !isFinite(sec)) return "–";
  const m = Math.max(0, sec) / 60;
  if (m < 60) return `${Math.max(1, Math.round(m))}m`;
  const hr = m / 60;
  if (hr < 48) return `${Math.round(hr)}h`;
  const d = hr / 24;
  if (d < 21) return `${Math.round(d)}d`;
  return `${Math.round(d / 7)}w`;
}
export const fmtTime = (sec, tz) => new Date(sec * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz });

/* ── tooltip ───────────────────────────────────────────────────────────────── */

let tipEl = null;
export function tip(evt, head, lines, foot) {
  if (!tipEl) tipEl = document.getElementById("tip");
  tipEl.replaceChildren(...[
    h("div", { class: "tip-head", text: head }),
    ...lines.map(l => h("div", { class: "tip-line" },
      l.color ? h("i", { style: `background:${l.color}` }) : null,
      h("b", { text: l.value }),
      l.label ? h("span", { text: l.label }) : null)),
    foot ? h("div", { class: "tip-foot", text: foot }) : null,
  ].filter(Boolean));
  tipEl.hidden = false;
  const r = tipEl.getBoundingClientRect();
  let x = evt.clientX + 14, y = evt.clientY + 14;
  if (x + r.width > innerWidth - 8) x = evt.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = evt.clientY - r.height - 14;
  tipEl.style.left = `${Math.max(8, x)}px`;
  tipEl.style.top = `${Math.max(8, y)}px`;
}
export function hideTip() { if (tipEl) tipEl.hidden = true; }

/* ── scaffolding ───────────────────────────────────────────────────────────── */

function niceStep(raw, integer) {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  let step = 10 * p;
  for (const f of [1, 2, 2.5, 5, 10]) if (f * p >= raw) { step = f * p; break; }
  return integer ? Math.max(1, Math.ceil(step)) : step;
}

function scaleFor(min, max, { integer, pct, ticks = 4 } = {}) {
  if (pct) { min = Math.min(0, min); max = Math.max(max, 0.0001); }
  if (max <= min) max = min + (integer ? 1 : 1);
  const step = niceStep((max - min) / ticks, integer);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const list = [];
  for (let v = lo; v <= hi + step / 2; v += step) list.push(+v.toFixed(10));
  return { lo, hi, ticks: list };
}

function frame(host, height, left, right = 14) {
  const W = Math.max(260, Math.floor(host.getBoundingClientRect().width || 320));
  const m = { l: left, r: right, t: 12, b: 26 };
  const svg = s("svg", { width: W, height, viewBox: `0 0 ${W} ${height}`, class: "chart", role: "img" });
  return { svg, W, H: height, m, iw: W - m.l - m.r, ih: height - m.t - m.b };
}

function yAxis(f, sc, yAt, format) {
  for (const t of sc.ticks) {
    f.svg.append(s("line", { x1: f.m.l, x2: f.W - f.m.r, y1: yAt(t), y2: yAt(t), class: t === 0 ? "axis" : "grid" }));
    f.svg.append(s("text", { x: f.m.l - 7, y: yAt(t) + 3.5, "text-anchor": "end", class: "tick", text: fmtAxis(t, format) }));
  }
}

function xLabels(f, labels, xAt, anchorEnds) {
  const n = labels.length;
  const room = Math.max(2, Math.floor(f.iw / 72));
  const every = Math.max(1, Math.ceil(n / room));
  for (let i = 0; i < n; i += every) {
    const last = i + every >= n;
    const anchor = anchorEnds && n > 1 ? (i === 0 ? "start" : last && i === n - 1 ? "end" : "middle") : "middle";
    f.svg.append(s("text", { x: xAt(i), y: f.H - 7, "text-anchor": anchor, class: "tick", text: labels[i] }));
  }
}

const leftFor = (sc, format) => Math.max(30, 12 + 6.3 * Math.max(...sc.ticks.map(t => fmtAxis(t, format).length)));

export function legend(items, { hidden, onToggle, box } = {}) {
  if (items.length < 2) return null;
  return h("div", { class: "legend" }, items.map(it => {
    const off = hidden && hidden.has(it.id);
    return h("button", {
      class: `legend-item${off ? " off" : ""}`, type: "button", title: off ? "show" : "hide",
      onclick: onToggle ? () => onToggle(it.id) : null,
    }, h("i", { class: box ? "box" : "line", style: `background:${it.color}` }), h("span", { text: it.name }));
  }));
}

function colPath(x, y, w, hgt, down) {
  const r = Math.max(0, Math.min(4, w / 2, hgt));
  if (down) return `M${x},${y}V${y + hgt - r}Q${x},${y + hgt} ${x + r},${y + hgt}H${x + w - r}Q${x + w},${y + hgt} ${x + w},${y + hgt - r}V${y}Z`;
  return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
}

const isInt = values => values.every(v => v === null || v === undefined || Number.isInteger(v));

/* ── lines and areas ───────────────────────────────────────────────────────── */

// series: [{ id, name, values, color }]; labels: x labels; heads: tooltip heads.
export function drawLines(host, { labels, heads, series, format = {}, area = false, height = 280, hidden = new Set(), onToggle, extra }) {
  const visible = series.filter(sr => !hidden.has(sr.id));
  const n = labels.length;
  let min = 0, max = 0;
  if (area) {
    for (let i = 0; i < n; i++) { let sum = 0; for (const sr of visible) sum += Math.max(0, sr.values[i] || 0); max = Math.max(max, sum); }
  } else {
    for (const sr of visible) for (const v of sr.values) if (v !== null && v !== undefined && isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); }
  }
  const sc = scaleFor(min, max, { integer: !format.pct && isInt(visible.flatMap(x => x.values)), pct: format.pct });
  const f = frame(host, height, leftFor(sc, format), 40);
  const xAt = i => f.m.l + (n === 1 ? f.iw / 2 : (i * f.iw) / (n - 1));
  const yAt = v => f.m.t + f.ih - ((v - sc.lo) / (sc.hi - sc.lo)) * f.ih;
  yAxis(f, sc, yAt, format);
  xLabels(f, labels, xAt, true);

  const base = Array(n).fill(0);
  for (const sr of visible) {
    if (area) {
      const top = sr.values.map((v, i) => base[i] + Math.max(0, v || 0));
      const up = top.map((v, i) => `${i ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join("");
      const down = base.map((v, i) => [i, v]).reverse().map(([i, v]) => `L${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join("");
      f.svg.append(s("path", { d: `${up}${down}Z`, fill: sr.color, "fill-opacity": 0.14, stroke: "none" }));
      f.svg.append(s("path", { d: up, fill: "none", stroke: sr.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      top.forEach((v, i) => { base[i] = v; });
    } else {
      let d = "";
      let pen = false;
      sr.values.forEach((v, i) => {
        if (v === null || v === undefined || !isFinite(v)) { pen = false; return; }
        d += `${pen ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`;
        pen = true;
      });
      f.svg.append(s("path", { d, fill: "none", stroke: sr.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      if (n <= 16) sr.values.forEach((v, i) => {
        if (v === null || v === undefined || !isFinite(v)) return;
        f.svg.append(s("circle", { cx: xAt(i), cy: yAt(v), r: 3, fill: sr.color, stroke: "var(--panel)", "stroke-width": 1.5 }));
      });
    }
  }

  // End labels only while they stay apart; the legend and tooltip carry the rest.
  if (!area && visible.length <= 4) {
    const ends = visible.map(sr => ({ sr, v: sr.values[n - 1] })).filter(x => x.v !== null && x.v !== undefined && isFinite(x.v))
      .map(x => ({ ...x, y: yAt(x.v) })).sort((a, b) => a.y - b.y);
    const apart = ends.every((e, i) => i === 0 || e.y - ends[i - 1].y >= 12);
    for (const e of ends) {
      f.svg.append(s("circle", { cx: xAt(n - 1), cy: e.y, r: 4, fill: e.sr.color, stroke: "var(--panel)", "stroke-width": 2 }));
      if (apart) f.svg.append(s("text", { x: xAt(n - 1) + 8, y: e.y + 3.5, class: "label", text: fmtAxis(e.v, format) }));
    }
  }

  const cross = s("line", { y1: f.m.t, y2: f.m.t + f.ih, class: "cross", visibility: "hidden" });
  f.svg.append(cross);
  const hit = s("rect", { x: f.m.l - 8, y: 0, width: f.iw + 16, height: f.m.t + f.ih, fill: "transparent" });
  hit.addEventListener("pointermove", evt => {
    const box = f.svg.getBoundingClientRect();
    const px = ((evt.clientX - box.left) * f.W) / box.width;
    const i = n === 1 ? 0 : Math.min(n - 1, Math.max(0, Math.round(((px - f.m.l) / f.iw) * (n - 1))));
    cross.setAttribute("x1", xAt(i));
    cross.setAttribute("x2", xAt(i));
    cross.setAttribute("visibility", "visible");
    tip(evt, (heads || labels)[i], visible.map(sr => ({ color: sr.color, value: fmtValue(sr.values[i], format), label: sr.name })), extra ? extra(i) : null);
  });
  hit.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); hideTip(); });
  f.svg.append(hit);
  return [legend(series, { hidden, onToggle }), f.svg];
}

/* ── columns ───────────────────────────────────────────────────────────────── */

export function drawColumns(host, { labels, heads, series, format = {}, stacked = false, height = 280, hidden = new Set(), onToggle, capLabels, extra, onClick }) {
  const visible = series.filter(sr => !hidden.has(sr.id));
  const n = labels.length;
  let min = 0, max = 0;
  for (let i = 0; i < n; i++) {
    if (stacked) {
      let pos = 0, neg = 0;
      for (const sr of visible) { const v = sr.values[i] || 0; if (v >= 0) pos += v; else neg += v; }
      max = Math.max(max, pos); min = Math.min(min, neg);
    } else {
      for (const sr of visible) { const v = sr.values[i]; if (v !== null && v !== undefined && isFinite(v)) { max = Math.max(max, v); min = Math.min(min, v); } }
    }
  }
  const sc = scaleFor(min, max, { integer: !format.pct && isInt(visible.flatMap(x => x.values)), pct: format.pct });
  const f = frame(host, height, leftFor(sc, format), 10);
  const yAt = v => f.m.t + f.ih - ((v - sc.lo) / (sc.hi - sc.lo)) * f.ih;
  yAxis(f, sc, yAt, format);
  const band = f.iw / Math.max(1, n);
  xLabels(f, labels, i => f.m.l + band * i + band / 2, false);
  const zero = yAt(0);
  const k = Math.max(1, visible.length);
  const groupW = stacked ? Math.min(24, Math.max(2, band * 0.7)) : Math.min(24 * k + 2 * (k - 1), Math.max(2, band * 0.8));
  const barW = stacked ? groupW : Math.max(1, (groupW - 2 * (k - 1)) / k);
  const labelEvery = capLabels ?? (n * k <= 14);

  for (let i = 0; i < n; i++) {
    const gx = f.m.l + band * i + (band - groupW) / 2;
    const marks = [];
    if (stacked) {
      let up = zero, down = zero;
      const parts = visible.map(sr => ({ sr, v: sr.values[i] || 0 })).filter(p => p.v !== 0);
      parts.forEach((p, pi) => {
        const hgt = Math.abs(yAt(p.v) - zero);
        const gap = pi && hgt > 3 ? 2 : 0;
        if (p.v > 0) {
          const top = up - hgt;
          const lastUp = !parts.slice(pi + 1).some(q => q.v > 0);
          const d = lastUp ? colPath(gx, top, barW, Math.max(1, hgt - gap)) : `M${gx},${up - gap}V${top}H${gx + barW}V${up - gap}Z`;
          marks.push(s("path", { d, fill: p.sr.color }));
          up = top;
        } else {
          const lastDown = !parts.slice(pi + 1).some(q => q.v < 0);
          const d = lastDown ? colPath(gx, down + gap, barW, Math.max(1, hgt - gap), true) : `M${gx},${down + gap}V${down + hgt}H${gx + barW}V${down + gap}Z`;
          marks.push(s("path", { d, fill: p.sr.color }));
          down += hgt;
        }
      });
      if (labelEvery && parts.length && up < zero) f.svg.append(s("text", { x: gx + barW / 2, y: up - 4, "text-anchor": "middle", class: "label", text: fmtAxis(parts.reduce((a, p) => a + p.v, 0), format) }));
    } else {
      visible.forEach((sr, si) => {
        const v = sr.values[i];
        if (v === null || v === undefined || !isFinite(v) || v === 0) return;
        const x = gx + si * (barW + 2);
        const y = yAt(v);
        const hgt = Math.max(1.5, Math.abs(y - zero));
        marks.push(s("path", { d: v > 0 ? colPath(x, zero - hgt, barW, hgt) : colPath(x, zero, barW, hgt, true), fill: sr.color }));
        if (labelEvery) f.svg.append(s("text", { x: x + barW / 2, y: v > 0 ? zero - hgt - 4 : zero + hgt + 11, "text-anchor": "middle", class: "label", text: fmtAxis(v, format) }));
      });
    }
    f.svg.append(...marks);
    const hit = s("rect", { x: f.m.l + band * i, y: f.m.t, width: band, height: f.ih, fill: "transparent", class: onClick ? "clickable" : null });
    hit.addEventListener("pointermove", evt => {
      for (const mk of marks) mk.classList.add("hot");
      tip(evt, (heads || labels)[i], visible.map(sr => ({ color: sr.color, value: fmtValue(sr.values[i], format), label: sr.name })), extra ? extra(i) : null);
    });
    hit.addEventListener("pointerleave", () => { for (const mk of marks) mk.classList.remove("hot"); hideTip(); });
    if (onClick) hit.addEventListener("click", () => onClick(i));
    f.svg.append(hit);
  }
  return [legend(series, { hidden, onToggle, box: true }), f.svg];
}

/* ── horizontal bar rows ───────────────────────────────────────────────────── */

// Nominal rows share one hue; several series per row get their own.
export function drawBarRows(host, { rows, series, format = {}, hidden = new Set(), onToggle }) {
  const visible = series.filter(sr => !hidden.has(sr.id));
  const max = Math.max(0, ...rows.flatMap(r => visible.map(sr => r.values[sr.id] || 0)));
  const one = visible.length === 1;
  const list = h("div", { class: "hbars" }, rows.map(r => h("div", { class: "hbar" },
    h("div", { class: "hbar-name", title: r.label, text: r.label }),
    h("div", { class: "hbar-tracks" }, visible.map(sr => {
      const v = r.values[sr.id];
      return h("div", { class: "hbar-track" },
        h("div", { class: "hbar-fill", style: `width:${max > 0 && v > 0 ? Math.max(0.5, (v / max) * 100) : 0}%;background:${one ? "var(--s1)" : sr.color}` }));
    })),
    h("div", { class: "hbar-vals" }, visible.map(sr => h("div", { text: fmtValue(r.values[sr.id], format) }))),
  )));
  return [one ? null : legend(series, { hidden, onToggle, box: true }), list];
}

/* ── headline number ───────────────────────────────────────────────────────── */

export function drawKpi(host, r) {
  const change = r.previous !== null && r.previous !== undefined && r.value !== null && r.previous !== 0 ? (r.value - r.previous) / Math.abs(r.previous) : null;
  const dir = change === null ? "" : change > 0 ? "up" : change < 0 ? "down" : "flat";
  const spark = r.spark && r.spark.length > 1 ? sparkline(r.spark) : null;
  return [h("div", { class: "kpi" },
    h("div", { class: "kpi-value", text: fmtValue(r.value, r.format) }),
    h("div", { class: `kpi-delta ${dir}` },
      change === null ? h("span", { class: "muted", text: r.previous === null ? "no earlier period" : `was ${fmtValue(r.previous, r.format)}` })
        : [h("b", { text: `${change > 0 ? "▲" : change < 0 ? "▼" : "■"} ${Math.abs(Math.round(change * 100))}%` }), h("span", { class: "muted", text: ` vs previous ${r.range.days} days (${fmtValue(r.previous, r.format)})` })]),
    spark)];
}

function sparkline(values) {
  const W = 160, H = 30;
  const nums = values.map(v => v || 0);
  const max = Math.max(1, ...nums);
  const x = i => (i * (W - 4)) / (nums.length - 1) + 2;
  const y = v => H - 3 - (v / max) * (H - 6);
  const svg = s("svg", { class: "spark", width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  svg.append(s("path", { d: nums.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(""), fill: "none", stroke: "var(--deemph-ink)", "stroke-width": 1.5, "stroke-linejoin": "round" }));
  svg.append(s("circle", { cx: x(nums.length - 1), cy: y(nums[nums.length - 1]), r: 3, fill: "var(--s1)" }));
  return svg;
}

/* ── funnel ────────────────────────────────────────────────────────────────── */

export function drawFunnel(host, r, { height = 300, hidden = new Set(), onToggle, onUsers }) {
  const short = r.steps.map((st, i) => `${i + 1}. ${st.label}`);
  if (r.groups) {
    const series = r.groups.map((g, i) => ({ id: `g${i}`, name: `${g.key} (${g.entered})`, color: colorAt(i), values: g.steps.map(st => st.pctFirst) }));
    return drawColumns(host, {
      labels: short.map(t => clip(t, 22)), heads: short, series, format: { pct: true }, height, hidden, onToggle,
      extra: i => `conversion from step 1`,
    });
  }
  const f = frame(host, height, 44, 10);
  const max = Math.max(1, r.entered);
  const sc = scaleFor(0, max, { integer: true });
  const yAt = v => f.m.t + f.ih - (v / sc.hi) * f.ih;
  yAxis(f, sc, yAt, {});
  const n = r.steps.length;
  const band = f.iw / n;
  const bw = Math.min(24, Math.max(4, band * 0.5));
  xLabels(f, short.map(t => clip(t, Math.max(8, Math.floor(band / 6.4)))), i => f.m.l + band * i + band / 2, false);
  r.steps.forEach((st, i) => {
    const x = f.m.l + band * i + (band - bw) / 2;
    const prev = i ? r.steps[i - 1].count : st.count;
    if (prev > st.count) {
      const top = yAt(prev), bottom = yAt(st.count);
      const ghost = s("path", { d: colPath(x, top, bw, bottom - top - (st.count ? 2 : 0)), fill: "var(--q1)", class: st.dropped.length && onUsers ? "clickable" : null });
      if (onUsers && st.dropped.length) ghost.addEventListener("click", () => onUsers(st.dropped, `Dropped before step ${i + 1}: ${st.label}`));
      ghost.addEventListener("pointermove", evt => tip(evt, `Dropped before step ${i + 1}`, [{ value: fmtValue(st.dropped.length), label: "people" }], st.open ? `${st.open} still inside the window · click to list` : "click to list"));
      ghost.addEventListener("pointerleave", hideTip);
      f.svg.append(ghost);
    }
    if (st.count > 0) {
      const top = yAt(st.count);
      const bar = s("path", { d: colPath(x, top, bw, f.m.t + f.ih - top), fill: "var(--s1)", class: onUsers ? "clickable" : null });
      if (onUsers) bar.addEventListener("click", () => onUsers(st.users, `Reached step ${i + 1}: ${st.label}`));
      bar.addEventListener("pointermove", evt => tip(evt, `Step ${i + 1}: ${st.label}`, [
        { value: fmtValue(st.count), label: "people" },
        { value: fmtValue(st.pctFirst, { pct: true }), label: "of step 1" },
        ...(i ? [{ value: fmtValue(st.pctPrev, { pct: true }), label: "of the step before" }, { value: fmtDuration(st.fromPrev), label: "median time from the step before" }] : []),
      ], "click to list"));
      bar.addEventListener("pointerleave", hideTip);
      f.svg.append(bar);
    }
    f.svg.append(s("text", { x: x + bw / 2, y: yAt(Math.max(prev, st.count)) - 6, "text-anchor": "middle", class: "label strong", text: fmtValue(st.pctFirst, { pct: true }) }));
  });
  return [null, f.svg];
}

const clip = (t, n) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);

/* ── lifecycle ─────────────────────────────────────────────────────────────── */

export function drawLifecycle(host, r, { height = 280, hidden = new Set(), onToggle }) {
  const series = [
    { id: "new", name: "New", color: "var(--s1)", values: r.new },
    { id: "current", name: "Current", color: "var(--s2)", values: r.current },
    { id: "resurrected", name: "Resurrected", color: "var(--s3)", values: r.resurrected },
    { id: "dormant", name: "Dormant", color: "var(--deemph)", values: r.dormant.map(v => -v) },
  ];
  const labels = r.buckets.map(b => b.label);
  const [lg, svg] = drawColumns(host, {
    labels, heads: r.buckets.map(b => `${b.long}${b.partial ? " (partial)" : ""}`), series, stacked: true, height, hidden, onToggle, capLabels: false,
  });
  return [lg, svg];
}

/* ── heatmap ───────────────────────────────────────────────────────────────── */

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hourName = hr => (hr === 0 ? "12am" : hr < 12 ? `${hr}am` : hr === 12 ? "12pm" : `${hr - 12}pm`);

export function drawHeatmap(host, r) {
  const W = Math.max(260, Math.floor(host.getBoundingClientRect().width || 320));
  const left = 34, gap = 2;
  const cell = Math.max(8, Math.min(30, Math.floor((W - left) / 24) - gap));
  const rowH = Math.max(12, Math.min(cell, 22));
  const H = 7 * (rowH + gap) + 20;
  const max = Math.max(0, ...r.grid.flat());
  const width = left + 24 * (cell + gap);
  const svg = s("svg", { class: "chart", width, height: H, viewBox: `0 0 ${width} ${H}` });
  DOW.forEach((d, row) => svg.append(s("text", { x: left - 7, y: row * (rowH + gap) + rowH / 2 + 3.5, "text-anchor": "end", class: "tick", text: d })));
  [0, 3, 6, 9, 12, 15, 18, 21].forEach(hr => { if (cell >= 12 || hr % 6 === 0) svg.append(s("text", { x: left + hr * (cell + gap), y: H - 5, class: "tick", text: hourName(hr) })); });
  r.grid.forEach((line, row) => line.forEach((v, c) => {
    const step = v > 0 && max > 0 ? Math.min(5, Math.floor((v / max) * 5.999)) : -1;
    const rect = s("rect", { x: left + c * (cell + gap), y: row * (rowH + gap), width: cell, height: rowH, rx: 2, fill: step < 0 ? "var(--q0)" : RAMP[step] });
    rect.addEventListener("pointermove", evt => { rect.classList.add("hot"); tip(evt, `${DOW[row]} ${hourName(c)}`, [{ value: fmtValue(v), label: r.unit }]); });
    rect.addEventListener("pointerleave", () => { rect.classList.remove("hot"); hideTip(); });
    svg.append(rect);
  }));
  const scale = h("div", { class: "legend static" },
    h("span", { text: "0" }), h("span", { class: "ramp" }, RAMP.map(c => h("i", { class: "box", style: `background:${c}` }))),
    h("span", { text: `${fmtValue(max)} ${r.unit} in the busiest hour` }));
  return [null, h("div", { class: "scroll-x" }, svg), scale];
}

/* ── journeys ──────────────────────────────────────────────────────────────── */

export function drawTree(host, r, { eventLabel, onUsers }) {
  const rows = [];
  const total = r.root.count;
  if (!total) return [null, h("div", { class: "empty", text: "Nobody did the start event in this range." })];
  const add = (label, node, depth, stop) => rows.push(h("div", { class: `tree-row${stop ? " stop" : ""}${onUsers && node.users ? " clickable" : ""}`, style: `--depth:${depth}`,
    onclick: onUsers && node.users ? () => onUsers(node.users, label) : null },
    h("div", { class: "tree-name", title: label }, depth ? h("span", { class: "tree-elbow", text: "└" }) : null, h("span", { text: label })),
    h("div", { class: "tree-track" }, h("div", { class: "tree-fill", style: `width:${(node.count / total) * 100}%` })),
    h("div", { class: "tree-count", text: node.count }),
    h("div", { class: "tree-pct", text: fmtValue(node.count / total, { pct: true }) })));
  const walk = (node, depth) => {
    const kids = [...node.kids.entries()].sort((a, b) => b[1].count - a[1].count);
    const limit = depth === 1 ? 8 : 4;
    kids.slice(0, limit).forEach(([t, kid]) => { add(eventLabel(t), kid, depth, false); walk(kid, depth + 1); });
    const rest = kids.slice(limit);
    if (rest.length) add(`${rest.length} other paths`, { count: rest.reduce((a, [, k]) => a + k.count, 0), users: rest.flatMap(([, k]) => k.users) }, depth, true);
    const stopped = node.count - kids.reduce((a, [, k]) => a + k.count, 0);
    if (stopped > 0 && depth <= r.depth) {
      const going = new Set(kids.flatMap(([, k]) => k.users));
      add(depth === 1 ? "(nothing yet)" : "(nothing after)", { count: stopped, users: node.users.filter(u => !going.has(u)) }, depth, true);
    }
  };
  add(r.startLabel, r.root, 0, false);
  walk(r.root, 1);
  return [null, h("div", { class: "tree" }, rows)];
}

/* ── tables ────────────────────────────────────────────────────────────────── */

// table: { columns: [{ label, align, cls }], rows: [{ cells: [..], raw: [..], onClick }] }
export function drawTable(table, { sort, onSort, maxRows = 500, sticky = true } = {}) {
  const rows = table.rows.slice(0, maxRows);
  return h("div", { class: "table-wrap" }, h("table", { class: "data" },
    h("thead", null, h("tr", null, table.columns.map((c, ci) => h("th", {
      class: [c.align === "left" ? "l" : null, ci === 0 && sticky ? "sticky" : null, onSort ? "sortable" : null, sort && sort.col === ci ? "sorted" : null].filter(Boolean).join(" ") || null,
      title: c.title || null,
      onclick: onSort ? () => onSort(ci) : null,
    }, c.label, sort && sort.col === ci ? (sort.dir < 0 ? " ↓" : " ↑") : "")))),
    h("tbody", null, rows.map(r => h("tr", { class: r.onClick ? "clickable" : null, onclick: r.onClick || null },
      r.cells.map((cell, ci) => h("td", {
        class: [table.columns[ci].align === "left" ? "l" : null, ci === 0 && sticky ? "sticky" : null, r.cls?.[ci] || null].filter(Boolean).join(" ") || null,
        style: r.styles?.[ci] || null,
        title: r.titles?.[ci] || null,
      }, cell))))),
  ), table.rows.length > maxRows ? h("div", { class: "table-more", text: `${table.rows.length - maxRows} more rows not shown; download the CSV for all of them` }) : null);
}

export function toCSV(table) {
  const esc = v => {
    const t = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [table.columns.map(c => esc(c.label)), ...table.rows.map(r => (r.raw || r.cells).map(esc))].map(l => l.join(",")).join("\n");
}

export function rampCell(rate) {
  if (rate === null || rate === undefined) return { bg: null, ink: null };
  const step = rate > 0 ? Math.min(5, Math.floor(rate * 5.999)) : -1;
  return { bg: step < 0 ? "var(--q0)" : RAMP[step], ink: step >= 4 ? "#fff" : "var(--text)" };
}

export { DOW, hourName, fmtDay };
