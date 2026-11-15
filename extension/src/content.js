// eyeRead content script.
// Phase 1 (always on, no camera): finds the article, splits it into paragraphs, and
// spreads the time the reader spends on each screenful over the words that are on screen.
// Phase 2 (opt-in): webcam gaze arrives from the offscreen document; after a quick
// calibration it is mapped to article lines with the same line HMM the web app uses.
import { buildReport, articleKey } from "./report.js";
import { GazeModel, validate } from "../../src/lib/gaze/gazeModel";
import { LineHmm } from "../../src/lib/gaze/lineHmm";
import { OneEuroFilter } from "../../src/lib/gaze/oneEuro";

(() => {
  if (window.top !== window || window.__readAssist) return;
  window.__readAssist = true;

  const TICK_MS = 250;
  const IDLE_MS = 60_000; // no scroll / mouse / key for this long → not reading
  const SAVE_MS = 5_000;
  const MIN_ARTICLE_WORDS = 250;
  const MAX_ARTICLES = 200;

  const BLOCK_SEL = "p, h1, h2, h3, h4, li, blockquote, pre";
  const EXCLUDE_SEL =
    "nav, aside, footer, header:not(article header), form, figure, figcaption, button, [role=navigation], [role=complementary], [role=banner], [role=contentinfo], [aria-hidden=true], .ad, .ads, [class*=newsletter], [class*=related], [class*=comment], [class*=share], [class*=promo], [data-testid*=ad]";

  const wordsOf = (s) => (s.match(/\S+/g) || []).length;
  const clean = (s) => s.replace(/\s+/g, " ").trim();
  const now = () => performance.now();

  // ---------------------------------------------------------------- article detection
  function blockOk(el) {
    if (el.closest(EXCLUDE_SEL)) return false;
    if (el.closest("#read-assist-root")) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 120 || r.height < 8) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") return false;
    return true;
  }

  /** Readability-style: paragraphs vote for their parent (and half for grandparent). */
  function findRoot() {
    const scores = new Map();
    const contained = new Map(); // words of good paragraphs anywhere inside each element
    for (const p of document.querySelectorAll("p")) {
      const text = clean(p.textContent || "");
      const n = wordsOf(text);
      if (n < 12 || !blockOk(p)) continue;
      const linkChars = [...p.querySelectorAll("a")].reduce((a, l) => a + (l.textContent || "").length, 0);
      if (linkChars > text.length * 0.5) continue;
      const add = (el, s) => el && el !== document.documentElement && scores.set(el, (scores.get(el) || 0) + s);
      add(p.parentElement, n);
      add(p.parentElement?.parentElement, n / 2);
      add(p.parentElement?.parentElement?.parentElement, n / 4);
      for (let a = p.parentElement; a && a !== document.documentElement; a = a.parentElement) contained.set(a, (contained.get(a) || 0) + n);
    }
    let best = null, bestScore = 0;
    for (const [el, s] of scores) if (s > bestScore) { best = el; bestScore = s; }
    if (!best) return null;
    // Articles split into <section>s / chunks: climb to the ancestor holding all of them,
    // as long as that ancestor is still mostly article text (not the whole page).
    for (let a = best.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const c = contained.get(a) || 0;
      if (c < (contained.get(best) || 0) * 1.25) continue;
      if (c < wordsOf(a.innerText || "") * 0.4) break;
      best = a;
    }
    // Prefer an enclosing <article>/articleBody if it doesn't drag in much more text.
    const art = best.closest("article, [itemprop=articleBody]");
    if (art && art !== best && (art.textContent || "").length < (best.textContent || "").length * 2.5) best = art;
    return best;
  }

  function collectBlocks(root) {
    const out = [];
    for (const el of root.querySelectorAll(BLOCK_SEL)) {
      // Innermost blocks only (an <li> holding a <p> counts once, as the <p>).
      if (el.querySelector(BLOCK_SEL)) continue;
      const text = clean(el.innerText || el.textContent || "");
      if (!text) continue;
      const heading = /^H[1-4]$/.test(el.tagName);
      const n = wordsOf(text);
      if (!heading && n < 5) continue;
      if (heading && n > 30) continue;
      if (!blockOk(el)) continue;
      if (!heading) {
        const linkChars = [...el.querySelectorAll("a")].reduce((a, l) => a + (l.textContent || "").length, 0);
        if (linkChars > text.length * 0.6) continue;
      }
      out.push({ el, text, words: n, heading });
    }
    return out;
  }

  // ---------------------------------------------------------------- state
  let key = articleKey(location.href);
  let paras = []; // { el, text, words, heading, dwell: Float32Array, k, id }
  let paraSeq = 0; // stable id per paragraph object (array indexes shift when the page inserts blocks)
  let byEl = new WeakMap();
  let rec = { activeSec: 0, eyeSec: 0, firstSeen: Date.now(), lastSeen: Date.now() };
  let saved = null; // stored paragraphs (for restoring dwell on a revisit)
  let tracking = false;
  let dirty = false;
  let lastInput = now();
  let lastTick = now();
  let lastSave = 0;
  let overlayOn = false;

  const textKey = (t) => t.slice(0, 60);

  async function loadSaved() {
    const got = await chrome.storage.local.get(key);
    saved = got[key] || null;
    if (saved) {
      rec.activeSec = saved.activeSec || 0;
      rec.eyeSec = saved.eyeSec || 0;
      rec.firstSeen = saved.firstSeen || Date.now();
    }
  }

  function rescan() {
    const root = findRoot();
    if (!root) return;
    const blocks = collectBlocks(root);
    const total = blocks.filter((b) => !b.heading).reduce((a, b) => a + b.words, 0);
    if (total < MIN_ARTICLE_WORDS) return;
    const savedByKey = new Map((saved?.paras || []).map((p) => [p.k, p]));
    const next = blocks.map((b) => {
      const old = byEl.get(b.el);
      if (old && old.words === b.words) return old;
      const dwell = new Float32Array(b.words);
      const src = old || savedByKey.get(textKey(b.text));
      if (src) {
        const d = src.dwell;
        // Word count changed a little (e.g. live edit): stretch the old dwell over the new words.
        for (let i = 0; i < b.words; i++) dwell[i] = d[Math.min(d.length - 1, Math.floor((i * d.length) / b.words))] || 0;
      }
      const p = { ...b, dwell, k: textKey(b.text), id: ++paraSeq };
      byEl.set(b.el, p);
      return p;
    });
    const changed = next.length !== paras.length || next.some((p, i) => p !== paras[i]);
    paras = next;
    if (changed) {
      tracking = true;
      linesDirty = true;
      if (overlayOn) paintOverlay();
    }
  }

  function snapshot() {
    return {
      url: location.origin + location.pathname,
      title: document.title.replace(/\s+[|–-]\s+[^|–-]+$/, "").trim() || document.title,
      site: location.hostname.replace(/^www\./, ""),
      activeSec: rec.activeSec,
      eyeSec: rec.eyeSec,
      firstSeen: rec.firstSeen,
      lastSeen: Date.now(),
      paras: paras.map((p) => ({
        k: p.k,
        text: p.text.slice(0, 200),
        words: p.words,
        heading: p.heading,
        dwell: Array.from(p.dwell, (v) => Math.round(v * 100) / 100),
      })),
    };
  }

  async function save() {
    if (!tracking || !dirty) return;
    dirty = false;
    lastSave = now();
    const snap = snapshot();
    if (snap.activeSec < 3) return; // don't clutter history with pages you only glanced at
    saved = snap;
    try {
      await chrome.storage.local.set({ [key]: snap });
      // Prune old history.
      const all = await chrome.storage.local.get(null);
      const arts = Object.entries(all).filter(([k]) => k.startsWith("art:"));
      if (arts.length > MAX_ARTICLES) {
        arts.sort((a, b) => (a[1].lastSeen || 0) - (b[1].lastSeen || 0));
        await chrome.storage.local.remove(arts.slice(0, arts.length - MAX_ARTICLES).map(([k]) => k));
      }
    } catch {
      // Extension was reloaded/removed while this page stayed open.
    }
  }

  // ---------------------------------------------------------------- activity
  for (const ev of ["scroll", "wheel", "mousemove", "keydown", "pointerdown", "touchstart"]) {
    window.addEventListener(ev, () => (lastInput = now()), { passive: true, capture: true });
  }
  const isActive = () => document.visibilityState === "visible" && document.hasFocus() && now() - lastInput < IDLE_MS;

  // ---------------------------------------------------------------- Phase 1: scroll + time
  function tick() {
    const t = now();
    const dt = Math.min(1, (t - lastTick) / 1000);
    lastTick = t;
    if (!tracking || !paras.length || eye.running) return;
    if (!isActive()) return;

    const vh = window.innerHeight;
    let visibleWords = 0, textHeight = 0, totalWords = 0;
    const vis = [];
    for (const p of paras) {
      if (p.heading) continue;
      const r = p.el.getBoundingClientRect();
      if (r.height <= 0) continue;
      textHeight += r.height;
      totalWords += p.words;
      const a = Math.max(r.top, 0), b = Math.min(r.bottom, vh);
      if (b <= a) continue;
      const i0 = Math.max(0, Math.floor(((a - r.top) / r.height) * p.words));
      const i1 = Math.min(p.words, Math.ceil(((b - r.top) / r.height) * p.words));
      if (i1 > i0) {
        vis.push([p, i0, i1]);
        visibleWords += i1 - i0;
      }
    }
    if (!visibleWords) return;
    // If only a sliver of text is on screen (photo, comments, ads…), don't pretend all
    // the time went into that sliver: divide by at least half a screenful of words.
    const screenful = textHeight > 0 ? (totalWords / textHeight) * vh : visibleWords;
    const perWord = dt / Math.max(visibleWords, 0.5 * screenful);
    for (const [p, i0, i1] of vis) for (let i = i0; i < i1; i++) p.dwell[i] += perWord;
    rec.activeSec += dt;
    dirty = true;
  }

  // ---------------------------------------------------------------- coverage overlay
  const STYLE_ID = "read-assist-style";
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = `
      [data-ra-status]{transition:box-shadow .2s, background-color .6s}
      [data-ra-status=read]{box-shadow:-6px 0 0 #16a34a}
      [data-ra-status=skimmed]{box-shadow:-6px 0 0 #eab308}
      [data-ra-status=skipped]{box-shadow:-6px 0 0 #dc2626}
      .ra-flash{background-color:rgba(250,204,21,.35)!important}`;
    document.documentElement.appendChild(s);
  }
  function paintOverlay() {
    ensureStyle();
    const rep = buildReport(snapshot());
    rep.paragraphs.forEach((r, i) => {
      if (!r.heading && paras[i]) paras[i].el.dataset.raStatus = r.status;
    });
  }
  function clearOverlay() {
    for (const p of paras) delete p.el.dataset.raStatus;
  }

  // ---------------------------------------------------------------- messages
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {
      case "ra:report":
        sendResponse(
          tracking && paras.length
            ? { ok: true, report: buildReport(snapshot()), live: true, eye: eye.running, overlay: overlayOn, calibrating: eye.calibrating }
            : { ok: false, reason: "no-article" },
        );
        return;
      case "ra:scrollTo": {
        const p = paras[msg.index];
        if (p) {
          ensureStyle();
          p.el.scrollIntoView({ behavior: "smooth", block: "center" });
          p.el.classList.add("ra-flash");
          setTimeout(() => p.el.classList.remove("ra-flash"), 1800);
        }
        sendResponse({ ok: !!p });
        return;
      }
      case "ra:overlay":
        overlayOn = !!msg.on;
        if (overlayOn) paintOverlay();
        else clearOverlay();
        sendResponse({ ok: true });
        return;
      case "ra:reset":
        for (const p of paras) p.dwell.fill(0);
        rec.activeSec = 0;
        rec.eyeSec = 0;
        rec.firstSeen = Date.now();
        dirty = true;
        chrome.storage.local.remove(key);
        if (overlayOn) paintOverlay();
        sendResponse({ ok: true });
        return;
      case "ra:eyeBegin":
        if (!tracking) sendResponse({ ok: false, reason: "no-article" });
        else {
          eyeBegin();
          sendResponse({ ok: true });
        }
        return;
      case "ra:eyeStop":
        eyeStop();
        sendResponse({ ok: true });
        return;
      case "eye:frame":
        onEyeFrame(msg.frame);
        return;
      case "eye:status":
        onEyeStatus(msg);
        return;
    }
  });

  // =================================================================== Phase 2: eye tracking
  const eye = {
    running: false, // camera on and calibrated, crediting gaze
    calibrating: false,
    model: null,
    hmm: null,
    sigmaY: 40,
    lineH: 24,
    fx: new OneEuroFilter(0.6, 0.004),
    fy: new OneEuroFilter(0.6, 0.004),
    qx: new OneEuroFilter(2.5, 0.01),
    lastT: null,
    lastFaceAt: 0,
    hist: [], // fast-filtered gaze x for return-sweep detection
    lastSweep: -10,
    frameSink: null, // calibration listener
    ui: null,
  };
  let linesDirty = true;
  let lastLinesAt = 0;
  // Lines in VIEWPORT coordinates (the gaze model predicts viewport points). They are rebuilt
  // after any scroll (the window's or an inner scroll area's) and every LINES_MAX_AGE_MS, so
  // they follow the text when the page scrolls or shifts (ads/images loading above, etc.).
  let lineCache = []; // { key, top, bottom, left, right, para, first, last }
  const LINES_MAX_AGE_MS = 250;

  function medianLineHeight() {
    const hs = [];
    for (const p of paras.slice(0, 40)) {
      if (p.heading) continue;
      const lh = parseFloat(getComputedStyle(p.el).lineHeight);
      if (lh > 0) hs.push(lh);
      else hs.push(parseFloat(getComputedStyle(p.el).fontSize) * 1.4 || 24);
    }
    hs.sort((a, b) => a - b);
    return hs.length ? hs[hs.length >> 1] : 24;
  }

  /**
   * Text lines (viewport coordinates) that are on screen right now. Off-screen lines are left
   * out on purpose: you can't be reading them, and keeping them let the model hold on to the
   * top of the article after you'd scrolled past it.
   */
  function buildLines() {
    const vh = window.innerHeight, vw = window.innerWidth;
    const out = [];
    paras.forEach((p) => {
      if (p.heading) return;
      const r = p.el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= vh) return;
      const range = document.createRange();
      range.selectNodeContents(p.el);
      const rects = [...range.getClientRects()].filter((q) => q.width > 2 && q.height > 4);
      const rows = [];
      for (const q of rects) {
        const row = rows.find((w) => Math.abs((w.top + w.bottom) / 2 - (q.top + q.bottom) / 2) < q.height * 0.5);
        if (row) {
          row.left = Math.min(row.left, q.left);
          row.right = Math.max(row.right, q.right);
          row.top = Math.min(row.top, q.top);
          row.bottom = Math.max(row.bottom, q.bottom);
        } else rows.push({ top: q.top, bottom: q.bottom, left: q.left, right: q.right });
      }
      rows.sort((a, b) => a.top - b.top);
      const totalW = rows.reduce((a, w) => a + (w.right - w.left), 0) || 1;
      let acc = 0;
      rows.forEach((w, li) => {
        const first = Math.floor((acc / totalW) * p.words);
        acc += w.right - w.left;
        const last = Math.max(first, Math.ceil((acc / totalW) * p.words) - 1);
        // Only lines at least half visible (and not scrolled sideways out of view).
        const visH = Math.min(w.bottom, vh) - Math.max(w.top, 0);
        if (visH < (w.bottom - w.top) * 0.5 || w.right <= 0 || w.left >= vw) return;
        out.push({
          key: p.id + ":" + li,
          top: w.top,
          bottom: w.bottom,
          left: w.left,
          right: w.right,
          para: p,
          first,
          last: Math.min(p.words - 1, last),
        });
      });
    });
    return out;
  }

  function refreshLines() {
    const fresh = buildLines();
    const hmm = eye.hmm;
    const oldP = new Map(lineCache.map((l, i) => [l.key, hmm.p[i] || 0]));
    const off = hmm.lines.length ? hmm.p[hmm.lines.length] : 0.05;
    lineCache = fresh;
    hmm.lines = fresh.map((l, i) => ({
      index: i, page: 0, top: l.top, bottom: l.bottom, left: l.left, right: l.right,
      firstWord: l.first, lastWord: l.last, paragraph: l.para.id,
    }));
    const p = new Float64Array(fresh.length + 1);
    let carried = 0;
    const fresh0 = [];
    fresh.forEach((l, i) => {
      if (oldP.has(l.key)) {
        p[i] = oldP.get(l.key);
        carried += p[i];
      } else fresh0.push(i);
    });
    if (carried < 1e-6) p.fill(1); // nothing to carry over: spread evenly
    else if (fresh0.length) {
      // Lines that just scrolled into view start with a fair share, so the gaze can claim
      // them right away instead of the model waiting for a rare "jump" to reach them.
      const share = (carried + off) / fresh.length;
      for (const i of fresh0) p[i] = share;
    }
    p[fresh.length] = Math.max(off, 0.02);
    const s = p.reduce((a, b) => a + b, 0) || 1;
    for (let i = 0; i < p.length; i++) p[i] /= s;
    hmm.p = p;
    linesDirty = false;
    lastLinesAt = now();
  }
  // capture: scroll events from inner scroll areas don't bubble, but they do pass the window
  // in the capture phase. Many news sites scroll a container, not the window.
  window.addEventListener("scroll", () => (linesDirty = true), { passive: true, capture: true });
  window.addEventListener("resize", () => (linesDirty = true), { passive: true });

  function onEyeFrame(f) {
    if (eye.frameSink) eye.frameSink(f);
    if (f.face) eye.lastFaceAt = f.t;
    if (!eye.running || !eye.model) return;
    const dt = eye.lastT === null ? 1 / 30 : Math.min(0.2, Math.max(0.001, f.t - eye.lastT));
    eye.lastT = f.t;
    if (document.visibilityState !== "visible") return;
    if (linesDirty || now() - lastLinesAt > LINES_MAX_AGE_MS) refreshLines();
    const hmm = eye.hmm;
    if (!hmm.lines.length) return;

    let obs = null, sweep = false;
    if (f.features) {
      const g = eye.model.predict(f.features);
      obs = { x: eye.fx.filter(g.x, f.t), y: eye.fy.filter(g.y, f.t) };
      // Return sweep: a fast leftward jump of ≥40% of the column within ~0.35 s.
      const qx = eye.qx.filter(g.x, f.t);
      eye.hist.push({ t: f.t, x: qx });
      while (eye.hist.length && eye.hist[0].t < f.t - 0.35) eye.hist.shift();
      const colW = Math.max(200, Math.max(...lineCache.map((l) => l.right - l.left)));
      const maxX = Math.max(...eye.hist.map((h) => h.x));
      if (maxX - qx > colW * 0.4 && f.t - eye.lastSweep > 0.6) {
        sweep = true;
        eye.lastSweep = f.t;
        eye.hist = [];
      }
    }
    hmm.predict(dt, sweep);
    hmm.observe(obs, !f.face, dt);
    if (obs) {
      // Slowly learn a vertical offset from confident moments (corrects calibration drift).
      const b = hmm.best();
      if (b.index >= 0 && b.prob >= 0.6) {
        const cap = Math.max(eye.lineH * 3, hmm.sigmaY * 1.5);
        hmm.learnBias(hmm.offsetFor(obs.y, b.index), dt, -cap, cap);
      }
    }

    rec.eyeSec += dt;
    rec.activeSec += dt;
    dirty = true;
    if (!f.face) return;
    // Credit this moment to the lines the reader is probably on, spread over their words.
    for (let i = 0; i < lineCache.length; i++) {
      const pr = hmm.p[i];
      if (pr < 0.02) continue;
      const l = lineCache[i];
      const p = l.para;
      if (!byEl.has(p.el) || byEl.get(p.el) !== p) continue; // paragraph was replaced by a rescan
      const n = l.last - l.first + 1;
      const add = (pr * dt) / n;
      for (let w = l.first; w <= l.last; w++) p.dwell[w] += add;
    }
  }

  // ----- UI (shadow DOM so the page's CSS can't touch it)
  function ui() {
    if (eye.ui) return eye.ui;
    const host = document.createElement("div");
    host.id = "read-assist-root";
    host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host{all:initial}
        *{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
        .veil{position:fixed;inset:0;background:rgba(250,250,249,.97);pointer-events:auto;display:none;color:#1c1917}
        .card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:440px;padding:24px;background:#fff;border:1px solid #e7e5e4;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.08);font-size:15px;line-height:1.5}
        h2{margin:0 0 8px;font-size:18px}
        p{margin:0 0 14px;color:#44403c}
        button{font:inherit;font-size:14px;border-radius:8px;border:1px solid #d6d3d1;background:#fff;padding:8px 14px;cursor:pointer;margin-right:8px}
        button.primary{background:#1c1917;color:#fff;border-color:#1c1917}
        .dot{position:absolute;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;background:#2563eb;border:4px solid #bfdbfe;cursor:pointer;display:none}
        .dot.auto{background:#7c3aed;border-color:#ddd6fe;cursor:default}
        .dot.busy{transform:scale(.6);transition:transform .8s}
        .face{position:absolute;left:50%;bottom:24px;transform:translateX(-50%);font-size:13px;color:#b91c1c;display:none}
        .pill{position:fixed;right:16px;bottom:16px;pointer-events:auto;display:none;align-items:center;gap:8px;background:#1c1917;color:#fff;border-radius:999px;padding:6px 6px 6px 12px;font-size:13px;box-shadow:0 4px 14px rgba(0,0,0,.2)}
        .pill .rec{width:8px;height:8px;border-radius:50%;background:#ef4444}
        .pill button{margin:0;padding:4px 10px;border-radius:999px;font-size:12px}
      </style>
      <div class="veil"><div class="card"></div><div class="dot"></div><div class="face">Can't see your face — look at the screen</div></div>
      <div class="pill"><span class="rec"></span><span class="ptext">Eye tracking</span><button class="stop">Stop</button></div>`;
    document.documentElement.appendChild(host);
    const $ = (s) => root.querySelector(s);
    eye.ui = { host, veil: $(".veil"), card: $(".card"), dot: $(".dot"), face: $(".face"), pill: $(".pill"), ptext: $(".ptext") };
    $(".stop").addEventListener("click", () => eyeStop());
    return eye.ui;
  }

  function showCard(html, buttons) {
    const u = ui();
    u.veil.style.display = "block";
    u.card.style.display = "block";
    u.card.innerHTML = html;
    const row = document.createElement("div");
    for (const [label, fn, primary] of buttons) {
      const b = document.createElement("button");
      b.textContent = label;
      if (primary) b.className = "primary";
      b.addEventListener("click", fn);
      row.appendChild(b);
    }
    u.card.appendChild(row);
  }
  const hideVeil = () => eye.ui && (eye.ui.veil.style.display = "none");

  function eyeBegin() {
    if (eye.calibrating) return;
    eye.calibrating = true;
    showCard("<h2>Starting camera…</h2><p>Loading the face model on this computer. Video never leaves your device.</p>", [
      ["Cancel", () => eyeStop()],
    ]);
    chrome.runtime.sendMessage({ type: "eye:start" }).catch(() => {});
  }

  function onEyeStatus(msg) {
    if (msg.status === "started") {
      if (eye.calibrating) calibrate();
    } else if (msg.status === "need-permission") {
      showCard(
        "<h2>Allow the camera</h2><p>A eyeRead tab just opened to ask for camera access (Chrome can't ask from a background page). Allow it there, then come back and press Try again.</p>",
        [["Try again", () => { eye.calibrating = false; eyeBegin(); }, true], ["Cancel", () => eyeStop()]],
      );
    } else if (msg.status === "error") {
      showCard(`<h2>Eye tracking couldn't start</h2><p>${String(msg.error || "Unknown error").replace(/[<>&]/g, "")}</p>`, [
        ["Close", () => eyeStop(), true],
      ]);
    } else if (msg.status === "stopped") {
      stopLocal();
    }
  }

  const CAL_POINTS = [[50, 50], [6, 8], [50, 8], [94, 8], [94, 50], [94, 92], [50, 92], [6, 92], [6, 50], [28, 29], [72, 29], [72, 71], [28, 71]];
  const VAL_POINTS = [[50, 40], [24, 26], [76, 26], [76, 74], [24, 74]];

  function collect(point, at, delay, dur, into) {
    return new Promise((resolve) => {
      let start = null;
      const before = into.length;
      eye.frameSink = (f) => {
        start ??= f.t;
        if (f.features && f.t >= start + delay && f.t <= start + delay + dur) into.push({ features: f.features, x: at.x, y: at.y, point });
      };
      setTimeout(() => {
        eye.frameSink = null;
        resolve(into.length - before);
      }, (delay + dur) * 1000 + 80);
    });
  }

  async function calibrate() {
    const u = ui();
    eye.lineH = medianLineHeight();
    const faceTimer = setInterval(() => {
      u.face.style.display = eye.calibrating && performance.now() / 1000 - eye.lastFaceAt > 1.5 && eye.lastFaceAt ? "block" : "none";
    }, 300);
    await new Promise((res) =>
      showCard(
        "<h2>Quick calibration (about 30 s)</h2><p>Sit like you normally read. Look at each blue dot and click it while looking at it. Then five purple dots appear by themselves — just look at them.</p>",
        [["Begin", res, true], ["Cancel", () => { eyeStop(); res(); }]],
      ),
    );
    if (!eye.calibrating) return clearInterval(faceTimer);
    u.card.style.display = "none";
    const W = window.innerWidth, H = window.innerHeight;
    const pos = ([px, py]) => ({ x: (px / 100) * W, y: (py / 100) * H });
    const cal = [], val = [];
    for (let i = 0; i < CAL_POINTS.length && eye.calibrating; ) {
      const at = pos(CAL_POINTS[i]);
      u.dot.className = "dot";
      u.dot.style.cssText = `display:block;left:${at.x}px;top:${at.y}px`;
      await new Promise((res) => u.dot.addEventListener("click", res, { once: true }));
      u.dot.classList.add("busy");
      const got = await collect(i, at, 0.12, 0.85, cal);
      if (got >= 6) i++;
    }
    for (let i = 0; i < VAL_POINTS.length && eye.calibrating; i++) {
      const at = pos(VAL_POINTS[i]);
      u.dot.className = "dot auto";
      u.dot.style.cssText = `display:block;left:${at.x}px;top:${at.y}px`;
      await collect(100 + i, at, 0.65, 0.95, val);
    }
    u.dot.style.display = "none";
    clearInterval(faceTimer);
    u.face.style.display = "none";
    if (!eye.calibrating) return;
    try {
      const m = GazeModel.fit(cal);
      const v = validate(m, val, eye.lineH);
      eye.model = GazeModel.fit([...cal, ...val], m.lambda);
      eye.sigmaY = Math.min(eye.lineH * 5, Math.max(eye.lineH * 0.7, v.meanAbsDyPx * 1.3));
      const lines = (v.meanAbsDyPx / eye.lineH).toFixed(1);
      showCard(
        `<h2>Calibration: ${v.quality}</h2><p>Typical vertical error ≈ ${lines} lines (${Math.round(v.meanErrorPx)} px overall). ${
          v.quality === "poor" ? "Tracking will be rough — better light on your face or a steadier head helps." : "Good enough to tell which paragraph you're on."
        }</p>`,
        [["Start reading", () => startRunning(), true], ["Recalibrate", () => { hideVeil(); calibrate(); }], ["Cancel", () => eyeStop()]],
      );
    } catch (e) {
      showCard(`<h2>Calibration failed</h2><p>${String(e.message).replace(/[<>&]/g, "")}. Make sure your face is lit and visible.</p>`, [
        ["Try again", () => calibrate(), true],
        ["Cancel", () => eyeStop()],
      ]);
    }
  }

  function startRunning() {
    hideVeil();
    eye.calibrating = false;
    eye.running = true;
    eye.hmm = new LineHmm(eye.sigmaY, Math.max(60, eye.sigmaY));
    eye.hmm.setLines([], "spread");
    lineCache = [];
    linesDirty = true;
    eye.lastT = null;
    eye.fx.reset();
    eye.fy.reset();
    eye.qx.reset();
    const u = ui();
    u.pill.style.display = "flex";
  }

  function stopLocal() {
    eye.running = false;
    eye.calibrating = false;
    eye.frameSink = null;
    if (eye.ui) {
      eye.ui.veil.style.display = "none";
      eye.ui.pill.style.display = "none";
    }
  }

  function eyeStop() {
    stopLocal();
    chrome.runtime.sendMessage({ type: "eye:stop" }).catch(() => {});
    dirty = true;
    save();
  }

  // ---------------------------------------------------------------- eyeRead account bridge
  // The eyeRead home page (a student's dashboard) says hello with window.postMessage.
  // If the student has allowed that site, we hand it the articles measured elsewhere; the
  // page uploads them to the account with its own sign-in. The extension never logs in.
  // Any page could send this hello, so nothing is shared until the student clicks Allow in a
  // box the page can't reach into (closed shadow root, trusted clicks only).
  const APPS_KEY = "ra:apps"; // { [origin]: true } sites allowed to receive your reading history
  const SYNC_KEY = "ra:synced"; // { [origin|account]: { [articleKey]: lastSeen already handed over } }
  const APP_SRC = "read-assist-app", EXT_SRC = "read-assist-ext";
  let consent = null; // Promise<boolean> while/after asking on this page load
  const pendingSync = new Map(); // id → { account, sent: { [articleKey]: lastSeen } }
  const toPage = (msg) => window.postMessage({ source: EXT_SRC, ...msg }, location.origin);

  function askToConnect() {
    return new Promise((resolve) => {
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;inset:0;z-index:2147483647";
      const root = host.attachShadow({ mode: "closed" });
      const site = location.host.replace(/[<>&"]/g, "");
      root.innerHTML = `
        <style>
          *{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
          .veil{position:fixed;inset:0;background:rgba(28,25,23,.35);display:flex;align-items:center;justify-content:center;padding:16px}
          .card{max-width:420px;background:#fff;color:#1c1917;border-radius:14px;padding:22px;box-shadow:0 10px 30px rgba(0,0,0,.2);font-size:15px;line-height:1.5}
          h2{margin:0 0 8px;font-size:17px} p{margin:0 0 14px;color:#44403c}
          button{font:inherit;font-size:14px;border-radius:8px;border:1px solid #d6d3d1;background:#fff;padding:8px 14px;cursor:pointer;margin-right:8px}
          button.primary{background:#1c1917;color:#fff;border-color:#1c1917}
        </style>
        <div class="veil" role="dialog" aria-modal="true" aria-labelledby="t"><div class="card">
          <h2 id="t">Add your web reading to eyeRead?</h2>
          <p><b>${site}</b> is asking for the articles the eyeRead extension measured on other sites: each article's title, link, how much you read and a short snippet of each paragraph. They'll appear under "Your own readings" in your account.</p>
          <button class="primary" data-a="1">Allow</button><button data-a="0">Not now</button>
        </div></div>`;
      const done = (ok) => {
        host.remove();
        resolve(ok);
      };
      root.addEventListener("click", (e) => {
        const b = e.target.closest?.("button");
        if (b && e.isTrusted) done(b.dataset.a === "1");
      });
      document.documentElement.appendChild(host);
      root.querySelector("button.primary").focus();
    });
  }

  async function articlesToSync(account) {
    const all = await chrome.storage.local.get(null);
    const synced = (all[SYNC_KEY] || {})[location.origin + "|" + account] || {};
    const out = [], sent = {};
    for (const [k, rec] of Object.entries(all)) {
      if (!k.startsWith("art:") || !rec?.paras) continue;
      if (rec.url?.startsWith(location.origin)) continue; // pages of eyeRead itself
      if ((synced[k] || 0) >= (rec.lastSeen || 0)) continue; // already handed over, unchanged
      const rep = buildReport(rec);
      out.push({
        url: rec.url, title: rep.title, site: rep.site, firstSeen: rec.firstSeen, lastSeen: rec.lastSeen,
        coveragePct: rep.coveragePct, activeSec: rec.activeSec || 0, eyeSec: rec.eyeSec || 0,
        paragraphs: rep.paragraphs.map((p) => ({ heading: p.heading, status: p.status, words: p.words, text: p.text.slice(0, 100) })),
      });
      sent[k] = rec.lastSeen || 0;
    }
    return { out, sent };
  }

  window.addEventListener("message", async (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.source !== APP_SRC) return;
    const account = typeof d.account === "string" ? d.account.slice(0, 100) : "";
    if (!account) return;
    try {
      const apps = (await chrome.storage.local.get(APPS_KEY))[APPS_KEY] || {};
      if (d.type === "hello") {
        if (!apps[location.origin]) {
          if (!consent) {
            toPage({ type: "status", state: "asking" });
            consent = askToConnect();
          }
          if (!(await consent)) return toPage({ type: "status", state: "declined" });
          const now = (await chrome.storage.local.get(APPS_KEY))[APPS_KEY] || {};
          if (!now[location.origin]) await chrome.storage.local.set({ [APPS_KEY]: { ...now, [location.origin]: true } });
        }
        const { out, sent } = await articlesToSync(account);
        const id = Math.random().toString(36).slice(2);
        pendingSync.set(id, { account, sent });
        toPage({ type: "articles", id, articles: out });
      } else if (d.type === "imported" && apps[location.origin] && pendingSync.get(d.id)?.account === account) {
        // The page saved them to the account: don't send these versions again.
        const { sent } = pendingSync.get(d.id);
        pendingSync.delete(d.id);
        const all = (await chrome.storage.local.get(SYNC_KEY))[SYNC_KEY] || {};
        const slot = location.origin + "|" + account;
        all[slot] = { ...(all[slot] || {}), ...sent };
        await chrome.storage.local.set({ [SYNC_KEY]: all });
      }
    } catch {
      toPage({ type: "status", state: "error" }); // e.g. the extension was reloaded under this page
    }
  });

  // ---------------------------------------------------------------- lifecycle
  let scanTimer = 0;
  const mo = new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(rescan, 1500);
  });

  async function startForUrl() {
    key = articleKey(location.href);
    paras = [];
    byEl = new WeakMap();
    tracking = false;
    rec = { activeSec: 0, eyeSec: 0, firstSeen: Date.now(), lastSeen: Date.now() };
    await loadSaved();
    rescan();
  }

  // Single-page sites change URL without reloading.
  let lastHref = location.href;
  setInterval(() => {
    if (articleKey(location.href) !== articleKey(lastHref)) {
      dirty = true;
      save();
      if (eye.running || eye.calibrating) eyeStop();
      lastHref = location.href;
      startForUrl();
    }
  }, 1000);

  setInterval(() => {
    tick();
    if (dirty && now() - lastSave > SAVE_MS) save();
    if (overlayOn && dirty && Math.random() < 0.1) paintOverlay();
  }, TICK_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") save();
    lastTick = now();
  });
  window.addEventListener("pagehide", () => {
    save();
    if (eye.running || eye.calibrating) chrome.runtime.sendMessage({ type: "eye:stop" }).catch(() => {});
  });

  startForUrl().then(() => {
    mo.observe(document.body, { childList: true, subtree: true });
  });
})();
