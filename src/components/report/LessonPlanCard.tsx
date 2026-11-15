"use client";
import { useState } from "react";
import type { LessonPlan } from "@/lib/types";
import { IconSparkle } from "@/components/icons";
import { errorMessage, jsonBody } from "@/lib/http";

/** Teacher's AI lesson plan for the next class, built from how students read this. */
export function LessonPlanCard({
  readingId,
  initial,
  hasSessions,
  changedStudents,
}: {
  readingId: string;
  initial: LessonPlan | null;
  hasSessions: boolean;
  /** Students whose reading changed after the plan was made (it doesn't include that yet). */
  changedStudents: number;
}) {
  const [plan, setPlan] = useState(initial);
  const [staleBy, setStaleBy] = useState(changedStudents);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function generate() {
    setBusy(true);
    setError("");
    let res: Response;
    try {
      res = await fetch(`/api/readings/${readingId}/lesson-plan`, { method: "POST" });
    } catch {
      setBusy(false);
      return setError("Couldn't reach the server. Check your connection and try again.");
    }
    const data = await jsonBody(res);
    setBusy(false);
    if (!res.ok) return setError(errorMessage(res, data, "Couldn't make the lesson plan."));
    setPlan(data.plan);
    setStaleBy(0);
  }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 font-medium">
          <span className="text-accent"><IconSparkle size={18} /></span>
          Lesson plan for the next class
        </div>
        <div className="flex gap-2">
          {plan && (
            <button
              className="btn btn-ghost !py-1.5 text-sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(plan.text);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {}
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          )}
          <button className={`btn !py-1.5 text-sm ${!plan || staleBy > 0 ? "btn-primary" : "btn-ghost"}`} onClick={generate} disabled={busy || !hasSessions}>
            {busy ? "Planning…" : plan ? "Regenerate" : "Generate plan"}
          </button>
        </div>
      </div>
      {plan && staleBy > 0 && (
        <div className="mt-3 rounded-lg px-3 py-2 text-sm" style={{ background: "var(--skim-soft)" }}>
          <b>Out of date:</b> {staleBy} student{staleBy === 1 ? "'s" : "s'"} reading has changed since this plan was made. Regenerate to include{" "}
          {staleBy === 1 ? "it" : "them"}.
        </div>
      )}
      {plan ? (
        <>
          <div className="mt-4 text-[15px] leading-relaxed whitespace-pre-line">{plan.text}</div>
          <p className="text-[11px] text-faint mt-4">
            {plan.generatedBy === "gemini" ? "Written by Google Gemini" : "Template plan, not written by AI,"} from {plan.basedOnSessions} student
            {plan.basedOnSessions === 1 ? "" : "s"}&apos; reading data.
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">
          {hasSessions
            ? "Builds a 45-minute plan around the passages your students struggled with and the parts they skipped."
            : "Available once students have read it."}
        </p>
      )}
      {error && <p className="text-sm text-skip mt-2">{error}</p>}
    </div>
  );
}
