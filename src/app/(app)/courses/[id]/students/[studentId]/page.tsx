import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getCourse, getUser, isEnrolled, readingsForCourse, sessionsFor } from "@/lib/db";
import { bestOf, plural, readingHabits, studentSummary } from "@/lib/insights";
import { finishedLate, formatDate, formatDueDate, formatDuration } from "@/lib/text";
import { PageHeader } from "@/components/AppShell";
import { EmptyState, HabitCard, OverduePill, Section, Stat, StatusPill, isOverdue } from "@/components/ui";

// Teacher view of one student in one course: every reading, plus overall numbers and habits.
export default async function StudentInCoursePage({ params }: PageProps<"/courses/[id]/students/[studentId]">) {
  const { id, studentId } = await params;
  const user = await requireUser();
  const course = await getCourse(id);
  if (!course || course.professorId !== user.id) notFound();
  const student = await getUser(studentId);
  if (!student || !(await isEnrolled(student.id, course.id))) notFound();

  const readings = await readingsForCourse(course.id);
  const ids = new Set(readings.map((r) => r.id));
  const sessions = (await sessionsFor(student.id)).filter((s) => ids.has(s.readingId));
  const s = studentSummary(readings, sessions);
  const habits = readingHabits(sessions, new Map(readings.map((r) => [r.id, r])));
  const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v)}%`);

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow={
          <Link href={`/courses/${course.id}`} className="hover:text-fg">
            {course.code} · {course.name}
          </Link>
        }
        title={student.name}
        subtitle={`Username: ${student.username}`}
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-10">
        <Stat label="Readings finished" value={`${s.finished}/${s.assigned}`} hint={s.started > s.finished ? `${s.started - s.finished} in progress` : "read 85% or more"} />
        <Stat label="On time" value={s.withDueDate ? `${s.onTime}/${s.withDueDate}` : "–"} hint="finished by the due date" />
        <Stat label="Time reading" value={formatDuration(s.eyesOnSec)} hint={`eyes on the page · ${s.sessions} session${s.sessions === 1 ? "" : "s"}`} />
        <Stat label="Avg coverage" value={pct(s.avgCoverage)} hint={s.started ? `best session · ${s.started} of ${plural(s.assigned, "reading")} started · focus ${pct(s.avgFocus)}` : "nothing started yet"} />
        <Stat label="Avg speed" value={s.avgWpm === null ? "–" : Math.round(s.avgWpm)} hint={s.avgWpm === null ? "not enough data" : `wpm · best session · readings started`} />
      </div>

      <Section title="Reading by reading">
        {readings.length === 0 ? (
          <EmptyState>No readings in this course yet.</EmptyState>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-border">
                  <th className="font-medium px-5 py-3">Reading</th>
                  <th className="font-medium px-3 py-3">Status</th>
                  <th className="font-medium px-3 py-3">Focus</th>
                  <th className="font-medium px-3 py-3" title="Eyes on the page, across all sessions on this reading">Total reading time (eyes on page)</th>
                  <th className="font-medium px-3 py-3">Speed</th>
                  <th className="font-medium px-3 py-3">Skipped ¶</th>
                  <th className="font-medium px-3 py-3">Sessions</th>
                  <th className="font-medium px-5 py-3 text-right">Report</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {readings.map((r) => {
                  const mine = sessions.filter((x) => x.readingId === r.id);
                  const b = bestOf(mine);
                  const rep = b?.report;
                  return (
                    <tr key={r.id} className="hover:bg-surface-2/60 align-top">
                      <td className="px-5 py-3">
                        <Link href={`/readings/${r.id}/insights`} className="font-medium hover:text-accent">{r.title}</Link>
                        <div className="text-xs text-muted mt-0.5">
                          {r.dueDate ? `Due ${formatDueDate(r.dueDate)}` : "No due date"}
                          {b && b.status === "done" && finishedLate(b.endedAt, r.dueDate) ? " · finished late" : ""}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <StatusPill session={b} attempts={mine.length} />
                          {isOverdue(r.dueDate, b) && <OverduePill />}
                        </div>
                      </td>
                      <td className="px-3 py-3 tabular-nums">{rep ? `${Math.round(rep.focusPct)}%` : "–"}</td>
                      <td className="px-3 py-3 tabular-nums">{mine.length ? formatDuration(mine.reduce((t, x) => t + x.report.activeSec, 0)) : "–"}</td>
                      <td className="px-3 py-3 tabular-nums">{rep?.avgWpm ? `${rep.avgWpm} wpm` : "–"}</td>
                      <td className="px-3 py-3 tabular-nums">{rep ? rep.paragraphs.filter((p) => p.status === "skipped").length : "–"}</td>
                      <td className="px-3 py-3 tabular-nums">
                        {mine.length}
                        {b && b.sittings > 1 ? <span className="text-xs text-muted"> ({b.sittings} sittings)</span> : null}
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        {b ? (
                          <Link href={`/reports/${b.id}`} className="text-accent hover:underline">
                            {formatDate(b.endedAt)} →
                          </Link>
                        ) : (
                          <span className="text-muted">–</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Reading habits (as the student sees them)">
        {habits.length === 0 ? (
          <EmptyState>Patterns appear after a few sessions of a minute or more.</EmptyState>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {habits.map((h) => (
              <HabitCard key={h.id} title={h.title} detail={h.detail} tone={h.tone} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
