// fiammo: the page for /d/<token>, a dump shared by link (d/index.html). See
// its header for the shape of it; the rules themselves live in the
// recap-share-link edge function and migration 220.
(function () {
  "use strict";

  // The publishable key, same one the app ships in Config.swift and /p/ uses.
  // It goes in the apikey header only (see p/index.html for why not Bearer).
  var API = "https://syqqxogkqmuojchbglle.supabase.co/functions/v1/recap-share-link";
  var KEY = "sb_publishable_Zcxmg3htO9UvumePY6U3bw_wQrh7X6K";
  // A local stack can stand in, but only on a local host: a query string on
  // the real site must never be able to point this page somewhere else.
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    var q = new URLSearchParams(location.search);
    if (q.get("api")) API = q.get("api");
    if (q.get("key")) KEY = q.get("key");
  }
  var APP_STORE = "/download";
  // fiammo is iPhone-only: on Android there's no app to point at.
  var CAN_GET_APP = !/android/i.test(navigator.userAgent);

  var TOKEN = location.pathname.replace(/\/+$/, "").split("/")[2] || "";
  // The author's standing invite, put on the link by the app (?i=, migration
  // 201). This page can't count it. The profile link can, so it is handed on
  // to that link and nowhere else.
  var INVITE = new URLSearchParams(location.search).get("i");
  if (!INVITE || !/^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/.test(INVITE)) INVITE = null;

  var app = document.getElementById("app");

  // ---------------------------------------------------------------- dom
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === "text") el.textContent = attrs[k];
      else if (k === "html") el.innerHTML = attrs[k];          // icons only, never data
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) el.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return el;
  }
  var ICON = {
    person: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="5.5" r="2.6"/><path d="M3 13.5c.8-2.4 2.7-3.6 5-3.6s4.2 1.2 5 3.6"/></svg>',
    flame: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1.5c.5 2.4 4 4 4 7.5A4 4 0 018 13.2 4 4 0 014 9c0-1.8 1.1-3 1.9-3.6-.1 1.3.5 2.2 1.2 2.4C6.9 5.7 7.3 3.5 8 1.5z"/></svg>',
    close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>',
    left: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3L5 8l5 5"/></svg>',
    right: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>',
  };

  function top() {
    return h("div", { class: "top" }, [
      h("a", { class: "wordmark", href: "/" }, [
        h("img", { class: "word", src: "/wordmark.svg?v=3", alt: "fiammo" }),
      ]),
      CAN_GET_APP ? h("a", { class: "get", href: APP_STORE, text: "Get the app" }) : null,
    ]);
  }
  function screen(kids) {
    app.textContent = "";
    kids.forEach(function (k) { if (k) app.appendChild(k); });
    window.scrollTo(0, 0);
  }

  // Color.fiammoAvatarTints, in the app's order. The server works out which
  // one (shape.ts tintIndex), so a person with no photo has the colour here
  // that they have in the app.
  var TINTS = [["#F4D9CE", "#8A4A2E"], ["#F6E4C6", "#8A6520"], ["#E3E7CE", "#5E6B3A"], ["#CFE3DB", "#3C6559"],
               ["#D4E0EC", "#3F5F7D"], ["#DCD9EE", "#554F80"], ["#EFD5E1", "#8A4566"]];
  function avatar(author, size) {
    var t = TINTS[author.tint] || TINTS[0];
    var el = h("div", { class: "avatar", style: "width:" + size + "px;height:" + size + "px;font-size:" + Math.round(size * .42) + "px;background:" + t[0] + ";color:" + t[1] });
    var letter = (author.first_name || "?").trim().charAt(0).toUpperCase();
    if (author.avatar_url && /^https:\/\//.test(author.avatar_url)) {
      var img = h("img", { src: author.avatar_url, alt: "", referrerpolicy: "no-referrer" });
      img.onerror = function () { el.textContent = letter; };
      el.appendChild(img);
    } else el.textContent = letter;
    return el;
  }
  function name(author) { return author.first_name || "Someone"; }

  // Where the author's profile link goes, with their invite when the link to
  // this page carried one. Only ever our own /u/ page.
  function profileLink(author) {
    if (!author.profile || !/^https:\/\/fiammo\.co\/u\/[0-9a-f-]{36}$/.test(author.profile)) return null;
    var path = author.profile.replace("https://fiammo.co", "");
    return INVITE ? path + "?i=" + INVITE : path;
  }

  // ---------------------------------------------------------------- words
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                "August", "September", "October", "November", "December"];
  // "2026-09-01" is a calendar month, not an instant: read off the string,
  // so nobody west of Greenwich sees August.
  function monthName(month) {
    var m = /^\d{4}-(\d{2})-\d{2}$/.exec(month || "");
    return m ? MONTHS[parseInt(m[1], 10) - 1] || null : null;
  }
  function dumpName(month) {
    var n = monthName(month);
    return n ? n + " dump" : "dump";
  }
  // RecapNumber.bubble: "21" and "days written", "2,140" and "words".
  function stat(n) {
    var v = Math.max(0, Math.round(n.value));
    if (n.key === "days") return [String(v), v === 1 ? "day written" : "days written"];
    if (n.key === "words") return [v.toLocaleString("en-US"), v === 1 ? "word" : "words"];
    return null;
  }
  function shortDay(iso) {
    var t = Date.parse(iso || "");
    if (isNaN(t)) return null;
    return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  // ---------------------------------------------------------------- collage
  // RecapCollage.fold: where each photo sits, in a unit square, for a count
  // of 1 to 9. The same numbers as the app, so the page's collage is the one
  // its author looked at when they sent it.
  function fold(count) {
    function rows(spec) {
      var out = [], y = 0;
      spec.forEach(function (row) {
        for (var i = 0; i < row[0]; i++) out.push([i / row[0], y, 1 / row[0], row[1]]);
        y += row[1];
      });
      return out;
    }
    var third = 1 / 3;
    switch (count) {
      case 1: return rows([[1, 1]]);
      case 2: return rows([[2, 1]]);
      case 3: return [[0, 0, 2 * third, 1], [2 * third, 0, third, .5], [2 * third, .5, third, .5]];
      case 4: return rows([[2, .5], [2, .5]]);
      case 5: return rows([[2, .56], [3, .44]]);
      case 6: return [[0, 0, 2 * third, 2 * third], [2 * third, 0, third, third], [2 * third, third, third, third]]
        .concat(rows([[3, third]]).map(function (r) { return [r[0], r[1] + 2 * third, r[2], r[3]]; }));
      case 7: return rows([[2, .38], [3, .26], [2, .36]]);
      case 8: return rows([[3, .3], [2, .4], [3, .3]]);
      default: return rows([[3, third], [3, third], [3, third]]);
    }
  }
  function pct(n) { return (n * 100).toFixed(4) + "%"; }

  function collage(photos) {
    var shown = photos.slice(0, 9);
    if (!shown.length) return null;
    var places = fold(shown.length);
    var box = h("div", { class: "collage" }, shown.map(function (url, i) {
      var p = places[i];
      return h("button", {
        class: "tile", type: "button",
        style: "left:" + pct(p[0]) + ";top:" + pct(p[1]) + ";width:" + pct(p[2]) + ";height:" + pct(p[3]),
        "aria-label": "Photo " + (i + 1) + " of " + shown.length,
        onclick: function () { view(shown, i); },
      }, [h("img", { src: url, alt: "", loading: i < 3 ? "eager" : "lazy", referrerpolicy: "no-referrer" })]);
    }));
    return h("div", { class: "print" }, [box]);
  }

  // ---------------------------------------------------------------- viewer
  // One photo, whole, over the page. The arrows, the arrow keys and a swipe
  // go to the next; the x, Escape and a tap on the dark put it away.
  function view(photos, start) {
    var at = start, opener = document.activeElement;
    var img = h("img", { alt: "", referrerpolicy: "no-referrer" });
    var count = h("div", { class: "count" });
    var many = photos.length > 1;
    var prev = many ? h("button", { class: "prev", type: "button", "aria-label": "Previous photo", html: ICON.left, onclick: function (e) { e.stopPropagation(); go(-1); } }) : null;
    var next = many ? h("button", { class: "next", type: "button", "aria-label": "Next photo", html: ICON.right, onclick: function (e) { e.stopPropagation(); go(1); } }) : null;
    var close = h("button", { class: "close", type: "button", "aria-label": "Close", html: ICON.close, onclick: function (e) { e.stopPropagation(); shut(); } });
    var layer = h("div", { class: "viewer", role: "dialog", "aria-modal": "true", "aria-label": "Photo" }, [img, close, prev, next, count]);

    function paint() {
      img.src = photos[at];
      count.textContent = many ? (at + 1) + " of " + photos.length : "";
    }
    function go(step) { at = (at + step + photos.length) % photos.length; paint(); }
    function shut() {
      document.removeEventListener("keydown", keys);
      document.body.classList.remove("viewing");
      layer.remove();
      if (opener && opener.focus) opener.focus({ preventScroll: true });
    }
    function keys(e) {
      if (e.key === "Escape") shut();
      else if (many && e.key === "ArrowLeft") go(-1);
      else if (many && e.key === "ArrowRight") go(1);
    }
    var downX = null;
    layer.addEventListener("pointerdown", function (e) { downX = e.clientX; });
    layer.addEventListener("pointerup", function (e) {
      var moved = downX === null ? 0 : e.clientX - downX;
      downX = null;
      if (many && Math.abs(moved) > 40) return go(moved < 0 ? 1 : -1);
      if (e.target === layer) shut();
    });
    img.addEventListener("click", function (e) { e.stopPropagation(); });

    paint();
    document.addEventListener("keydown", keys);
    document.body.classList.add("viewing");
    document.body.appendChild(layer);
    close.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- load
  function load() {
    if (!/^[a-z2-7]{26}$/.test(TOKEN)) return notFound();
    fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": KEY },
      body: JSON.stringify({ token: TOKEN }),
      cache: "no-store",
      referrerPolicy: "no-referrer",
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) { return { status: r.status, body: b }; });
    }, function () { return { status: 0, body: {} }; }).then(function (r) {
      if (r.status === 404) return notFound();
      if (r.status === 429) return slow();
      if (r.status !== 200 || !r.body.author) return failed();
      if (r.body.state === "dump" && r.body.dump) return renderDump(r.body.author, r.body.dump);
      if (r.body.state === "burned") return renderBurned(r.body.author);
      failed();
    });
  }

  // ---------------------------------------------------------------- the dump
  function renderDump(a, d) {
    var n = name(a);
    document.title = n + "'s " + dumpName(d.month) + " · fiammo";

    var stats = (d.numbers || []).map(stat).filter(Boolean);
    var topics = (d.topics || []).slice(0, 5);
    var picks = (d.picks || []).slice(0, 3);

    var names = h("div", { class: "names" });
    topics.forEach(function (t, i) {
      // A space either side of the dot, so the line can break there: with
      // none, five names ran off the page as one unbreakable word.
      if (i) {
        names.appendChild(document.createTextNode(" "));
        names.appendChild(h("i", { text: "·", "aria-hidden": "true" }));
        names.appendChild(document.createTextNode(" "));
      }
      names.appendChild(h("span", { text: t }));
    });

    screen([
      top(),
      h("div", { class: "byline" }, [
        avatar(a, 28),
        h("span", { class: "name", text: n }),
        a.handle ? h("span", { class: "handle", text: "@" + a.handle }) : null,
      ]),
      collage(d.photos || []),
      h("h1", { class: "title", text: n + "'s " + dumpName(d.month) }),
      stats.length ? h("div", { class: "stats" }, stats.map(function (s) {
        return h("span", { class: "stat" }, [h("b", { text: s[0] }), s[1]]);
      })) : null,
      topics.length ? h("div", { class: "about" }, [
        h("div", { class: "label", text: "Mostly wrote about" }), names,
      ]) : null,
      picks.length ? h("section", { class: "picks" }, [
        h("h2", { text: picks.length === 1 ? "A post " + n + " brought back"
          : (picks.length === 2 ? "Two" : "Three") + " posts " + n + " brought back" }),
      ].concat(picks.map(pick))) : null,
      h("div", { class: picks.length ? "foot" : "foot bare" }, [invite(a)]),
    ]);
    // Whether a post runs past its nine lines is measured once it is on the
    // page, not guessed from its length.
    app.querySelectorAll(".pick .words").forEach(offerMore);
  }

  function pick(p) {
    var meta = [];
    var day = shortDay(p.created_at);
    if (day) meta.push(day);
    if (p.topic) meta.push(p.topic);
    if (p.excerpt) meta.push("From a longer post");
    return h("article", { class: "pick" }, [
      p.prompt_text ? h("p", { class: "prompt", text: p.prompt_text }) : null,
      h("p", { class: "words closed", text: String(p.text || "").trim() }),
      meta.length ? h("div", { class: "meta", text: meta.join(" · ") }) : null,
    ]);
  }

  function offerMore(words) {
    if (words.scrollHeight <= words.clientHeight + 1) return;
    var btn = h("button", { class: "more", type: "button", "aria-expanded": "false", text: "Read more" });
    btn.addEventListener("click", function () {
      var opening = words.classList.contains("closed");
      words.classList.toggle("closed", !opening);
      btn.setAttribute("aria-expanded", String(opening));
      btn.textContent = opening ? "Show less" : "Read more";
    });
    words.insertAdjacentElement("afterend", btn);
  }

  // An icon and a line. The icon is ours; the line is set as text.
  function perk(icon, line) {
    var el = h("div", { class: "perk", html: icon + "<span></span>" });
    el.lastChild.textContent = line;
    return el;
  }

  // The card at the foot: who this is, and the way to them. The button is the
  // author's profile link, which is where their invite is counted and where
  // the App Store is one tap on.
  function invite(a) {
    var n = name(a), link = profileLink(a);
    return h("section", { class: "card" }, [
      h("h2", { text: n + " writes on fiammo." }),
      perk(ICON.person, "Add " + n + " and you'll see what they write while it's still up."),
      perk(ICON.flame, "Posts burn after a day. A dump is what a month leaves behind."),
      CAN_GET_APP ? h("a", { class: "primary", href: link || APP_STORE, text: link ? "Add " + n + " on fiammo" : "Get fiammo" }) : null,
      h("p", { class: "fine", style: "text-align:center", text: CAN_GET_APP ? "Free on iPhone" : "fiammo is on iPhone for now." }),
    ]);
  }

  // ---------------------------------------------------------------- other states
  function renderBurned(a) {
    var n = name(a);
    screen([
      top(),
      h("div", { class: "hello" }, [
        avatar(a, 52),
        h("h1", { text: "This dump has burned" }),
        h("p", { text: n + " took it down, or turned its link off. Nothing of it is kept here." }),
      ]),
      h("div", { class: "ash", "aria-hidden": "true" }, [h("i"), h("i"), h("i"), h("i"), h("i"), h("i")]),
      h("section", { class: "card" }, [
        h("h2", { text: "Catch the next one" }),
        h("p", { text: n + " writes on fiammo. With the app you'll see it while it's still up." }),
        CAN_GET_APP ? h("a", { class: "primary", href: profileLink(a) || APP_STORE, text: profileLink(a) ? "Add " + n + " on fiammo" : "Get fiammo" }) : null,
      ]),
    ]);
  }

  function notFound() {
    screen([
      top(),
      h("div", { class: "hello" }, [
        h("h1", { text: "This link doesn't open anything" }),
        h("p", { text: "It may have been copied wrong, or the dump it pointed to may be gone." }),
      ]),
      CAN_GET_APP ? h("a", { class: "primary", href: APP_STORE, text: "Get fiammo" }) : null,
    ]);
  }

  function slow() {
    screen([
      top(),
      h("div", { class: "hello" }, [
        h("h1", { text: "Give it a minute" }),
        h("p", { text: "This has been opened a lot from here in the last few minutes. Try again shortly." }),
      ]),
      h("button", { class: "primary", type: "button", text: "Try again", onclick: function () { location.reload(); } }),
    ]);
  }

  function failed() {
    screen([
      top(),
      h("div", { class: "hello" }, [
        h("h1", { text: "This didn't load" }),
        h("p", { text: "Check your connection and try again." }),
      ]),
      h("button", { class: "primary", type: "button", text: "Try again", onclick: function () { location.reload(); } }),
    ]);
  }

  load();
})();
