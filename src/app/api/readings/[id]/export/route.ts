import { getCurrentUser } from "@/lib/auth";
import { getCourse, getReading, studentSessionsForReading, studentsInCourse } from "@/lib/db";
import { attemptsPerStudent, bestPerStudent, totalEyesOnPerStudent } from "@/lib/insights";
import { appDay } from "@/lib/text";

// CSV of the class insights "Students" table (one row per enrolled student, best session).
function cell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote everything that could break a CSV; also stop spreadsheet formula injection
  // (cells starting with = + - @, or a tab / carriage return that hides one).
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r\t]/.test(safe) || safe !== s ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function GET(req: Request, ctx: RouteContext<"/api/readings/[id]/export">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  const reading = await getReading(id);
  const course = reading?.courseId ? await getCourse(reading.courseId) : null;
  if (!user || !reading || !course || course.professorId !== user.id)
    return Response.json({ error: "Not allowed." }, { status: 403 });

  const all = await studentSessionsForReading(reading.id);
  const best = bestPerStudent(all);
  const attempts = attemptsPerStudent(all);
  const totals = totalEyesOnPerStudent(all);
  const origin = new URL(req.url).origin;

  const header = [
    // "Reading time" = eyes on the page everywhere in the app. Session length (which also counts
    // distractions and time looking away) is labelled separately so the two aren't confused.
    "Student", "Username", "Status", "Coverage %", "Focus %", "Speed (wpm)",
    "Best session reading time (s, eyes on page)", "Best session length (s, incl. distractions)",
    "Total reading time (s, eyes on page, all sessions)",
    "Distractions", "Sessions", "Best session date", "Best session link",
  ];
  const rows = (await studentsInCourse(course.id)).map((st) => {
    const s = best.get(st.id);
    const r = s?.report;
    return [
      st.name,
      st.username,
      r ? `Read ${Math.round(r.coveragePct)}%` : "Not started",
      r ? Math.round(r.coveragePct) : "",
      r ? Math.round(r.focusPct) : "",
      r?.avgWpm ?? "",
      r ? r.activeSec : "",
      r ? r.durationSec : "",
      totals.has(st.id) ? totals.get(st.id) : "",
      r ? r.distractions.length : "",
      attempts.get(st.id) ?? 0,
      s ? appDay(s.endedAt) : "", // YYYY-MM-DD in Eastern time, like the pages
      s ? `${origin}/reports/${s.id}` : "",
    ];
  });

  const csv = [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
  const slug = `${course.code}-${reading.title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug || "class-insights"}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
