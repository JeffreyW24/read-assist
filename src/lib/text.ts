// Text helpers shared by the server and the browser.

/** Split a paragraph into words exactly the same way everywhere (reader, report, server). */
export function splitWords(paragraph: string): string[] {
  return paragraph.split(/\s+/).filter(Boolean);
}

export function countWords(paragraphs: string[]): number {
  return paragraphs.reduce((n, p) => n + splitWords(p).length, 0);
}

/** A short line without ending punctuation is treated as a heading. */
export function isHeading(paragraph: string): boolean {
  const t = paragraph.trim();
  return t.length > 0 && t.length < 90 && !/[.!?:;,"”’)]$/.test(t) && splitWords(t).length <= 12;
}

/**
 * Turn pasted text into paragraphs. Blank lines separate paragraphs; if the text has
 * no blank lines at all, every line break is treated as a paragraph break.
 */
export function toParagraphs(raw: string): string[] {
  const text = raw.replace(/\r\n?/g, "\n").replace(/ /g, " ").trim();
  if (!text) return [];
  const hasBlankLines = /\n\s*\n/.test(text);
  const blocks = hasBlankLines ? text.split(/\n\s*\n/) : text.split("\n");
  return blocks
    .map((b) =>
      b
        .replace(/(\w)-\n(\w)/g, "$1$2") // re-join hyphenated line breaks
        .replace(/\s*\n\s*/g, " ")
        .replace(/[ \t]+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

/** Estimated reading minutes at a typical college pace. */
export function estimateMinutes(wordCount: number, wpm = 240): number {
  return Math.max(1, Math.round(wordCount / wpm));
}

export function formatDuration(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m}m ${r}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/**
 * Due dates are calendar days, not moments in time. We store them as noon UTC on the day the
 * professor picked and display them by their UTC date, so everyone sees the same day no
 * matter their timezone (older entries saved at midnight UTC also show the right day).
 */
export function formatDueDate(iso: string | null): string {
  if (!iso || !isValidDate(iso)) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * The app's time zone: US Eastern (EST, or EDT in summer). "Today", "finished on time" and the
 * dates shown on pages all use it, so the server (which runs in UTC) and every student agree on
 * which day it is. A reading due Nov 20 is on time until 11:59 pm Eastern on Nov 20.
 */
export const APP_TIME_ZONE = "America/New_York";

/** Can this be read as a real date? (A bad one must never crash a page.) */
export function isValidDate(v: string | Date): boolean {
  return !Number.isNaN((typeof v === "string" ? new Date(v) : v).getTime());
}

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** The calendar day ("2026-11-20") a moment falls on, in Eastern time; "" if it isn't a real date. */
export function appDay(moment: string | Date): string {
  const d = typeof moment === "string" ? new Date(moment) : moment;
  return isValidDate(d) ? dayFormat.format(d) : "";
}

/** The calendar day a reading is due ("2026-11-20"); see formatDueDate for how it's stored. "" if unreadable. */
export function dueDay(dueIso: string): string {
  const d = new Date(dueIso);
  return isValidDate(d) ? d.toISOString().slice(0, 10) : "";
}

/** Was something finished (at `endedIso`) after its due day ended, in Eastern time? */
export function finishedLate(endedIso: string, dueIso: string | null): boolean {
  if (!dueIso) return false;
  const due = dueDay(dueIso), ended = appDay(endedIso);
  return !!due && !!ended && ended > due;
}

/**
 * Is a due date in the past? Compares calendar days: the due day against today in Eastern
 * time. A reading due today is not overdue yet.
 */
export function isPastDue(dueIso: string | null, now = new Date()): boolean {
  const due = dueIso ? dueDay(dueIso) : "";
  return !!due && appDay(now) > due;
}

/** Turn a date-input value ("2026-11-20") into the stored due date (noon UTC that day). */
export function dueDateFromInput(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (m) {
    // Only real calendar days: "2026-02-31" isn't one (Date would quietly make it Mar 3).
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const t = new Date(Date.UTC(y, mo - 1, d, 12));
    return y >= 2000 && y <= 2100 && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? t.toISOString() : null;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2000 || d.getUTCFullYear() > 2100 ? null : d.toISOString();
}

export function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: APP_TIME_ZONE });
}
