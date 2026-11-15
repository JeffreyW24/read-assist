// The teacher's instructions for a reading, as students see them. Used on the reading's page,
// in the reader before starting, and (shortened) in reading lists.

/** The full note, keeping the teacher's line breaks. */
export function TeacherNote({ text, className = "" }: { text: string; className?: string }) {
  if (!text.trim()) return null;
  return (
    <div className={`rounded-xl border border-border bg-accent-soft px-5 py-4 text-[15px] ${className}`}>
      <div className="font-semibold mb-1">From your teacher</div>
      <div className="whitespace-pre-line leading-relaxed">{text}</div>
    </div>
  );
}

/** One line for reading lists; the full text is on the reading's page. */
export function TeacherNoteLine({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="text-xs text-muted mt-1 truncate" title={text}>
      <span className="font-medium text-fg">From your teacher:</span> {text.replace(/\s+/g, " ")}
    </div>
  );
}
