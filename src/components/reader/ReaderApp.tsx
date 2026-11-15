"use client";
// Orchestrates a reading session: camera setup → calibration → reading → saving the report.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FaceTracker } from "@/lib/gaze/faceTracker";
import { gazeEngine, WebEyeTrackSource } from "@/lib/gaze/webEyeTrackSource";
import type { TrackingMode } from "@/lib/gaze/readingTracker";
import type { ResumeState, SessionReport } from "@/lib/types";
import { Calibration, type CalibrationResult } from "./Calibration";
import { applyReadingCalibration, ReadingCalibration } from "./ReadingCalibration";
import { ReaderView, lineHeightFor, loadPrefs, type ReaderPrefs } from "./ReaderView";
import { Setup, type CameraState } from "./Setup";
import { enterFullscreen, FullscreenGate, useOutOfFullscreen } from "./fullscreen";
import { fromSaved, sameScreen, toSaved, type SavedCalibration } from "@/lib/gaze/savedCalibration";
import { loadPace } from "@/lib/gaze/readingPace";
import { errorMessage, jsonBody } from "@/lib/http";

// calibrate = the dots; readcal = the reading-pace passage. Both are skipped when the student
// has a saved calibration (calibrate once per account; Recalibrate redoes them).
type Phase = "setup" | "calibrate" | "readcal" | "reading" | "saving";

export function ReaderApp({
  readingId,
  title,
  instructions = "",
  paragraphs,
  backHref,
  resume,
  savedCalibration,
}: {
  readingId: string;
  title: string;
  /** The teacher's instructions, shown before the student starts ("" = none). */
  instructions?: string;
  paragraphs: string[];
  backHref: string;
  /** A paused session to continue, if the student has one for this reading. */
  resume: { sessionId: string; state: ResumeState } | null;
  /** The student's saved calibration (calibrate once per account), if any. */
  savedCalibration: SavedCalibration | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("setup");
  const [cameraState, setCameraState] = useState<CameraState>("off");
  const [mode, setMode] = useState<TrackingMode>("gaze");
  const [calibration, setCalibration] = useState<CalibrationResult | null>(null);
  /** Dot calibration result, waiting for the reading step to refine it. */
  const [dotCalibration, setDotCalibration] = useState<CalibrationResult | null>(null);
  const [prefs, setPrefs] = useState<ReaderPrefs | null>(null);
  const [saveError, setSaveError] = useState("");
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [tracker] = useState(() => new FaceTracker());
  // WebEyeTrack (default engine) rides on the FaceTracker's frames; null = MediaPipe + ridge.
  const [wet, setWet] = useState<WebEyeTrackSource | null>(null);
  const wetLoad = useRef<Promise<WebEyeTrackSource | null> | null>(null);
  const startedAt = useRef(new Date().toISOString());
  // `saveId` stays the same when "Try again" resends a save, so the server never stores it twice.
  const pendingSave = useRef<{ report: SessionReport; state: ResumeState | null; saveId: string } | null>(null);
  const [pausing, setPausing] = useState(false);
  const [saved, setSaved] = useState(savedCalibration);
  // Calibrate once per account: a saved calibration is always reused (the student can press
  // Recalibrate), as long as the engine is the default one, the only one that can be saved.
  // The engine comes from the URL, so it's only known in the browser.
  const engine = useSyncExternalStore(noSubscribe, gazeEngine, () => null);
  // ...and only on the screen it was made on (another computer or an external monitor needs
  // its own). Like the engine, the screen is only known in the browser.
  const onSavedScreen = useSyncExternalStore(noSubscribe, () => !saved || sameScreen(saved), () => true);
  const savedUsable = !!saved && engine === "mediapipe" && onSavedScreen;

  /** Save a new calibration to the account, replacing the old one (best effort). */
  function saveToAccount(c: CalibrationResult) {
    const s = toSaved(c, saved?.secPerWord ?? loadPace()?.secPerWord ?? null);
    if (!s) return; // this engine's calibration can't be saved
    setSaved(s);
    void fetch("/api/calibration", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ calibration: s }) })
      .then((res) => {
        if (!res.ok) console.warn("[calibration] not saved", res.status);
      })
      .catch((e) => console.warn("[calibration] not saved", e));
  }

  useEffect(() => () => tracker.stop(), [tracker]);
  useEffect(() => () => wet?.dispose(), [wet]); // stops its worker

  /** Load WebEyeTrack once. If it fails, fall back to the MediaPipe + ridge pipeline. */
  function loadWet(): Promise<WebEyeTrackSource | null> {
    if (gazeEngine() !== "webeyetrack") return Promise.resolve(null);
    wetLoad.current ??= WebEyeTrackSource.create().catch((e) => {
      console.warn("[webeyetrack] unavailable, using MediaPipe + ridge", e);
      return null;
    });
    return wetLoad.current;
  }

  async function startCamera() {
    if (!video) return;
    setCameraState("loading");
    try {
      const [, w] = await Promise.all([tracker.start(video), loadWet()]);
      if (w) w.attach(tracker);
      setWet(w);
      setCameraState("on");
    } catch (e) {
      const name = (e as DOMException)?.name;
      console.warn("[camera]", e);
      tracker.stop(); // release anything half-started
      setCameraState(
        name === "NotAllowedError" || name === "SecurityError"
          ? "denied"
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "missing"
            : name === "NotReadableError" || name === "AbortError"
              ? "busy"
              : "error",
      );
    }
  }

  function beginReading(m: TrackingMode, c: CalibrationResult | null) {
    setMode(m);
    setCalibration(c);
    startedAt.current = new Date().toISOString();
    setPhase("reading");
  }

  // Finishing (state = null) builds the report; pausing (state given) saves progress to resume later.
  async function save(report: SessionReport, state: ResumeState | null, saveId: string = newSaveId()) {
    pendingSave.current = { report, state, saveId };
    setPausing(!!state);
    setPhase("saving");
    setSaveError("");
    wet?.detach();
    tracker.stop();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          readingId,
          sessionId: resume?.sessionId ?? null,
          saveId,
          startedAt: startedAt.current,
          endedAt: new Date().toISOString(),
          status: state ? "paused" : "done",
          report,
          resume: state,
        }),
      });
      const data = await jsonBody(res);
      if (!res.ok || typeof data.id !== "string") throw new Error(errorMessage(res, data, "Save failed."));
      router.push(state ? `${backHref}?paused=1` : `/reports/${data.id}`);
    } catch (e) {
      setSaveError((e as Error).message);
    }
  }

  const lineH = prefs ? lineHeightFor(prefs) : 50;
  // Calibration and reading require full screen (see fullscreen.tsx). Calibration and the
  // pace passage are taken down while out of it, so they start again on return.
  const outOfFullscreen = useOutOfFullscreen();
  const blocked = outOfFullscreen && (phase === "calibrate" || phase === "readcal" || phase === "reading");

  return (
    <>
      {/* The camera feed lives here for the whole session (hidden; the tracker reads it). */}
      {/* aria-hidden: an empty <video> otherwise announces "Unable to play media" to screen readers. */}
      {/* suppressHydrationWarning: video extensions (speed controllers, PiP tools) tag every
          <video> with attributes like data-video="0" before React hydrates. Attributes only. */}
      <video
        suppressHydrationWarning
        ref={setVideo}
        aria-hidden="true"
        tabIndex={-1}
        className="fixed bottom-0 right-0 pointer-events-none"
        style={{ width: 160, height: 120, opacity: 0 }}
        muted
        playsInline
        disablePictureInPicture
      />

      {phase === "setup" && (
        <Setup
          tracker={tracker}
          video={video}
          cameraState={cameraState}
          onStartCamera={startCamera}
          onCalibrate={() => {
            setPrefs(loadPrefs());
            enterFullscreen();
            setPhase("calibrate");
          }}
          savedCalibrationAt={savedUsable && saved ? saved.savedAt : null}
          calibrationNote={saved && engine === "mediapipe" && !onSavedScreen ? "Your saved calibration was made on a different screen, so this one needs its own." : null}
          onUseSaved={() => {
            if (!saved) return;
            setPrefs(loadPrefs());
            enterFullscreen();
            beginReading("gaze", fromSaved(saved));
          }}
          onSkipTracking={(m) => {
            setPrefs(loadPrefs());
            enterFullscreen();
            beginReading(m, null);
          }}
          title={title}
          instructions={instructions}
          backHref={backHref}
          resuming={!!resume}
        />
      )}

      {blocked && <FullscreenGate reading={phase === "reading"} />}

      {phase === "calibrate" && !blocked && (
        <Calibration
          tracker={tracker}
          wet={wet}
          lineHeight={lineH}
          onCancel={() => setPhase("setup")}
          onAttentionOnly={() => beginReading("attention", null)}
          onDone={(r) => {
            setDotCalibration(r);
            setPhase("readcal");
          }}
        />
      )}

      {phase === "readcal" && dotCalibration && prefs && !blocked && (
        <ReadingCalibration
          prefs={prefs}
          onDone={(o) => {
            const c = applyReadingCalibration(dotCalibration, o);
            saveToAccount(c);
            beginReading("gaze", c);
          }}
          onSkip={() => {
            saveToAccount(dotCalibration);
            beginReading("gaze", dotCalibration);
          }}
        />
      )}

      {phase === "reading" && prefs && (
        <ReaderView
          title={title}
          paragraphs={paragraphs}
          tracker={mode === "none" ? null : tracker}
          wet={wet}
          mode={mode}
          calibration={calibration}
          initialPrefs={prefs}
          resume={resume?.state ?? null}
          onFinish={(r) => save(r, null)}
          onPause={(r, st) => save(r, st)}
          onRecalibrated={saveToAccount}
          outOfFullscreen={blocked}
        />
      )}

      {phase === "saving" && (
        <div className="fixed inset-0 flex items-center justify-center bg-bg">
          <div className="text-center max-w-sm px-6">
            {saveError ? (
              <>
                <p className="font-medium">Couldn&apos;t save your session</p>
                <p className="text-sm text-muted mt-1">{saveError}</p>
                <button className="btn btn-primary mt-5" onClick={() => pendingSave.current && save(pendingSave.current.report, pendingSave.current.state, pendingSave.current.saveId)}>
                  Try again
                </button>
              </>
            ) : (
              <>
                <div className="mx-auto h-8 w-8 rounded-full border-2 border-border border-t-accent animate-spin" />
                <p className="font-medium mt-5">{pausing ? "Saving your place…" : "Building your report…"}</p>
                <p className="text-sm text-muted mt-1">
                  {pausing ? "Your progress is kept. Pick up right where you left off any time." : "Summarizing anything you skipped. This takes a few seconds."}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function newSaveId(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** The gaze engine is fixed for the page's lifetime: nothing to subscribe to. */
const noSubscribe = () => () => {};
