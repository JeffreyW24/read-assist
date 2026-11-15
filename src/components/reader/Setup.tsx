"use client";
// Pre-session check: turn on the camera and make sure face, distance and lighting look OK.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FaceFrame, FaceTracker } from "@/lib/gaze/faceTracker";
import { IconArrowLeft, IconCamera, IconCheck } from "@/components/icons";
import { TeacherNote } from "@/components/TeacherNote";

type Check = "ok" | "warn" | "bad" | "wait";

// Thresholds for the pre-calibration checks. First guesses: tune them against real sessions.
/** Eye width (corner to corner) in camera pixels below which tracking gets coarse. At 720p on
 *  a laptop camera this is roughly 55–60 cm away. Closer = more iris pixels per line of text. */
const EYE_PX_MIN = 40;
/** Face too close: eye-corner distance above this share of the image width. */
const FACE_SIZE_MAX = 0.26;
/** Share of near-white pixels around the eyes above which glare likely hides the iris. */
const GLARE_MAX = 0.04;
/** Average brightness around the eyes below which the face is in shadow (e.g. backlit). */
const EYE_LUMA_MIN = 70;
export type CameraState = "off" | "loading" | "on" | "denied" | "missing" | "busy" | "error";

const CAMERA_PROBLEM: Partial<Record<CameraState, { title: string; body: string }>> = {
  denied: {
    title: "Camera access is blocked",
    body: "To use eye tracking, click the camera icon in your browser's address bar, choose Allow, then press Try again (or reload). On a Mac, also check System Settings → Privacy & Security → Camera.",
  },
  missing: { title: "No camera found", body: "We couldn't find a webcam on this device." },
  busy: {
    title: "Your camera is busy",
    body: "Another app (like Zoom or FaceTime) may be using it. Close that app, then press Try again.",
  },
  error: { title: "Couldn't start eye tracking", body: "The camera or the on-device eye tracker failed to start." },
};

export function Setup({
  tracker,
  video,
  cameraState,
  onStartCamera,
  onCalibrate,
  onSkipTracking,
  savedCalibrationAt = null,
  calibrationNote = null,
  onUseSaved,
  title,
  instructions = "",
  backHref,
  resuming = false,
}: {
  tracker: FaceTracker;
  video: HTMLVideoElement | null;
  cameraState: CameraState;
  onStartCamera: () => void;
  onCalibrate: () => void;
  onSkipTracking: (mode: "attention" | "none") => void;
  /** When the student's saved calibration (usable on this screen) was made; null = none. */
  savedCalibrationAt?: string | null;
  /** Why a saved calibration isn't being offered (shown under Calibrate & start); null = nothing to say. */
  calibrationNote?: string | null;
  /** Start reading with the saved calibration. */
  onUseSaved?: () => void;
  title: string;
  /** The teacher's instructions for this reading ("" = none). */
  instructions?: string;
  backHref: string;
  resuming?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef<FaceFrame | null>(null);
  const [checks, setChecks] = useState<{
    face: Check;
    distance: Check;
    light: Check;
    center: Check;
    glare: Check;
    distanceText: string;
    lightText: string;
  }>({
    face: "wait",
    distance: "wait",
    light: "wait",
    center: "wait",
    glare: "wait",
    distanceText: "Distance",
    lightText: "Lighting",
  });

  useEffect(() => tracker.subscribe((f) => (latest.current = f)), [tracker]);

  // Mirror the hidden camera video into a preview canvas.
  useEffect(() => {
    if (cameraState !== "on" || !video) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvasRef.current;
      if (!c || video.readyState < 2) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      c.width = 480;
      c.height = 360;
      ctx.save();
      ctx.translate(480, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, 480, 360);
      ctx.restore();
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [cameraState, video]);

  useEffect(() => {
    if (cameraState !== "on") return;
    const id = setInterval(() => {
      const f = latest.current;
      if (!f) return;
      const recent = performance.now() / 1000 - f.t < 0.5;
      const face: Check = recent && f.face ? "ok" : "bad";
      // Distance: judged by how many pixels the camera has on your eyes (works for any camera).
      const tooFar = f.face && f.eyePx < EYE_PX_MIN;
      const tooClose = f.face && f.faceSize > FACE_SIZE_MAX;
      const distance: Check = !f.face ? "wait" : tooFar || tooClose ? "warn" : "ok";
      const distanceText = !f.face
        ? "Distance"
        : tooFar
          ? "Move closer: tracking is sharper when your eyes are bigger to the camera"
          : tooClose
            ? "Move back a little"
            : "Distance looks good";
      // Lighting: the whole image (room) must not be too dark; the face itself should be lit.
      const shadowed = f.eyes !== null && f.eyes.luma < EYE_LUMA_MIN;
      const light: Check = f.brightness === null ? "wait" : f.brightness < 55 ? "bad" : f.brightness < 85 || shadowed ? "warn" : "ok";
      const lightText =
        light === "bad"
          ? "Too dark: add light in front of you"
          : shadowed
            ? "Your face is in shadow: face a light, not a window behind you"
            : light === "warn"
              ? "A bit dim"
              : "Lighting";
      // Glare: bright reflections over the eyes (usually on glasses) hide the iris.
      const glare: Check = !f.face || !f.eyes ? "wait" : f.eyes.glare > GLARE_MAX ? "warn" : "ok";
      const center: Check = !f.face ? "wait" : Math.abs(f.faceX - 0.5) > 0.2 || Math.abs(f.faceY - 0.5) > 0.22 ? "warn" : "ok";
      setChecks({ face, distance, light, center, glare, distanceText, lightText });
    }, 250);
    return () => clearInterval(id);
  }, [cameraState]);

  const { distanceText, lightText } = checks;
  const glareText =
    checks.glare === "warn" ? "Glare on your eyes or glasses: move the light to the side or tilt the screen" : "No glare on your eyes";
  const ready = checks.face === "ok" && checks.light !== "bad";

  return (
    <div className="min-h-screen flex flex-col">
      <div className="px-6 h-14 flex items-center">
        <Link href={backHref} className="inline-flex items-center gap-2 text-sm text-muted hover:text-fg">
          <IconArrowLeft size={16} /> Back
        </Link>
      </div>
      <div className="flex-1 flex items-center justify-center px-6 pb-12">
        <div className="w-full max-w-3xl grid md:grid-cols-[1fr_300px] gap-6 items-start">
          <div className="card overflow-hidden">
            <div className="relative aspect-[4/3] bg-surface-2 flex items-center justify-center">
              {cameraState === "on" ? (
                <>
                  <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-cover" />
                  {/* face guide oval */}
                  <div
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[66%] aspect-[3/4] rounded-[50%] border-2 border-dashed transition-colors"
                    style={{ borderColor: checks.face === "ok" ? "var(--read)" : "rgba(255,255,255,0.7)" }}
                  />
                </>
              ) : (
                <div className="text-center px-8" role={CAMERA_PROBLEM[cameraState] ? "alert" : undefined}>
                  <IconCamera size={32} className={`mx-auto ${CAMERA_PROBLEM[cameraState] ? "text-skip" : "text-muted"}`} />
                  {CAMERA_PROBLEM[cameraState] ? (
                    <>
                      <p className="mt-3 font-medium">{CAMERA_PROBLEM[cameraState]!.title}</p>
                      <p className="mt-1 text-muted text-sm max-w-sm mx-auto">{CAMERA_PROBLEM[cameraState]!.body}</p>
                      <p className="mt-2 text-muted text-sm max-w-sm mx-auto">You can still read now. We&apos;ll time each page instead.</p>
                      <div className="mt-5 flex flex-wrap gap-2 justify-center">
                        <button className="btn btn-primary" onClick={() => onSkipTracking("none")}>
                          Read without eye tracking
                        </button>
                        <button className="btn btn-ghost" onClick={onStartCamera}>
                          Try again
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="mt-3 text-muted text-sm max-w-xs mx-auto">
                        {cameraState === "loading"
                          ? "Loading the on-device eye tracker…"
                          : "Your camera is processed only in this browser tab. Nothing is recorded or uploaded."}
                      </p>
                      {cameraState === "off" && (
                        <button className="btn btn-primary mt-5" onClick={onStartCamera}>
                          Turn on camera
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted">{resuming ? "Picking up where you left off" : "Getting ready"}</div>
              <h1 className="text-lg font-semibold mt-1 leading-snug">{title}</h1>
            </div>
            <TeacherNote text={instructions} className="!text-sm max-h-48 overflow-y-auto" />
            <ul className="card divide-y divide-border text-sm">
              <CheckRow state={cameraState === "on" ? checks.face : "wait"} text={checks.face === "bad" ? "Can't find your face" : "Face visible"} />
              <CheckRow state={cameraState === "on" ? checks.center : "wait"} text={checks.center === "warn" ? "Center your face in the oval" : "Centered"} />
              <CheckRow state={cameraState === "on" ? checks.distance : "wait"} text={distanceText} />
              <CheckRow state={cameraState === "on" ? checks.light : "wait"} text={lightText} />
              <CheckRow state={cameraState === "on" ? checks.glare : "wait"} text={glareText} />
            </ul>
            {savedCalibrationAt && onUseSaved ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <button className="btn btn-primary flex-1 !py-2.5" disabled={cameraState !== "on" || !ready} onClick={onUseSaved}>
                    Start reading
                  </button>
                  <button className="btn btn-ghost !py-2.5" disabled={cameraState !== "on" || !ready} onClick={onCalibrate}>
                    Recalibrate
                  </button>
                </div>
                <p className="text-xs text-muted leading-relaxed">
                  Using your calibration from {new Date(savedCalibrationAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}. Recalibrate if
                  you&apos;ve moved your screen or camera, or the tracking feels off.
                </p>
              </div>
            ) : (
              <>
                <button className="btn btn-primary w-full !py-2.5" disabled={cameraState !== "on" || !ready} onClick={onCalibrate}>
                  Calibrate &amp; start
                </button>
                {calibrationNote && <p className="text-xs text-muted leading-relaxed">{calibrationNote}</p>}
              </>
            )}
            {cameraState === "on" && !ready && (
              <p className="text-xs font-medium text-skip" role="status">
                {checks.face !== "ok" ? "We need to see your face" : "It's too dark"} before {savedCalibrationAt ? "starting" : "calibrating"}. Fix the red check above.
              </p>
            )}
            <p className="text-xs text-muted leading-relaxed">
              Reading happens in full screen: the eye tracker is calibrated to it. If you leave full screen (Esc), reading pauses until you return.
            </p>
            <div className="pt-2 border-t border-border">
              <button
                className="text-xs text-muted hover:text-fg underline underline-offset-2"
                onClick={() => onSkipTracking(cameraState === "on" ? "attention" : "none")}
              >
                Read without eye tracking ({cameraState === "on" ? "focus & page timing only" : "page timing only"})
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckRow({ state, text }: { state: Check; text: string }) {
  const color = state === "ok" ? "var(--read)" : state === "warn" ? "var(--skim)" : state === "bad" ? "var(--skip)" : "var(--faint)";
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span
        className="h-5 w-5 rounded-full flex items-center justify-center shrink-0"
        style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}
      >
        {state === "ok" ? <IconCheck size={13} /> : <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
      </span>
      <span className={state === "wait" ? "text-muted" : ""}>{text}</span>
    </li>
  );
}
