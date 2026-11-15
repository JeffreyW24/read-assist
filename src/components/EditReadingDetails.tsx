"use client";
// Teacher: change a posted reading's title, due date and instructions for students.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage, jsonBody } from "@/lib/http";
import { dueDay } from "@/lib/text";

export function EditReadingDetails({
  readingId,
  title: initialTitle,
  dueDate: initialDue,
  instructions: initialInstructions,
}: {
  readingId: string;
  title: string;
  dueDate: string | null;
  instructions: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  // Due dates are stored as noon UTC on the chosen day; the date input wants that day.
  const [dueDate, setDueDate] = useState(initialDue ? dueDay(initialDue) : "");
  const [instructions, setInstructions] = useState(initialInstructions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open)
    return (
      <div className="mb-4 flex justify-end">
        <button type="button" className="btn btn-ghost !py-1.5 text-sm" onClick={() => setOpen(true)}>
          {initialInstructions ? "Edit details and instructions" : "Add instructions for students"}
        </button>
      </div>
    );

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/readings/${readingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, dueDate: dueDate || null, instructions }),
      });
      const data = await jsonBody(res);
      if (!res.ok) return setError(errorMessage(res, data, "Couldn't save."));
      setOpen(false);
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card p-5 mb-6 space-y-4">
      <div className="grid sm:grid-cols-[1fr_200px] gap-4">
        <div>
          <label className="label" htmlFor="edit-title">Title</label>
          <input id="edit-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} />
        </div>
        <div>
          <label className="label" htmlFor="edit-due">Due date (optional)</label>
          <input id="edit-due" type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="edit-instructions">Instructions for students (optional)</label>
        <textarea
          id="edit-instructions"
          className="input min-h-[96px] leading-relaxed"
          maxLength={5000}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder={'What to focus on, questions to think about, what to bring to class…\nStudents see this under "From your teacher" before they start.'}
        />
      </div>
      {error && <p className="text-sm text-skip">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !title.trim()}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}
