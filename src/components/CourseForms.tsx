"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconPlus } from "./icons";
import { errorMessage, jsonBody } from "@/lib/http";

export function JoinCourseForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  if (!open)
    return (
      <button className="btn btn-ghost" onClick={() => setOpen(true)}>
        <IconPlus size={16} /> Join a course
      </button>
    );
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setMsg("");
        let res: Response;
        try {
          res = await fetch("/api/courses/join", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ joinCode: code }),
          });
        } catch {
          return setMsg("Couldn't reach the server. Check your connection and try again.");
        }
        const data = await jsonBody(res);
        if (!res.ok) return setMsg(errorMessage(res, data, "Couldn't join that course."));
        setOpen(false);
        setCode("");
        router.refresh();
      }}
    >
      <input
        autoFocus
        className="input !py-2 w-36 uppercase tracking-widest"
        placeholder="CODE"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <button className="btn btn-primary">Join</button>
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      {msg && <span className="text-sm text-skip">{msg}</span>}
    </form>
  );
}

export function CreateCourseForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [term, setTerm] = useState("Fall 2026");
  const [msg, setMsg] = useState("");
  if (!open)
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        <IconPlus size={16} /> New course
      </button>
    );
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4 fade-in" onClick={() => setOpen(false)}>
      <form
        className="card w-full max-w-md p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          let res: Response;
          try {
            res = await fetch("/api/courses", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, code, term }),
            });
          } catch {
            return setMsg("Couldn't reach the server. Check your connection and try again.");
          }
          const data = await jsonBody(res);
          if (!res.ok) return setMsg(errorMessage(res, data, "Couldn't create the course."));
          router.push(`/courses/${data.course.id}`);
          router.refresh();
        }}
      >
        <h2 className="text-lg font-semibold">Create a course</h2>
        <div>
          <label className="label">Course name</label>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Intro to Philosophy" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Course code</label>
            <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="PHIL 101" />
          </div>
          <div>
            <label className="label">Term</label>
            <input className="input" value={term} onChange={(e) => setTerm(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-muted leading-relaxed">
          The course code is just a label (like &ldquo;PHIL 101&rdquo;). Students join with a separate{" "}
          <b className="text-fg">join code</b> that we generate, shown on the course page after you create it.
        </p>
        {msg && <p className="text-sm text-skip">{msg}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn btn-primary">Create course</button>
        </div>
      </form>
    </div>
  );
}

export function JoinCodeCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="card mb-8 px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-2">
      <div>
        <div className="text-xs font-medium text-muted">Join code for students</div>
        <div className="font-mono text-2xl font-semibold tracking-[0.2em] mt-0.5">{code}</div>
      </div>
      <p className="text-sm text-muted flex-1 min-w-[200px]">
        Students click <b className="text-fg">Join a course</b> on their dashboard and type this code. It&apos;s different from the course code.
      </p>
      <button
        className="btn btn-ghost"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {}
        }}
      >
        {copied ? "Copied" : "Copy code"}
      </button>
    </div>
  );
}
