import { getCurrentUser } from "@/lib/auth";
import { canViewReading, closePausedSessions, createSession, getReading, getSession, sessionBySaveId, takeAiCall, updateSession } from "@/lib/db";
import { generateSessionAi } from "@/lib/gemini";
import { checkReport, checkResume, parseTimestamp, readJsonBody, strField } from "@/lib/validate";

// A report has one entry per word, and a paused session's resume state a few more, so a very
// long reading makes a big request. Far more than the longest allowed reading needs.
const MAX_BODY = 20_000_000;

// Saves a reading session. status "paused" keeps the progress (and the state needed to resume);
// status "done" finishes it and builds the AI summary. Resuming a paused session updates the
// same row, so a long reading done in several sittings ends up as ONE report.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const body = await readJsonBody(req, MAX_BODY);
  if (!body) return Response.json({ error: "That request wasn't understood. Reload the page and try again." }, { status: 400 });
  const readingId = strField(body, "readingId");
  const sessionId = strField(body, "sessionId");
  // Identifies this save in the browser. A retry of a save that already went through (the
  // response was lost) or a double submit sends the same id, and must not store it twice.
  const saveId = strField(body, "saveId")?.slice(0, 100) || null;
  const reading = readingId ? await getReading(readingId) : null;
  if (!reading || !(await canViewReading(user, reading))) return Response.json({ error: "Reading not found." }, { status: 404 });

  if (saveId) {
    const already = await sessionBySaveId(user.id, saveId);
    if (already) return Response.json({ id: already.id });
  }

  // The report is built in the browser, so check it fits this reading before saving it:
  // a malformed one would otherwise break the class pages that read it back.
  const checked = checkReport(body.report, reading);
  if ("error" in checked) return Response.json({ error: checked.error }, { status: 400 });
  const report = checked.report;

  const startedAt = parseTimestamp(body.startedAt);
  const endedAt = parseTimestamp(body.endedAt);
  if (!startedAt || !endedAt || endedAt < startedAt)
    return Response.json({ error: "The session's start and end times aren't valid." }, { status: 400 });

  const status = body.status === "paused" ? "paused" : "done";
  const resume = status === "paused" ? checkResume(body.resume, reading) : null;
  if (status === "paused" && !resume) return Response.json({ error: "Missing progress to save." }, { status: 400 });

  const ai = status === "done" ? await generateSessionAi(reading, report, () => takeAiCall(user.id)) : null;

  if (sessionId) {
    const existing = await getSession(sessionId);
    if (existing && existing.userId === user.id && existing.readingId === reading.id && existing.status === "paused") {
      await updateSession(existing.id, { endedAt, status, sittings: existing.sittings + 1, report, ai, resume }, saveId);
      return Response.json({ id: existing.id });
    }
  }
  await closePausedSessions(user.id, reading.id);
  const session = await createSession(
    {
      readingId: reading.id,
      userId: user.id,
      startedAt,
      endedAt,
      status,
      sittings: 1,
      report,
      ai,
      resume,
    },
    saveId,
  );
  return Response.json({ id: session.id });
}
