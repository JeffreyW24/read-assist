"use client";
import { useState } from "react";
import type { ClassDigest } from "@/lib/types";
import { IconSparkle } from "@/components/icons";
import { errorMessage, jsonBody } from "@/lib/http";

export function DigestCard({
  readingId,
  initial,
  hasSessions,
  changedStudents,
}: {
  readingId: string;
  initial: ClassDigest | null;
  hasSessions: boolean;
  /** Students whose reading changed after this digest was written (it doesn't include that yet). */
  changedStudents: number;
}) {
  const [digest, setDigest] = useState(initial);
  const [staleBy, setStaleBy] = useState(changedStudents);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function generate() {
    setBusy(true);
    setError("");
    let res: Response;
    try {
      res = await fetch(`/api/readings/${readingId}/digest`, { method: "POST" });
    } catch {
      setBusy(false);
      return setError("Couldn't reach the server. Check your connection and try again.");
    }
    const data = await jsonBody(res);
    setBusy(false);
    if (!res.ok) return setError(errorMessage(res, data, "Couldn't make the summary."));
    setDigest(data.digest);
    setStaleBy(0);
  }
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 font-medium">
          <span className="text-accent"><IconSparkle size={18} /></span>
          Class digest
        </div>
        <button
          className={`btn !py-1.5 text-sm ${digest && staleBy > 0 ? "btn-primary" : "btn-ghost"}`}
          onClick={generate}
          disabled={busy || !hasSessions}
        >
          {busy ? "Analyzing…" : digest ? "Refresh" : "Generate"}
        </button>
      </div>
      {digest && staleBy > 0 && (
        <div
          className="mt-3 rounded-lg px-3 py-2 text-sm"
          style={{ background: "var(--skim-soft)", color: "var(--fg)" }}
        >
          <b>Out of date:</b> {staleBy} student{staleBy === 1 ? "'s" : "s'"} reading has changed since this digest was written. Click Refresh to
          include {staleBy === 1 ? "it" : "them"}.
        </div>
      )}
      {digest ? (
        <>
          <p className="mt-3 text-[15px] leading-relaxed whitespace-pre-line">{digest.text}</p>
          <p className="text-[11px] text-faint mt-3">
            {digest.generatedBy === "gemini" ? "Written by Google Gemini from class reading data." : "Basic summary, not written by AI."}{" "}
            {/* server and browser may format times differently; the browser's version wins */}
            <span suppressHydrationWarning>
              Written {new Date(digest.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.
            </span>
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">
          {hasSessions ? "Get a short AI write-up of where the class struggled and what they skipped." : "Available once students finish the reading."}
        </p>
      )}
      {error && <p className="text-sm text-skip mt-2">{error}</p>}
    </div>
  );
}
