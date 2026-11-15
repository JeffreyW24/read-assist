import { getCurrentUser } from "@/lib/auth";
import { getCourse, getLessonPlan, getReading, saveLessonPlan, studentSessionsForReading, studentsInCourse, takeAiCall } from "@/lib/db";
import { generateLessonPlan } from "@/lib/gemini";
import { aggregateParagraphs, bestPerStudent } from "@/lib/insights";

export async function POST(_req: Request, ctx: RouteContext<"/api/readings/[id]/lesson-plan">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  const reading = await getReading(id);
  const course = reading?.courseId ? await getCourse(reading.courseId) : null;
  if (!user || !reading || !course || course.professorId !== user.id) return Response.json({ error: "Not allowed." }, { status: 403 });

  // Enrolled students only: the professor trying the reading themselves isn't part of the class.
  const best = [...bestPerStudent(await studentSessionsForReading(reading.id)).values()];
  if (best.length === 0) return Response.json({ error: "No student sessions yet." }, { status: 400 });
  const students = await studentsInCourse(course.id);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const result = await generateLessonPlan(reading, best.length, aggregateParagraphs(reading, best), {
    avgCoverage: avg(best.map((s) => s.report.coveragePct)),
    avgFocus: avg(best.map((s) => s.report.focusPct)),
    notStarted: Math.max(0, students.length - best.length),
  }, () => takeAiCall(user.id));
  // Gemini didn't answer this time: keep a plan it wrote earlier rather than replacing it with the basic template.
  if (result.generatedBy === "fallback" && (await getLessonPlan(reading.id))?.generatedBy === "gemini")
    return Response.json({ error: "The AI couldn't be reached, so your current plan was kept. Try again in a minute." }, { status: 502 });
  const plan = { readingId: reading.id, text: result.text, generatedBy: result.generatedBy, createdAt: new Date().toISOString(), basedOnSessions: best.length };
  await saveLessonPlan(plan);
  return Response.json({ plan });
}
