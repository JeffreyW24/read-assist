"use client";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { countWords, toParagraphs } from "@/lib/text";
import type { Role } from "@/lib/types";
import { IconUpload } from "@/components/icons";
import { errorMessage, jsonBody } from "@/lib/http";

export function NewReadingForm({
  role,
  courses,
  defaultCourseId,
  aiAvailable,
}: {
  role: Role;
  courses: { id: string; label: string }[];
  defaultCourseId?: string;
  aiAvailable: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"paste" | "pdf" | "photo">("paste");
  const [source, setSource] = useState<"paste" | "pdf" | "image">("paste");
  const [progress, setProgress] = useState<{ msg: string; frac: number } | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [courseId, setCourseId] = useState(defaultCourseId ?? "");
  const [dueDate, setDueDate] = useState("");
  const [instructions, setInstructions] = useState("");
  const [useAi, setUseAi] = useState(false);
  const [pdfInfo, setPdfInfo] = useState("");
  const [busy, setBusy] = useState<"" | "pdf" | "ocr" | "save">("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const stats = useMemo(() => {
    const paragraphs = toParagraphs(text);
    return { paragraphs: paragraphs.length, words: countWords(paragraphs) };
  }, [text]);

  async function uploadPdf(file: File) {
    setBusy("pdf");
    setError("");
    setPdfInfo("");
    const form = new FormData();
    form.append("file", file);
    if (useAi) form.append("ai", "1");
    let res: Response;
    try {
      res = await fetch("/api/pdf", { method: "POST", body: form });
    } catch {
      setBusy("");
      return setError("Couldn't reach the server. Check your connection and try again.");
    }
    const data = await jsonBody(res);
    setBusy("");
    if (res.ok && data.scanned) return readScans([file]); // photocopied pages: read them as images
    if (!res.ok) return setError(errorMessage(res, data, "Couldn't read that PDF."));
    setText(data.text);
    setSource("pdf");
    if (!title) setTitle(data.title);
    setPdfInfo(
      `Extracted ${data.pages} page${data.pages === 1 ? "" : "s"}${data.cleanedByAi ? " (cleaned up with Gemini)" : ""}. Check the text below and fix anything that looks off.`,
    );
  }

  /** Photos or scanned pages → text. Gemini if available, otherwise on-device recognition. */
  async function readScans(files: File[]) {
    if (!files.length) return;
    setBusy("ocr");
    setError("");
    setPdfInfo("");
    setProgress({ msg: "Reading your pages…", frac: 0 });
    try {
      let result: string | null = null;
      if (aiAvailable) {
        const form = new FormData();
        files.forEach((f) => form.append("file", f));
        const res = await fetch("/api/ocr", { method: "POST", body: form });
        const data = await jsonBody(res);
        if (res.ok) result = data.text;
        // "no-ai", or no answer at all: read the pages on this device instead.
        else if (data.error && data.error !== "no-ai") throw new Error(data.error);
      }
      if (result === null) {
        const { pdfToImages, recognizeImages } = await import("@/lib/ocr");
        const onProgress = (msg: string, frac: number) => setProgress({ msg, frac });
        const images: Blob[] = [];
        for (const f of files) {
          if (f.type === "application/pdf") images.push(...(await pdfToImages(f, onProgress)));
          else images.push(f);
        }
        result = await recognizeImages(images, onProgress);
      }
      if (!result.trim()) throw new Error("Couldn't find any text in those pages. Try a sharper, well-lit photo.");
      setText(result);
      setSource("image");
      if (!title) setTitle(files[0].name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " "));
      setPdfInfo(
        `Read ${files.length} file${files.length === 1 ? "" : "s"}${aiAvailable ? " with Gemini" : " on this device"}. Text recognition isn't perfect, so skim the text below and fix any mistakes.`,
      );
    } catch (err) {
      console.error("[ocr]", err);
      setError((err as Error).message || "Couldn't read those pages.");
    } finally {
      setBusy("");
      setProgress(null);
    }
  }

  function openPicker() {
    if (busy === "") fileRef.current?.click();
  }

  function handleFiles(list: FileList | File[]) {
    const files = Array.from(list);
    if (!files.length) return;
    if (mode === "pdf") {
      if (files[0].type !== "application/pdf") return setError("That isn't a PDF. Use the Photos tab for pictures of pages.");
      return uploadPdf(files[0]);
    }
    const bad = files.find((f) => !f.type.startsWith("image/") && f.type !== "application/pdf");
    if (bad) return setError(`${bad.name} isn't an image or PDF.`);
    // Pages in filename order (phones name photos IMG_0001, IMG_0002, …).
    void readScans(files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    setError("");
    let res: Response;
    try {
      res = await fetch("/api/readings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        text,
        courseId: role === "professor" ? courseId || null : null,
        dueDate: dueDate || null,
        instructions,
        source,
      }),
      });
    } catch {
      setBusy("");
      return setError("Couldn't reach the server. Check your connection and try again. Your text is still here.");
    }
    const data = await jsonBody(res);
    if (!res.ok) {
      setBusy("");
      return setError(errorMessage(res, data, "Couldn't save."));
    }
    router.push(role === "professor" && courseId ? `/courses/${courseId}` : `/readings/${data.reading.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <div className="card p-6 space-y-5">
        <div>
          <label className="label" htmlFor="title">Title</label>
          <input id="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Chapter 3: Memory and Attention" />
        </div>

        <div className="inline-grid grid-cols-3 gap-1 p-1 rounded-xl bg-surface-2 border border-border">
          {(["paste", "pdf", "photo"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${mode === m ? "bg-surface shadow-sm" : "text-muted hover:text-fg"}`}
            >
              {m === "paste" ? "Paste text" : m === "pdf" ? "Upload PDF" : "Photos or scans"}
            </button>
          ))}
        </div>

        {mode !== "paste" && (
          <div className="space-y-3">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (busy === "") handleFiles(e.dataTransfer.files);
              }}
              // A real, focusable control: Tab reaches it, Enter/Space open the file picker.
              role="button"
              tabIndex={busy === "" ? 0 : -1}
              aria-disabled={busy !== ""}
              aria-label={mode === "pdf" ? "Choose a PDF to upload" : "Choose photos of pages or a scanned PDF"}
              onClick={openPicker}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openPicker();
                }
              }}
              className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-10 text-center transition outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent ${
                dragging ? "border-accent bg-accent-soft" : "border-border hover:border-accent"
              }`}
            >
              <IconUpload className="mx-auto text-muted" size={24} />
              <div className="mt-2 font-medium">
                {busy === "pdf"
                  ? "Reading your PDF…"
                  : busy === "ocr"
                    ? progress?.msg ?? "Reading your pages…"
                    : mode === "pdf"
                      ? "Drop a PDF here, or click to choose"
                      : "Drop photos of pages (or a scanned PDF) here, or click to choose"}
              </div>
              <div className="text-sm text-muted mt-1">
                {mode === "pdf"
                  ? "We pull out the text and reformat it for comfortable reading. Scanned PDFs are read like photos."
                  : "Photocopies and phone photos work. Choose several pages at once; they're read in filename order."}
              </div>
              {busy === "ocr" && progress && (
                <div className="mx-auto mt-4 h-1.5 w-56 rounded-full bg-surface-2 overflow-hidden">
                  <div className="h-full bg-accent transition-all duration-300" style={{ width: `${Math.round(progress.frac * 100)}%` }} />
                </div>
              )}
            </div>
            {/* Kept outside the dropzone: if it were inside, opening it would also "click" the
                dropzone again, which can cancel the picker. */}
            <input
              ref={fileRef}
              type="file"
              multiple={mode === "photo"}
              accept={mode === "pdf" ? "application/pdf" : "image/*,application/pdf"}
              className="hidden"
              tabIndex={-1}
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {mode === "pdf" && <label className={`flex items-center gap-2 text-sm ${aiAvailable ? "" : "opacity-50"}`}>
              <input type="checkbox" disabled={!aiAvailable} checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
              Clean up messy formatting with Gemini (slower)
              {!aiAvailable && <span className="text-muted">· needs an API key</span>}
            </label>}
            {pdfInfo && <p className="text-sm text-read">{pdfInfo}</p>}
          </div>
        )}

        {(mode === "paste" || text) && (
          <div>
            <div className="flex justify-between items-end">
              <label className="label" htmlFor="text">Text</label>
              <span className="text-xs text-muted mb-1.5">
                {stats.paragraphs} paragraphs · {stats.words.toLocaleString()} words
              </span>
            </div>
            <textarea
              id="text"
              className="input font-serif leading-relaxed min-h-[320px]"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste your reading here. Leave a blank line between paragraphs."
            />
          </div>
        )}
      </div>

      {role === "professor" && (
        <div className="card p-6 space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Course</label>
              <select className="input" value={courseId} onChange={(e) => setCourseId(e.target.value)} required>
                {courses.length === 0 && <option value="">Create a course first</option>}
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Due date (optional)</label>
              <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="instructions">Instructions for students (optional)</label>
            <textarea
              id="instructions"
              className="input min-h-[96px] leading-relaxed"
              maxLength={5000}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={"What to focus on, questions to think about, what to bring to class…\nStudents see this under \"From your teacher\" before they start."}
            />
          </div>
        </div>
      )}

      {error && <p className="text-sm text-skip">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => router.back()}>Cancel</button>
        <button className="btn btn-primary" disabled={busy !== "" || !title || stats.words === 0}>
          {busy === "save" ? "Saving…" : role === "professor" ? "Post reading" : "Save reading"}
        </button>
      </div>
    </form>
  );
}
