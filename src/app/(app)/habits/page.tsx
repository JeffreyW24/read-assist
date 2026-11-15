import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { coursesForUser, personalReadings, readingsForCourses, sessionsFor } from "@/lib/db";
import { plural, readingHabits, studentSummary } from "@/lib/insights";
import { appDay, formatDuration } from "@/lib/text";
import type { Reading, Session } from "@/lib/types";
import { PageHeader } from "@/components/AppShell";
import { EmptyState, HabitCard, Section, Stat } from "@/components/ui";

export default async function HabitsPage() {
  const user = await requireUser();
  if (user.role !== "student") redirect("/dashboard");
  const courses = await coursesForUser(user);
  const readings = [...(await readingsForCourses(courses.map((c) => c.id))), ...(await personalReadings(user.id))];
  const sessions = await sessionsFor(user.id);
  const byId = new Map<string, Reading>(readings.map((r) => [r.id, r]));
  const habits = readingHabits(sessions, byId);
  const s = studentSummary(readings, sessions);
  const week = weeklyMinutes(sessions);
  const maxWeek = Math.max(1, ...week.map((w) => w.min));

  return (
    <div className="max-w-4xl">
      <PageHeader title="Your reading habits" subtitle="Patterns from all your sessions. They get sharper the more you read." />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
        <Stat label="Time reading" value={formatDuration(s.eyesOnSec)} hint="eyes on the page, all time" />
        <Stat label="Sessions" value={s.sessions} hint={`${plural(s.finished, "reading")} finished`} />
        <Stat
          label="Avg coverage"
          value={s.avgCoverage === null ? "–" : `${Math.round(s.avgCoverage)}%`}
          hint={s.started ? `across all ${plural(s.started, "reading")} you've started (assigned + your own)` : "no readings started yet"}
        />
        <Stat label="Avg focus" value={s.avgFocus === null ? "–" : `${Math.round(s.avgFocus)}%`} hint={s.started ? `same ${plural(s.started, "reading")} · time not distracted` : "time not distracted"} />
      </div>

      <Section title="What we've noticed">
        {habits.length === 0 ? (
          <EmptyState>
            Read a couple more sessions (a minute or longer each) and patterns will show up here.{" "}
            <Link href="/dashboard" className="text-accent underline underline-offset-2">Find a reading</Link>
          </EmptyState>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {habits.map((h) => (
              <HabitCard key={h.id} title={h.title} detail={h.detail} tone={h.tone} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Minutes reading, last 8 weeks">
        <div className="card p-6">
          <div className="flex items-end gap-3 h-36">
            {week.map((w) => (
              <div key={w.label} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                <span className="text-[11px] text-muted tabular-nums">{w.min ? Math.round(w.min) : ""}</span>
                <div className="w-full max-w-10 rounded-t-md bg-accent/70" style={{ height: `${(w.min / maxWeek) * 100}%`, minHeight: w.min ? 3 : 0 }} />
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-2 border-t border-border pt-2">
            {week.map((w) => (
              <div key={w.label} className="flex-1 text-center text-[11px] text-muted">{w.label}</div>
            ))}
          </div>
          <p className="text-xs text-faint mt-3">Counts time with your eyes on the page, not time with the tab open.</p>
        </div>
      </Section>
    </div>
  );
}

/** Reading minutes per week (Monday start, Eastern time), oldest first. */
function weeklyMinutes(sessions: Session[]) {
  // Calendar days as "YYYY-MM-DD" in Eastern time; day arithmetic on them is done in UTC.
  const today = new Date(appDay(new Date()) + "T00:00:00Z");
  const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * 864e5);
  const dayOf = (d: Date) => d.toISOString().slice(0, 10);
  return Array.from({ length: 8 }, (_, i) => {
    const start = new Date(monday.getTime() - (7 - i) * 7 * 864e5);
    const end = new Date(start.getTime() + 7 * 864e5);
    const min = sessions
      .filter((s) => {
        const day = appDay(s.startedAt);
        return day >= dayOf(start) && day < dayOf(end);
      })
      .reduce((t, s) => t + s.report.activeSec / 60, 0);
    return { label: i === 7 ? "This wk" : start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }), min };
  });
}
