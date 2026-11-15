"use client";
import { useState } from "react";

/** "In your own words, what was this part about?" (works without any AI key). */
export function RecallBox({ sessionId, section, initial }: { sessionId: string; section: number; initial: string }) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const dirty = text.trim() !== saved.trim();

  async function save() {
    setState("saving");
    try {
      const res = await fetch(`/api/sessions/${sessionId}/recall`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, text }),
      });
      if (!res.ok) return setState("error");
      setSaved(text);
      setState("idle");
    } catch {
      setState("error"); // offline or the server didn't answer: let them try again
    }
  }

  return (
    <div className="mt-3">
      <label className="text-xs font-medium text-muted" htmlFor={`recall-${section}`}>
        Quick check: in your own words, what was this part about?
      </label>
      <textarea
        id={`recall-${section}`}
        className="input mt-1.5 min-h-[72px] text-sm leading-relaxed"
        maxLength={2000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="One or two sentences is plenty. Try it before re-reading the section."
      />
      <div className="mt-1.5 flex items-center gap-3">
        <button className="btn btn-ghost !py-1 !px-3 text-sm" onClick={save} disabled={!dirty || state === "saving"}>
          {state === "saving" ? "Saving…" : "Save"}
        </button>
        <span className="text-xs text-muted" role="status">
          {state === "error" ? "Couldn't save. Try again." : !dirty && saved ? "Saved with this report" : ""}
        </span>
      </div>
    </div>
  );
}
