import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canViewReading, getCourse, getReading, sessionsFor } from "@/lib/db";
import { SEC_PER_WORD } from "@/lib/gaze/readingTracker";
import { estimateMinutes, formatDate, formatDueDate, formatDuration, isHeading } from "@/lib/text";
import { bestOf } from "@/lib/insights";
import { PageHeader } from "@/components/AppShell";
import { BestTag, EmptyState, isOverdue, OverduePill, RowLink, Section, StatusPill } from "@/components/ui";
import { IconCamera, IconEye, IconSun, IconUsers } from "@/components/icons";
import { TeacherNote } from "@/components/TeacherNote";
import { EditReadingDetails } from "@/components/EditReadingDetails";

export default async function ReadingPage({ params, searchParams }: PageProps<"/readings/[id]">) {
  const { id } = await params;
  const { paused: justPaused } = await searchParams;
  const user = await requireUser();
  const reading = await getReading(id);
  if (!reading || !(await canViewReading(user, reading))) notFound();
  const course = reading.courseId ? await getCourse(reading.courseId) : null;
  const isProf = course?.professorId === user.id;
  const sessions = await sessionsFor(user.id, reading.id);
  const best = bestOf(sessions);
  // All of this student's reading time on this text, over every session and sitting.
  const totalReadingSec = sessions.reduce((t, s) => t + s.report.activeSec, 0);
  const paused = sessions.find((s) => s.status === "paused") ?? null;
  const minutesLeft = paused ? Math.max(1, Math.round(((100 - paused.report.coveragePct) / 100) * reading.wordCount * SEC_PER_WORD / 60)) : 0;
  // Only students get the overdue flag (it's about their own progress).
  const overdue = !isProf && !!course && isOverdue(reading.dueDate, best);
  const preview = reading.paragraphs.find((p) => !isHeading(p)) ?? reading.paragraphs[0];

  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow={course ? `${course.code} · ${course.name}` : "Personal reading"}
        title={reading.title}
        subtitle={
          <>
            {reading.wordCount.toLocaleString()} words · about {estimateMinutes(reading.wordCount)} min
            {reading.dueDate && (
              <span className={overdue ? "text-skip font-medium" : ""}>
                {" · "}
                {overdue ? "Was due" : "Due"} {formatDueDate(reading.dueDate)}
              </span>
            )}
            {overdue && (
              <span className="ml-2 align-middle">
                <OverduePill />
              </span>
            )}
          </>
        }
        actions={
          isProf && (
            <Link href={`/readings/${reading.id}/insights`} className="btn btn-ghost">
              <IconUsers size={16} /> Class insights
            </Link>
          )
        }
      />

      {isProf && <EditReadingDetails readingId={reading.id} title={reading.title} dueDate={reading.dueDate} instructions={reading.instructions} />}
      {course && <TeacherNote text={reading.instructions} className="mb-6" />}

      {justPaused && paused && (
        <div className="mb-6 rounded-xl border border-border px-5 py-4 text-[15px] fade-in" style={{ background: "var(--read-soft, var(--accent-soft))" }}>
          <b>Progress saved.</b> You&apos;ve read about {Math.round(paused.report.coveragePct)}% so far. Come back any time and continue where you left off.
        </div>
      )}

      {paused && (
        <div className="card p-6 sm:p-8 mb-6 border-accent">
          <div className="grid md:grid-cols-[1fr_auto] gap-6 items-center">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-accent">In progress</div>
              <h2 className="text-lg font-semibold mt-1">Continue where you left off</h2>
              <p className="text-muted mt-1 text-[15px]">
                {Math.round(paused.report.coveragePct)}% read so far · {formatDuration(paused.report.activeSec)} reading ({formatDuration(paused.report.durationSec)} session)
                {paused.sittings > 1 ? ` in ${paused.sittings} sittings` : ""} · about {minutesLeft} min left. It all goes into one report.
              </p>
              <div className="mt-3 h-1.5 w-full max-w-sm rounded-full bg-surface-2 overflow-hidden">
                <div className="h-full bg-accent" style={{ width: `${Math.min(100, paused.report.coveragePct)}%` }} />
              </div>
            </div>
            <div className="flex flex-col items-stretch gap-2">
              <Link href={`/read/${reading.id}`} className="btn btn-primary !px-6 !py-3 text-base">
                Continue reading
              </Link>
              <Link href={`/read/${reading.id}?fresh=1`} className="text-sm text-muted hover:text-fg text-center">
                Start over instead
              </Link>
            </div>
          </div>
        </div>
      )}

      <div className={`card p-6 sm:p-8 mb-10 ${paused ? "hidden" : ""}`}>
        <div className="grid md:grid-cols-[1fr_auto] gap-8 items-center">
          <div>
            <h2 className="text-lg font-semibold">Start a reading session</h2>
            <p className="text-muted mt-1 text-[15px]">
              Takes about 30 seconds to set up. Your camera is processed on this device only, and no video is ever uploaded.
              Long reading? Press <b className="text-fg">Save &amp; exit</b> any time to save your place and come back later.
            </p>
            <ul className="mt-5 grid sm:grid-cols-3 gap-3 text-sm">
              <Tip icon={<IconSun size={16} />} text="Sit facing a light, not with a window behind you" />
              <Tip icon={<IconCamera size={16} />} text="Keep your face centered, about an arm's length away" />
              <Tip icon={<IconEye size={16} />} text="Try to keep your head still-ish while you read" />
            </ul>
          </div>
          <Link href={`/read/${reading.id}`} className="btn btn-primary !px-6 !py-3 text-base">
            Start reading
          </Link>
        </div>
      </div>

      <Section title="Preview">
        <p className="font-serif text-[17px] leading-8 text-muted line-clamp-4">{preview}</p>
      </Section>

      <Section
        title="Your sessions"
        action={
          sessions.length > 0 && (
            <span className="text-sm text-muted" title="Time reading this text, added up over all your sessions. Stretches of more than 5 minutes without reading aren't counted.">
              Total reading time: <b className="text-fg">{formatDuration(totalReadingSec)}</b>
            </span>
          )
        }
      >
        {sessions.length === 0 ? (
          <EmptyState>No sessions yet. Your first report will appear here.</EmptyState>
        ) : (
          <div className="card divide-y divide-border">
            {sessions.map((s) => (
              <RowLink key={s.id} href={s.status === "paused" ? `/read/${reading.id}` : `/reports/${s.id}`}>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{formatDate(s.endedAt)}</div>
                  <div className="text-sm text-muted">
                    {formatDuration(s.report.activeSec)} reading ({formatDuration(s.report.durationSec)} session) · focus {Math.round(s.report.focusPct)}%
                    {s.report.avgWpm ? ` · ${s.report.avgWpm} wpm` : ""}
                    {s.sittings > 1 ? ` · ${s.sittings} sittings` : ""}
                  </div>
                </div>
                {sessions.length > 1 && s.id === best?.id && <BestTag />}
                <StatusPill session={s} />
              </RowLink>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Tip({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <li className="flex gap-2.5 rounded-lg bg-surface-2 px-3 py-2.5 text-muted">
      <span className="text-accent mt-0.5">{icon}</span>
      {text}
    </li>
  );
}
