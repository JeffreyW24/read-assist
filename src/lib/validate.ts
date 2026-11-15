// Checks on data that arrives from the browser. Session reports are built in the reader
// (in the browser), so the server must not trust their shape: one malformed report used to
// crash the class pages for everyone. Everything here is plain data in, plain data out.
import type {
  AiResult, QuizQuestion, SkippedSection,
  CoverageStatus, DistractionEvent, ParagraphStat, Reading, ReadingState, ResumeState, SessionReport, StateSegment,
} from "./types";
import { countWords } from "./text";
import { activeReadingSec } from "./readingTime";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const numOrNull = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** Event lists (timeline, distractions, re-reads) get long in long sessions, but never this long. */
const MAX_EVENTS = 50_000;
const events = (v: unknown): unknown[] => arr(v).slice(0, MAX_EVENTS);

const STATUSES: CoverageStatus[] = ["read", "skimmed", "skipped"];
const STATES: ReadingState[] = ["reading", "skimming", "pausing", "offtext", "away"];
const QUALITIES: SessionReport["calibrationQuality"][] = ["good", "fair", "poor", "attention-only"];
const KINDS: DistractionEvent["kind"][] = ["away", "offtext", "tab"];

const status = (v: unknown): CoverageStatus => (STATUSES.includes(v as CoverageStatus) ? (v as CoverageStatus) : "skipped");

/**
 * Read a JSON request body as an object. Returns null when the body isn't valid JSON or
 * isn't an object, so routes can answer 400 instead of crashing with a 500.
 */
export async function readJsonBody(req: Request, maxChars = DEFAULT_MAX_BODY): Promise<Obj | null> {
  try {
    // Refuse oversized bodies up front when the browser says how big they are.
    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxChars * 4) return null;
    const text = await req.text();
    if (text.length > maxChars) return null;
    const body: unknown = JSON.parse(text);
    return isObj(body) ? body : null;
  } catch {
    return null;
  }
}

/** Most requests are small forms; routes that take more (a reading, a session) pass their own limit. */
const DEFAULT_MAX_BODY = 100_000;

/** Longest teacher instructions for a reading. */
export const MAX_INSTRUCTIONS_CHARS = 5_000;

/** A string field, or undefined when it's missing or the wrong type. */
export function strField(body: Obj, key: string): string | undefined {
  const v = body[key];
  return typeof v === "string" ? v : undefined;
}

/** Parse an ISO timestamp sent by the browser; null when it isn't a real date. */
export function parseTimestamp(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Longest a session can be, all sittings together. Far beyond any real reading; it keeps the
 * numbers small enough that pages working through a session's timeline stay fast.
 */
export const MAX_SESSION_SEC = 30 * 86_400;

function segment(v: unknown, maxT: number): StateSegment | null {
  if (!isObj(v) || !STATES.includes(v.state as ReadingState)) return null;
  const start = num(v.start, 0, 0, maxT);
  return { state: v.state as ReadingState, start, end: num(v.end, start, start, maxT) };
}

/**
 * A timeline as pages expect it: every segment inside the session, in order, none
 * overlapping. A malformed one (overlapping or far-out segments) used to be able to make
 * pages that walk through timelines run for minutes.
 */
function timelineOf(v: unknown, maxT: number): StateSegment[] {
  const list = events(v)
    .map((x) => segment(x, maxT))
    .filter((s): s is StateSegment => s !== null)
    .sort((a, b) => a.start - b.start);
  const out: StateSegment[] = [];
  let at = 0;
  for (const s of list) {
    const start = Math.max(s.start, at);
    if (s.end <= start) continue;
    out.push({ ...s, start });
    at = s.end;
  }
  return out;
}

function distraction(v: unknown, maxT: number): DistractionEvent | null {
  if (!isObj(v) || !KINDS.includes(v.kind as DistractionEvent["kind"])) return null;
  const start = num(v.start, 0, 0, maxT);
  return { kind: v.kind as DistractionEvent["kind"], start, durationSec: num(v.durationSec, 0, 0, maxT - start), paragraph: numOrNull(v.paragraph) };
}

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

/**
 * A saved AI summary with every field the report page expects. Summaries are stored as
 * Gemini wrote them (and older ones in older shapes), so a missing or odd field must not
 * crash the page.
 */
export function normalizeAi(raw: unknown): AiResult | null {
  if (!isObj(raw)) return null;
  const sections: SkippedSection[] = arr(raw.sections)
    .filter(isObj)
    .map((s, i) => ({
      paragraphs: arr(s.paragraphs).filter((p): p is number => typeof p === "number" && Number.isInteger(p) && p >= 0),
      title: str(s.title, `Section ${i + 1}`),
      summary: str(s.summary),
    }))
    .filter((s) => s.paragraphs.length > 0);
  const quiz: QuizQuestion[] = arr(raw.quiz)
    .filter(isObj)
    .map((q) => ({ question: str(q.question), options: arr(q.options).map((o) => str(o)), answerIndex: num(q.answerIndex, -1, -1, 100), explanation: str(q.explanation) }))
    .filter((q) => q.question && q.options.length >= 2 && Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex < q.options.length);
  return {
    generatedBy: raw.generatedBy === "gemini" ? "gemini" : "fallback",
    overview: str(raw.overview),
    sections,
    quiz,
    ...(typeof raw.note === "string" ? { note: raw.note } : {}),
    ...(raw.failed === true ? { failed: true } : {}),
  };
}

function paragraphStat(v: unknown, index: number): ParagraphStat {
  const o = isObj(v) ? v : {};
  return {
    index,
    words: Math.round(num(o.words)),
    status: status(o.status),
    coverage: num(o.coverage, 0, 0, 1),
    dwellSec: num(o.dwellSec),
    expectedSec: num(o.expectedSec),
    rereads: Math.round(num(o.rereads, 0, 0, 1000)),
    wpm: numOrNull(o.wpm, 0, 5000),
  };
}

/**
 * Give a report every field the pages expect, with safe values where something is missing
 * or the wrong type. Used when loading sessions from the database, so an old or damaged
 * row can never crash a page.
 */
export function normalizeReport(raw: unknown): SessionReport {
  const o = isObj(raw) ? raw : {};
  const durationSec = num(o.durationSec, 0, 0, MAX_SESSION_SEC);
  const timeline = timelineOf(o.timeline, durationSec);
  let activeSec = num(o.activeSec, durationSec, 0, durationSec);
  let focusPct = num(o.focusPct, durationSec > 0 ? (activeSec / durationSec) * 100 : 100, 0, 100);
  // Reading time never includes long stretches without reading (see activeReadingSec). Older
  // reports counted them, so they're corrected here when the timeline shows them.
  if (timeline.length) {
    const fromTimeline = Math.round(activeReadingSec(timeline));
    if (fromTimeline < activeSec) {
      activeSec = fromTimeline;
      focusPct = durationSec > 0 ? Math.round((activeSec / durationSec) * 1000) / 10 : 100;
    }
  }
  const wordStatus = arr(o.wordStatus).map(status);
  return {
    durationSec,
    activeSec,
    focusPct,
    coveragePct: num(o.coveragePct, 0, 0, 100),
    wordsRead: Math.round(num(o.wordsRead)),
    avgWpm: numOrNull(o.avgWpm, 0, 5000),
    baselineWpm: numOrNull(o.baselineWpm, 0, 5000),
    calibrationQuality: QUALITIES.includes(o.calibrationQuality as SessionReport["calibrationQuality"])
      ? (o.calibrationQuality as SessionReport["calibrationQuality"])
      : "attention-only",
    calibrationErrorPx: numOrNull(o.calibrationErrorPx),
    paragraphs: arr(o.paragraphs).map(paragraphStat),
    wordStatus,
    distractions: events(o.distractions).map((d) => distraction(d, durationSec)).filter((d): d is DistractionEvent => d !== null),
    timeline,
    nudges: Math.round(num(o.nudges)),
    pagesTurned: Math.round(num(o.pagesTurned)),
  };
}

/**
 * Check a report sent by the reader against the reading it claims to be about, and return
 * a clean copy. Returns an error message when it doesn't fit the reading.
 *
 * The headline numbers (coverage, words read) are recomputed here from the per-word
 * statuses instead of being taken on trust. This keeps a report consistent with itself;
 * it can't prove the student really read the words, because the measuring happens in
 * their browser.
 */
export function checkReport(raw: unknown, reading: Reading): { report: SessionReport } | { error: string } {
  if (!isObj(raw) || !Array.isArray(raw.paragraphs) || !Array.isArray(raw.wordStatus)) return { error: "Missing session report." };
  if (raw.paragraphs.length !== reading.paragraphs.length || raw.wordStatus.length !== countWords(reading.paragraphs))
    return { error: "This report doesn't match the reading. Reload the page and try again." };
  if (typeof raw.durationSec !== "number" || !Number.isFinite(raw.durationSec) || raw.durationSec < 0 || raw.durationSec > MAX_SESSION_SEC)
    return { error: "Missing session report." };

  const report = normalizeReport(raw);
  const read = report.wordStatus.filter((s) => s === "read").length;
  const skimmed = report.wordStatus.filter((s) => s === "skimmed").length;
  const total = Math.max(1, report.wordStatus.length);
  report.wordsRead = read;
  report.coveragePct = Math.round(((read + 0.5 * skimmed) / total) * 1000) / 10;
  report.focusPct = report.durationSec > 0 ? Math.round((report.activeSec / report.durationSec) * 1000) / 10 : 100;
  return { report };
}

/** Check the "pick up where you left off" state saved by "Save & exit". Null when it's unusable. */
export function checkResume(raw: unknown, reading: Reading): ResumeState | null {
  const n = countWords(reading.paragraphs);
  if (!isObj(raw) || !Array.isArray(raw.wordDwell) || raw.wordDwell.length !== n) return null;
  const wordRereads = arr(raw.wordRereads);
  const regressions = events(raw.regressions)
    .filter(isObj)
    .map((r) => ({ from: Math.round(num(r.from, 0, 0, Math.max(0, n - 1))), to: Math.round(num(r.to, 0, 0, Math.max(0, n - 1))) }))
    .filter((r) => r.from <= r.to);
  const elapsedSec = num(raw.elapsedSec, 0, 0, MAX_SESSION_SEC);
  return {
    version: 1,
    elapsedSec,
    firstWord: Math.round(num(raw.firstWord, 0, 0, Math.max(0, n - 1))),
    wordDwell: raw.wordDwell.map((v) => num(v)),
    wordRereads: Array.from({ length: n }, (_, i) => Math.round(num(wordRereads[i]))),
    segments: timelineOf(raw.segments, elapsedSec),
    distractions: events(raw.distractions).map((d) => distraction(d, elapsedSec)).filter((d): d is DistractionEvent => d !== null),
    regressions,
    nudges: Math.round(num(raw.nudges)),
    pagesTurned: Math.round(num(raw.pagesTurned)),
    totalSweeps: Math.round(num(raw.totalSweeps)),
    calibrationQuality: QUALITIES.includes(raw.calibrationQuality as SessionReport["calibrationQuality"])
      ? (raw.calibrationQuality as SessionReport["calibrationQuality"])
      : "attention-only",
    calibrationErrorPx: numOrNull(raw.calibrationErrorPx),
  };
}
