import { buildReport, articleKey } from "./report.js";

const $ = (id) => document.getElementById(id);
const fmt = (s) => {
  s = Math.round(s || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0");
};
const ago = (t) => {
  const d = (Date.now() - t) / 1000;
  if (d < 90) return "just now";
  if (d < 3600) return Math.round(d / 60) + " min ago";
  if (d < 86400) return Math.round(d / 3600) + " h ago";
  return new Date(t).toLocaleDateString();
};

let tabId = null;
let state = { live: false, eye: false, overlay: false };

async function send(msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    return null;
  }
}

function render(rep) {
  $("empty").hidden = true;
  $("report").hidden = false;
  $("title").textContent = rep.title || rep.url;
  $("site").textContent = rep.site + " · " + rep.totalWords.toLocaleString() + " words · " + rep.paragraphCount + " paragraphs";
  $("coverage").textContent = Math.round(rep.coveragePct);
  $("time").textContent = fmt(rep.activeSec);
  $("expected").textContent = fmt(rep.expectedSec);
  $("eyeline").hidden = !rep.eyeSec;
  $("eyeline").textContent = rep.eyeSec ? `${fmt(rep.eyeSec)} eye-tracked` : "";
  const tw = Math.max(1, rep.totalWords);
  const [r, k, s] = $("bar").children;
  r.style.width = (rep.wordsRead / tw) * 100 + "%";
  k.style.width = (rep.wordsSkimmed / tw) * 100 + "%";
  s.style.width = (rep.wordsSkipped / tw) * 100 + "%";
  $("nread").textContent = rep.paragraphsRead;
  $("nskim").textContent = rep.paragraphsSkimmed;
  $("nskip").textContent = rep.paragraphsSkipped;

  const ul = $("skipped");
  ul.textContent = "";
  if (!rep.skippedSections.length) {
    const li = document.createElement("li");
    li.className = "none";
    li.textContent = rep.paragraphsRead + rep.paragraphsSkimmed ? "Nothing skipped so far." : "Nothing read yet — start scrolling.";
    ul.appendChild(li);
  }
  for (const sec of rep.skippedSections) {
    const li = document.createElement("li");
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent =
      (sec.paragraphs === 1 ? "1 paragraph" : sec.paragraphs + " paragraphs") +
      " · " + sec.words + " words" + (sec.section ? " · under “" + sec.section.slice(0, 50) + "”" : "");
    const snip = document.createElement("div");
    snip.className = "snip";
    snip.textContent = sec.snippet;
    li.append(meta, snip);
    if (state.live) li.addEventListener("click", () => send({ type: "ra:scrollTo", index: sec.from }));
    else li.style.cursor = "default";
    ul.appendChild(li);
  }

  $("eye").hidden = !state.live;
  $("overlay").hidden = !state.live;
  $("reset").hidden = !state.live;
  $("eye").textContent = state.eye ? "Stop eye tracking" : "Start eye-tracked reading";
  $("overlay").textContent = state.overlay ? "Hide on page" : "Show on page";
  $("mode").textContent = state.live
    ? state.eye
      ? "Eye tracking: time is credited to the lines your eyes are on."
      : "No-camera mode: time is spread over the text on screen while you're active on the page."
    : "Saved report (the page isn't open in this tab).";
}

function showEmpty(text) {
  $("report").hidden = true;
  $("empty").hidden = false;
  $("empty").textContent = text;
}

async function loadArticle() {
  // ?tab=<id> lets the popup be opened as a normal page for a given tab (used by tests).
  const forced = Number(new URLSearchParams(location.search).get("tab"));
  const [tab] = forced ? [await chrome.tabs.get(forced)] : await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  const res = tabId != null ? await send({ type: "ra:report" }) : null;
  if (res?.ok) {
    state = { live: true, eye: res.eye || res.calibrating, overlay: res.overlay };
    render(res.report);
    return;
  }
  // Fall back to a saved report for this URL (e.g. content script not injected yet).
  if (tab?.url) {
    const k = articleKey(tab.url);
    const got = await chrome.storage.local.get(k);
    if (got[k]) {
      state = { live: false, eye: false, overlay: false };
      render(buildReport(got[k]));
      return;
    }
  }
  showEmpty(
    res === null
      ? "eyeRead isn't running on this page. Reload the page (pages opened before the extension was loaded need a reload), or this page type isn't allowed (chrome:// pages, the Web Store)."
      : "No article found on this page. eyeRead tracks pages with at least ~250 words of body text.",
  );
}

async function loadHistory() {
  const all = await chrome.storage.local.get(null);
  const items = Object.values(all)
    .filter((v) => v && v.paras)
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  const ul = $("hist");
  ul.textContent = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No articles yet.";
    ul.appendChild(li);
  }
  for (const it of items) {
    const rep = buildReport(it);
    const li = document.createElement("li");
    li.innerHTML = `<div class="row"><span class="t"></span><span class="pct"></span></div><div class="meta"></div>`;
    li.querySelector(".t").textContent = rep.title || rep.url;
    li.querySelector(".pct").textContent = Math.round(rep.coveragePct) + "%";
    li.querySelector(".meta").textContent = `${rep.site} · ${fmt(rep.activeSec)} of ${fmt(rep.expectedSec)} · ${rep.paragraphsSkipped} skipped ¶ · ${ago(rep.lastSeen)}`;
    li.title = rep.url;
    li.addEventListener("click", () => chrome.tabs.create({ url: rep.url }));
    ul.appendChild(li);
  }
}

for (const b of document.querySelectorAll(".tab")) {
  b.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === b));
    $("article").hidden = b.dataset.view !== "article";
    $("history").hidden = b.dataset.view !== "history";
    if (b.dataset.view === "history") loadHistory();
  });
}

$("eye").addEventListener("click", async () => {
  if (state.eye) {
    await send({ type: "ra:eyeStop" });
    state.eye = false;
    loadArticle();
  } else {
    await send({ type: "ra:eyeBegin" });
    window.close(); // calibration happens on the page
  }
});
$("overlay").addEventListener("click", async () => {
  state.overlay = !state.overlay;
  await send({ type: "ra:overlay", on: state.overlay });
  loadArticle();
});
$("reset").addEventListener("click", async () => {
  await send({ type: "ra:reset" });
  loadArticle();
});
$("clear").addEventListener("click", async () => {
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith("art:")));
  loadHistory();
});

loadArticle();
setInterval(() => !$("article").hidden && state.live && loadArticle(), 2000);
