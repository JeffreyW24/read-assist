"use client";
// Reading pace: after the dots, the student reads a short passage laid out exactly like the
// reader, and we time it. That gives *their* normal pace, so read vs skimmed is judged against
// how fast they read rather than an assumed 240 wpm. It is not used to correct the gaze: a
// correction learned from one passage could throw the gaze off the page for the rest of the
// session.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PACE_MAX_WPM, paceFrom, savePace } from "@/lib/gaze/readingPace";
import type { CalibrationResult } from "./Calibration";
import { FONT_VAR, readerGeometry, type ReaderPrefs } from "./ReaderView";

/**
 * ~200 everyday words: more than fills one reader page at the usual sizes, so the timing
 * covers a full page of real reading. Words past the page bottom are hidden and not counted.
 */
const PASSAGE =
  "Honeybees find their way home by using the sun as a compass. Before a bee leaves the hive, it notes the angle " +
  "between the sun and the path it plans to fly. On the way back, it simply reverses that angle. Thin clouds do not " +
  "confuse it much, because bees can sense patterns in the light that passes through them. The harder problem is " +
  "time. The sun moves across the sky, so an angle that worked in the morning would lead a bee astray by afternoon. " +
  "Bees solve this with an internal clock that shifts the angle as the hours pass, even when every landmark around " +
  "them is new. Scientists noticed this by moving a hive a long way overnight. The next morning, the bees left at the " +
  "angle that would have been right at home, and flew off in the wrong direction. Within a few days, though, they had " +
  "learned the new area and adjusted. Bees also share what they find. A forager that discovers flowers returns and " +
  "performs a short dance on the comb. The direction of the dance tells the others which way to fly, measured against " +
  "the sun, and its length tells them roughly how far to go.";
const WORDS = PASSAGE.split(/\s+/);

export interface ReadingCalibrationOutcome {
  pace: { wpm: number; secPerWord: number } | null;
}

/** Add the measured reading pace to the dot calibration's result (the gaze is left as it is). */
export function applyReadingCalibration(cal: CalibrationResult, o: ReadingCalibrationOutcome): CalibrationResult {
  return o.pace ? { ...cal, secPerWord: o.pace.secPerWord } : cal;
}

type Phase = "intro" | "reading" | "result";

export function ReadingCalibration({
  prefs,
  onDone,
  onSkip,
}: {
  prefs: ReaderPrefs;
  onDone: (o: ReadingCalibrationOutcome) => void;
  onSkip: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [outcome, setOutcome] = useState<(ReadingCalibrationOutcome & { tooFast: boolean; seconds: number }) | null>(null);
  const textRef = useRef<HTMLDivElement>(null);
  /** Words actually shown (the passage is cut at the bottom of the page). */
  const shownWords = useRef(WORDS.length);
  const startedAt = useRef(0);

  useEffect(() => {
    const upd = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    upd();
    window.addEventListener("resize", upd);
    return () => window.removeEventListener("resize", upd);
  }, []);

  const g = readerGeometry(vp.w, vp.h, prefs);

  // Once the passage is on screen: hide what doesn't fit the page, count the rest, start the clock.
  useLayoutEffect(() => {
    if (phase !== "reading" || !textRef.current) return;
    const pageBottom = g.pageTop + g.pageH;
    let shown = 0;
    for (const el of Array.from(textRef.current.querySelectorAll<HTMLElement>("[data-w]"))) {
      // Same page height as the reader: hide whatever doesn't fit.
      const fits = el.getBoundingClientRect().bottom <= pageBottom;
      el.style.visibility = fits ? "" : "hidden";
      if (fits) shown++;
    }
    shownWords.current = shown;
    startedAt.current = performance.now() / 1000;
  }, [phase, g.pageTop, g.pageH]);

  function finish() {
    const end = performance.now() / 1000;
    const seconds = end - startedAt.current;
    const pace = paceFrom(shownWords.current, seconds);
    const tooFast = !pace && shownWords.current / (seconds / 60) > PACE_MAX_WPM;
    setOutcome({ pace, tooFast, seconds });
    setPhase("result");
  }

  useEffect(() => {
    if (phase !== "reading") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        finish();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  function accept() {
    if (!outcome) return;
    if (outcome.pace) savePace(outcome.pace.wpm);
    onDone({ pace: outcome.pace });
  }

  return (
    <div className="fixed inset-0 z-50 reader-surface select-none">
      {phase === "intro" && (
        <CenterCard>
          <h2 className="text-xl font-semibold">One more step: read a short passage</h2>
          <p className="text-muted mt-2 leading-relaxed">
            <b className="text-fg">Read it once, at your normal pace</b>, the way you&apos;d read for class. Then press{" "}
            <b className="text-fg">Space</b> (or click Done).
          </p>
          <p className="text-muted mt-3 text-sm leading-relaxed">
            This teaches eyeRead how fast <i>you</i> read, so reading and skimming are judged against your own
            pace. About 45 seconds.
          </p>
          <div className="mt-6 flex gap-2 justify-end">
            <button className="btn btn-ghost" onClick={onSkip}>
              Skip
            </button>
            <button className="btn btn-primary" onClick={() => setPhase("reading")}>
              Show the passage
            </button>
          </div>
        </CenterCard>
      )}

      {phase === "reading" && vp.w > 0 && (
        <>
          <div
            ref={textRef}
            className="absolute"
            style={{
              left: g.pageLeft,
              top: g.pageTop,
              width: g.pageW,
              fontSize: g.fontPx,
              lineHeight: g.lineHeightRatio,
              fontFamily: FONT_VAR[prefs.font],
            }}
          >
            {WORDS.map((w, i) => (
              <span key={i} data-w="">
                {w}{" "}
              </span>
            ))}
          </div>
          <div className="fixed left-0 right-0 bottom-6 flex justify-center">
            <button className="btn btn-primary" onClick={finish}>
              Done (Space)
            </button>
          </div>
        </>
      )}

      {phase === "result" && outcome && (
        <CenterCard>
          {outcome.tooFast ? (
            <>
              <h2 className="text-xl font-semibold">That was quicker than reading</h2>
              <p className="text-muted mt-2 leading-relaxed">
                {Math.round(outcome.seconds)} seconds is skimming pace for this passage. To learn your pace, please read it
                through normally.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold">Got it</h2>
              <p className="mt-3 text-sm leading-relaxed">
                {outcome.pace ? (
                  <>
                    Your reading pace: <b>{outcome.pace.wpm} words per minute</b>. Reading and skimming will be judged against it.
                  </>
                ) : (
                  <span className="text-muted">We couldn&apos;t measure a normal reading pace from that, so we&apos;ll use a typical one.</span>
                )}
              </p>
            </>
          )}
          <div className="mt-6 flex flex-wrap gap-2 justify-end">
            <button className="btn btn-ghost" onClick={() => setPhase("reading")}>
              Read it again
            </button>
            {!outcome.tooFast && (
              <button className="btn btn-primary" onClick={accept}>
                Start reading
              </button>
            )}
            {outcome.tooFast && (
              <button className="btn btn-ghost" onClick={onSkip}>
                Skip
              </button>
            )}
          </div>
        </CenterCard>
      )}
    </div>
  );
}

function CenterCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div className="card max-w-lg w-full p-7 fade-in">{children}</div>
    </div>
  );
}
