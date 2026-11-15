import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canViewCourse, getCourse, readingsForCourse, sessionsFor, studentSessionsForReadings, studentsInCourse } from "@/lib/db";
import { bestOf, bestPerStudent, plural, studentSummary, totalEyesOnPerStudent } from "@/lib/insights";
import { estimateMinutes, formatDueDate, formatDuration } from "@/lib/text";
import type { Course, Reading, Session, User } from "@/lib/types";
import { PageHeader } from "@/components/AppShell";
import { EmptyState, OverduePill, RowLink, Section, Stat, StatusPill, isOverdue } from "@/components/ui";
import { JoinCodeCard } from "@/components/CourseForms";
import { IconBook, IconPlus } from "@/components/icons";
import { TeacherNoteLine } from "@/components/TeacherNote";

export default async function CoursePage({ params }: PageProps<"/courses/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const course = await getCourse(id);
  if (!course || !(await canViewCourse(user, course))) notFound();
  const readings = await readingsForCourse(course.id);
  return course.professorId === user.id ? (
    <TeacherCourse course={course} readings={readings} />
  ) : (
    <StudentCourse course={course} readings={readings} user={user} />
  );
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v)}%`);

async function TeacherCourse({ course, readings }: { course: Course; readings: Reading[] }) {
  const students = await studentsInCourse(course.id);
  // Enrolled students only: the professor trying a reading themselves isn't part of the class.
  const sessions = await studentSessionsForReadings(readings.map((r) => r.id));
  const perReading = readings.map((r) => {
    const best = [...bestPerStudent(sessions.filter((s) => s.readingId === r.id)).values()];
    return {
      r,
      best,
      finished: best.filter((s) => s.report.coveragePct >= 85).length,
      avgCoverage: avg(best.map((s) => s.report.coveragePct)),
      // total time per student who started (all their sessions), averaged
      avgEyesOn: avg([...totalEyesOnPerStudent(sessions.filter((s) => s.readingId === r.id)).values()]),
    };
  });
  const totalEyesOn = sessions.reduce((t, s) => t + s.report.activeSec, 0);
  const allBest = perReading.flatMap((p) => p.best);
  const slots = readings.length * students.length;
  const finishedSlots = perReading.reduce((t, p) => t + p.finished, 0);

  return (
    <>
      <PageHeader
        eyebrow={`${course.code}${course.term ? ` · ${course.term}` : ""}`}
        title={course.name}
        actions={
          <Link href={`/readings/new?courseId=${course.id}`} className="btn btn-primary">
            <IconPlus size={16} /> Post a reading
          </Link>
        }
      />

      <JoinCodeCard code={course.joinCode} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
        <Stat label="Students" value={students.length} hint={`${readings.length} reading${readings.length === 1 ? "" : "s"} assigned`} />
        <Stat label="Readings finished" value={slots ? `${Math.round((finishedSlots / slots) * 100)}%` : "–"} hint={`${finishedSlots} of ${slots} student-readings`} />
        <Stat
          label="Avg coverage"
          value={pct(avg(allBest.map((s) => s.report.coveragePct)))}
          hint={`best session · across the ${plural(allBest.length, "student-reading")} started (of ${slots})`}
        />
        <Stat label="Class reading time" value={formatDuration(totalEyesOn)} hint="eyes on the page, all students" />
      </div>

      <div className="grid lg:grid-cols-[1fr_300px] gap-8">
        <Section title="Readings">
          {readings.length === 0 ? (
            <EmptyState>
              No readings yet.{" "}
              <Link href={`/readings/new?courseId=${course.id}`} className="text-accent underline underline-offset-2">
                Post one
              </Link>{" "}
              by pasting text, uploading a PDF, or snapping photos of photocopied pages.
            </EmptyState>
          ) : (
            <div className="card divide-y divide-border">
              {perReading.map(({ r, best, finished, avgCoverage, avgEyesOn }) => (
                <RowLink key={r.id} href={`/readings/${r.id}/insights`}>
                  <div className="h-10 w-10 rounded-lg bg-accent-soft text-accent flex items-center justify-center shrink-0">
                    <IconBook size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{r.title}</div>
                    <div className="text-sm text-muted">
                      {r.dueDate ? `Due ${formatDueDate(r.dueDate)}` : "No due date"} · {r.wordCount.toLocaleString()} words · ~{estimateMinutes(r.wordCount)} min
                    </div>
                    {best.length > 0 && (
                      <div className="text-xs text-muted mt-1">
                        Of the {plural(best.length, "student")} who started: avg coverage {pct(avgCoverage)} · avg total reading time (eyes on page) {formatDuration(avgEyesOn ?? 0)}
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <span className="pill">
                      {finished}/{students.length} finished
                    </span>
                    {best.length > finished && <div className="text-[11px] text-muted mt-1">{best.length - finished} in progress</div>}
                  </div>
                </RowLink>
              ))}
            </div>
          )}
        </Section>

        <Section title={`Students (${students.length})`}>
          {students.length === 0 ? (
            <EmptyState>Share the join code with your class.</EmptyState>
          ) : (
            <div className="card divide-y divide-border">
              {students.map((st) => {
                const s = studentSummary(readings, sessions.filter((x) => x.userId === st.id));
                return (
                  <Link key={st.id} href={`/courses/${course.id}/students/${st.id}`} className="px-4 py-3 flex items-center gap-3 hover:bg-surface-2 transition first:rounded-t-[14px] last:rounded-b-[14px]">
                    <Avatar user={st} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{st.name}</div>
                      <div className="text-xs text-muted truncate">
                        {s.finished}/{readings.length} done · {formatDuration(s.eyesOnSec)} reading
                      </div>
                    </div>
                    <span className="text-xs text-muted">→</span>
                  </Link>
                );
              })}
            </div>
          )}
        </Section>
      </div>
    </>
  );
}

function Avatar({ user }: { user: User }) {
  return (
    <div className="h-8 w-8 rounded-full bg-surface-2 flex items-center justify-center text-xs font-semibold text-muted shrink-0">
      {user.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

async function StudentCourse({ course, readings, user }: { course: Course; readings: Reading[]; user: User }) {
  const mine = await sessionsFor(user.id);
  const byReading = (id: string): Session[] => mine.filter((s) => s.readingId === id);
  const s = studentSummary(readings, mine);
  return (
    <>
      <PageHeader eyebrow={`${course.code}${course.term ? ` · ${course.term}` : ""}`} title={course.name} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
        <Stat label="Readings done" value={`${s.finished}/${s.assigned}`} hint={s.started > s.finished ? `${s.started - s.finished} in progress` : "read 85% or more"} />
        <Stat label="Time reading" value={formatDuration(s.eyesOnSec)} hint="eyes on the page" />
        <Stat label="Avg coverage" value={pct(s.avgCoverage)} hint={s.started ? `across the ${plural(s.started, "reading")} you've started` : "no readings started yet"} />
        <Stat label="Avg focus" value={pct(s.avgFocus)} hint={s.started ? `across the ${plural(s.started, "reading")} you've started` : "time not distracted"} />
      </div>

      <Section title="Readings">
        {readings.length === 0 ? (
          <EmptyState>No readings posted yet.</EmptyState>
        ) : (
          <div className="card divide-y divide-border">
            {readings.map((r) => {
              const best = bestOf(byReading(r.id));
              const overdue = isOverdue(r.dueDate, best);
              return (
                <RowLink key={r.id} href={`/readings/${r.id}`}>
                  <div className="h-10 w-10 rounded-lg bg-accent-soft text-accent flex items-center justify-center shrink-0">
                    <IconBook size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{r.title}</div>
                    <div className="text-sm text-muted">
                      {r.wordCount.toLocaleString()} words · ~{estimateMinutes(r.wordCount)} min
                      {r.dueDate && (
                        <span className={overdue ? "text-skip font-medium" : ""}>
                          {" · "}
                          {overdue ? "Was due" : "Due"} {formatDueDate(r.dueDate)}
                        </span>
                      )}
                    </div>
                    <TeacherNoteLine text={r.instructions} />
                  </div>
                  {overdue && <OverduePill />}
                  <StatusPill session={best} attempts={byReading(r.id).length} />
                </RowLink>
              );
            })}
          </div>
        )}
      </Section>
    </>
  );
}
