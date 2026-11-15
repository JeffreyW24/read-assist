import { getCurrentUser } from "@/lib/auth";
import { getCourse, getDigest, getReading, saveDigest, studentSessionsForReading, takeAiCall } from "@/lib/db";
import { generateClassDigest } from "@/lib/gemini";
import { aggregateParagraphs, bestPerStudent } from "@/lib/insights";

export async function POST(_req: Request, ctx: RouteContext<"/api/readings/[id]/digest">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  const reading = await getReading(id);
  const course = reading?.courseId ? await getCourse(reading.courseId) : null;
  if (!user || !reading || !course || course.professorId !== user.id)
    return Response.json({ error: "Not allowed." }, { status: 403 });

  // Enrolled students only: the professor trying the reading themselves isn't part of the class.
  const latest = [...bestPerStudent(await studentSessionsForReading(reading.id)).values()];
  if (latest.length === 0) return Response.json({ error: "No student sessions yet." }, { status: 400 });

  const result = await generateClassDigest(reading, latest.length, aggregateParagraphs(reading, latest), () => takeAiCall(user.id));
  // Gemini didn't answer this time: keep a summary it wrote earlier rather than replacing it with the basic one.
  if (result.generatedBy === "fallback" && (await getDigest(reading.id))?.generatedBy === "gemini")
    return Response.json({ error: "The AI couldn't be reached, so your current summary was kept. Try again in a minute." }, { status: 502 });
  const digest = { readingId: reading.id, text: result.text, generatedBy: result.generatedBy, createdAt: new Date().toISOString() };
  await saveDigest(digest);
  return Response.json({ digest });
}
