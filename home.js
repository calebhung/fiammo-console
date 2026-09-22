/* fiammo — the homepage loop.
 *
 * One post, one cycle: today's prompt, the answer typed, three friends let in
 * (and their posts sliding up behind yours), a line echoed, the echo becoming
 * a conversation just between you two, then the post burning word by word
 * from the end while the conversation stays. The quote at the top of the
 * thread turns into "Replied to your post" as it goes, which is what the app
 * shows once the post it quoted is gone.
 *
 * Every value is a function of one clock, so any frame can be drawn on its
 * own: the loop pauses off screen and picks up where it was, and reduced
 * motion draws the single frame after the reply instead of the animation.
 */
(function () {
  "use strict";

  var root = document.getElementById("stage");
  if (!root) return;

  var LOOP = 19000;
  var TYPE_AT = 900, CPS = 36;
  var POSTED = 5100, FRIENDS = 5500, ECHO = 7300, CHIP = 8300;
  var THREAD = 9000, REPLY_IN = 9800, TYPING = 10500, MINE = 11400;
  var B0 = 12900, B1 = 15900, END = 18300;
  var STILL_AT = 12000;

  var $ = function (id) { return document.getElementById(id); };
  var pre = $("stage-pre"), hl = $("stage-hl"), caret = $("stage-caret");
  var status = $("stage-status"), readers = $("stage-readers"), chip = $("stage-chip");
  var gone = $("stage-gone"), thread = $("stage-thread"), quote = $("stage-quote");
  var m1 = $("stage-m1"), typingEl = $("stage-typing"), m2 = $("stage-m2");
  var head = root.querySelector(".card-head");
  var fades = root.querySelectorAll(".fades");
  var friends = root.querySelectorAll(".card-foot .avs .av");
  var peekBack = root.querySelector(".peek-back"), peekFront = root.querySelector(".peek-front");
  var bars = root.querySelectorAll(".rail-bars b");
  var labels = root.querySelectorAll(".rail-labels span");
  var dots = typingEl.querySelectorAll("span");

  var text = "Honestly, for days. I rehearse the better version in the shower like it's getting a second showing.";
  var parts = text.split(" ");
  var n = parts.length;
  var HL_FROM = 3;
  var quoteText = quote.textContent;

  // One span per word, so each can burn on its own.
  pre.textContent = "";
  hl.textContent = "";
  var words = parts.map(function (p, i) {
    var s = document.createElement("span");
    (i < HL_FROM ? pre : hl).appendChild(s);
    return s;
  });
  var shown = words.map(function () { return null; });

  var RAMP = ["#120B04", "#2a1a0e", "#4a2a12", "#6e3a14", "#8B5210", "#a65a24", "#C96F3B",
    "rgba(201,111,59,.7)", "rgba(201,111,59,.42)", "rgba(201,111,59,.18)", "rgba(201,111,59,0)"];
  var STEPS = [[0, POSTED], [POSTED, ECHO], [ECHO, THREAD], [THREAD, B0], [B0, B1]];

  function cl(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function ease(x) { x = cl(x); return 1 - Math.pow(1 - x, 3); }

  function draw(t) {
    var inAt = function (a, d) { return ease((t - a) / (d || 350)); };
    var burnP = cl((t - B0) / (B1 - B0));
    var endOut = 1 - cl((t - END) / 600);
    var fadeOut = 1 - cl((t - (B1 - 1000)) / 800);

    // Typing, then the burn from the last word back.
    var typed = Math.floor(cl((t - TYPE_AT) / (text.length * CPS)) * text.length);
    var off = 0;
    for (var i = 0; i < n; i++) {
      var p = parts[i];
      var vis = p.slice(0, Math.max(0, typed - off)) + (typed > off + p.length && i < n - 1 ? " " : "");
      off += p.length + 1;
      if (shown[i] !== vis) { words[i].textContent = vis; shown[i] = vis; }
      var q = cl((burnP * (n + 5) - (n - 1 - i)) / 5);
      var st = words[i].style;
      st.color = RAMP[Math.min(10, Math.floor(q * 10.99))];
      st.textShadow = q > .25 && q < .75 ? "0 0 14px rgba(242,140,70,.45)" : "";
      st.filter = q > .6 ? "blur(" + ((q - .6) * 5).toFixed(1) + "px)" : "";
    }
    var typing = t >= TYPE_AT && typed < text.length;
    caret.style.opacity = typing || (t > 500 && t < TYPE_AT) ? (Math.floor(t / 450) % 2 ? 1 : .15) : 0;

    var echoP = cl((t - ECHO) / 1100);
    var a = (.13 * (1 - cl(burnP * 4))).toFixed(3);
    hl.style.backgroundImage = "linear-gradient(rgba(201,111,59," + a + "),rgba(201,111,59," + a + "))";
    hl.style.backgroundSize = (echoP * 100).toFixed(1) + "% 100%";

    head.style.opacity = (inAt(0, 600) * fadeOut).toFixed(2);
    for (var f = 0; f < fades.length; f++) fades[f].style.opacity = fadeOut.toFixed(2);

    status.textContent = t >= B0 ? "Burning" : t >= POSTED ? "Burns in 24h" : "Writing";
    status.style.color = t >= POSTED ? "" : "var(--quiet)";

    for (var k = 0; k < friends.length; k++) {
      var o = inAt(FRIENDS + k * 280, 300);
      friends[k].style.opacity = o.toFixed(2);
      friends[k].style.transform = "translateY(" + ((1 - o) * 6).toFixed(1) + "px)";
    }
    readers.style.opacity = (inAt(6100, 400) * (1 - inAt(7900, 300))).toFixed(2);
    var c = inAt(CHIP, 350);
    chip.style.opacity = c.toFixed(2);
    chip.style.transform = "translateY(" + ((1 - c) * 6).toFixed(1) + "px)";

    // Friends' posts slide up behind yours once you've posted.
    var pk = inAt(POSTED + 200, 600) * endOut;
    peekBack.style.opacity = peekFront.style.opacity = pk.toFixed(2);
    peekBack.style.transform = "translateY(" + (-72 * pk).toFixed(1) + "px) rotate(3.2deg) scale(.94)";
    peekFront.style.transform = "translateY(" + (-40 * pk).toFixed(1) + "px) rotate(1.6deg) scale(.97)";

    gone.style.opacity = (inAt(B1 - 100, 700) * endOut).toFixed(2);

    var th = inAt(THREAD, 450);
    thread.style.opacity = (th * endOut).toFixed(2);
    thread.style.transform = "translateY(" + ((1 - th) * 14).toFixed(1) + "px)";
    var burned = t >= B1 - 200;
    if (burned !== quote.classList.contains("burned")) {
      quote.classList.toggle("burned", burned);
      quote.textContent = burned ? "Replied to your post" : quoteText;
    }
    quote.style.opacity = (inAt(9200, 400) * (burned ? inAt(B1 - 150, 300) : 1 - cl((t - (B1 - 500)) / 300))).toFixed(2);
    var r1 = inAt(REPLY_IN, 350);
    m1.style.opacity = r1.toFixed(2);
    m1.style.transform = "translateY(" + ((1 - r1) * 8).toFixed(1) + "px)";
    var dotsOn = t >= TYPING && t < MINE;
    typingEl.style.opacity = dotsOn ? 1 : 0;
    for (var d = 0; d < dots.length; d++) dots[d].style.opacity = (.35 + .65 * (.5 + .5 * Math.sin(t / 140 - d))).toFixed(2);
    var r2 = inAt(MINE, 350);
    m2.style.opacity = r2.toFixed(2);
    m2.style.transform = "translateY(" + ((1 - r2) * 8).toFixed(1) + "px)";

    for (var s = 0; s < STEPS.length; s++) {
      var from = STEPS[s][0], to = STEPS[s][1];
      var fill = t >= B1 ? 1 : cl((t - from) / (to - from));
      bars[s].style.width = (fill * 100).toFixed(1) + "%";
      labels[s].className = t >= from && t < to ? "on" : fill >= 1 ? "done" : "";
    }
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    draw(STILL_AT);
    return;
  }

  // Runs only while the loop is on screen, and resumes where it paused.
  var clock = 0, last = null, raf = null;
  function frame(now) {
    if (last !== null) clock = (clock + (now - last)) % LOOP;
    last = now;
    draw(clock);
    raf = requestAnimationFrame(frame);
  }
  function start() { if (raf === null) { last = null; raf = requestAnimationFrame(frame); } }
  function stop() { if (raf !== null) { cancelAnimationFrame(raf); raf = null; } }

  draw(0);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { e.isIntersecting ? start() : stop(); });
    }, { threshold: 0.2 }).observe(root);
  } else {
    start();
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop();
    else if (root.getBoundingClientRect().bottom > 0 && root.getBoundingClientRect().top < innerHeight) start();
  });
})();

/* The circle picker in "Everyone you chose". Circles add up, the way the
 * app's Sending to sheet does: close friends is the default, roommates and
 * home bring their people in, and just me clears the rest. Everyone past the
 * three friends with faces is counted in a +N rather than drawn as a letter.
 */
(function () {
  "use strict";

  var chips = document.getElementById("chips");
  if (!chips) return;
  var avs = document.getElementById("members-avs");
  var copy = document.getElementById("members-copy");
  var count = document.getElementById("members-count");

  var CIRCLES = {
    "close friends": ["Avery", "Taylor", "Daniel"],
    "roommates": ["Taylor", "Marcus", "Priya"],
    "home": ["Daniel", "Ruth", "Dani", "Nell"]
  };
  var FACES = { Avery: "avery", Taylor: "taylor", Daniel: "daniel" };
  var buttons = chips.querySelectorAll(".chip");
  var picked = ["close friends"];

  function face(name) {
    var img = document.createElement("img");
    img.className = "av";
    img.alt = "";
    img.src = "home-people/" + name + ".jpg";
    return img;
  }

  function render() {
    for (var i = 0; i < buttons.length; i++) {
      var on = picked.indexOf(buttons[i].getAttribute("data-circle")) !== -1;
      buttons[i].classList.toggle("on", on);
      buttons[i].setAttribute("aria-pressed", on ? "true" : "false");
    }

    avs.textContent = "";
    if (picked[0] === "just me") {
      avs.appendChild(face("casey"));
      copy.textContent = "Only you";
      count.textContent = "";
      return;
    }

    var people = [];
    picked.forEach(function (c) {
      CIRCLES[c].forEach(function (p) { if (people.indexOf(p) === -1) people.push(p); });
    });
    var withFaces = people.filter(function (p) { return FACES[p]; }).slice(0, 3);
    withFaces.forEach(function (p) { avs.appendChild(face(FACES[p])); });
    var rest = people.length - withFaces.length;
    if (rest > 0) {
      var more = document.createElement("span");
      more.className = "av-more";
      more.textContent = "+" + rest;
      avs.appendChild(more);
    }

    if (people.length <= 3) {
      copy.textContent = people.slice(0, -1).join(", ") + (people.length > 1 ? " and " : "") + people[people.length - 1];
    } else {
      copy.textContent = people.slice(0, 3).join(", ") + " and " + (people.length - 3) + " more";
    }
    count.textContent = people.length + (people.length === 1 ? " person" : " people");
  }

  chips.addEventListener("click", function (e) {
    var b = e.target.closest(".chip");
    if (!b) return;
    var c = b.getAttribute("data-circle");
    if (c === "just me") {
      picked = ["just me"];
    } else {
      picked = picked.filter(function (x) { return x !== "just me"; });
      var at = picked.indexOf(c);
      if (at === -1) picked.push(c); else picked.splice(at, 1);
      // Unpicking the last circle leaves the post with nobody, which the app
      // treats as a post just for you.
      if (!picked.length) picked = ["just me"];
    }
    render();
  });
})();
