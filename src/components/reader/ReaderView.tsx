"use client";
// The distraction-free reader. Text is laid out in CSS columns where each column is
// one "page" (no scrolling). We measure where every line sits on screen so the
// tracker can match your gaze to lines.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { isHeading, splitWords } from "@/lib/text";
import type { FaceTracker } from "@/lib/gaze/faceTracker";
import type { WebEyeTrackSource } from "@/lib/gaze/webEyeTrackSource";
import type { LineBox } from "@/lib/gaze/lineHmm";
import { sigmaYFor } from "@/lib/gaze/gazeModel";
import { loadPace } from "@/lib/gaze/readingPace";
import { OneEuroFilter } from "@/lib/gaze/oneEuro";
import { joinDevGazeLog, roundFeatures, type DevGazeLog } from "@/lib/gaze/devLog";
import { ReadingTracker, type MarkerInfo, type ToastInfo, type TrackingMode } from "@/lib/gaze/readingTracker";
import type { ReadingState, ResumeState, SessionReport } from "@/lib/types";
import { useTheme, type ThemeChoice } from "@/components/ThemeToggle";
import { IconBug, IconChevronLeft, IconChevronRight, IconSettings, IconX } from "@/components/icons";
import { Calibration, type CalibrationResult } from "./Calibration";

export interface ReaderPrefs {
  font: "serif" | "sans" | "hyper";
  size: "s" | "m" | "l";
  aids: boolean;
  showGaze: boolean;
}
const DEFAULT_PREFS: ReaderPrefs = { font: "serif", size: "m", aids: true, showGaze: false };
const FONT_PX = { s: 18, m: 20, l: 23 };
export const FONT_VAR = { serif: "var(--font-reader-serif)", sans: "var(--font-ui)", hyper: "var(--font-reader-hyper)" };
// Generous spacing = lines farther apart = easier to tell apart by gaze. A webcam is only
// accurate to about a centimetre on screen, so every extra pixel between lines helps.
const LINE_HEIGHT = 2.5;
const COL_GAP = 120;
const TOP_BAR = 56;
const BOTTOM_BAR = 60;

export function loadPrefs(): ReaderPrefs {
  try {
    // The gaze debug view is a developer tool: it always starts hidden (toggle with G).
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem("ra-reader") ?? "{}"), showGaze: false };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function lineHeightFor(prefs: ReaderPrefs) {
  return FONT_PX[prefs.size] * LINE_HEIGHT;
}

/**
 * Where the reader puts its text column for a viewport, so other screens (the reading
 * calibration) can lay text out in exactly the same place, size and spacing.
 */
export function readerGeometry(vw: number, vh: number, prefs: Pick<ReaderPrefs, "size">) {
  const fontPx = FONT_PX[prefs.size];
  const lineH = fontPx * LINE_HEIGHT;
  const pageW = Math.max(280, Math.min(660, vw - 2 * 110));
  const pageLeft = Math.round((vw - pageW) / 2);
  const pageTop = TOP_BAR + 28;
  const pageH = Math.max(lineH * 4, Math.floor((vh - TOP_BAR - BOTTOM_BAR - 48) / lineH) * lineH);
  return { fontPx, lineH, pageW, pageLeft, pageTop, pageH, lineHeightRatio: LINE_HEIGHT };
}

interface Layout {
  lines: LineBox[];
  byPage: LineBox[][];
  pages: number;
}

export function ReaderView({
  title,
  paragraphs,
  tracker,
  wet,
  mode: initialMode,
  calibration: initialCalibration,
  initialPrefs,
  resume,
  onFinish,
  onPause,
  onRecalibrated,
  outOfFullscreen = false,
}: {
  title: string;
  paragraphs: string[];
  tracker: FaceTracker | null;
  /** WebEyeTrack source, when that engine is active (passed on to recalibration). */
  wet?: WebEyeTrackSource | null;
  mode: TrackingMode;
  calibration: CalibrationResult | null;
  initialPrefs: ReaderPrefs;
  /** Progress from a paused session to continue from (null = fresh session). */
  resume: ResumeState | null;
  onFinish: (report: SessionReport) => void;
  onPause: (report: SessionReport, state: ResumeState) => void;
  /** A new calibration was made mid-session (to save it to the account). */
  onRecalibrated?: (r: CalibrationResult) => void;
  /** Left full screen: reading is paused (counted like leaving the tab) until it's back. */
  outOfFullscreen?: boolean;
}) {
  const [prefs, setPrefs] = useState<ReaderPrefs>(initialPrefs);
  const [mode, setMode] = useState<TrackingMode>(initialMode);
  const [calibration, setCalibration] = useState<CalibrationResult | null>(initialCalibration);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [page, setPage] = useState(0);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [state, setState] = useState<ReadingState>("reading");
  const [marker, setMarker] = useState<MarkerInfo | null>(null);
  const [toast, setToast] = useState<ToastInfo | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  // The account's dyslexia font (Settings) replaces every reader font, so the picker would do nothing.
  const dyslexiaFont = useSyncExternalStore(noSubscribe, () => document.documentElement.dataset.font === "dyslexic", () => false);
  const [recalibrating, setRecalibrating] = useState(false);
  const [theme, setTheme] = useTheme();

  const innerRef = useRef<HTMLDivElement>(null);
  const trackerRef = useRef<ReadingTracker | null>(null);
  const pageRef = useRef(0);
  const firstWordOfPage = useRef(resume?.firstWord ?? 0);
  const gazeDotRef = useRef<HTMLDivElement>(null);
  const lineHiRef = useRef<HTMLDivElement>(null);
  const debugRef = useRef<HTMLDivElement>(null);
  // Development only: the tracker's internals, sent to data/gaze-debug.jsonl (see devGazeLog).
  const devLogRef = useRef<DevGazeLog | null>(null);
  const rawGazeRef = useRef<{ x: number; y: number } | null>(null);
  const featuresRef = useRef<number[] | null>(null);
  useEffect(() => {
    const { log, leave } = joinDevGazeLog();
    devLogRef.current = log;
    return () => {
      leave();
      devLogRef.current = null;
    };
  }, []);
  const showGazeRef = useRef(prefs.showGaze);
  const calibRef = useRef(calibration);
  const modeRef = useRef(mode);
  const recalibratingRef = useRef(false);

  // ----- words -----
  const { paraWords, offsets, totalWords, wordParagraph } = useMemo(() => {
    const paraWords = paragraphs.map(splitWords);
    const offsets: number[] = [];
    let n = 0;
    for (const w of paraWords) {
      offsets.push(n);
      n += w.length;
    }
    const wordParagraph = new Int32Array(n);
    paraWords.forEach((w, p) => wordParagraph.fill(p, offsets[p], offsets[p] + w.length));
    return { paraWords, offsets, totalWords: n, wordParagraph };
  }, [paragraphs]);

  // ----- geometry -----
  const { fontPx, lineH, pageW, pageLeft, pageTop, pageH } = readerGeometry(vp.w, vp.h, prefs);
  const stride = pageW + COL_GAP;

  useEffect(() => {
    const upd = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    upd();
    window.addEventListener("resize", upd);
    return () => window.removeEventListener("resize", upd);
  }, []);

  useEffect(() => {
    try {
      const { showGaze: _debugOnly, ...saved } = prefs; // never persist the debug view
      void _debugOnly;
      localStorage.setItem("ra-reader", JSON.stringify(saved));
    } catch {}
    showGazeRef.current = prefs.showGaze;
    trackerRef.current?.setAids(prefs.aids);
    if (!prefs.showGaze) {
      if (gazeDotRef.current) gazeDotRef.current.style.opacity = "0";
      if (lineHiRef.current) lineHiRef.current.style.opacity = "0";
    }
  }, [prefs]);

  // ----- measure every line after layout -----
  const measure = useCallback((): Layout | null => {
    const inner = innerRef.current;
    if (!inner || vp.w === 0) return null;
    const spans = inner.querySelectorAll<HTMLSpanElement>("[data-w]");
    const lines: LineBox[] = [];
    let cur: LineBox | null = null;
    const shift = pageRef.current * stride;
    spans.forEach((s) => {
      const w = Number(s.dataset.w);
      const r = s.getBoundingClientRect();
      const xAbs = r.left + shift - pageLeft;
      const pg = Math.max(0, Math.floor((xAbs + COL_GAP / 2) / stride));
      const left = r.left + shift - pg * stride;
      const right = r.right + shift - pg * stride;
      const cy = (r.top + r.bottom) / 2;
      const para = wordParagraph[w];
      if (cur && cur.page === pg && cur.paragraph === para && Math.abs((cur.top + cur.bottom) / 2 - cy) < lineH * 0.45) {
        cur.lastWord = w;
        cur.left = Math.min(cur.left, left);
        cur.right = Math.max(cur.right, right);
        cur.top = Math.min(cur.top, r.top);
        cur.bottom = Math.max(cur.bottom, r.bottom);
      } else {
        cur = { index: lines.length, page: pg, top: r.top, bottom: r.bottom, left, right, firstWord: w, lastWord: w, paragraph: para };
        lines.push(cur);
      }
    });
    const pages = lines.length ? lines[lines.length - 1].page + 1 : 1;
    const byPage: LineBox[][] = Array.from({ length: pages }, () => []);
    lines.forEach((l) => byPage[l.page].push(l));
    return { lines, byPage, pages };
  }, [vp.w, stride, pageLeft, wordParagraph, lineH]);

  // Re-measure when fonts load or size/font/viewport change, keeping your place.
  useLayoutEffect(() => {
    if (vp.w === 0) return;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      // Measure from page 0 to keep math simple, then jump back to the right page.
      const inner = innerRef.current;
      if (inner) {
        inner.style.transition = "none";
        inner.style.transform = "translateX(0px)";
        void inner.offsetWidth; // apply instantly (no animation) before measuring
      }
      pageRef.current = 0;
      const l = measure();
      if (!l) return;
      const keep = firstWordOfPage.current;
      const p = Math.max(0, l.lines.find((x) => x.lastWord >= keep)?.page ?? 0);
      setLayout(l);
      setPage(p);
      pageRef.current = p;
      if (inner) {
        inner.style.transform = `translateX(${-p * stride}px)`;
        void inner.offsetWidth;
        requestAnimationFrame(() => (inner.style.transition = "transform 160ms ease-out"));
      }
      trackerRef.current?.setPage(l.byPage[p] ?? [], p, performance.now() / 1000, "relayout");
    };
    document.fonts.ready.then(() => requestAnimationFrame(run));
    return () => {
      cancelled = true;
    };
  }, [measure, prefs.font, prefs.size, vp.w, vp.h, stride]);

  // ----- create the reading tracker once we have a layout -----
  useEffect(() => {
    if (!layout || trackerRef.current) return;
    const v = calibration?.validation;
    const sigmaY = v ? sigmaYFor(v, lineH) : lineH * 2;
    const rt = new ReadingTracker(
      {
        mode,
        totalWords,
        wordParagraph,
        paragraphWords: paraWords.map((w) => w.length),
        lineHeight: lineH,
        sigmaY,
        initialBiasY: 0,
        aids: prefs.aids,
        // Own pace from this session's reading calibration, else the last one measured here.
        secPerWord: calibration?.secPerWord ?? loadPace()?.secPerWord,
      },
      performance.now() / 1000,
    );
    rt.onState = setState;
    rt.onMarker = setMarker;
    rt.onToast = setToast;
    devLogRef.current?.push({ k: "start", at: new Date().toISOString(), viewport: { w: window.innerWidth, h: window.innerHeight }, lineH, sigmaY, mode, engine: calibration?.engine, validation: v, secPerWord: calibration?.secPerWord ?? loadPace()?.secPerWord ?? null });
    rt.onDebug = (d) => {
      const log = devLogRef.current;
      if (log && modeRef.current === "gaze") {
        const page = pageRef.current;
        if (page !== log.page) {
          log.page = page;
          const ls = layout.byPage[page] ?? [];
          log.push({ k: "page", page, lines: ls.map((l) => ({ i: l.index, top: Math.round(l.top), bottom: Math.round(l.bottom), left: Math.round(l.left), right: Math.round(l.right) })) });
        }
        const r1 = (p: { x: number; y: number } | null) => (p ? { x: Math.round(p.x), y: Math.round(p.y) } : null);
        log.push({
          k: "f", t: Math.round(performance.now()) / 1000, page, raw: r1(rawGazeRef.current), gaze: r1(d.gaze), seen: r1(d.seen), feat: roundFeatures(featuresRef.current),
          bias: Math.round(d.biasY), gain: Math.round(d.gain * 1000) / 1000, line: d.line ? d.line.index : null,
          p: Math.round(d.lineProb * 100) / 100, off: Math.round(d.offProb * 100) / 100, state: d.state, face: d.face,
        });
      }
      if (!showGazeRef.current) return;
      if (gazeDotRef.current && d.seen) {
        gazeDotRef.current.style.opacity = "1";
        // Draw the gaze the way the line model sees it: with the vertical offset ("bias" below)
        // AND the vertical stretch it has learned both undone. With only the offset undone, the
        // dot drifted from the highlighted line further down the page whenever the stretch
        // wasn't 1. The dot is still one moment of noisy gaze; the highlight weighs several
        // seconds of it plus reading order, and is usually the one on the right line.
        gazeDotRef.current.style.transform = `translate(${d.seen.x - 9}px, ${d.seen.y - 9}px)`;
      }
      if (lineHiRef.current) {
        if (d.line) {
          lineHiRef.current.style.opacity = String(Math.min(1, d.lineProb) * 0.9);
          lineHiRef.current.style.transform = `translate(${d.line.left - 8}px, ${d.line.top - 6}px)`;
          lineHiRef.current.style.width = `${d.line.right - d.line.left + 16}px`;
          lineHiRef.current.style.height = `${d.line.bottom - d.line.top + 12}px`;
        } else lineHiRef.current.style.opacity = "0";
      }
      if (debugRef.current) {
        debugRef.current.textContent =
          `state ${d.state} · line ${d.line ? d.line.index : "-"} (${Math.round(d.lineProb * 100)}%) · off ${Math.round(d.offProb * 100)}%` +
          ` · bias ${Math.round(d.biasY)}px · stretch ${d.gain.toFixed(2)} · sweeps/20s ${d.sweeps} · ${Math.round(d.fps)} fps${d.face ? "" : " · no face"}`;
      }
    };
    if (resume) rt.restore(resume, performance.now() / 1000);
    rt.setPage(layout.byPage[pageRef.current] ?? [], pageRef.current, performance.now() / 1000, "relayout");
    trackerRef.current = rt;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  useEffect(() => {
    calibRef.current = calibration;
    modeRef.current = mode;
  }, [calibration, mode]);

  // ----- feed camera frames → gaze → reading tracker -----
  useEffect(() => {
    const fx = new OneEuroFilter(0.6, 0.004), fy = new OneEuroFilter(0.6, 0.004);
    const qx = new OneEuroFilter(2.5, 0.01), qy = new OneEuroFilter(2.5, 0.01);
    if (!tracker || mode === "none") {
      // No camera: tick the tracker on a timer so page time is still measured.
      const id = setInterval(() => trackerRef.current?.onFrame(null, null, null, performance.now() / 1000), 100);
      return () => clearInterval(id);
    }
    return tracker.subscribe((f) => {
      const rt = trackerRef.current;
      if (!rt || recalibratingRef.current) return;
      let gaze = null, fast = null;
      const g = modeRef.current === "gaze" ? (calibRef.current?.estimator.predict(f) ?? null) : null;
      rawGazeRef.current = g;
      featuresRef.current = f.features;
      if (g) {
        gaze = { x: fx.filter(g.x, f.t), y: fy.filter(g.y, f.t) };
        fast = { x: qx.filter(g.x, f.t), y: qy.filter(g.y, f.t) };
      }
      rt.onFrame(f, gaze, fast, f.t, tracker.fps);
    });
  }, [tracker, mode]);

  useEffect(() => {
    recalibratingRef.current = recalibrating;
  }, [recalibrating]);

  // Tab switches count as distractions, and so does leaving full screen (reading pauses).
  const outOfFullscreenRef = useRef(outOfFullscreen);
  useEffect(() => {
    outOfFullscreenRef.current = outOfFullscreen;
    trackerRef.current?.onVisibility(document.hidden || outOfFullscreen, performance.now() / 1000);
  }, [outOfFullscreen]);
  useEffect(() => {
    const onVis = () => trackerRef.current?.onVisibility(document.hidden || outOfFullscreenRef.current, performance.now() / 1000);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // ----- paging -----
  const goTo = useCallback(
    (p: number, byKeyboard = false) => {
      if (!layout) return;
      const np = Math.max(0, Math.min(layout.pages - 1, p));
      if (np === pageRef.current) return;
      pageRef.current = np;
      setPage(np);
      firstWordOfPage.current = layout.byPage[np]?.[0]?.firstWord ?? 0;
      if (innerRef.current) innerRef.current.style.transform = `translateX(${-np * stride}px)`;
      // Turning with the keyboard means the eyes were still on the last line, which the
      // tracker uses to keep itself calibrated (a mouse click pulls the eyes to the button).
      trackerRef.current?.setPage(layout.byPage[np] ?? [], np, performance.now() / 1000, "turn", byKeyboard);
      setMarker(null);
    },
    [layout, stride],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc closes whichever panel is open (settings, or the finish confirmation).
      if (e.key === "Escape" && (settingsOpen || confirmFinish)) {
        setSettingsOpen(false);
        setConfirmFinish(false);
        return;
      }
      if (settingsOpen || confirmFinish || recalibrating || outOfFullscreenRef.current) return;
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (["ArrowRight", "PageDown", " "].includes(e.key)) {
        e.preventDefault();
        goTo(pageRef.current + 1, true);
      } else if (["ArrowLeft", "PageUp"].includes(e.key)) {
        e.preventDefault();
        goTo(pageRef.current - 1, true);
      } else if (e.key.toLowerCase() === "g" && modeRef.current === "gaze") {
        setPrefs((p) => ({ ...p, showGaze: !p.showGaze }));
      } else if (e.key.toLowerCase() === "m" && devLogRef.current) {
        // Development only: mark "I'm going back to re-read now" in the gaze log.
        devLogRef.current.push({ k: "mark", t: Math.round(performance.now()) / 1000, page: pageRef.current });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, settingsOpen, confirmFinish, recalibrating]);

  // ----- chrome fades away while you read -----
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => {
      setChromeVisible(true);
      clearTimeout(timer);
      timer = setTimeout(() => setChromeVisible(false), 3500);
    };
    wake();
    window.addEventListener("mousemove", wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", wake);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(id);
  }, [toast]);

  // First two sessions: a short hint about where the controls are.
  // The ref makes sure we count each session ONCE (React runs effects twice in development).
  const hintSeen = useRef<number | null>(null);
  useEffect(() => {
    if (hintSeen.current === null) {
      let seen = 0;
      try {
        seen = Number(localStorage.getItem("ra-reader-hints") ?? "0") || 0;
        localStorage.setItem("ra-reader-hints", String(seen + 1));
      } catch {}
      hintSeen.current = seen;
    }
    if (hintSeen.current >= 2) return;
    // Starts after Chrome's own "press Esc to exit full screen" banner has gone.
    const show = setTimeout(() => setShowHint(true), 1200);
    const hide = setTimeout(() => setShowHint(false), 10000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, []);

  function calibInfo(): { quality: SessionReport["calibrationQuality"]; errorPx: number | null } {
    const v = calibration?.validation;
    if (mode === "gaze" && v) return { quality: v.quality, errorPx: Math.round(v.meanErrorPx) };
    // Resumed in focus-only mode after an eye-tracked sitting: keep the earlier calibration info.
    if (resume && resume.calibrationQuality !== "attention-only") return { quality: resume.calibrationQuality, errorPx: resume.calibrationErrorPx };
    return { quality: "attention-only", errorPx: null };
  }

  function finish() {
    const rt = trackerRef.current;
    if (!rt) return;
    onFinish(rt.buildReport(performance.now() / 1000, paragraphs, calibInfo()));
  }

  function pause() {
    const rt = trackerRef.current;
    if (!rt) return;
    const now = performance.now() / 1000;
    const info = calibInfo();
    onPause(rt.buildReport(now, paragraphs, info), rt.exportState(now, firstWordOfPage.current, info));
  }

  const lastPage = layout ? page >= layout.pages - 1 : false;
  // Status chip. Line-level states (reading / skimming …) only exist with eye tracking.
  // Focus-only sessions just say so (plus whether the camera can see you, which is what
  // the report's Focus % is based on); with no camera at all it's "Not tracking".
  const away = state === "away" || state === "offtext";
  const stateColor =
    mode === "none"
      ? "var(--faint)"
      : mode === "attention"
        ? away
          ? "var(--away)"
          : "var(--accent)"
        : state === "reading"
          ? "var(--read)"
          : state === "skimming"
            ? "var(--skim)"
            : state === "pausing"
              ? "var(--accent)"
              : "var(--away)";
  const stateLabel =
    mode === "none"
      ? "Not tracking"
      : mode === "attention"
        ? away
          ? "Focus only · can't see you"
          : "Focus only"
        : { reading: "Reading", skimming: "Moving quickly", pausing: "Paused", offtext: "Looking away", away: "Away" }[state];

  return (
    <div className="fixed inset-0 reader-surface overflow-hidden" style={{ cursor: chromeVisible ? "auto" : "none" }}>
      {/* Top bar */}
      <header
        className="absolute top-0 left-0 right-0 z-20 flex items-center gap-4 px-5 transition-opacity duration-500"
        style={{ height: TOP_BAR, opacity: chromeVisible || settingsOpen ? 1 : 0.22 }}
      >
        {/* Screen-reader-only: the status dot is visual, so announce losing the face (same wording
            as calibration). Only on "away" (face not found / turned away), so it stays quiet otherwise. */}
        <div role="status" aria-live="polite" className="sr-only">
          {mode !== "none" && state === "away" ? "We can't see your face. Check the camera and lighting." : ""}
        </div>
        <div className="flex items-center gap-2 min-w-0" title={stateLabel}>
          <span className="h-2 w-2 rounded-full shrink-0 transition-colors duration-700" style={{ background: stateColor }} />
          <span className="text-sm text-muted truncate">{title}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button className="btn btn-ghost !px-2.5 !py-1.5 text-muted" onClick={() => setSettingsOpen((o) => !o)} aria-label="Reader settings">
            <IconSettings size={16} />
          </button>
          <button className="btn btn-ghost !py-1.5 text-sm" onClick={pause} title="Save your place and progress, leave, and pick up here later">
            Save &amp; exit
          </button>
          <button className="btn btn-ghost !py-1.5 text-sm" onClick={() => (lastPage ? finish() : setConfirmFinish(true))}>
            Finish session
          </button>
        </div>
      </header>

      {/* Pages */}
      <div className="absolute overflow-hidden" style={{ left: pageLeft, top: pageTop, width: pageW, height: pageH, zIndex: 1 }}>
        <div
          ref={innerRef}
          className="reader-columns"
          style={{
            width: pageW,
            height: pageH,
            columnWidth: pageW,
            columnGap: COL_GAP,
            fontFamily: FONT_VAR[prefs.font],
            fontSize: fontPx,
            lineHeight: LINE_HEIGHT,
          }}
        >
          <TextBlock paraWords={paraWords} offsets={offsets} paragraphs={paragraphs} />
        </div>
      </div>

      {/* Gaze debug layer (press G) */}
      <div ref={lineHiRef} className="pointer-events-none absolute left-0 top-0 rounded-md opacity-0" style={{ background: "var(--accent-soft)", zIndex: 0 }} />
      <div
        ref={gazeDotRef}
        className="pointer-events-none absolute left-0 top-0 h-[18px] w-[18px] rounded-full opacity-0 z-30"
        style={{ background: "color-mix(in srgb, var(--accent) 35%, transparent)", border: "2px solid var(--accent)" }}
      />
      {prefs.showGaze && mode === "gaze" && (
        <div ref={debugRef} className="absolute left-4 bottom-16 z-30 text-[11px] font-mono text-muted bg-surface/80 rounded-md px-2 py-1 border border-border" />
      )}

      {/* "Your place was here" marker: only appears after you look away or jump ahead */}
      {marker && (
        <PlaceMarker
          line={marker.line}
          reason={marker.reason}
          lineH={lineH}
          roomLeft={pageLeft}
          onDismiss={() => {
            trackerRef.current?.dismissMarker();
            setMarker(null);
          }}
        />
      )}

      {showHint && !toast && (
        <div className="absolute left-1/2 -translate-x-1/2 z-30 fade-in w-max max-w-[calc(100vw-32px)]" style={{ bottom: BOTTOM_BAR + 8 }}>
          <div className="card px-4 py-2 text-xs text-muted flex items-center gap-3">
            <span>
              <b className="text-fg">← →</b> turn pages · move the mouse for <b className="text-fg">Settings</b> and{" "}
              <b className="text-fg">Finish</b> (top right) · <b className="text-fg">Esc</b> leaves full screen
            </span>
            <button className="text-muted hover:text-fg" onClick={() => setShowHint(false)} aria-label="Dismiss hint">
              <IconX size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="absolute left-1/2 -translate-x-1/2 z-30 fade-in" style={{ top: 8 }}>
          <div className="card flex items-center gap-3 pl-4 pr-2 py-2 text-sm">
            <span>{toast.message}</span>
            {toast.goToPage !== null && (
              <button
                className="btn btn-ghost !py-1 !px-2.5"
                onClick={() => {
                  goTo(toast.goToPage!);
                  setToast(null);
                }}
              >
                Go back
              </button>
            )}
            <button className="p-1 text-muted hover:text-fg" onClick={() => setToast(null)} aria-label="Dismiss">
              <IconX size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Bottom bar */}
      <footer
        className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-center gap-5 transition-opacity duration-500"
        style={{ height: BOTTOM_BAR, opacity: chromeVisible ? 1 : 0.35 }}
      >
        <button className="p-2 rounded-lg text-muted hover:text-fg disabled:opacity-30" onClick={() => goTo(page - 1)} disabled={page === 0} aria-label="Previous page">
          <IconChevronLeft size={20} />
        </button>
        <div className="flex flex-col items-center gap-1.5 w-40">
          <span className="text-xs text-muted tabular-nums">
            {layout ? `${page + 1} / ${layout.pages}` : "…"}
          </span>
          <div className="h-[3px] w-full rounded-full bg-surface-2 overflow-hidden">
            <div className="h-full bg-accent/60 transition-all duration-300" style={{ width: layout ? `${((page + 1) / layout.pages) * 100}%` : "0%" }} />
          </div>
        </div>
        {lastPage ? (
          <button className="btn btn-primary !py-1.5" onClick={finish}>
            Finish &amp; see report
          </button>
        ) : (
          <button className="p-2 rounded-lg text-muted hover:text-fg" onClick={() => goTo(page + 1)} aria-label="Next page">
            <IconChevronRight size={20} />
          </button>
        )}
      </footer>

      {/* Settings popover */}
      {settingsOpen && (
        <div className="absolute inset-0 z-40" onClick={() => setSettingsOpen(false)}>
          <div className="card absolute right-5 w-80 p-5 space-y-5 fade-in" style={{ top: TOP_BAR }} onClick={(e) => e.stopPropagation()}>
            <Seg
              label="Theme"
              value={theme}
              options={[["system", "Auto"], ["light", "Light"], ["dark", "Dark"], ["sepia", "Sepia"]]}
              onChange={(v) => setTheme(v as ThemeChoice)}
            />
            {dyslexiaFont ? (
              <p className="text-xs text-muted">Font: dyslexia-friendly (change it in Settings).</p>
            ) : (
              <Seg label="Font" value={prefs.font} options={[["serif", "Serif"], ["sans", "Sans"], ["hyper", "Legible"]]} onChange={(v) => setPrefs({ ...prefs, font: v as ReaderPrefs["font"] })} />
            )}
            <Seg label="Text size" value={prefs.size} options={[["s", "A"], ["m", "A+"], ["l", "A++"]]} onChange={(v) => setPrefs({ ...prefs, size: v as ReaderPrefs["size"] })} />
            <Toggle
              label="Reading aids"
              hint="A soft marker shows where you left off after you look away."
              checked={prefs.aids}
              onChange={(v) => setPrefs({ ...prefs, aids: v })}
            />
            {mode === "gaze" && (
              <Toggle
                label="Show gaze (debug)"
                hint="See what the tracker sees. Shortcut: G"
                checked={prefs.showGaze}
                onChange={(v) => setPrefs({ ...prefs, showGaze: v })}
                icon={<IconBug size={14} />}
              />
            )}
            {/* Camera on: recalibrate (eye tracking) or switch this session to eye tracking (focus-only).
                No camera at all: nothing to offer. */}
            {tracker && mode !== "none" && (
              <div>
                <button
                  className="btn btn-ghost w-full"
                  onClick={() => {
                    setSettingsOpen(false);
                    setRecalibrating(true);
                  }}
                >
                  {mode === "gaze" ? "Recalibrate eye tracking" : "Turn on eye tracking"}
                </button>
                {mode !== "gaze" && (
                  <p className="text-xs text-muted mt-1.5">
                    This session is focus-only. Calibrating switches it to line-by-line tracking from here on.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Finish confirmation */}
      {confirmFinish && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/25 fade-in" onClick={() => setConfirmFinish(false)}>
          <div className="card max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-lg">Finish this session?</h3>
            <p className="text-muted text-sm mt-1.5">
              You&apos;re on page {page + 1} of {layout?.pages}. Pages you haven&apos;t opened will count as skipped, and we&apos;ll summarize them for you.
              Need a break instead? <b className="text-fg">Save &amp; exit</b> keeps your place and your progress so far, and you can pick up here later.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button className="btn btn-ghost" onClick={() => setConfirmFinish(false)}>Keep reading</button>
              <button className="btn btn-ghost" onClick={pause}>Save &amp; exit</button>
              <button className="btn btn-primary" onClick={finish}>Finish</button>
            </div>
          </div>
        </div>
      )}

      {recalibrating && tracker && (
        <Calibration
          tracker={tracker}
          wet={wet}
          lineHeight={lineH}
          onCancel={() => setRecalibrating(false)}
          onAttentionOnly={() => {
            setMode("attention");
            trackerRef.current?.retune(lineH * 2, 0, "attention");
            setRecalibrating(false);
          }}
          onDone={(r) => {
            setCalibration(r);
            onRecalibrated?.(r);
            setMode("gaze");
            const sigmaY = sigmaYFor(r.validation, lineH);
            trackerRef.current?.retune(sigmaY, 0, "gaze");
            setRecalibrating(false);
          }}
        />
      )}
    </div>
  );
}

/** The text itself. Memoised so turning pages never re-renders thousands of words. */
const TextBlock = memo(function TextBlock({
  paraWords,
  offsets,
  paragraphs,
}: {
  paraWords: string[][];
  offsets: number[];
  paragraphs: string[];
}) {
  return (
    <>
      {paraWords.map((words, p) => {
        const content = words.map((w, i) => (
          <span key={i}>
            <span data-w={offsets[p] + i}>{w}</span>{" "}
          </span>
        ));
        return isHeading(paragraphs[p]) ? (
          <h2 key={p} style={{ fontSize: "1.15em" }}>{content}</h2>
        ) : (
          <p key={p}>{content}</p>
        );
      })}
    </>
  );
});

function PlaceMarker({
  line,
  reason,
  lineH,
  roomLeft,
  onDismiss,
}: {
  line: LineBox;
  reason: "away" | "jump";
  lineH: number;
  roomLeft: number;
  onDismiss: () => void;
}) {
  const cy = (line.top + line.bottom) / 2;
  const label = reason === "away" ? "You left off here" : "Your place was here";
  const showSideLabel = roomLeft > 190;
  return (
    <>
      {/* soft wash behind the line */}
      <div
        className="pointer-events-none absolute place-marker rounded-md"
        style={{
          left: line.left - 10,
          top: cy - lineH / 2 + 4,
          width: line.right - line.left + 20,
          height: lineH - 8,
          background: "var(--accent-soft)",
          opacity: 0.75,
          zIndex: 0,
        }}
      />
      <div className="absolute place-marker z-20 flex items-center gap-2" style={{ right: `calc(100% - ${line.left - 18}px)`, top: cy - 14, height: 28 }}>
        {showSideLabel && (
          <button
            onClick={onDismiss}
            className="text-xs font-medium rounded-full px-2.5 py-1 whitespace-nowrap"
            style={{ color: "var(--accent)", background: "var(--accent-soft)" }}
            title="Dismiss"
          >
            {label}
          </button>
        )}
        <span className="h-6 w-[3px] rounded-full" style={{ background: "var(--accent)" }} />
      </div>
      {!showSideLabel && (
        <button
          onClick={onDismiss}
          className="absolute place-marker z-20 text-xs font-medium rounded-full px-2.5 py-0.5"
          style={{ left: line.left, top: cy - lineH / 2 - 14, color: "var(--accent)", background: "var(--accent-soft)" }}
        >
          {label}
        </button>
      )}
    </>
  );
}

function Seg({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="grid gap-1 p-1 rounded-lg bg-surface-2 border border-border" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
        {options.map(([v, l]) => (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={`rounded-md py-1 text-xs font-medium transition ${value === v ? "bg-surface shadow-sm text-fg" : "text-muted hover:text-fg"}`}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  icon,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  icon?: React.ReactNode;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <span className="flex-1">
        <span className="text-sm font-medium flex items-center gap-1.5">{icon}{label}</span>
        <span className="block text-xs text-muted mt-0.5">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative mt-0.5 h-5 w-9 rounded-full transition-colors shrink-0"
        style={{ background: checked ? "var(--accent)" : "var(--border)" }}
      >
        <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all" style={{ left: checked ? 18 : 2 }} />
      </button>
    </label>
  );
}

/** The dyslexia-font setting can't change while reading (it's set on another page). */
const noSubscribe = () => () => {};
