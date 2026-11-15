import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getCourse, getDigest, getLessonPlan, getReading, studentSessionsForReading, studentsInCourse } from "@/lib/db";
import { aggregateParagraphs, attemptsPerStudent, bestPerStudent, plural, studentsChangedSince, totalEyesOnPerStudent } from "@/lib/insights";
import { formatDate, formatDuration, isHeading } from "@/lib/text";
import { PageHeader } from "@/components/AppShell";
import { EmptyState, Section, Stat, StatusPill } from "@/components/ui";
import { DigestCard } from "@/components/report/DigestCard";
import { LessonPlanCard } from "@/components/report/LessonPlanCard";

export default async function InsightsPage({ params }: PageProps<"/readings/[id]/insights">) {
  const { id } = await params;
  const user = await requireUser();
  const reading = await getReading(id);
  const course = reading?.courseId ? await getCourse(reading.courseId) : null;
  if (!reading || !course || course.professorId !== user.id) notFound();

  const students = await studentsInCourse(course.id);
  // One session per student: their BEST attempt (highest coverage), so a short re-read
  // doesn't drag the class numbers down. All stats below are labelled accordingly.
  // Enrolled students only: the professor trying the reading themselves isn't part of the class.
  const allSessions = await studentSessionsForReading(reading.id);
  const best = bestPerStudent(allSessions);
  const attempts = attemptsPerStudent(allSessions);
  const sessions = [...best.values()];
  const digest = await getDigest(reading.id);
  const plan = await getLessonPlan(reading.id);
  const agg = aggregateParagraphs(reading, sessions);
  const avg = (f: (s: (typeof sessions)[number]) => number | null) => {
    const vals = sessions.map(f).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const avgCoverage = avg((s) => s.report.coveragePct);
  const avgFocus = avg((s) => s.report.focusPct);
  const avgWpm = avg((s) => s.report.avgWpm);
  // Reading time is everything a student spent on this reading (all sessions), not just the best one.
  const totals = totalEyesOnPerStudent(allSessions);
  const avgEyesOn = totals.size ? [...totals.values()].reduce((a, b) => a + b, 0) / totals.size : null;
  const withSpeed = sessions.filter((s) => s.report.avgWpm !== null).length;
  // Every average below covers only the students who have started (not-started students aren't 0%).
  const scope = `best session · ${plural(best.size, "student")} who started`;
  // reduce, not Math.max(...list): spreading a very long reading's paragraphs overflows the stack.
  const maxRereads = agg.reduce((m, a) => Math.max(m, a.avgRereads), 0.0001);

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow={
          <Link href={`/courses/${course.id}`} className="hover:text-fg">
            {course.code} · {course.name}
          </Link>
        }
        title={reading.title}
        subtitle={`Class insights · ${best.size} of ${students.length} students have started it · averages cover only those students`}
        actions={
          <Link href={`/readings/${reading.id}`} className="btn btn-ghost">
            Try it yourself
          </Link>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
        <Stat label="Started" value={`${best.size}/${students.length}`} hint={`students · ${allSessions.length} session${allSessions.length === 1 ? "" : "s"} total`} />
        <Stat label="Avg coverage" value={avgCoverage === null ? "–" : `${Math.round(avgCoverage)}%`} hint={scope} />
        <Stat label="Avg focus" value={avgFocus === null ? "–" : `${Math.round(avgFocus)}%`} hint={scope} />
        <Stat label="Avg reading time" value={avgEyesOn === null ? "–" : formatDuration(avgEyesOn)} hint={`total eyes on the page · per student who started`} />
        <Stat
          label="Avg speed"
          value={avgWpm === null ? "–" : `${Math.round(avgWpm)}`}
          hint={avgWpm === null ? "not enough reading yet" : `wpm · best session · ${plural(withSpeed, "student")} with a speed`}
        />
      </div>

      <div className="mb-10 grid gap-4">
        <LessonPlanCard
          readingId={reading.id}
          initial={plan}
          hasSessions={sessions.length > 0}
          changedStudents={plan ? studentsChangedSince(best, plan.createdAt) : 0}
        />
        <DigestCard
          readingId={reading.id}
          initial={digest}
          hasSessions={sessions.length > 0}
          changedStudents={digest ? studentsChangedSince(best, digest.createdAt) : 0}
        />
      </div>

      <Section
        title="Students"
        action={
          students.length > 0 && (
            <a href={`/api/readings/${reading.id}/export`} download className="btn btn-ghost !py-1.5 text-sm">
              Download CSV
            </a>
          )
        }
      >
        {students.length === 0 ? (
          <EmptyState>No students enrolled yet. Share the join code {course.joinCode}.</EmptyState>
        ) : (
          <>
          <p className="text-xs text-muted mb-2">
            Status, focus, speed and distractions come from each student&apos;s best session. Total reading time is time with their eyes on the page, added up across all their sessions (time looking away isn&apos;t counted).
          </p>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-border">
                  <th className="font-medium px-5 py-3">Student</th>
                  <th className="font-medium px-3 py-3">Status</th>
                  <th className="font-medium px-3 py-3">Focus</th>
                  <th className="font-medium px-3 py-3">Speed</th>
                  <th className="font-medium px-3 py-3" title="Eyes on the page, across all of the student's sessions">Total reading time (eyes on page)</th>
                  <th className="font-medium px-3 py-3">Distractions</th>
                  <th className="font-medium px-3 py-3">Sessions</th>
                  <th className="font-medium px-5 py-3 text-right">Best session</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {students.map((st) => {
                  const s = best.get(st.id) ?? null;
                  return (
                    <tr key={st.id} className="hover:bg-surface-2/60">
                      <td className="px-5 py-3 font-medium">
                        <Link href={`/courses/${course.id}/students/${st.id}`} className="hover:text-accent">{st.name}</Link>
                      </td>
                      <td className="px-3 py-3"><StatusPill session={s} /></td>
                      <td className="px-3 py-3 tabular-nums">{s ? `${Math.round(s.report.focusPct)}%` : "–"}</td>
                      <td className="px-3 py-3 tabular-nums">{s?.report.avgWpm ? `${s.report.avgWpm} wpm` : "–"}</td>
                      <td className="px-3 py-3 tabular-nums">{totals.has(st.id) ? formatDuration(totals.get(st.id)!) : "–"}</td>
                      <td className="px-3 py-3 tabular-nums">{s ? s.report.distractions.length : "–"}</td>
                      <td className="px-3 py-3 tabular-nums">{attempts.get(st.id) ?? 0}</td>
                      <td className="px-5 py-3 text-right">
                        {s ? (
                          <Link href={`/reports/${s.id}`} className="text-accent hover:underline">
                            {formatDate(s.endedAt)} →
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
          </>
        )}
      </Section>

      <Section
        title="Class reading map"
        action={
          <div className="flex gap-4 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded" style={{ background: "var(--skip-soft)" }} />Skipped by many</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-[3px] rounded-full" style={{ background: "var(--reread)" }} />Re-read</span>
          </div>
        }
      >
        {sessions.length === 0 ? (
          <EmptyState>The class map appears after the first student finishes.</EmptyState>
        ) : (
          <div className="card p-6 sm:p-8 space-y-4">
            {agg.map((a) => {
              const heading = isHeading(a.text);
              const skipShade = Math.min(1, (a.skippedPct + a.skimmedPct * 0.5) / 100);
              const rereadW = a.avgRereads / maxRereads;
              return (
                <div key={a.index} className="grid grid-cols-[1fr_150px] gap-6 items-start">
                  <div className="relative pl-4">
                    <div
                      className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full"
                      style={{ background: "var(--reread)", opacity: a.avgRereads > 0 ? 0.25 + 0.75 * rereadW : 0 }}
                    />
                    <p
                      className={`font-serif leading-[1.85] rounded-md px-2 -mx-2 ${heading ? "font-semibold" : "text-[15.5px]"}`}
                      style={{ background: `color-mix(in srgb, var(--skip) ${Math.round(skipShade * 22)}%, transparent)` }}
                    >
                      {a.text}
                    </p>
                  </div>
                  {!heading && (
                    <div className="text-xs text-muted space-y-1 pt-1 tabular-nums">
                      <div>¶{a.index + 1}</div>
                      {a.readers < sessions.length && (
                        <div title="Students still partway through only count for the parts they've reached">
                          {a.readers} of {sessions.length} reached it
                        </div>
                      )}
                      <div>{Math.round(a.skippedPct)}% skipped</div>
                      <div>{Math.round(a.skimmedPct)}% skimmed</div>
                      <div style={{ color: a.avgRereads >= 1 ? "var(--reread)" : undefined }}>{a.avgRereads.toFixed(1)} re-reads/student</div>
                      <div>{a.avgDwellRatio.toFixed(1)}× expected time</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
