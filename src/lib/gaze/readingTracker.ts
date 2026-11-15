// The "brain" of a reading session. Every camera frame it:
//   • decides if you're reading, skimming, pausing, looking off the text, or away
//   • detects return sweeps (end-of-line jumps) and feeds them to the line HMM
//   • adds up how long your eyes spent on every word (spread by line probability)
//   • spots re-reading (jumping back several lines) and big jumps ahead
//   • decides when to show the gentle "your place was here" marker
// At the end it turns all of that into a SessionReport.
import type { FaceFrame } from "./faceTracker";
import { LineHmm, type LineBox } from "./lineHmm";
import { activeReadingSec } from "../readingTime";
import type {
  CoverageStatus,
  DistractionEvent,
  ParagraphStat,
  ReadingState,
  ResumeState,
  SessionReport,
  StateSegment,
} from "../types";

export type TrackingMode = "gaze" | "attention" | "none";

/** Seconds a typical college reader spends per word (≈240 wpm). Used when we don't know the student's own pace. */
export const SEC_PER_WORD = 60 / 240;
// Both ratios are relative to the reader's normal time per word (their own pace when known,
// from the reading calibration; else SEC_PER_WORD). At 240 wpm that means:
const READ_RATIO = 0.35; // ≥35% of normal time on a word → read  (i.e. faster than ~690 wpm is not "reading")
const SKIM_RATIO = 0.15; // 15–35% → skimmed (~700–1600 wpm); below → skipped
/** "Skimming" state: moving down lines this many times faster than your normal pace. */
const SKIM_SPEEDUP = 2.75; // at 240 wpm and ~11 words a line ≈ 1 line/s, the old fixed threshold

export interface MarkerInfo {
  line: LineBox;
  reason: "away" | "jump";
}

export interface ToastInfo {
  id: number;
  message: string;
  goToPage: number | null;
}

export interface DebugSnapshot {
  state: ReadingState;
  gaze: { x: number; y: number } | null;
  /** The gaze as the line model reads it: learned offset and vertical stretch undone. */
  seen: { x: number; y: number } | null;
  line: LineBox | null;
  lineProb: number;
  offProb: number;
  biasY: number;
  gain: number;
  sweeps: number;
  fps: number;
  face: boolean;
}

interface Options {
  mode: TrackingMode;
  totalWords: number;
  wordParagraph: Int32Array; // paragraph index of each word
  paragraphWords: number[]; // word count per paragraph
  lineHeight: number;
  sigmaY: number;
  initialBiasY: number;
  aids: boolean;
  /** This student's normal seconds per word (from the reading-pace passage); default SEC_PER_WORD. */
  secPerWord?: number;
}

/**
 * Offset learning uses only the settled middle of each line you read: from SETTLE_AFTER s
 * after arriving on it to SETTLE_BEFORE s before the return sweep that ends it. Around a line
 * change the smoothed gaze is still on its way while the model's belief changes only once the
 * sweep is detected, so those moments pair gaze with the wrong line. Learning from them made
 * the offset chase the model's own lag (and drag the dot with it).
 * SETTLE_BEFORE matches the sweep detector's look-back (0.75 s).
 */
const SETTLE_AFTER = 0.5;
/**
 * Fastest drift of the offset we follow, in line heights per second (≈ 1 line in 20 s). Webcam
 * calibrations drift steadily as eyelids droop or posture changes; learning the drift's rate
 * (not just the offset) lets the offset keep up instead of always trailing behind.
 */
const MAX_DRIFT_LINES_PER_SEC = 0.05;
/**
 * Re-reading detection (see trackPlace). A jump back of at least REREAD_LINES line(s) counts once
 * the model's probability on those earlier lines, minus REREAD_BASE (what noise alone puts
 * there), adds up to REREAD_EVIDENCE_SEC. REACH_SEC: how long a new furthest line must be
 * favoured before it counts as reached; REREAD_FROM_SEC: how long a line must be favoured to
 * count as where the re-reading started. Tuned in scripts/simulate-reread.ts.
 */
const REREAD_LINES = 1;
const REREAD_BASE = 0.4;
const REREAD_EVIDENCE_SEC = 0.6;
const REACH_SEC = 0.4;
const REREAD_FROM_SEC = 0.3;
/** Gaps in eye tracking longer than this (s) restart the jump detector's history. */
const HIST_GAP_SEC = 0.3;
/**
 * Sideways correction. Webcam gaze is often shifted left or right by a few hundred pixels once
 * reading starts (posture changes after calibration), and nothing else corrects x. While
 * reading, the gaze sweeps back and forth across the text column, so over the last X_WINDOW_SEC
 * the median gaze x should sit at the column's median. The gap between them is followed with
 * time constant X_TAU_SEC, once X_MIN_SEC of gaze has been seen, and limited to one column width.
 */
const X_WINDOW_SEC = 15;
const X_MIN_SEC = 3;
const X_TAU_SEC = 3;
/**
 * The sideways correction only learns while you are actually reading: within this many
 * seconds of the last big leftward jump (the end of a line). Its assumption, "the gaze should
 * be centred on the text column", is only true then. Without this, looking at something
 * beside the text (a phone, a sidebar) was slowly "corrected" back onto the page and counted
 * as reading. Reading a line takes about 2.5 s, 5 s for a slow reader.
 */
const X_ACTIVE_SEC = 6;
/**
 * How a frame's time on a line is shared among that line's words: this share goes evenly to
 * every word, the rest goes to the words near where the eyes are, left to right. Left-right
 * is the webcam's better axis, so this is what separates "read the whole line" from "read
 * the first half and dropped down" (skimming). The even share keeps a leftover sideways
 * offset from starving the words at one end of every line.
 */
const EVEN_SHARE = 0.4;
/**
 * A jump back marks a run of lines as re-read. A paragraph is only flagged when the run
 * covers at least this share of it, or the paragraph holds at least half of the run. The
 * start of a run is often one line too high (gaze noise), which used to flag the paragraph
 * ABOVE the one that was really re-read, on the strength of its last line.
 */
const REREAD_PARA_SHARE = 0.45;
/**
 * Re-reading by passes (catches a single line read twice, which never moves the eyes far
 * enough up the page for the jump-back detector). Every return sweep, and every forward page
 * turn, finishes one "pass" of the line the eyes were on. A paragraph counts as re-read when
 * it got at least EXTRA_PASS_LINES lines' worth of passes beyond one read AND at least
 * EXTRA_TIME_LINES lines' worth of extra time. Either alone is too easy to get by accident.
 * Checked with a simulated mix of reading, skimming and re-reading: about 4 in 10 single
 * re-read lines caught, about 1 in 1,000 normally read paragraphs flagged by mistake. Lower
 * values (0.5 / 0.2) catch a few more and flag about 1 in 100.
 */
const EXTRA_PASS_LINES = 0.6;
const EXTRA_TIME_LINES = 0.3;
const SETTLE_BEFORE = 0.75;

export class ReadingTracker {
  readonly wordDwell: Float64Array;
  readonly wordRereads: Int32Array;
  /** How many times each word's line was read to its end (see EXTRA_PASS_LINES). */
  private wordPasses: Float32Array;
  private lineWordsSum = 0;
  private lineWordsN = 0;
  private hmm: LineHmm;
  private lines: LineBox[] = [];
  private page = 0;
  private pageStart = 0;
  private t0: number;
  private lastT: number | null = null;

  // state machine
  state: ReadingState = "reading";
  private candidate: { kind: "away" | "offtext" | "ontext"; since: number } = { kind: "ontext", since: 0 };
  private segments: StateSegment[] = [];
  private segStart = 0;
  private distractions: DistractionEvent[] = [];
  private openDistraction: DistractionEvent | null = null;
  private tabHiddenAt: number | null = null;

  // sweeps & lines
  private gazeHist: { t: number; x: number; y: number }[] = [];
  private lastSweep = -10;
  private sweepTimes: number[] = [];
  private confHist: { t: number; line: number }[] = [];
  private pageMax = -1;
  // `snap` = how well each line on the page had been read when you jumped back. Only lines
  // that were already properly READ count as re-read; going back to lines you skimmed or
  // skipped is just reading them (their dwell keeps adding up and they turn "read").
  // A possible re-reading episode: started when the model began to favour lines well above the
  // furthest one reached (`pageMax`); `ev` = evidence so far (s), `held` = seconds each earlier
  // line was the favourite (the re-reading starts at the earliest one held REREAD_FROM_SEC).
  private regress: { ev: number; held: Map<number, number>; snap: number[]; counted: boolean } | null = null;
  private reach: { line: number; since: number } | null = null; // a new furthest line, not yet held
  private regressions: { from: number; to: number }[] = []; // word ranges re-read

  // page-start anchoring: after a page turn people read the first line, so the gaze offset
  // while they do tells us the calibration drift directly. But the first moments on a new page
  // are often a glance around it, so we only trust the second just before the first return
  // sweep: to sweep back to the start of line 2 you must have just been reading line 1.
  // Sideways correction (see X_WINDOW_SEC): recent raw gaze x, and the shift added to it.
  private xHist: { t: number; x: number }[] = [];
  private xShift = 0;
  private anchoring = false;
  private anchorResid: { t: number; r: number }[] = [];
  // Offset evidence from the line being read now: { time, line the model was sure of, offset
  // that line implies }. Turned into an offset update when the line ends (see SETTLE_AFTER).
  private visit: { t: number; line: number; r: number }[] = [];
  private visitStart = 0;
  // The offset at the start of this page. Within a page the offset may move at most
  // biasCap() from here: so slow drift is followed across pages without limit, while a
  // wrong belief can't walk the offset far inside one page.
  private pageBias = 0;
  // Learned drift of the offset (px/s) and when the offset was last learned.
  private biasRate = 0;
  private lastLearnAt: number | null = null;

  // Vertical stretch ("gain") learning. On each page we know two moments for sure: the
  // reader starts on the first line and, if they read down the page, presses "next" from
  // the last line. Comparing where the camera saw those two moments with how far apart the
  // lines really are tells us how stretched the gaze is. See learnGain().
  private pageAnchorRawY: number | null = null; // raw gaze y while on this page's first line
  private sweepsOnPage = 0;
  private yHist: { t: number; y: number }[] = []; // last ~1.5 s of smoothed gaze y
  private gainObs: number[] = [];

  // place marker
  private place = -1; // page-local line index of where you're reading
  private skipCandidate: { line: number; since: number } | null = null;
  private lastSkipScan = 0;
  private flaggedLines = new Set<number>();
  private marker: (MarkerInfo & { returnedAt: number | null; shownAt: number; nearSince: number | null }) | null = null;
  private lastNudgeAt = -1e9;
  private lastToastAt = -1e9;
  private toastId = 0;
  nudges = 0;
  totalSweeps = 0;
  pagesTurned = 0;

  onMarker: (m: MarkerInfo | null) => void = () => {};
  onToast: (t: ToastInfo) => void = () => {};
  onState: (s: ReadingState) => void = () => {};
  onDebug: (d: DebugSnapshot) => void = () => {};

  constructor(private opts: Options, now: number) {
    this.wordDwell = new Float64Array(opts.totalWords);
    this.wordRereads = new Int32Array(opts.totalWords);
    this.wordPasses = new Float32Array(opts.totalWords);
    this.hmm = new LineHmm(opts.sigmaY, Math.max(60, opts.sigmaY));
    this.hmm.biasY = opts.initialBiasY;
    this.pageBias = opts.initialBiasY;
    this.t0 = now;
    this.segStart = 0;
    this.pageStart = now;
  }

  get mode() {
    return this.opts.mode;
  }

  /** Normal seconds per word for this reader: their own pace if measured, else typical. */
  private get spw() {
    return this.opts.secPerWord ?? SEC_PER_WORD;
  }

  setAids(on: boolean) {
    this.opts.aids = on;
    if (!on) this.setMarker(null);
  }

  /** Largest change of the offset within one page (also caps the page-start anchoring). */
  private biasCap() {
    return Math.max(this.opts.lineHeight * 4, this.opts.sigmaY * 2);
  }

  /** Re-tune after a recalibration. */
  retune(sigmaY: number, biasY: number, mode: TrackingMode) {
    // Switching from focus-only to eye tracking mid-session: we don't know the line yet.
    if (mode === "gaze" && this.opts.mode !== "gaze") this.hmm.setLines(this.lines, "spread");
    this.opts.mode = mode;
    this.opts.sigmaY = sigmaY;
    this.hmm.sigmaY = sigmaY;
    this.hmm.biasY = biasY;
    this.pageBias = biasY;
    this.visit = [];
    this.biasRate = 0;
    this.lastLearnAt = null;
    // A new calibration has its own stretch: forget what we learned about the old one.
    this.hmm.gain = 1;
    this.xShift = 0;
    this.xHist = [];
    this.gainObs = [];
    this.pageAnchorRawY = null;
  }

  /**
   * Learn the vertical stretch from the page that was just finished. Only trusted when the
   * reader clearly read down the page (enough line-to-line return sweeps) and turned it
   * from the keyboard (a mouse click means the eyes were on the button, not the last line).
   */
  private learnGain(lines: LineBox[], now: number) {
    if (this.opts.mode !== "gaze" || lines.length < 6 || this.pageAnchorRawY === null) return;
    if (this.sweepsOnPage < 0.6 * (lines.length - 1)) return;
    const recent = this.yHist.filter((g) => now - g.t >= 0.1 && now - g.t <= 0.8).map((g) => g.y).sort((a, b) => a - b);
    if (recent.length < 8) return;
    const first = lines[0], last = lines[lines.length - 1];
    const span = (last.top + last.bottom) / 2 - (first.top + first.bottom) / 2;
    if (span < this.opts.lineHeight * 4) return;
    const obs = (recent[recent.length >> 1] - this.pageAnchorRawY) / span;
    if (!(obs >= 0.55 && obs <= 1.7)) return; // implausible: they weren't on the last line
    this.gainObs.push(obs);
    if (this.gainObs.length > 5) this.gainObs.shift();
    const sorted = [...this.gainObs].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    // One page is a noisy measurement, so move only part of the way until more agree.
    const trust = (this.gainObs.length + 0.5) / (this.gainObs.length + 1);
    const gain = 1 + (median - 1) * trust;
    this.hmm.gain = Math.abs(gain - 1) < 0.03 ? 1 : Math.max(0.6, Math.min(1.6, gain));
  }

  /** Called when the page changes (or the layout is rebuilt). */
  setPage(lines: LineBox[], page: number, now: number, reason: "turn" | "relayout", byKeyboard = false) {
    const prevPage = this.page;
    const prevLines = this.lines;
    if (reason === "turn" && page !== prevPage) {
      this.pagesTurned++;
      if (page > prevPage) this.checkRushedPage(prevLines, prevPage, now);
      // Turning forward ends a pass of the last line you were on (there's no sweep to see).
      if (page === prevPage + 1 && this.opts.mode === "gaze" && !this.anchoring && (this.state === "reading" || this.state === "skimming")) this.countPass();
      if (page === prevPage + 1 && byKeyboard) this.learnGain(prevLines, now);
    }
    if (page !== this.page || !this.lineWordsN) {
      for (const l of lines) {
        this.lineWordsSum += l.lastWord - l.firstWord + 1;
        this.lineWordsN++;
      }
    }
    this.lines = lines;
    this.page = page;
    this.pageStart = now;
    const backwards = reason === "turn" && page < prevPage;
    this.hmm.setLines(lines, backwards ? "spread" : "top");
    this.anchoring = !backwards && (reason === "turn" || this.pagesTurned === 0);
    this.anchorResid = [];
    this.visit = [];
    this.visitStart = now;
    this.pageBias = this.hmm.biasY;
    this.pageAnchorRawY = null;
    this.sweepsOnPage = 0;
    this.pageMax = -1;
    this.place = -1;
    this.skipCandidate = null;
    this.regress = null;
    this.reach = null;
    this.confHist = [];
    this.setMarker(null);
  }

  private wordsIn(l: LineBox) {
    return l.lastWord - l.firstWord + 1;
  }

  private lineRatio(l: LineBox) {
    let d = 0;
    for (let w = l.firstWord; w <= l.lastWord; w++) d += this.wordDwell[w];
    return d / (this.wordsIn(l) * this.spw);
  }

  private checkRushedPage(lines: LineBox[], page: number, now: number) {
    if (!lines.length) return;
    let words = 0, skipped = 0;
    for (const l of lines) {
      const n = this.wordsIn(l);
      words += n;
      if (this.lineRatio(l) < 0.15) skipped += n;
    }
    if (words >= 40 && skipped / words >= 0.4 && this.opts.aids && now - this.lastToastAt > 40) {
      this.lastToastAt = now;
      this.nudges++;
      this.onToast({
        id: ++this.toastId,
        message: `Page ${page + 1} went by quickly. Want to go back to it?`,
        goToPage: page,
      });
    }
  }

  private setMarker(m: MarkerInfo | null, now = 0) {
    if (!m) {
      if (this.marker) {
        this.marker = null;
        this.onMarker(null);
      }
      return;
    }
    this.marker = { ...m, returnedAt: null, shownAt: now, nearSince: null };
    this.onMarker(m);
  }

  // ---------- tab visibility ----------
  onVisibility(hidden: boolean, now: number) {
    const t = now - this.t0;
    if (hidden) {
      this.tabHiddenAt = now;
      this.enterState("away", t, "tab");
    } else if (this.tabHiddenAt !== null) {
      this.tabHiddenAt = null;
      this.lastT = now; // don't count the hidden gap as dwell
      this.candidate = { kind: "ontext", since: now };
      this.enterState("pausing", t);
    }
  }

  // ---------- per-frame update ----------
  onFrame(frame: FaceFrame | null, gaze: { x: number; y: number } | null, gazeFast: { x: number; y: number } | null, now: number, fps = 0) {
    if (this.tabHiddenAt !== null) return;
    const dt = this.lastT === null ? 1 / 30 : Math.min(0.25, Math.max(0, now - this.lastT));
    this.lastT = now;
    if (this.opts.mode === "gaze" && gaze && frame?.features) this.learnXShift(gaze.x, now, dt);
    if (this.xShift) {
      if (gaze) gaze = { x: gaze.x + this.xShift, y: gaze.y };
      if (gazeFast) gazeFast = { x: gazeFast.x + this.xShift, y: gazeFast.y };
    }
    const t = now - this.t0;
    const mode = this.opts.mode;
    const lines = this.lines;
    const lineH = this.opts.lineHeight;

    // 1) Instant classification
    let inst: "away" | "offtext" | "ontext" = "ontext";
    if (mode !== "none" && frame) {
      if (!frame.face || Math.abs(frame.yaw) > 0.6 || Math.abs(frame.pitch) > 0.5) inst = "away";
      else if (mode === "gaze" && gaze && lines.length) {
        const colL = lines[0].left, colR = Math.max(...lines.map((l) => l.right));
        const w = colR - colL;
        const y = this.hmm.correctY(gaze.y);
        const top = lines[0].top, bottom = lines[lines.length - 1].bottom;
        const margin = Math.max(this.opts.sigmaY * 1.6, lineH * 3);
        if (gaze.x < colL - 0.35 * w || gaze.x > colR + 0.35 * w || y < top - margin || y > bottom + margin) inst = "offtext";
      }
    }

    // 2) Big, fast leftward jumps of the gaze. Most are return sweeps to the next line, but
    // hopping back within a line or jumping back to re-read look the same sideways; only the
    // jump's vertical size tells them apart, and the line model weighs that (see predict()).
    // `sweep` = a jump that didn't go up, counted as a line ending for pace and anchoring.
    let sweep = false;
    let jump: { dy: number } | null = null;
    if (mode === "gaze" && gazeFast && frame?.features) {
      // A blink (a few frames without eye features) keeps the history: people often blink
      // during the return sweep itself, and dropping the history then hid the line change.
      // Only a longer loss of tracking starts it afresh.
      const lastSeen = this.gazeHist.length ? this.gazeHist[this.gazeHist.length - 1].t : -Infinity;
      if (now - lastSeen > HIST_GAP_SEC) this.gazeHist = [];
      this.gazeHist.push({ t: now, ...gazeFast });
      while (this.gazeHist.length && now - this.gazeHist[0].t > 1.2) this.gazeHist.shift();
      if (lines.length && now - this.lastSweep > 0.7) {
        const before = this.gazeHist.filter((g) => now - g.t >= 0.35 && now - g.t <= 0.75);
        const after = this.gazeHist.filter((g) => now - g.t <= 0.15);
        if (before.length >= 4 && after.length >= 2) {
          const mean = (a: typeof before, k: "x" | "y") => a.reduce((s, g) => s + g[k], 0) / a.length;
          const colW = Math.max(...lines.map((l) => l.right)) - lines[0].left;
          const dx = mean(after, "x") - mean(before, "x");
          const dy = mean(after, "y") - mean(before, "y");
          if (dx < -0.33 * colW) {
            jump = { dy };
            this.lastSweep = now;
            if (dy > -1.5 * lineH) {
              sweep = true;
              this.sweepTimes.push(t);
              this.totalSweeps++;
              this.sweepsOnPage++;
            }
          }
        }
      }
    }
    while (this.sweepTimes.length && t - this.sweepTimes[0] > 20) this.sweepTimes.shift();

    if (mode === "gaze" && gaze && frame?.features) {
      this.yHist.push({ t: now, y: gaze.y });
      while (this.yHist.length && now - this.yHist[0].t > 1.5) this.yHist.shift();
    }

    // 3) Line HMM
    if (mode === "gaze" && lines.length && this.anchoring) {
      // Still on the first line of a fresh page: learn the offset, keep the model pinned.
      if (gaze && frame?.features && inst !== "away") {
        const first = lines[0];
        this.anchorResid.push({ t: now, r: gaze.y - (first.top + first.bottom) / 2 });
      }
      // Give up after ~6 s without a sweep (or on looking away): then we learn nothing.
      const timedOut = this.anchorResid.length >= 180 || inst === "away";
      if (sweep || timedOut) {
        // Only the last stretch of line 1, before the sweep's own movement.
        const onLine1 = sweep ? this.anchorResid.filter((a) => now - a.t <= 1.2 && now - a.t >= 0.25).map((a) => a.r) : [];
        if (onLine1.length >= 12) {
          const sorted = onLine1.sort((a, b) => a - b);
          const med = sorted[sorted.length >> 1];
          const cap = this.biasCap();
          // Limited relative to the offset so far (not to zero), so drift that builds up over a
          // session keeps being followed.
          this.hmm.biasY = Math.max(this.pageBias - cap, Math.min(this.pageBias + cap, med));
          this.pageBias = this.hmm.biasY;
          this.pageAnchorRawY = (lines[0].top + lines[0].bottom) / 2 + med;
        }
        this.anchoring = false;
        this.hmm.pin(0);
        this.visit = [];
        this.visitStart = now;
        if (sweep) {
          this.countPass();
          this.hmm.predict(dt, jump ?? true);
        }
      } else {
        this.hmm.pin(0);
      }
    } else if (mode === "gaze" && lines.length) {
      if (this.biasRate && frame?.face) {
        const cap = this.biasCap();
        this.hmm.biasY = Math.max(this.pageBias - cap, Math.min(this.pageBias + cap, this.hmm.biasY + this.biasRate * dt));
      }
      if (jump) this.learnBiasFromLine(now);
      if (sweep) this.countPass();
      this.hmm.predict(dt, jump ?? false);
      if (inst === "away") this.hmm.observe(null, true, dt);
      else if (gaze && frame?.features) {
        this.hmm.observe(gaze, false, dt);
        // Every reading frame counts, whatever the model's confidence: how sure it can get
        // depends on the gaze noise (at 1.5 lines of noise it rarely passes 60% even on the
        // right line). Whether a line's evidence is trusted is decided once the line ends.
        const b = this.state === "reading" ? this.hmm.best() : null;
        if (b && b.index >= 0 && b.off < 0.5) this.visit.push({ t: now, line: b.index, r: this.hmm.offsetFor(gaze.y, b.index) });
        while (this.visit.length && now - this.visit[0].t > 10) this.visit.shift();
      }
    }
    const best = mode === "gaze" ? this.hmm.best() : { index: -1, prob: 0, off: 0 };
    const confident = best.index >= 0 && best.prob >= 0.6 ? best.index : -1;
    const likely = best.index >= 0 && best.prob >= 0.4 && best.off < 0.5 ? best.index : -1;
    if (confident >= 0) {
      this.confHist.push({ t, line: confident });
      while (this.confHist.length && t - this.confHist[0].t > 6) this.confHist.shift();
    }

    // 4) State machine with hysteresis (so one noisy frame never triggers anything)
    if (inst !== this.candidate.kind) this.candidate = { kind: inst, since: now };
    const held = now - this.candidate.since;
    const onText = this.state === "reading" || this.state === "skimming" || this.state === "pausing";
    if (this.candidate.kind === "away" && held >= 1.2 && this.state !== "away") this.enterState("away", t, "away");
    else if (this.candidate.kind === "offtext" && held >= 2.0 && this.state !== "offtext" && this.state !== "away")
      this.enterState("offtext", t, "offtext");
    else if (this.candidate.kind === "ontext" && (onText || held >= 0.6)) {
      const sub = this.subState(t);
      if (sub !== this.state) this.enterState(sub, t);
    }

    // 5) Dwell: spread this frame's time over the words you're probably looking at
    const nowOnText = this.state === "reading" || this.state === "skimming" || this.state === "pausing";
    if (nowOnText && lines.length) {
      if (mode === "gaze") {
        // The quicker-reacting gaze point follows the eyes along the line; the smooth one lags.
        const x = frame?.features ? (gazeFast ?? gaze)?.x : undefined;
        for (let i = 0; i < lines.length; i++) {
          const share = this.hmm.p[i] * dt;
          if (share < 1e-5) continue;
          const L = lines[i];
          const n = this.wordsIn(L);
          const per = share / n;
          if (x === undefined || n < 3) {
            for (let w = L.firstWord; w <= L.lastWord; w++) this.wordDwell[w] += per;
            continue;
          }
          // Part evenly, part to the words near the eyes (see EVEN_SHARE).
          const width = L.right - L.left;
          const sx = Math.max(50, 0.12 * width);
          if (this.scratch.length < n) this.scratch = new Float64Array(n * 2);
          const wts = this.scratch;
          let sum = 0;
          for (let k = 0; k < n; k++) {
            const z = (x - (L.left + ((k + 0.5) / n) * width)) / sx;
            sum += wts[k] = Math.exp(-0.5 * z * z) + 1e-9;
          }
          const near = (share * (1 - EVEN_SHARE)) / sum;
          for (let k = 0; k < n; k++) this.wordDwell[L.firstWord + k] += per * EVEN_SHARE + near * wts[k];
        }
      } else {
        // Without gaze we only know you're facing the page: spread time evenly over it.
        const first = lines[0].firstWord, last = lines[lines.length - 1].lastWord;
        const per = dt / (last - first + 1);
        for (let w = first; w <= last; w++) this.wordDwell[w] += per;
      }
    }

    // 6) Re-reading, place tracking and the place marker (gaze mode only)
    if (mode === "gaze" && lines.length && !this.anchoring) this.trackPlace(likely, now, dt);
    else if (mode === "gaze" && this.anchoring && this.state === "reading") this.place = 0;

    this.onDebug({
      state: this.state,
      gaze,
      seen: gaze && mode === "gaze" ? { x: gaze.x, y: this.hmm.correctY(gaze.y) } : null,
      line: best.index >= 0 ? lines[best.index] : null,
      lineProb: best.prob,
      offProb: best.off,
      biasY: this.hmm.biasY,
      gain: this.hmm.gain,
      sweeps: this.sweepTimes.length,
      fps,
      face: !!frame?.face,
    });
  }

  /**
   * A big leftward jump just ended a stretch of reading (usually a line): learn the offset from that line's settled middle (see
   * SETTLE_AFTER), if the model's best guess stayed on one line for nearly all of it.
   */
  private learnBiasFromLine(now: number) {
    const from = this.visitStart + SETTLE_AFTER, to = now - SETTLE_BEFORE;
    const mid = this.visit.filter((v) => v.t >= from && v.t <= to);
    this.visit = [];
    this.visitStart = now;
    if (mid.length < 10) return;
    const count = new Map<number, number>();
    for (const v of mid) count.set(v.line, (count.get(v.line) ?? 0) + 1);
    const [line, n] = [...count.entries()].reduce((a, b) => (b[1] > a[1] ? b : a));
    if (n < 0.7 * mid.length) return;
    const rs = mid.filter((v) => v.line === line).map((v) => v.r).sort((a, b) => a - b);
    const cap = this.biasCap();
    const span = mid[mid.length - 1].t - mid[0].t;
    // The evidence is from the middle of the line, a second or so ago: bring it up to now.
    const target = rs[rs.length >> 1] + this.biasRate * (now - (mid[0].t + span / 2));
    const innovation = target - this.hmm.biasY;
    this.hmm.learnBias(target, span, this.pageBias - cap, this.pageBias + cap);
    // Drift rate: an alpha-beta filter (critically damped) on the same evidence.
    if (this.lastLearnAt !== null && now - this.lastLearnAt < 15) {
      const alpha = 1 - Math.exp(-span / this.hmm.biasTau);
      const beta = (alpha * alpha) / (2 - alpha);
      const maxRate = MAX_DRIFT_LINES_PER_SEC * this.opts.lineHeight;
      this.biasRate = Math.max(-maxRate, Math.min(maxRate, this.biasRate + (beta * innovation) / (now - this.lastLearnAt)));
    }
    this.lastLearnAt = now;
  }

  /** Follow the gap between the median gaze x and the text column's median (see X_WINDOW_SEC). */
  private learnXShift(rawX: number, now: number, dt: number) {
    const lines = this.lines;
    if (!lines.length) return;
    if (now - this.lastSweep > X_ACTIVE_SEC) return; // not reading right now: see X_ACTIVE_SEC
    this.xHist.push({ t: now, x: rawX });
    while (this.xHist.length && now - this.xHist[0].t > X_WINDOW_SEC) this.xHist.shift();
    if (now - this.xHist[0].t < X_MIN_SEC) return;
    // The column's median x while reading: line midpoints, weighted by line width.
    let w = 0, cx = 0;
    for (const l of lines) {
      const lw = l.right - l.left;
      w += lw;
      cx += lw * (l.left + l.right) / 2;
    }
    if (w <= 0) return;
    const xs = this.xHist.map((h) => h.x).sort((a, b) => a - b);
    const target = cx / w - xs[xs.length >> 1];
    const colW = Math.max(...lines.map((l) => l.right)) - lines[0].left;
    const next = this.xShift + (1 - Math.exp(-dt / X_TAU_SEC)) * (target - this.xShift);
    this.xShift = Math.max(-colW, Math.min(colW, next));
  }

  private subState(t: number): ReadingState {
    if (this.opts.mode !== "gaze") return "reading";
    const recent = this.confHist.filter((c) => t - c.t <= 4);
    let advance = 0;
    if (recent.length > 4) {
      const span = recent[recent.length - 1].t - recent[0].t;
      if (span > 1.5) advance = (recent[recent.length - 1].line - recent[0].line) / span;
    }
    const sweeps5 = this.sweepTimes.filter((s) => t - s <= 5).length;
    const sweeps12 = this.sweepTimes.filter((s) => t - s <= 12).length;
    // Your normal pace in lines per second on this page, then "much faster than that" = skimming.
    const lines = this.lines;
    const wordsPerLine = lines.length ? lines.reduce((s, l) => s + this.wordsIn(l), 0) / lines.length : 11;
    const skimAdvance = Math.max(0.4, SKIM_SPEEDUP / (wordsPerLine * this.spw));
    // Return sweeps: 4 in 5 s at 240 wpm; scaled to your pace (a fast reader sweeps more often).
    const skimSweeps = Math.max(3, Math.round((4 * SEC_PER_WORD) / this.spw));
    if (advance > skimAdvance || sweeps5 >= skimSweeps) return "skimming";
    if (sweeps12 === 0 && t - (this.pageStart - this.t0) > 12) return "pausing";
    return "reading";
  }

  private enterState(s: ReadingState, t: number, distraction?: DistractionEvent["kind"]) {
    if (s === this.state && !distraction) return;
    // close the current segment
    if (t > this.segStart) this.segments.push({ state: this.state, start: this.segStart, end: t });
    this.segStart = t;
    const wasDistracted = this.state === "away" || this.state === "offtext";
    const nowDistracted = s === "away" || s === "offtext";
    if (this.openDistraction && (!nowDistracted || distraction === "tab")) {
      this.openDistraction.durationSec = t - this.openDistraction.start;
      if (this.openDistraction.durationSec >= 1) this.distractions.push(this.openDistraction);
      this.openDistraction = null;
    }
    if (nowDistracted && distraction && !this.openDistraction) {
      const placeLine = this.place >= 0 ? this.lines[this.place] : this.lines[0];
      this.openDistraction = { kind: distraction, start: t, durationSec: 0, paragraph: placeLine ? placeLine.paragraph : null };
      // Leave a bookmark where you were, so it's waiting when you look back.
      if (this.opts.mode === "gaze" && this.opts.aids && this.place >= 0 && !this.marker) {
        this.setMarker({ line: this.lines[this.place], reason: "away" }, this.lastT ?? 0);
      }
    }
    if (wasDistracted && !nowDistracted && this.marker && this.marker.returnedAt === null) {
      this.marker.returnedAt = this.lastT ?? 0;
    }
    this.state = s;
    this.onState(s);
  }

  private trackPlace(likely: number, now: number, dt: number) {
    const lines = this.lines;
    // --- furthest line reached on this page: a line counts once favoured for REACH_SEC, so
    // one noisy moment further down can't make ordinary reading look like going back.
    if (likely > this.pageMax) {
      if (this.reach?.line !== likely) this.reach = { line: likely, since: now };
      else if (now - this.reach.since >= REACH_SEC) {
        this.pageMax = likely;
        this.reach = null;
      }
    } else this.reach = null;

    // --- re-reading: the model's probability on lines at least REREAD_LINES above the
    // furthest reached, summed over time beyond what noise alone puts there. A jump back is
    // counted once that evidence reaches REREAD_EVIDENCE_SEC, however sure any single moment
    // was; it ends when the evidence has drained away (you're back where you were).
    const edge = this.pageMax - REREAD_LINES;
    const onText = this.state === "reading" || this.state === "skimming" || this.state === "pausing";
    if (edge >= 0 && onText) {
      let back = 0, bi = -1;
      for (let i = 0; i <= edge; i++) {
        back += this.hmm.p[i];
        if (bi < 0 || this.hmm.p[i] > this.hmm.p[bi]) bi = i;
      }
      const ev = (this.regress?.ev ?? 0) + (back - REREAD_BASE) * dt;
      if (ev <= 0) this.regress = null;
      else {
        // Snapshot of how well each line was read before going back (see `snap` in addRegressions).
        this.regress ??= { ev: 0, held: new Map(), snap: lines.map((l) => this.lineRatio(l)), counted: false };
        this.regress.ev = Math.min(ev, 2 * REREAD_EVIDENCE_SEC);
        if (back >= 0.5) this.regress.held.set(bi, (this.regress.held.get(bi) ?? 0) + dt);
        if (!this.regress.counted && this.regress.ev >= REREAD_EVIDENCE_SEC) {
          // Earliest line favoured for a while (a noisy moment one line higher doesn't count);
          // failing that, the one favoured longest.
          const held = [...this.regress.held.entries()];
          const firm = held.filter(([, sec]) => sec >= REREAD_FROM_SEC).map(([l]) => l);
          const from = firm.length ? Math.min(...firm) : held.length ? held.reduce((a, b) => (b[1] > a[1] ? b : a))[0] : edge;
          this.regress.counted = true;
          this.addRegressions(from, this.pageMax - 1, this.regress.snap);
        }
      }
    }

    // --- your "place": where you were reading (used for the look-away bookmark)
    const reading = this.state === "reading" || this.state === "skimming";
    if (reading && likely >= 0) this.place = likely;

    // --- skipped ahead? Look for a block of ≥3 lines ABOVE where you're now reading
    // that got almost no time, right after lines you did read.
    if (reading && likely >= 3 && now - this.lastSkipScan > 0.5) {
      this.lastSkipScan = now;
      let block: number | null = null;
      for (let i = 0; i <= likely - 2; i++) {
        if (this.flaggedLines.has(lines[i].index)) continue;
        let j = i;
        while (j <= likely - 2 && this.lineRatio(lines[j]) < 0.15) j++;
        const len = j - i;
        // you read something just before the gap (allowing one half-read edge line)
        const readBefore =
          i === 0 ||
          this.lineRatio(lines[i - 1]) >= READ_RATIO ||
          (i >= 2 && this.lineRatio(lines[i - 2]) >= READ_RATIO);
        if (len >= 3 && readBefore) {
          // point at the first line you didn't really read
          block = i > 0 && this.lineRatio(lines[i - 1]) < READ_RATIO ? i - 1 : i;
          break;
        }
        i = Math.max(i, j);
      }
      if (block === null) this.skipCandidate = null;
      else if (!this.skipCandidate || this.skipCandidate.line !== block) this.skipCandidate = { line: block, since: now };
      else if (now - this.skipCandidate.since >= 2 && !this.marker && this.opts.aids && now - this.lastNudgeAt > 30) {
        this.lastNudgeAt = now;
        this.nudges++;
        for (let k = block; k < Math.min(lines.length, block + 3); k++) this.flaggedLines.add(lines[k].index);
        this.setMarker({ line: lines[block], reason: "jump" }, now);
        this.skipCandidate = null;
      }
    }

    // --- hide the marker once you're back on track (or after a while)
    if (this.marker) {
      const m = this.marker;
      const markerIdx = lines.indexOf(m.line);
      const near = likely >= 0 && markerIdx >= 0 && Math.abs(likely - markerIdx) <= 1;
      if (near) m.nearSince ??= now;
      else m.nearSince = null;
      const backOnTrack = m.nearSince !== null && now - m.nearSince > 0.8 && (m.reason === "jump" || m.returnedAt !== null);
      const expired =
        m.reason === "away" ? m.returnedAt !== null && now - m.returnedAt > 6 : now - m.shownAt > 9;
      if (backOnTrack || expired) this.setMarker(null);
    }
  }

  /**
   * Record re-reading of page lines `from`..`to`. Only lines that were already properly READ
   * (per `snap`, taken when you went back) count: going back to lines you skimmed or skipped
   * is just reading them. Each contiguous run of such lines is one re-reading.
   */
  private addRegressions(from: number, to: number, snap: number[]) {
    const lines = this.lines;
    let run: { from: number; to: number } | null = null;
    for (let i = from; i <= Math.max(from, to); i++) {
      if ((snap[i] ?? 0) >= READ_RATIO) {
        if (run) run.to = lines[i].lastWord;
        else run = { from: lines[i].firstWord, to: lines[i].lastWord };
      } else if (run) {
        this.addRegression(run);
        run = null;
      }
    }
    if (run) this.addRegression(run);
  }

  private scratch = new Float64Array(64);

  /** The eyes just finished a line (return sweep or page turn): credit one pass, shared among the lines by how likely each is. */
  private countPass() {
    const lines = this.lines;
    let onLines = 0;
    for (let i = 0; i < lines.length; i++) onLines += this.hmm.p[i];
    if (onLines < 0.2) return;
    for (let i = 0; i < lines.length; i++) {
      const p = this.hmm.p[i] / onLines;
      if (p < 0.01) continue;
      for (let w = lines[i].firstWord; w <= lines[i].lastWord; w++) this.wordPasses[w] += p;
    }
  }

  private addRegression(r: { from: number; to: number }) {
    for (let w = r.from; w <= r.to; w++) this.wordRereads[w]++;
    this.regressions.push(r);
  }

  dismissMarker() {
    this.setMarker(null);
  }

  // ---------- final report ----------
  /** Segments and distractions so far, with the currently-open ones closed at time t (no mutation). */
  private closed(t: number) {
    const distractions = [...this.distractions];
    if (this.openDistraction) {
      const d = { ...this.openDistraction, durationSec: t - this.openDistraction.start };
      if (d.durationSec >= 1) distractions.push(d);
    }
    const segments = [...this.segments];
    if (t > this.segStart) segments.push({ state: this.state, start: this.segStart, end: t });
    return { distractions, segments };
  }

  /** Session time so far, in seconds. */
  elapsed(now: number) {
    return now - this.t0;
  }

  /** Everything needed to continue this session later (see ResumeState). */
  exportState(now: number, firstWord: number, calibration: { quality: SessionReport["calibrationQuality"]; errorPx: number | null }): ResumeState {
    const t = now - this.t0;
    const { distractions, segments } = this.closed(t);
    return {
      version: 1,
      elapsedSec: t,
      firstWord,
      wordDwell: Array.from(this.wordDwell, (v) => Math.round(v * 1000) / 1000),
      wordRereads: Array.from(this.wordRereads),
      segments,
      distractions,
      regressions: [...this.regressions],
      nudges: this.nudges,
      pagesTurned: this.pagesTurned,
      totalSweeps: this.totalSweeps,
      calibrationQuality: calibration.quality,
      calibrationErrorPx: calibration.errorPx,
    };
  }

  /** Continue a paused session: the clock picks up at its old elapsed time. */
  restore(s: ResumeState, now: number) {
    if (s.wordDwell.length === this.wordDwell.length) this.wordDwell.set(s.wordDwell);
    if (s.wordRereads.length === this.wordRereads.length) this.wordRereads.set(s.wordRereads);
    this.segments = [...s.segments];
    this.distractions = [...s.distractions];
    this.regressions = [...s.regressions];
    this.nudges = s.nudges;
    this.pagesTurned = s.pagesTurned;
    this.totalSweeps = s.totalSweeps;
    this.t0 = now - s.elapsedSec;
    this.segStart = s.elapsedSec;
    this.lastT = null;
  }

  buildReport(now: number, paragraphs: string[], calibration: { quality: SessionReport["calibrationQuality"]; errorPx: number | null }): SessionReport {
    const t = now - this.t0;
    const { distractions, segments } = this.closed(t);

    const { totalWords, wordParagraph, paragraphWords } = this.opts;
    const wordStatus: CoverageStatus[] = new Array(totalWords);
    for (let w = 0; w < totalWords; w++) {
      const r = this.wordDwell[w] / this.spw;
      wordStatus[w] = r >= READ_RATIO ? "read" : r >= SKIM_RATIO ? "skimmed" : "skipped";
    }

    const paraStats: ParagraphStat[] = paragraphWords.map((words, index) => ({
      index,
      words,
      status: "skipped" as CoverageStatus,
      coverage: 0,
      dwellSec: 0,
      expectedSec: words * this.spw,
      rereads: 0,
      wpm: null,
    }));
    const readCount = new Array(paragraphs.length).fill(0);
    const skimCount = new Array(paragraphs.length).fill(0);
    let readWords = 0, skimWords = 0, readDwell = 0;
    for (let w = 0; w < totalWords; w++) {
      const p = wordParagraph[w];
      paraStats[p].dwellSec += this.wordDwell[w];
      if (wordStatus[w] === "read") {
        readCount[p]++;
        readWords++;
        readDwell += this.wordDwell[w];
      } else if (wordStatus[w] === "skimmed") {
        skimCount[p]++;
        skimWords++;
      }
    }
    for (const reg of this.regressions) {
      const touched = new Map<number, number>(); // paragraph → words of it in this run
      for (let w = reg.from; w <= reg.to; w++) touched.set(wordParagraph[w], (touched.get(wordParagraph[w]) ?? 0) + 1);
      const runWords = reg.to - reg.from + 1;
      // See REREAD_PARA_SHARE: a paragraph only clipped at its edge isn't "re-read".
      touched.forEach((n, p) => {
        if (n >= REREAD_PARA_SHARE * Math.max(1, paraStats[p].words) || n >= 0.5 * runWords) paraStats[p].rereads++;
      });
    }
    paraStats.forEach((s, p) => {
      const n = Math.max(1, s.words);
      const readShare = readCount[p] / n;
      const seenShare = (readCount[p] + skimCount[p]) / n;
      s.coverage = (readCount[p] + 0.5 * skimCount[p]) / n;
      s.status = readShare >= 0.6 ? "read" : seenShare < 0.35 ? "skipped" : "skimmed";
      // No speed for skipped paragraphs: a glance isn't "reading at N wpm".
      s.wpm = s.status !== "skipped" && s.dwellSec >= 2 && s.coverage > 0 ? Math.round((s.words * s.coverage) / (s.dwellSec / 60)) : null;
      s.dwellSec = Math.round(s.dwellSec * 10) / 10;
      s.expectedSec = Math.round(s.expectedSec * 10) / 10;
    });

    // Lingering far longer than YOUR usual pace on a paragraph also signals re-reading / struggle.
    const ratios = paraStats.filter((p) => p.status === "read" && p.words >= 8).map((p) => p.dwellSec / p.expectedSec).sort((a, b) => a - b);
    const typical = ratios.length ? ratios[ratios.length >> 1] : 1;
    // Lines read twice: more passes than one read needs, with the extra time to match.
    const passWords = new Array(paraStats.length).fill(0);
    for (let w = 0; w < totalWords; w++) passWords[wordParagraph[w]] += this.wordPasses[w];
    const lineWords = this.lineWordsN ? this.lineWordsSum / this.lineWordsN : 11;
    // Not next to a paragraph the jump-back detector already flagged: going back over a whole
    // paragraph spills a little extra time and passes onto its neighbours.
    const jumpedBack = paraStats.map((p) => p.rereads > 0);
    paraStats.forEach((p, i) => {
      if (p.rereads > 0 || p.status !== "read" || p.words < 8 || jumpedBack[i - 1] || jumpedBack[i + 1]) return;
      const extraPassWords = passWords[i] - p.words;
      const extraSec = p.dwellSec - typical * p.expectedSec;
      if (extraPassWords >= EXTRA_PASS_LINES * lineWords && extraSec >= EXTRA_TIME_LINES * lineWords * this.spw) p.rereads = 1;
    });
    for (const p of paraStats) {
      if (p.rereads === 0 && p.status === "read" && p.words >= 8 && p.dwellSec / p.expectedSec >= Math.max(1, typical * 1.6)) p.rereads = 1;
    }

    // Reading time: distractions don't count, and neither does any stretch of more than
    // IDLE_CUTOFF_SEC without reading (see activeReadingSec).
    const activeSec = Math.min(t, activeReadingSec(segments));
    const avgWpm = readWords >= 30 && readDwell > 0 ? Math.round(Math.min(1200, Math.max(40, readWords / (readDwell / 60)))) : null;

    // merge tiny timeline segments for a clean chart
    const timeline: StateSegment[] = [];
    for (const s of segments) {
      const last = timeline[timeline.length - 1];
      if (last && last.state === s.state) last.end = s.end;
      else if (s.end - s.start >= 0.3) timeline.push({ ...s });
      else if (last) last.end = s.end;
    }

    return {
      durationSec: Math.round(t),
      activeSec: Math.round(activeSec),
      focusPct: t > 0 ? Math.round((activeSec / t) * 1000) / 10 : 100,
      coveragePct: totalWords ? Math.round(((readWords + 0.5 * skimWords) / totalWords) * 1000) / 10 : 0,
      wordsRead: Math.round(readWords + 0.5 * skimWords),
      avgWpm,
      baselineWpm: this.opts.secPerWord ? Math.round(60 / this.opts.secPerWord) : null,
      calibrationQuality: calibration.quality,
      calibrationErrorPx: calibration.errorPx,
      paragraphs: paraStats,
      wordStatus,
      distractions: distractions.map((d) => ({ ...d, start: Math.round(d.start * 10) / 10, durationSec: Math.round(d.durationSec * 10) / 10 })),
      timeline: timeline.map((s) => ({ ...s, start: Math.round(s.start * 10) / 10, end: Math.round(s.end * 10) / 10 })),
      nudges: this.nudges,
      pagesTurned: this.pagesTurned,
    };
  }
}
