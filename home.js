/* fiammo — homepage motion.
 *
 * Every mockup on this page performs the thing it is describing rather than
 * captioning it: the gate really blurs, the composer really types, the circles
 * really hold different people. Three rules keep that from turning into noise:
 *
 *   Nothing animates off screen. Each piece is driven by an IntersectionObserver
 *   and stops when it scrolls away, so the page is not running five loops at
 *   once for a reader who is looking at one of them.
 *
 *   Reduced motion gets the finished frame. Not a slower animation and not an
 *   empty box: the state the animation would have ended on.
 *
 *   The copy is the same copy the app ships. "You and 3 others echoed" is the
 *   app's own string (PostCardView), not a marketing version of it.
 */
(function () {
  "use strict";

  var still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Only hide things that this file is going to bring back. Without the flag,
  // a failed or blocked script leaves every section at opacity zero.
  document.documentElement.classList.add("js");

  /** Runs `start` when the element is in view and `stop` when it leaves. */
  function whenVisible(el, start, stop) {
    if (!el) return;
    if (!("IntersectionObserver" in window)) { start(); return; }
    var running = false;
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && !running) { running = true; start(); }
        else if (!e.isIntersecting && running) { running = false; if (stop) stop(); }
      });
    }, { threshold: 0.35 }).observe(el);
  }

  /* ---------- sections rise as they arrive ---------- */

  var panels = document.querySelectorAll(".reveal");
  if (still || !("IntersectionObserver" in window)) {
    panels.forEach(function (p) { p.classList.add("in"); });
  } else {
    var rise = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); rise.unobserve(e.target); }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -60px" });
    panels.forEach(function (p) { rise.observe(p); });
  }

  /** Types `text` into `el` one character at a time. Returns a cancel function. */
  function typeInto(el, text, speed, done) {
    var i = 0, timer;
    el.textContent = "";
    (function step() {
      el.textContent = text.slice(0, ++i);
      if (i < text.length) timer = setTimeout(step, speed);
      else if (done) timer = setTimeout(done, 700);
    })();
    return function () { clearTimeout(timer); };
  }

  /* ---------- write to read ---------- */

  (function () {
    var btn = document.getElementById("write-btn");
    var gate = document.getElementById("gate-prompt");
    var copy = document.getElementById("gate-copy");
    var typed = document.getElementById("gate-typed");
    var screen = document.getElementById("gate-screen");
    if (!btn || !gate || !screen) return;

    var posts = screen.querySelectorAll(".post");
    var line = "Rain all morning. I stayed in and let it.";
    var original = copy.textContent;
    var cancel = null, resetTimer = null, busy = false;

    function unlock() {
      posts.forEach(function (p, i) {
        setTimeout(function () {
          p.classList.remove("locked");
          p.classList.add("unlocked");
        }, i * 260);
      });
      copy.textContent = "You wrote today.";
      gate.classList.remove("writing");
      gate.classList.add("sent");
      resetTimer = setTimeout(reset, 4600);
    }

    function reset() {
      posts.forEach(function (p) { p.classList.add("locked"); p.classList.remove("unlocked"); });
      gate.classList.remove("sent", "writing");
      copy.textContent = original;
      typed.textContent = "";
      busy = false;
    }

    function run() {
      if (busy) return;
      busy = true;
      gate.classList.add("writing");
      if (still) { typed.textContent = line; unlock(); return; }
      cancel = typeInto(typed, line, 38, unlock);
    }

    btn.addEventListener("click", run);

    // Plays itself once on arrival, so a reader who never clicks still sees the
    // gate open. Clicking replays it.
    whenVisible(screen, function () { setTimeout(run, 900); }, function () {
      if (cancel) cancel();
      clearTimeout(resetTimer);
      reset();
    });
  })();

  /* ---------- the daily prompt composer ---------- */

  (function () {
    var el = document.getElementById("reply-typed");
    var row = document.getElementById("answered-row");
    if (!el) return;

    var line = "Longer than I'd admit. Usually until I've rewritten my side of it into something I'd have been proud of.";
    var cancel = null, loop = null;

    function play() {
      if (still) { el.textContent = line; if (row) row.classList.add("in"); return; }
      cancel = typeInto(el, line, 34, function () {
        if (row) row.classList.add("in");
        // The row stays put once it has arrived. Clearing it every loop made
        // the screen read as empty for the length of the next sentence.
        loop = setTimeout(play, 3400);
      });
    }

    whenVisible(el.closest(".screen"), play, function () {
      if (cancel) cancel();
      clearTimeout(loop);
      el.textContent = "";
    });
  })();

  /* ---------- circles ---------- */

  (function () {
    var art = document.getElementById("circles-art");
    var name = document.getElementById("circle-name");
    var note = document.getElementById("circle-note");
    if (!art) return;

    var rings = Array.prototype.slice.call(art.querySelectorAll(".ring"));
    var at = 0, timer = null;

    function show(i) {
      rings.forEach(function (r, n) { r.classList.toggle("active", n === i); });
      var r = rings[i];
      name.textContent = r.dataset.circle;
      note.textContent = r.dataset.note;
    }

    show(0);
    if (still) return;

    whenVisible(art, function () {
      timer = setInterval(function () { at = (at + 1) % rings.length; show(at); }, 3200);
    }, function () { clearInterval(timer); });
  })();

  /* ---------- echoes ---------- */

  (function () {
    var post = document.getElementById("echo-post");
    var count = document.getElementById("echo-count");
    if (!post) return;

    // The app's own label, in the app's own order: your echo first, then the
    // number of other people who echoed the same line.
    var others = 3;
    var loop = null;

    function label(n) {
      if (n === 0) return "You echoed";
      return "You and " + n + " " + (n === 1 ? "other" : "others") + " echoed";
    }

    function play() {
      post.classList.add("echo-on");
      if (still) { count.textContent = label(others); post.classList.add("chip-in"); return; }
      var n = 0;
      count.textContent = label(0);
      post.classList.add("chip-in");
      (function tick() {
        loop = setTimeout(function () {
          n += 1;
          count.textContent = label(n);
          post.classList.add("bump");
          setTimeout(function () { post.classList.remove("bump"); }, 220);
          if (n < others) tick();
        }, 900);
      })();
    }

    whenVisible(post, play, function () {
      clearTimeout(loop);
      post.classList.remove("echo-on", "chip-in", "bump");
      count.textContent = label(others);
    });
  })();
})();
