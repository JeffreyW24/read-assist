import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { coursesForUser, getUser, personalReadings, readingsForCourses, sessionsFor, studentCounts, studentSessionsForReadings, webReadingsFor } from "@/lib/db";
import { bestOf, bestPerStudent, plural, readingHabits, studentSummary } from "@/lib/insights";
import { APP_TIME_ZONE, appDay, dueDay, estimateMinutes, formatDate, formatDueDate, formatDuration } from "@/lib/text";
import type { Reading, Session, User } from "@/lib/types";
import { PageHeader } from "@/components/AppShell";
import { CreateCourseForm, JoinCourseForm } from "@/components/CourseForms";
import { ExtensionSync } from "@/components/ExtensionSync";
import { BestTag, CoveragePill, EmptyState, HabitCard, OverduePill, RowLink, Section, Stat, StatusPill, isOverdue } from "@/components/ui";
import { IconBook, IconClock, IconMonitor, IconPlus, IconSparkle, IconUsers } from "@/components/icons";
import { TeacherNoteLine } from "@/components/TeacherNote";

export default async function Dashboard() {
  const user = await requireUser();
  return user.role === "professor" ? <ProfessorDashboard user={user} /> : <StudentDashboard user={user} />;
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: APP_TIME_ZONE, hour: "numeric", hourCycle: "h23" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

async function StudentDashboard({ user }: { user: User }) {
  const courses = await coursesForUser(user);
  const courseReadings = await readingsForCourses(courses.map((c) => c.id));
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const mine = await personalReadings(user.id);
  const web = await webReadingsFor(user.id);
  const allMine = await sessionsFor(user.id);
  const byReading = (id: string) => allMine.filter((s) => s.readingId === id);
  const readingsById = new Map<string, Reading>([...courseReadings, ...mine].map((r) => [r.id, r]));
  const summary = studentSummary(courseReadings, allMine);
  const habits = readingHabits(allMine, readingsById);
  const recent = allMine.slice(0, 5);
  const bestIds = new Set<string>();
  for (const id of new Set(allMine.map((s) => s.readingId))) {
    const list = byReading(id);
    const b = bestOf(list);
    if (b && list.length > 1) bestIds.add(b.id);
  }
  // Unfinished first (by due date), then finished ones.
  const assignments = courseReadings
    .map((r) => ({ reading: r, course: courseById.get(r.courseId!)!, best: bestOf(byReading(r.id)), attempts: byReading(r.id).length }))
    .sort((a, b) => {
      const da = (a.best?.report.coveragePct ?? 0) >= 85 ? 1 : 0, db = (b.best?.report.coveragePct ?? 0) >= 85 ? 1 : 0;
      return da - db || (a.reading.dueDate ?? "9").localeCompare(b.reading.dueDate ?? "9");
    });

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${user.name.split(" ")[0]}`}
        subtitle="Pick up a reading. You can pause any time and continue later."
        actions={
          <>
            <JoinCourseForm />
            <Link href="/readings/new" className="btn btn-primary">
              <IconPlus size={16} /> Upload a reading
            </Link>
          </>
        }
      />

      {courses.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
          <Stat label="Assigned readings done" value={`${summary.finished}/${summary.assigned}`} hint={summary.started > summary.finished ? `${summary.started - summary.finished} in progress` : "read 85% or more"} />
          <Stat label="Time reading" value={formatDuration(summary.eyesOnSec)} hint="eyes on the page" />
          <Stat
            label="Avg coverage"
            value={summary.avgCoverage === null ? "–" : `${Math.round(summary.avgCoverage)}%`}
            hint={summary.started ? `across the ${plural(summary.started, "assigned reading")} you've started` : "no assigned readings started yet"}
          />
          <Stat label="Avg speed" value={summary.avgWpm === null ? "–" : `${Math.round(summary.avgWpm)}`} hint={summary.avgWpm === null ? "not enough data yet" : "words / minute · assigned readings you've started"} />
        </div>
      )}

      <Section title="Assigned readings">
        {assignments.length === 0 ? (
          <EmptyState>No assigned readings yet. Join a course with the code your teacher gave you.</EmptyState>
        ) : (
          <div className="card divide-y divide-border">
            {assignments.map(({ reading, course, best, attempts }) => (
              <RowLink key={reading.id} href={`/readings/${reading.id}`}>
                <div className="h-10 w-10 rounded-lg bg-accent-soft text-accent flex items-center justify-center shrink-0">
                  <IconBook size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{reading.title}</div>
                  <div className="text-sm text-muted">
                    {course.code} · {estimateMinutes(reading.wordCount)} min read
                    {reading.dueDate && (
                      <span className={isOverdue(reading.dueDate, best) ? "text-skip font-medium" : ""}>
                        {" · "}
                        {isOverdue(reading.dueDate, best) ? "Was due" : "Due"} {formatDueDate(reading.dueDate)}
                      </span>
                    )}
                  </div>
                  <TeacherNoteLine text={reading.instructions} />
                </div>
                {isOverdue(reading.dueDate, best) && <OverduePill />}
                <StatusPill session={best} attempts={attempts} />
              </RowLink>
            ))}
          </div>
        )}
      </Section>

      {habits.length > 0 && (
        <Section title="Your reading habits" action={<Link href="/habits" className="text-sm text-accent hover:underline">See all →</Link>}>
          <div className="grid md:grid-cols-2 gap-3">
            {habits.slice(0, 2).map((h) => (
              <HabitCard key={h.id} title={h.title} detail={h.detail} tone={h.tone} />
            ))}
          </div>
        </Section>
      )}

      <div className="grid md:grid-cols-2 gap-8">
        <Section title="Your courses">
          {courses.length === 0 ? (
            <EmptyState>You&apos;re not in any courses yet.</EmptyState>
          ) : (
            <div className="grid gap-3">
              {courses.map((c) => {
                const rs = courseReadings.filter((r) => r.courseId === c.id);
                const s = studentSummary(rs, allMine);
                return (
                  <Link key={c.id} href={`/courses/${c.id}`} className="card px-5 py-4 hover:border-accent transition">
                    <div className="text-xs font-semibold text-accent">{c.code}</div>
                    <div className="font-medium mt-0.5">{c.name}</div>
                    <div className="text-sm text-muted mt-1">
                      {c.term ? `${c.term} · ` : ""}
                      {s.finished}/{rs.length} readings done · {formatDuration(s.eyesOnSec)} reading
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Section>

        <Section title="Your own readings">
          {mine.length === 0 && web.length === 0 ? (
            <EmptyState>
              Paste text, upload a PDF, or snap photos of pages to practice with your own material.{" "}
              <Link href="/readings/new" className="text-accent underline underline-offset-2">Upload one</Link>
            </EmptyState>
          ) : (
            <div className="card divide-y divide-border">
              {mine.map((r) => (
                <RowLink key={r.id} href={`/readings/${r.id}`}>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{r.title}</div>
                    <div className="text-sm text-muted">{r.wordCount.toLocaleString()} words</div>
                  </div>
                  <StatusPill session={bestOf(byReading(r.id))} attempts={byReading(r.id).length} />
                </RowLink>
              ))}
              {web.map((w) => (
                <RowLink key={w.id} href={`/web-readings/${w.id}`}>
                  <IconMonitor size={16} className="text-muted shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{w.title}</div>
                    <div className="text-sm text-muted truncate">
                      {w.site} · {formatDate(w.lastSeen)} · {formatDuration(w.activeSec)} reading
                    </div>
                  </div>
                  <CoveragePill pct={w.coveragePct} />
                </RowLink>
              ))}
            </div>
          )}
          <ExtensionSync account={user.id} />
        </Section>
      </div>

      <Section title="Recent sessions">
        {recent.length === 0 ? (
          <EmptyState>Your session reports will show up here.</EmptyState>
        ) : (
          <div className="card divide-y divide-border">
            {recent.map((s) => (
              <RowLink key={s.id} href={s.status === "paused" ? `/readings/${s.readingId}` : `/reports/${s.id}`}>
                <IconClock size={18} className="text-muted shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{readingsById.get(s.readingId)?.title ?? "Reading"}</div>
                  <div className="text-sm text-muted">
                    {formatDate(s.endedAt)} · {formatDuration(s.report.activeSec)} reading ({formatDuration(s.report.durationSec)} session) · focus {Math.round(s.report.focusPct)}%
                    {s.report.avgWpm ? ` · ${s.report.avgWpm} wpm` : ""}
                    {s.sittings > 1 ? ` · ${s.sittings} sittings` : ""}
                  </div>
                </div>
                {bestIds.has(s.id) && <BestTag />}
                <StatusPill session={s} />
              </RowLink>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

async function ProfessorDashboard({ user }: { user: User }) {
  const courses = await coursesForUser(user);
  const counts = await studentCounts(courses.map((c) => c.id));
  const readings = await readingsForCourses(courses.map((c) => c.id));
  // Enrolled students only: the professor trying a reading themselves isn't class activity.
  const sessions = await studentSessionsForReadings(readings.map((r) => r.id));
  const readingById = new Map(readings.map((r) => [r.id, r]));
  const activity = sessions.slice(0, 6);
  // Who each recent session belongs to (the list is about students, so it has to say which).
  const studentName = new Map<string, string>();
  for (const id of new Set(activity.map((s) => s.userId))) studentName.set(id, (await getUser(id))?.name ?? "A student");

  // Per course: how far the class is through its readings (best session per student).
  const courseStats = (courseId: string) => {
    const rs = readings.filter((r) => r.courseId === courseId);
    const n = counts.get(courseId) ?? 0;
    let finished = 0;
    for (const r of rs) for (const s of bestPerStudent(sessions.filter((x) => x.readingId === r.id)).values()) if (s.report.coveragePct >= 85) finished++;
    const today = appDay(new Date());
    const next = rs.filter((r) => r.dueDate && dueDay(r.dueDate) >= today)[0] ?? null;
    return { readings: rs.length, students: n, completion: rs.length && n ? Math.round((finished / (rs.length * n)) * 100) : null, next };
  };

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${user.name}`}
        subtitle="Your courses. Open one to post readings, see how students read them, and plan the next class."
        actions={<CreateCourseForm />}
      />
      <Section title="Courses you teach">
        {courses.length === 0 ? (
          <EmptyState>Create your first course. You&apos;ll get a join code to give your students.</EmptyState>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {courses.map((c) => {
              const st = courseStats(c.id);
              return (
                <Link key={c.id} href={`/courses/${c.id}`} className="card p-5 hover:border-accent transition flex flex-col">
                  <div className="text-xs font-semibold text-accent">{c.code}</div>
                  <div className="font-medium mt-0.5 text-[17px]">{c.name}</div>
                  <div className="text-sm text-muted mt-1">{c.term}</div>
                  {st.next && (
                    <div className="text-sm mt-3">
                      <span className="text-muted">Next due:</span> <span className="font-medium">{st.next.title}</span>
                      <span className="text-muted"> · {formatDueDate(st.next.dueDate!)}</span>
                    </div>
                  )}
                  <div className="mt-auto pt-4">
                    <div className="mt-4 pt-4 border-t border-border flex items-center gap-4 text-sm text-muted">
                      <span className="inline-flex items-center gap-1.5" title="Students"><IconUsers size={15} /> {st.students}</span>
                      <span className="inline-flex items-center gap-1.5" title="Readings"><IconBook size={15} /> {st.readings}</span>
                      {st.completion !== null && <span title="Share of assigned readings finished across the class">{st.completion}% done</span>}
                      <span className="ml-auto text-xs">
                        Join code <span className="font-mono tracking-widest text-fg">{c.joinCode}</span>
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Latest student sessions">
        {activity.length === 0 ? (
          <EmptyState>When students read an assignment, their sessions show up here.</EmptyState>
        ) : (
          <div className="card divide-y divide-border">
            {activity.map((s: Session) => {
              const r = readingById.get(s.readingId)!;
              return (
                <RowLink key={s.id} href={`/reports/${s.id}`}>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">
                      {studentName.get(s.userId)} <span className="text-muted font-normal">· {r.title}</span>
                    </div>
                    <div className="text-sm text-muted">
                      {formatDate(s.endedAt)} · {formatDuration(s.report.activeSec)} reading ({formatDuration(s.report.durationSec)} session) · focus {Math.round(s.report.focusPct)}%
                    </div>
                  </div>
                  <StatusPill session={s} />
                </RowLink>
              );
            })}
          </div>
        )}
      </Section>

      {courses.length > 0 && (
        <p className="text-sm text-muted flex items-center gap-2">
          <IconSparkle size={15} className="text-accent" /> Tip: open a reading&apos;s class report to generate a lesson plan from how students read it.
        </p>
      )}
    </>
  );
}
