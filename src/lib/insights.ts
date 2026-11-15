// Combines many students' sessions into class-level numbers for the professor view.
import type { Reading, Session, User } from "./types";
import type { ClassParagraphAggregate } from "./gemini";
import { finishedLate } from "./text";

/**
 * A student's progress on a reading is their BEST session: highest coverage; on a tie a
 * finished session beats one that's paused partway, then the most recent wins. A short
 * re-read (or a new attempt just started) shouldn't make progress look like it went backwards.
 */
export function bestOf(sessions: Session[]): Session | null {
  let best: Session | null = null;
  const done = (s: Session) => (s.status === "paused" ? 0 : 1);
  for (const s of sessions) {
    if (
      !best ||
      s.report.coveragePct > best.report.coveragePct ||
      (s.report.coveragePct === best.report.coveragePct &&
        (done(s) > done(best) || (done(s) === done(best) && s.endedAt > best.endedAt)))
    )
      best = s;
  }
  return best;
}

/** Each student's best session for a reading (see bestOf). */
export function bestPerStudent(sessions: Session[]): Map<string, Session> {
  const byUser = new Map<string, Session[]>();
  for (const s of sessions) byUser.set(s.userId, [...(byUser.get(s.userId) ?? []), s]);
  const map = new Map<string, Session>();
  byUser.forEach((list, user) => {
    const b = bestOf(list);
    if (b) map.set(user, b);
  });
  return map;
}

/** Number of sessions each student has done for a reading. */
export function attemptsPerStudent(sessions: Session[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of sessions) map.set(s.userId, (map.get(s.userId) ?? 0) + 1);
  return map;
}

/**
 * The last paragraph a session got to. A finished session covers the whole reading (anything
 * it didn't read was skipped). A paused one only got as far as the last paragraph read or
 * skimmed so far: what comes after isn't skipped, the student just hasn't reached it yet.
 */
export function reachedUpTo(s: Session): number {
  if (s.status !== "paused") return Infinity;
  let last = -1;
  s.report.paragraphs.forEach((p, i) => {
    if (p.status !== "skipped") last = i;
  });
  return last;
}

/**
 * Class numbers per paragraph, over the students who have reached it (see reachedUpTo), so
 * students still partway through don't make the rest of the reading look skipped.
 */
export function aggregateParagraphs(reading: Reading, sessions: Session[]): ClassParagraphAggregate[] {
  const reach = sessions.map(reachedUpTo);
  return reading.paragraphs.map((text, index) => {
    let skipped = 0, skimmed = 0, rereads = 0, ratio = 0, readers = 0;
    for (let k = 0; k < sessions.length; k++) {
      const s = sessions[k];
      const p = s.report.paragraphs[index];
      if (!p || index > reach[k]) continue;
      readers++;
      if (p.status === "skipped") skipped++;
      if (p.status === "skimmed") skimmed++;
      rereads += p.rereads;
      ratio += p.expectedSec > 0 ? p.dwellSec / p.expectedSec : 0;
    }
    const n = readers || 1;
    return {
      index,
      text,
      skippedPct: (skipped / n) * 100,
      skimmedPct: (skimmed / n) * 100,
      avgRereads: rereads / n,
      avgDwellRatio: ratio / n,
      readers,
    };
  });
}

export interface StudentRow {
  user: User;
  session: Session | null;
  attempts: number;
}

// ---------- Summary statistics ----------

/** Time the student actually had their eyes on the page (session time minus distractions). */
export function eyesOnSec(s: Session): number {
  return s.report.activeSec;
}

export interface StudentSummary {
  assigned: number;
  started: number;
  finished: number; // best coverage ≥ 85%
  onTime: number; // finished before the due date (of those with a due date)
  withDueDate: number;
  avgCoverage: number | null; // across started readings (best session each)
  avgFocus: number | null;
  avgWpm: number | null;
  eyesOnSec: number; // across ALL sessions
  sessions: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** One student's overall numbers for a set of readings (e.g. everything in a course). */
export function studentSummary(readings: Reading[], sessions: Session[]): StudentSummary {
  const ids = new Set(readings.map((r) => r.id));
  const mine = sessions.filter((s) => ids.has(s.readingId));
  const bests = readings.map((r) => ({ r, best: bestOf(mine.filter((s) => s.readingId === r.id)) }));
  const started = bests.filter((b) => b.best);
  const finished = started.filter((b) => b.best!.report.coveragePct >= 85);
  const withDue = readings.filter((r) => r.dueDate);
  const onTime = finished.filter((b) => b.r.dueDate && !finishedLate(b.best!.endedAt, b.r.dueDate));
  return {
    assigned: readings.length,
    started: started.length,
    finished: finished.length,
    onTime: onTime.length,
    withDueDate: withDue.length,
    avgCoverage: mean(started.map((b) => b.best!.report.coveragePct)),
    avgFocus: mean(started.map((b) => b.best!.report.focusPct)),
    avgWpm: mean(started.map((b) => b.best!.report.avgWpm).filter((v): v is number => v !== null)),
    eyesOnSec: mine.reduce((t, s) => t + eyesOnSec(s), 0),
    sessions: mine.length,
  };
}

// ---------- Reading habits ----------

export interface Habit {
  id: string;
  title: string;
  detail: string;
  tone: "good" | "watch" | "neutral";
}

/**
 * Patterns across a student's sessions: when skimming kicks in, whether focus fades,
 * whether the ends of readings get skipped, how long their best sessions are, pace trend.
 * Everything needs a minimum amount of data; with too little we say nothing rather than guess.
 */
export function readingHabits(sessions: Session[], readingsById: Map<string, Reading>): Habit[] {
  const habits: Habit[] = [];
  const done = sessions.filter((s) => s.report.durationSec >= 60);
  if (done.length < 2) return habits;
  const fmtMin = (sec: number) => `${Math.round(sec / 60)} min`;

  // 1) When does skimming start? Share of on-text time spent skimming, per 5-minute block.
  const gazeSessions = done.filter((s) => s.report.calibrationQuality !== "attention-only");
  const BLOCK = 300;
  const blocks: { skim: number; on: number }[] = [];
  for (const s of gazeSessions) {
    for (const seg of s.report.timeline) {
      if (seg.state === "away" || seg.state === "offtext") continue;
      for (let b = Math.floor(seg.start / BLOCK); b * BLOCK < seg.end; b++) {
        const overlap = Math.min(seg.end, (b + 1) * BLOCK) - Math.max(seg.start, b * BLOCK);
        if (overlap <= 0) continue;
        blocks[b] ??= { skim: 0, on: 0 };
        blocks[b].on += overlap;
        if (seg.state === "skimming") blocks[b].skim += overlap;
      }
    }
  }
  const shares = blocks.map((b) => (b && b.on >= 120 ? b.skim / b.on : null));
  const base = shares[0];
  if (base !== null && base !== undefined) {
    const onset = shares.findIndex((v, i) => i > 0 && v !== null && v >= 0.2 && v >= base * 1.6 + 0.05);
    if (onset > 0)
      habits.push({
        id: "skim-onset",
        title: `You start skimming after about ${onset * 5} minutes`,
        detail: `In the first 5 minutes you skim ${Math.round(base * 100)}% of the time; by minute ${onset * 5} it's ${Math.round(shares[onset]! * 100)}%. Try a short break around minute ${Math.max(5, onset * 5 - 5)}. Pausing keeps your place and your progress.`,
        tone: "watch",
      });
    else if (shares.filter((v) => v !== null).length >= 3)
      habits.push({ id: "skim-steady", title: "Your reading stays steady in long sessions", detail: "Skimming doesn't creep up as sessions go on. Nice stamina.", tone: "good" });
  }

  // 2) Does focus fade? Distraction time in the first vs second half of sessions.
  const longOnes = done.filter((s) => s.report.durationSec >= 600);
  if (longOnes.length >= 2) {
    let first = 0, second = 0;
    for (const s of longOnes) {
      const half = s.report.durationSec / 2;
      for (const d of s.report.distractions) {
        if (d.start < half) first += d.durationSec;
        else second += d.durationSec;
      }
    }
    if (second > first * 1.8 && second > 60)
      habits.push({
        id: "focus-fade",
        title: "Your focus fades in the second half of long sessions",
        detail: `You were distracted ${fmtMin(second)} in second halves vs ${fmtMin(first)} in first halves. Splitting long readings into two sittings could help.`,
        tone: "watch",
      });
  }

  // 3) Skipping the end of readings: skip rate in the last third vs the rest.
  let endSkip = 0, endWords = 0, restSkip = 0, restWords = 0;
  for (const s of done) {
    const n = s.report.wordStatus.length;
    if (n < 300) continue;
    s.report.wordStatus.forEach((st, i) => {
      const skipped = st === "skipped" ? 1 : 0;
      if (i >= (2 * n) / 3) {
        endSkip += skipped;
        endWords++;
      } else {
        restSkip += skipped;
        restWords++;
      }
    });
  }
  if (endWords > 0 && restWords > 0) {
    const e = endSkip / endWords, r = restSkip / restWords;
    if (e >= 0.3 && e > r * 1.8)
      habits.push({
        id: "end-skip",
        title: "You tend to skip the last part of readings",
        detail: `You skipped ${Math.round(e * 100)}% of the final third, compared with ${Math.round(r * 100)}% of the rest. Conclusions often hold the main argument.`,
        tone: "watch",
      });
  }

  // 4) Session length sweet spot: coverage of short vs long sessions on long readings.
  const sized = done.filter((s) => (readingsById.get(s.readingId)?.wordCount ?? 0) >= 1200);
  const short = sized.filter((s) => s.report.durationSec < 1200), long = sized.filter((s) => s.report.durationSec >= 1200);
  if (short.length >= 2 && long.length >= 2) {
    const cs = mean(short.map((s) => s.report.coveragePct))!, cl = mean(long.map((s) => s.report.coveragePct))!;
    if (cs - cl >= 15)
      habits.push({
        id: "short-better",
        title: "You read more carefully in shorter sittings",
        detail: `Sessions under 20 minutes average ${Math.round(cs)}% coverage; longer ones ${Math.round(cl)}%. Pause and come back instead of pushing through.`,
        tone: "watch",
      });
  }

  // 5) Re-reading: a good habit when it's targeted.
  const rereadSessions = done.filter((s) => s.report.paragraphs.some((p) => p.rereads > 0)).length;
  if (rereadSessions / done.length >= 0.5)
    habits.push({
      id: "rereads",
      title: "You go back over tricky passages",
      detail: `You re-read something in ${rereadSessions} of ${done.length} sessions. That's what strong readers do with hard material.`,
      tone: "good",
    });

  // 6) Pace trend: last 3 vs first 3 sessions with a speed.
  const paced = [...done].filter((s) => s.report.avgWpm).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  if (paced.length >= 4) {
    const k = Math.min(3, Math.floor(paced.length / 2));
    const a = mean(paced.slice(0, k).map((s) => s.report.avgWpm!))!, b = mean(paced.slice(-k).map((s) => s.report.avgWpm!))!;
    if (Math.abs(b - a) / a >= 0.15)
      habits.push({
        id: "pace",
        title: b > a ? "You're reading faster than when you started" : "You've slowed down lately",
        detail: `${Math.round(a)} → ${Math.round(b)} words per minute. ${b > a ? "Check your coverage is holding up too." : "Slower can mean harder readings, or more careful reading."}`,
        tone: "neutral",
      });
  }

  // 7) Coverage overall
  const avgCov = mean(done.map((s) => s.report.coveragePct))!;
  if (avgCov >= 85) habits.push({ id: "thorough", title: "You read thoroughly", detail: `Your sessions average ${Math.round(avgCov)}% coverage.`, tone: "good" });
  return habits;
}

/**
 * Students whose data changed after `sinceIso` (their best session is newer, or was continued
 * since). Used to say an AI class summary or lesson plan is out of date.
 */
export function studentsChangedSince(best: Map<string, Session>, sinceIso: string): number {
  let n = 0;
  best.forEach((s) => {
    if (s.endedAt > sinceIso) n++;
  });
  return n;
}

/** Total eyes-on reading time per student across ALL their sessions (not just the best one). */
export function totalEyesOnPerStudent(sessions: Session[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of sessions) map.set(s.userId, (map.get(s.userId) ?? 0) + s.report.activeSec);
  return map;
}

/** "1 reading" / "3 readings" */
export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}
