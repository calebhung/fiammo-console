// fiammo — the reader for two kinds of link, each with its own page and its
// own edge function holding the rules:
//   /p/<code>/<token>  a post texted to one person   p/read/   text-link
//   /s/<token>         a post shared by link         s/        post-share-link
// A shared link is the simpler one: the token is all there is, so there is
// no browser secret, no code and no list of other posts. It draws the same
// post, the same burned screen and the same way to the app.
//
// A shared link comes in two kinds. One made while the post was live ends
// when the post burns. One its author made after the burn (migration 251,
// post.after_burn) shows a post that is already gone from fiammo, for a few
// days of its own: the page says when it was written, that it has burned,
// and when the link ends, and "this link has ended" once it has.
(function () {
  "use strict";

  // The publishable key, same one the app ships in Config.swift and /p/ uses.
  // It goes in the apikey header only (see p/index.html for why not Bearer).
  var parts = location.pathname.replace(/\/+$/, "").split("/");
  var SHARE = parts[1] === "s";
  var API = "https://syqqxogkqmuojchbglle.supabase.co/functions/v1/" + (SHARE ? "post-share-link" : "text-link");
  var KEY = "sb_publishable_Zcxmg3htO9UvumePY6U3bw_wQrh7X6K";
  // A local stack can stand in, but only on a local host: a query string on
  // the real site must never be able to point this page, and the browser
  // secret it sends, somewhere else.
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    var q = new URLSearchParams(location.search);
    if (q.get("api")) API = q.get("api");
    if (q.get("key")) KEY = q.get("key");
  }
  var APP_STORE = "/download";
  // fiammo is iPhone-only: on Android there's no app to point at.
  var CAN_GET_APP = !/android/i.test(navigator.userAgent);

  var CODE = SHARE ? "" : (parts[2] || ""), TOKEN = (SHARE ? parts[2] : parts[3]) || "";

  // A shared link carries its author's invite (?i=, migration 208), the way a
  // profile link does (/u/). It can't follow anyone through the App Store, so
  // it counts when the link is opened again with fiammo installed.
  var INVITE = SHARE && /^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/.test(new URLSearchParams(location.search).get("i") || "");
  // Whether opening the link again opens the app. Not until the association
  // file claims /s/ for a build that answers it (SHARE_LINKS.md, "Shipping"),
  // and until then the page must not tell anyone to do it.
  var SHARE_OPENS_APP = false;

  var app = document.getElementById("app");
  var S = { data: null, invited: false, timer: null };

  // ---------------------------------------------------------------- browser
  // A random secret that says "this browser". The server keeps only a hash.
  // If storage is blocked it lives for this page load, which is still enough
  // to claim and read.
  var BROWSER = SHARE ? null : (function () {
    var k = "fiammo.reader";
    try { var v = localStorage.getItem(k); if (v && /^[A-Za-z0-9_-]{43}$/.test(v)) return v; } catch (e) {}
    var b = crypto.getRandomValues(new Uint8Array(32)), s = "";
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    var v2 = btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    try { localStorage.setItem(k, v2); } catch (e) {}
    return v2;
  })();

  function api(action, extra) {
    // A shared link sends its token and nothing else: nothing here says
    // which browser is asking.
    var body = SHARE ? { token: TOKEN } : { action: action, code: CODE, token: TOKEN, browser: BROWSER };
    for (var k in extra || {}) body[k] = extra[k];
    return fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": KEY },
      body: JSON.stringify(body),
      cache: "no-store",
      referrerPolicy: "no-referrer",
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) { return { status: r.status, body: b }; });
    }, function () { return { status: 0, body: {} }; });
  }

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
    ember: '<svg viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><path d="M7 1.2c.4 2.1 3.6 3.5 3.6 6.6A3.6 3.6 0 017 11.6a3.6 3.6 0 01-3.6-3.8c0-1.6 1-2.6 1.7-3.2-.1 1.2.4 2 1.1 2.2C6.2 5 6.4 3 7 1.2z"/></svg>',
    play: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 3.2l7.5 4.4a.5.5 0 010 .8L5 12.8a.5.5 0 01-.8-.4V3.6a.5.5 0 01.8-.4z"/></svg>',
    pause: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="4.5" y="3.5" width="2.6" height="9" rx="1"/><rect x="8.9" y="3.5" width="2.6" height="9" rx="1"/></svg>',
    chevr: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5"/></svg>',
    chev: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4.5L6 8l3.5-3.5"/></svg>',
    person: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="5.5" r="2.6"/><path d="M3 13.5c.8-2.4 2.7-3.6 5-3.6s4.2 1.2 5 3.6"/></svg>',
    flame: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1.5c.5 2.4 4 4 4 7.5A4 4 0 018 13.2 4 4 0 014 9c0-1.8 1.1-3 1.9-3.6-.1 1.3.5 2.2 1.2 2.4C6.9 5.7 7.3 3.5 8 1.5z"/></svg>',
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
    clearInterval(S.timer);
    app.textContent = "";
    kids.forEach(function (k) { if (k) app.appendChild(k); });
    window.scrollTo(0, 0);
  }

  // Color.fiammoAvatarTint: FNV-1a over the uppercase uuid string, so a
  // person has the same colour here as in the app.
  var TINTS = [["#F4D9CE", "#8A4A2E"], ["#F6E4C6", "#8A6520"], ["#E3E7CE", "#5E6B3A"], ["#CFE3DB", "#3C6559"],
               ["#D4E0EC", "#3F5F7D"], ["#DCD9EE", "#554F80"], ["#EFD5E1", "#8A4566"]];
  function tint(id) {
    if (typeof BigInt === "undefined" || !id) return TINTS[0];
    var hash = BigInt("0xcbf29ce484222325"), prime = BigInt("0x100000001b3"), mask = (BigInt(1) << BigInt(64)) - BigInt(1);
    var s = String(id).toUpperCase();
    for (var i = 0; i < s.length; i++) { hash ^= BigInt(s.charCodeAt(i)); hash = (hash * prime) & mask; }
    return TINTS[Number(hash % BigInt(TINTS.length))];
  }
  function avatar(author, size) {
    // A shared link's author comes with the colour already picked, so their
    // id never has to reach the page.
    var t = author.tint != null && TINTS[author.tint] ? TINTS[author.tint] : tint(author.id);
    var el = h("div", { class: "avatar", style: "width:" + size + "px;height:" + size + "px;font-size:" + Math.round(size * .42) + "px;background:" + t[0] + ";color:" + t[1] });
    var letter = (author.first_name || "?").trim().charAt(0).toUpperCase();
    if (author.avatar_url && /^https:\/\//.test(author.avatar_url)) {
      var img = h("img", { src: author.avatar_url, alt: "", referrerpolicy: "no-referrer" });
      img.onerror = function () { el.textContent = letter; };
      el.appendChild(img);
    } else el.textContent = letter;
    return el;
  }
  function name(author) { return author.first_name || "Your friend"; }

  function ago(iso) {
    var m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    if (m < 1) return "now";
    if (m < 60) return m + "m";
    if (m < 60 * 24) return Math.floor(m / 60) + "h";
    return Math.floor(m / 1440) + "d";
  }
  function burnsIn(iso) {
    var ms = Date.parse(iso) - Date.now();
    if (!(ms > 0)) return null;
    var m = Math.ceil(ms / 60000);
    return m >= 60 ? "Burns in " + Math.floor(m / 60) + "h" : "Burns in " + m + "m";
  }
  // "Jun 3", with the year once it isn't this one.
  function day(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    var o = { month: "short", day: "numeric" };
    if (d.getFullYear() !== new Date().getFullYear()) o.year = "numeric";
    return d.toLocaleDateString("en-US", o);
  }
  // A link made after the burn runs for days, so its end is told by its
  // date until the last day, and counted down from there.
  function endsOn(iso) {
    var ms = Date.parse(iso) - Date.now();
    if (!(ms > 0)) return null;
    var m = Math.ceil(ms / 60000);
    if (m >= 60 * 24) return "The link ends " + day(iso) + ".";
    return "The link ends in " + (m >= 60 ? Math.floor(m / 60) + "h." : m + "m.");
  }

  // ---------------------------------------------------------------- load
  function load() {
    if (SHARE ? !/^[a-z2-7]{26}$/.test(TOKEN)
              : (!/^[a-z2-9]{8}$/.test(CODE) || !/^[a-zA-Z2-9]{10}$/.test(TOKEN))) return notFound();
    api("open").then(function (r) {
      if (r.status === 404) return notFound();
      if (r.status === 429 && SHARE) return failed("This link has been opened a lot in the last few minutes. Try again in a minute.");
      if (r.status !== 200) return failed();
      S.data = r.body;
      if (r.body.state === "post") return renderPost();
      if (r.body.state === "locked") return renderLocked();
      if (r.body.state === "burned") return renderBurned(r.body.author, r.body.newer, r.body.after_burn === true);
      failed();
    });
  }

  // ---------------------------------------------------------------- post
  function renderPost() {
    var d = S.data, p = d.post, a = d.author;

    // A post shared after it burned: the day it was written rather than how
    // long ago, "Burned" where the burn would be counted down, and under
    // the post a line saying so and when the link ends. The byline has no
    // room for a second date beside the first.
    var after = p.after_burn === true;
    var burn = h("span", { class: "burn", text: after ? "Burned" : (burnsIn(p.expires_at) || "") });
    var note = after ? h("p", { class: "fine" }) : null;
    // What is left, drawn where it is counted. False once nothing is.
    function left() {
      var t = after ? endsOn(p.expires_at) : burnsIn(p.expires_at);
      if (!t) return false;
      if (after) note.textContent = "This post has burned on fiammo. " + name(a) + " shared it with you by link. " + t;
      else burn.textContent = t;
      return true;
    }
    left();
    var who = h("span", { class: "who" }, ["@" + (a.handle || name(a).toLowerCase()) + (a.founding_number != null ? " #" + a.founding_number : "")]);
    var byline = h("div", { class: "byline" }, [avatar(a, 36), who, h("span", { class: "meta", text: "· " + (after ? day(p.created_at) : ago(p.created_at)) }), burn]);

    var paras = String(p.content || "").split(/\n{2,}/).filter(function (t) { return t.trim(); });
    // A voice post's content is its transcript (108), not writing, so it does
    // not get the writing's face or the writing's place on the page: it folds
    // under the recording it transcribes, in the sans, the way the app shows
    // one. Anything actually written keeps the serif.
    var body = p.audio
      ? transcript(paras)
      : h("div", { class: "text" }, paras.map(function (t) { return h("p", { text: t.trim() }); }));
    var photos = p.images && p.images.length
      ? h("div", { class: "photos" }, p.images.map(function (u) { return h("img", { src: u, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }); }))
      : null;

    S.el = { burn: burn };

    screen([
      top(),
      byline,
      p.prompt_text ? h("p", { class: "prompt" }, ["Answering ", h("b", { text: p.prompt_text })]) : null,
      player(p.audio),
      body, photos,
      // A post's video stays in the app: it is served only to someone signed
      // in who can see the post (migration 200).
      p.has_video ? h("p", { class: "fine", text: "This post has a video, which plays in the app." }) : null,
      note,
      h("div", { class: "hair" }),
      moreList(d.more, a),
      h("div", { id: "inviteslot" }),
    ]);
    // Nothing is answered here now, and the invite used to wait for an answer.
    // Without that, waiting means never showing it at all.
    showInvite();

    // The post burns in place, the same moment it burns in the app, and a
    // link made after the burn ends in place.
    S.timer = setInterval(function () {
      if (!left()) renderBurned(a, null, after);
    }, 15000);
  }

  // ------------------------------------------------------------- voice
  // A voice post keeps its transcript in content (108), so this page always
  // rendered one as if it had been typed. The audio itself was never sent
  // until now. The player sits above the transcript rather than replacing it:
  // a texted post gets read in places audio is not welcome, which is the
  // reason the transcript exists at all.
  function player(audio) {
    if (!audio || !audio.url) return null;

    var el = h("audio", { src: audio.url, preload: "none" });
    var icon = h("span", { class: "pp", html: ICON.play });
    var time = h("span", { class: "t", text: clock(audio.duration_seconds) });
    var bar = h("div", { class: "bar" }, [h("i", {})]);
    var fill = bar.firstChild;
    var btn = h("button", { class: "voice", type: "button", "aria-label": "Play the voice post" }, [icon, bar, time]);

    function paint() {
      var d = el.duration || audio.duration_seconds || 0;
      fill.style.width = d ? Math.min(100, (el.currentTime / d) * 100) + "%" : "0%";
      time.textContent = clock(el.currentTime ? d - el.currentTime : d);
    }
    btn.addEventListener("click", function () {
      if (el.paused) { el.play().catch(function () { time.textContent = "can't play"; }); }
      else el.pause();
    });
    el.addEventListener("play",  function () { icon.innerHTML = ICON.pause; btn.setAttribute("aria-label", "Pause the voice post"); });
    el.addEventListener("pause", function () { icon.innerHTML = ICON.play;  btn.setAttribute("aria-label", "Play the voice post"); });
    el.addEventListener("timeupdate", paint);
    el.addEventListener("loadedmetadata", paint);
    el.addEventListener("ended", function () { el.currentTime = 0; paint(); });

    // Labelled, because a bare player next to a block of text leaves the two
    // looking unrelated: the recording is the post, and the transcript under
    // it is that recording written out.
    return h("div", { class: "voicewrap" }, [
      h("div", { class: "vlabel", text: "Voice post" }),
      btn, el,
    ]);
  }

  // ------------------------------------------------------------- more
  // The other posts this author texted to this number, still live. Not a
  // profile: the server only returns posts that were sent to this person, and
  // only to a browser that has proved the number, so this is a receipt of what
  // they were already given rather than a window onto everything the author
  // writes. Empty for everyone else, which is most people.
  function moreList(more, a) {
    if (!more || !more.length) return null;
    return h("section", { class: "more" }, [
      h("h3", { text: "Also sent to you" }),
      h("div", { class: "morerows" }, more.map(function (m) {
        var meta = [];
        if (m.author) meta.push(m.author);
        meta.push(ago(m.created_at));
        if (m.voice) meta.push("Voice post");
        else if (m.photos === 1) meta.push("1 photo");
        else if (m.photos > 1) meta.push(m.photos + " photos");
        return h("a", { class: "morerow", href: m.url }, [
          h("span", { class: "mbody" }, [
            h("span", { class: "mtext", text: m.excerpt || "Untitled" }),
            h("span", { class: "mmeta", text: meta.join(" \u00b7 ") }),
          ]),
          h("span", { class: "mchev", html: ICON.chevr }),
        ]);
      })),
    ]);
  }

  function transcript(paras) {
    if (!paras.length) return null;
    var id = "transcript";
    var body = h("div", { class: "transcript", id: id, hidden: true },
      paras.map(function (t) { return h("p", { text: t.trim() }); }));
    var label = h("span", { text: "Transcript" });
    var btn = h("button", {
      class: "tt", type: "button", "aria-expanded": "false", "aria-controls": id,
    }, [label, h("span", { class: "chev", html: ICON.chev })]);
    btn.addEventListener("click", function () {
      var opening = body.hidden;
      body.hidden = !opening;
      btn.setAttribute("aria-expanded", String(opening));
      label.textContent = opening ? "Hide transcript" : "Transcript";
    });
    return h("div", { class: "twrap" }, [btn, body]);
  }

  function clock(s) {
    if (!s && s !== 0) return "";
    var n = Math.max(0, Math.round(s));
    return Math.floor(n / 60) + ":" + String(n % 60).padStart(2, "0");
  }

  function showInvite() {
    if (S.invited) return;
    S.invited = true;
    if (SHARE) return document.getElementById("inviteslot").appendChild(shareCard(name(S.data.author), false));
    var n = name(S.data.author);
    // A day's text can name several people, and the card then belongs to all
    // of them rather than to whichever post happened to be opened. "Your
    // friends" rather than a list, because the list is already on the page
    // above and three names here would not fit the line.
    var several = (S.data.more || []).some(function (m) { return m.author_id && m.author_id !== S.data.author.id; });
    var who = several ? "Your friends" : n;
    var verb = several ? "write" : "writes";
    document.getElementById("inviteslot").appendChild(h("section", { class: "card" }, [
      // True only for a one-off texted post. Someone who opted in to a
      // circle gets every post by text, and telling them otherwise right
      // after they confirmed reads as a bait and switch.
      h("h2", { text: S.data.reader.one_off
        ? who + " " + verb + " here most days. Tomorrow's won't come by text."
        : who + " " + verb + " here most days. The app has all of it, not just the link." }),
      h("div", { class: "perk", html: ICON.person + "<span></span>" }),
      h("div", { class: "perk", html: ICON.flame + "<span>Posts burn after a day. Nothing to scroll back through.</span>" }),
      CAN_GET_APP ? h("a", { class: "primary", href: APP_STORE, text: "Get fiammo" }) : null,
      h("p", { class: "fine", style: "text-align:center", text: CAN_GET_APP ? "Free on iPhone" : "fiammo is on iPhone for now." }),
    ]));
    var perk = document.querySelector("#inviteslot .perk span");
    perk.textContent = several
      ? "Sign up with " + S.data.reader.masked + " and their friend requests are waiting for you."
      : "Sign up with " + S.data.reader.masked + " and " + n + "'s friend request is waiting for you.";
  }

  // The way to the app under a shared post, and under one that burned. It
  // promises only what is true for someone holding a link: no number was
  // given, so no friend request is waiting, and the invite counts only when
  // the link is opened again in the app.
  function shareCard(n, burned) {
    var perks = [];
    if (INVITE && SHARE_OPENS_APP) perks.push([ICON.person, "Once you have fiammo, open this link again to add " + n + "."]);
    perks.push([ICON.flame, "Posts burn after a day. Nothing to scroll back through."]);
    var card = h("section", { class: "card" }, [
      h("h2", { text: burned ? "Catch the next one" : n + " writes here most days. This is one post." }),
      burned ? h("p", { text: n + " writes here most days. With fiammo you'll see it while it's still up." }) : null,
    ].concat(perks.map(function (k) {
      return h("div", { class: "perk", html: k[0] + "<span></span>" });
    })).concat([
      CAN_GET_APP ? h("a", { class: "primary", href: APP_STORE, text: "Get fiammo" }) : null,
      h("p", { class: "fine", style: "text-align:center", text: CAN_GET_APP ? "Free on iPhone" : "fiammo is on iPhone for now." }),
    ]));
    // Text goes in as text, never through innerHTML: it carries a name.
    var spans = card.querySelectorAll(".perk span");
    perks.forEach(function (k, i) { spans[i].textContent = k[1]; });
    return card;
  }

  // ---------------------------------------------------------------- codes
  // The code goes to the number the link was sent to; nobody types a number
  // here. Only a claimed link opened somewhere else needs one now that this
  // page has nothing to answer with.
  function codeCard(o) {
    var digits = "";
    var boxes = h("div", { class: "code" });
    var input = h("input", { type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "6", "aria-label": "Six digit code", pattern: "[0-9]*" });
    var status = h("div", {});
    var resend = h("button", { class: "link", type: "button", text: "Send a new code", onclick: function () { send(); } });
    var sendBtn = o.autoSend ? null : h("button", { class: "primary", type: "button", text: "Text me the code", onclick: function () { send(); } });
    var entry = h("div", { class: "answer", hidden: !o.autoSend }, [boxes, h("p", { class: "fine" }, [o.foot ? o.foot + " " : "", resend])]);

    function draw() {
      boxes.textContent = "";
      for (var i = 0; i < 6; i++) boxes.appendChild(h("span", { class: i === digits.length ? "at" : "", text: digits[i] || "" }));
      boxes.appendChild(input);
    }
    function fail(t) { status.textContent = ""; status.appendChild(h("p", { class: "error", role: "alert", text: t })); }
    function send() {
      status.textContent = ""; resend.disabled = true; if (sendBtn) sendBtn.disabled = true;
      api("send_code").then(function (r) {
        resend.disabled = false; if (sendBtn) sendBtn.disabled = false;
        if (r.status === 200 && r.body.known) return o.onVerified();
        if (r.status === 200) {
          if (sendBtn) sendBtn.hidden = true;
          entry.hidden = false; draw(); input.focus({ preventScroll: true });
          return;
        }
        if (r.status === 410) return renderBurned(S.data.author, null);
        if (r.status === 429) return fail("Too many codes for now. Try again in 10 minutes.");
        if (r.status === 503) return fail("Texting codes isn't switched on yet. You can still read, and answering opens soon.");
        fail("The code didn't send. Check your connection and try again.");
      });
    }
    input.addEventListener("input", function () {
      digits = input.value.replace(/\D/g, "").slice(0, 6);
      input.value = digits;
      draw(); input.focus({ preventScroll: true });
      if (digits.length < 6) return;
      input.disabled = true;
      api("verify_code", { otp: digits }).then(function (r) {
        input.disabled = false;
        if (r.status === 200) return o.onVerified();
        digits = ""; input.value = ""; draw(); input.focus({ preventScroll: true });
        if (r.status === 410 && r.body.error === "burned") return renderBurned(S.data.author, null);
        if (r.body.error === "wrong_code") return fail(r.body.attempts_left === 1 ? "That's not it. One more try." : "That's not it. Check the text and try again.");
        fail("That code expired. Send a new one.");
      });
    });

    draw();
    if (o.autoSend) send();
    return h("section", { class: "card" }, [
      h("h2", { text: o.title }), h("p", { text: o.body }),
      sendBtn, entry, status,
    ]);
  }

  // ---------------------------------------------------------------- other states
  function renderLocked() {
    var a = S.data.author, n = name(a);
    screen([
      top(),
      h("div", { class: "hello" }, [
        avatar(a, 52),
        h("h1", { text: "This link was opened on another phone" }),
        h("p", { text: n + " sent it to one person. If that's you, we'll text a code to the number " + n + " sent it to, " + S.data.masked + "." }),
      ]),
      codeCard({ title: "Is this your link?", body: "The code only goes to that number.", foot: "", autoSend: false, onVerified: load }),
      h("p", { class: "fine", text: "Not you? Ask " + n + " to send it to you directly." }),
    ]);
  }

  // `after`: the link was made after the post burned, so what is over is
  // the link's few days, not the post's one.
  function renderBurned(a, newer, after) {
    var n = name(a);
    screen([
      top(),
      h("div", { class: "hello" }, [
        avatar(a, 52),
        h("h1", { text: after ? "This link has ended" : "This one burned" }),
        h("p", { text: after
          ? n + " shared a post that had already burned, for a few days. That time is up."
          : n + "'s post was up for a day, and now it's gone. Not saved anywhere, including here." }),
      ]),
      h("div", { class: "ash", "aria-hidden": "true" }, [h("i", { style: "width:34%" }), h("i", { style: "width:94%" }), h("i", { style: "width:80%" }), h("i", { style: "width:46%" })]),
      SHARE ? shareCard(n, true)
      : newer && /^\/p\/[a-z2-9]{8}\/[a-zA-Z2-9]{10}$/.test(newer)
        ? h("section", { class: "card" }, [
            h("div", { class: "perk", html: ICON.flame + "<span></span>" }),
            h("a", { class: "primary", href: newer, text: "Read it" }),
          ])
        : h("section", { class: "card" }, [
            h("h2", { text: "Catch the next one" }),
            h("p", { text: n + " writes here most days. With fiammo you'll see it while it's still up." }),
            h("a", { class: "primary", href: APP_STORE, text: "Get fiammo" }),
          ]),
    ]);
    var perk = app.querySelector(".card .perk span");
    if (perk && !SHARE) perk.textContent = n + " sent you something newer.";
  }

  function notFound() {
    screen([
      top(),
      h("div", { class: "hello" }, [
        h("h1", { text: "This link doesn't open anything" }),
        h("p", { text: "It may have been copied wrong. Posts on fiammo burn after a day, so the one it pointed to may be gone." }),
      ]),
      h("a", { class: "primary", href: APP_STORE, text: "Get fiammo" }),
    ]);
  }

  function failed(why) {
    screen([
      top(),
      h("div", { class: "hello" }, [
        h("h1", { text: "This didn't load" }),
        h("p", { text: why || "Check your connection and try again." }),
      ]),
      h("button", { class: "primary", type: "button", text: "Try again", onclick: function () { location.reload(); } }),
    ]);
  }

  function uuid4() {
    var b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var x = Array.prototype.map.call(b, function (v) { return (v + 256).toString(16).slice(1); }).join("");
    return x.slice(0, 8) + "-" + x.slice(8, 12) + "-" + x.slice(12, 16) + "-" + x.slice(16, 20) + "-" + x.slice(20);
  }

  load();
})();
