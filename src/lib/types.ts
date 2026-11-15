// Shared data types used by both the server (database) and the browser (reader + reports).

export type Role = "student" | "professor";

export interface User {
  id: string;
  name: string;
  /** What they sign in with (lowercase, unique). */
  username: string;
  /** Only accounts from before usernames have a real one; new accounts don't give an email. */
  email: string;
  role: Role;
  createdAt: string;
  /** Demo accounts sign in with one click; real accounts need a password. */
  demo?: boolean;
  /** Show the whole site in a dyslexia-friendly font (OpenDyslexic). Set on the Settings page. */
  dyslexiaFont?: boolean;
  /** Has a recovery code for resetting a forgotten password (see lib/recoveryCode.ts). */
  hasRecoveryCode?: boolean;
}

export interface Course {
  id: string;
  name: string;
  code: string; // e.g. "ENGL 210"
  term: string;
  professorId: string;
  joinCode: string; // students type this to join
  createdAt: string;
}

export interface Enrollment {
  courseId: string;
  userId: string;
  joinedAt: string;
}

export interface Reading {
  id: string;
  title: string;
  paragraphs: string[];
  wordCount: number;
  ownerId: string;
  courseId: string | null; // null = a student's personal reading
  dueDate: string | null;
  instructions: string;
  source: "paste" | "pdf" | "sample" | "image";
  createdAt: string;
}

/** How well a stretch of text was read. */
export type CoverageStatus = "read" | "skimmed" | "skipped";

export interface ParagraphStat {
  index: number;
  words: number;
  status: CoverageStatus;
  /** 0..1 share of the paragraph's words that were read (skimmed words count half). */
  coverage: number;
  /** Seconds the reader's eyes were estimated to be on this paragraph. */
  dwellSec: number;
  /** Seconds a normal-paced reader would need. */
  expectedSec: number;
  /** Times the reader jumped back to re-read part of this paragraph. */
  rereads: number;
  /** Words per minute while on this paragraph (null if barely looked at). */
  wpm: number | null;
}

export type ReadingState = "reading" | "skimming" | "pausing" | "offtext" | "away";

export interface StateSegment {
  state: ReadingState;
  start: number; // seconds since session start
  end: number;
}

export interface DistractionEvent {
  kind: "away" | "offtext" | "tab";
  start: number; // seconds since session start
  durationSec: number;
  paragraph: number | null; // where in the text it happened
}

export interface SessionReport {
  durationSec: number;
  activeSec: number; // time not distracted
  focusPct: number; // activeSec / durationSec
  coveragePct: number; // share of words read (skimmed counts half)
  wordsRead: number;
  avgWpm: number | null;
  /** The student's own normal pace from the reading calibration (what read/skim was judged against). */
  baselineWpm?: number | null;
  calibrationQuality: "good" | "fair" | "poor" | "attention-only";
  calibrationErrorPx: number | null;
  paragraphs: ParagraphStat[];
  /** status per word (index-aligned with the reading's words) */
  wordStatus: CoverageStatus[];
  distractions: DistractionEvent[];
  timeline: StateSegment[];
  nudges: number;
  pagesTurned: number;
}

export interface SkippedSection {
  paragraphs: number[];
  title: string;
  summary: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

export interface AiResult {
  generatedBy: "gemini" | "fallback";
  overview: string;
  sections: SkippedSection[];
  quiz: QuizQuestion[];
  note?: string;
  /** True when Gemini was asked and didn't answer (as opposed to no key): worth trying again. */
  failed?: boolean;
}

/**
 * Everything needed to pick a paused session back up where it left off. Saved by the
 * reader when a student presses "Save & exit"; the next "Continue reading" restores it.
 */
export interface ResumeState {
  version: 1;
  elapsedSec: number; // session time so far (pauses not counted)
  firstWord: number; // first word of the page they were on
  wordDwell: number[]; // seconds per word (rounded)
  wordRereads: number[];
  segments: StateSegment[];
  distractions: DistractionEvent[];
  regressions: { from: number; to: number }[];
  nudges: number;
  pagesTurned: number;
  totalSweeps: number;
  calibrationQuality: SessionReport["calibrationQuality"];
  calibrationErrorPx: number | null;
}

export type SessionStatus = "paused" | "done";

export interface Session {
  id: string;
  readingId: string;
  userId: string;
  startedAt: string;
  endedAt: string; // last time the session was saved (pause or finish)
  status: SessionStatus;
  /** How many sittings this session took (1 + number of resumes). */
  sittings: number;
  report: SessionReport;
  ai: AiResult | null;
  resume?: ResumeState | null;
  /** Student's own-words recall of each missed section (keyed by section index). */
  recall?: Record<string, { text: string; savedAt: string }>;
}

/** AI (or fallback) lesson plan for a reading, based on how the class read it. */
export interface LessonPlan {
  readingId: string;
  text: string; // markdown-ish plain text
  generatedBy: "gemini" | "fallback";
  createdAt: string;
  basedOnSessions: number;
}

export interface ClassDigest {
  readingId: string;
  text: string;
  generatedBy: "gemini" | "fallback";
  createdAt: string;
}

/**
 * An article read on another website (e.g. the WSJ) and measured by the eyeRead browser
 * extension, then imported into the student's account. Simpler than a Session: the extension
 * only knows per-paragraph read / skimmed / skipped and the time spent.
 */
export interface WebReading {
  id: string;
  userId: string;
  url: string;
  title: string;
  site: string;
  firstSeen: string;
  lastSeen: string;
  importedAt: string;
  totalWords: number;
  coveragePct: number;
  /** Seconds actively on the page (eyes on page when eye tracking was on). */
  activeSec: number;
  /** Of activeSec, seconds measured with eye tracking. */
  eyeSec: number;
  wordsRead: number;
  wordsSkimmed: number;
  wordsSkipped: number;
  /** In article order. Headings have status null. `text` is the first ~100 characters. */
  paragraphs: { status: CoverageStatus | null; words: number; text: string }[];
}
