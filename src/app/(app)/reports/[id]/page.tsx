import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getCourse, getReading, getSession, getUser, sessionsFor } from "@/lib/db";
import { formatDate, formatDuration } from "@/lib/text";
import { PageHeader } from "@/components/AppShell";
import { Section, Stat } from "@/components/ui";
import { IconSparkle } from "@/components/icons";
import { Legend, ParagraphStrip, ReadingMap } from "@/components/report/ReadingMap";
import { Timeline } from "@/components/report/Timeline";
import { Quiz } from "@/components/report/Quiz";
import { RecallBox } from "@/components/report/RecallBox";
import { RetryAi } from "@/components/report/RetryAi";
import { AI_FAILED_NOTE, geminiConfigured } from "@/lib/gemini";

export default async function ReportPage({ params }: PageProps<"/reports/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const session = await getSession(id);
  if (!session) notFound();
  const reading = await getReading(session.readingId);
  if (!reading) notFound();
  const course = reading.courseId ? await getCourse(reading.courseId) : null;
  const isOwner = session.userId === user.id;
  const isProf = course?.professorId === user.id;
  if (!isOwner && !isProf) notFound();
  const student = await getUser(session.userId);
  // The student's reading time on this text over all their sessions, not just this one.
  const allOnText = await sessionsFor(session.userId, reading.id);
  const totalReadingSec = allOnText.reduce((t, s) => t + s.report.activeSec, 0);

  const r = session.report;
  const ai = session.ai;
  // Gemini was asked and didn't answer. Older sessions stored the raw technical error as the
  // note: recognise those too, and never show that text to the student.
  const aiFailed = !!ai && ai.generatedBy === "fallback" && (ai.failed === true || !!ai.note?.startsWith("Gemini request failed"));
  const skippedParas = r.paragraphs.filter((p) => p.status === "skipped").length;
  const skimmedParas = r.paragraphs.filter((p) => p.status === "skimmed").length;
  const struggled = [...r.paragraphs].filter((p) => p.rereads > 0).sort((a, b) => b.rereads - a.rereads).slice(0, 3);
  const longestDistraction = r.distractions.reduce((m, d) => Math.max(m, d.durationSec), 0);
  const tabSec = r.distractions.filter((d) => d.kind === "tab").reduce((t, d) => t + d.durationSec, 0);
  const notFacingSec = r.distractions.filter((d) => d.kind !== "tab").reduce((t, d) => t + d.durationSec, 0);
  const coverColor = r.coveragePct >= 85 ? "var(--read)" : r.coveragePct >= 50 ? "var(--skim)" : "var(--skip)";
  const gazeMode = r.calibrationQuality !== "attention-only";
  // The student reads this as "you"; their teacher sees it about the student.
  const who = isOwner ? "You" : student?.name.split(" ")[0] || "The student";

  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow={`${session.status === "paused" ? "In progress (paused)" : "Session report"} · ${formatDate(session.endedAt)}${session.sittings > 1 ? ` · ${session.sittings} sittings` : ""}${!isOwner && student ? ` · ${student.name}` : ""}`}
        title={reading.title}
        actions={
          isOwner && (
            <Link href={`/read/${reading.id}`} className="btn btn-ghost">
              Read again
            </Link>
          )
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="Coverage" value={`${Math.round(r.coveragePct)}%`} hint={`${r.wordsRead.toLocaleString()} of ${reading.wordCount.toLocaleString()} words`} color={coverColor} />
        <Stat label="Focus" value={`${Math.round(r.focusPct)}%`} hint={`${r.distractions.length} distraction${r.distractions.length === 1 ? "" : "s"}`} />
        <Stat
          label="Reading speed"
          value={r.avgWpm ? `${r.avgWpm}` : "–"}
          hint={r.avgWpm ? `words / minute${r.baselineWpm ? ` · ${r.baselineWpm} in the warm-up passage` : ""}` : "not enough data"}
        />
        {/* "Reading time" means eyes on the page everywhere in the app; session length is labelled separately. */}
        <Stat
          label="Reading time"
          value={formatDuration(r.activeSec)}
          hint={`eyes on the page · session length ${formatDuration(r.durationSec)} (incl. distractions)${allOnText.length > 1 ? ` · ${formatDuration(totalReadingSec)} over all ${allOnText.length} sessions on this text` : ""}`}
        />
      </div>

      <div className="card px-5 py-4 mb-10">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-xs font-medium text-muted">Paragraph by paragraph</span>
          <span className="text-xs text-muted">
            {skippedParas} skipped · {skimmedParas} skimmed · {r.pagesTurned} page turns
          </span>
        </div>
        <ParagraphStrip stats={r.paragraphs} />
        <p className="text-xs text-faint mt-3">
          {gazeMode
            ? `Eye tracking: ${r.calibrationQuality} calibration${r.calibrationErrorPx !== null ? ` (≈${Math.round(r.calibrationErrorPx)}px)` : ""}. Line-level results are estimates.`
            : "Focus-only mode: coverage is based on time per page, not line-by-line gaze."}
        </p>
      </div>

      {ai && (ai.sections.length > 0 || ai.overview) && (
        <Section title={isOwner ? "What you missed" : `What ${who} missed`}>
          <div className="card p-6">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-accent">
                <IconSparkle size={18} />
              </span>
              <div>
                {/* The AI note is written to the student; tell the teacher that's who it's for. */}
                {!isOwner && <div className="text-xs font-medium text-muted mb-0.5">What {who} was shown</div>}
                <p className="text-[15px] leading-relaxed">{ai.overview}</p>
              </div>
            </div>
            {ai.sections.length > 0 && (
              <div className="mt-5 grid gap-3">
                {ai.sections.map((s, i) => (
                  <div key={i} className="rounded-xl border border-border bg-surface-2/50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium">{s.title}</div>
                      <a href={`#p-${s.paragraphs[0]}`} className="text-xs text-accent hover:underline whitespace-nowrap">
                        ¶{s.paragraphs[0] + 1}
                        {s.paragraphs.length > 1 ? `–${s.paragraphs[s.paragraphs.length - 1] + 1}` : ""} →
                      </a>
                    </div>
                    <p className="text-sm text-muted mt-1.5 leading-relaxed">{s.summary}</p>
                    {/* No AI quiz (no Gemini key)? Still prompt the student to recall the main point. */}
                    {ai.quiz.length === 0 && isOwner && (
                      <RecallBox sessionId={session.id} section={i} initial={session.recall?.[String(i)]?.text ?? ""} />
                    )}
                    {!isOwner && session.recall?.[String(i)] && (
                      <div className="mt-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                        <div className="text-xs font-medium text-muted mb-0.5">Student&apos;s summary in their own words</div>
                        {session.recall[String(i)].text}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-faint mt-4">
              {ai.generatedBy === "gemini" ? "Summaries generated by Google Gemini." : aiFailed ? AI_FAILED_NOTE : ai.note ?? "AI summaries unavailable."}{" "}
              {aiFailed && isOwner && geminiConfigured() && <RetryAi sessionId={session.id} />}
            </p>
          </div>
        </Section>
      )}

      {ai && ai.quiz.length > 0 && isOwner && (
        <Section title="Quick check on the parts you skipped">
          <Quiz questions={ai.quiz} />
        </Section>
      )}

      <Section title="How the session went">
        <div className="card p-5 space-y-5">
          <Timeline segments={r.timeline} duration={r.durationSec} distractions={r.distractions} focusOnly={!gazeMode} />
          <div className="grid sm:grid-cols-3 gap-4 pt-4 border-t border-border text-sm">
            <div>
              <div className="text-muted text-xs">Longest distraction</div>
              <div className="font-medium mt-0.5">{longestDistraction ? formatDuration(longestDistraction) : "None"}</div>
              {(tabSec > 0 || notFacingSec > 0) && (
                <div className="text-xs text-muted mt-0.5">
                  {[tabSec > 0 && `${formatDuration(tabSec)} on another tab`, notFacingSec > 0 && `${formatDuration(notFacingSec)} not facing the screen`]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              )}
            </div>
            <div>
              <div className="text-muted text-xs">Gentle nudges shown</div>
              <div className="font-medium mt-0.5">{r.nudges}</div>
            </div>
            <div>
              <div className="text-muted text-xs">Most re-read</div>
              <div className="font-medium mt-0.5">
                {struggled.length ? struggled.map((p) => `¶${p.index + 1}`).join(", ") : "Nothing stood out"}
              </div>
            </div>
          </div>
          {struggled.length > 0 && (
            <p className="text-sm text-muted">
              {who} went back over {struggled.map((p) => `¶${p.index + 1}`).join(" and ")} more than other parts. That usually means a tricky
              idea, so it may be worth reviewing or asking about in class.
            </p>
          )}
        </div>
      </Section>

      <Section title={isOwner ? "Your reading map" : `${who}'s reading map`} action={<Legend />}>
        <div className="card p-6 sm:p-10 sm:pl-12">
          <ReadingMap paragraphs={reading.paragraphs} wordStatus={r.wordStatus} stats={r.paragraphs} />
        </div>
      </Section>
    </div>
  );
}
