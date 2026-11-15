// "Reading time" = time the student was actually reading, used everywhere in the app.
// Shared by the reader (which builds the report) and the server (which checks it).
import type { StateSegment } from "./types";

/**
 * A stretch without reading (pausing on the text, looking off it, looking away, another tab)
 * longer than this doesn't count at all: the text was open but the student wasn't reading.
 * The clock picks up again once the eye tracker sees them reading.
 */
export const IDLE_CUTOFF_SEC = 5 * 60;

const isReading = (s: StateSegment["state"]) => s === "reading" || s === "skimming";

/**
 * Seconds of reading in a session's timeline:
 *   • reading and skimming always count;
 *   • a short pause on the text (thinking, looking at a figure) counts, as long as the whole
 *     non-reading stretch it belongs to is at most IDLE_CUTOFF_SEC;
 *   • looking away / off the text / another tab never counts (those are distractions);
 *   • a non-reading stretch longer than IDLE_CUTOFF_SEC counts for nothing.
 */
export function activeReadingSec(segments: StateSegment[]): number {
  const sorted = [...segments].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  let total = 0;
  let idle: StateSegment[] = []; // the current run of non-reading segments
  const closeIdle = () => {
    if (idle.length) {
      const span = idle[idle.length - 1].end - idle[0].start;
      if (span <= IDLE_CUTOFF_SEC) for (const s of idle) if (s.state === "pausing") total += s.end - s.start;
    }
    idle = [];
  };
  for (const s of sorted) {
    if (isReading(s.state)) {
      closeIdle();
      total += s.end - s.start;
    } else idle.push(s);
  }
  closeIdle();
  return total;
}
