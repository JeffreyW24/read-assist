import { getCurrentUser } from "@/lib/auth";
import { getCourse, getReading, updateReadingDetails } from "@/lib/db";
import { dueDateFromInput } from "@/lib/text";
import { MAX_INSTRUCTIONS_CHARS, readJsonBody, strField } from "@/lib/validate";

// Edit a posted reading's title, due date and instructions. Only the course's teacher can.
// The text can't change here: students' reports are tied to its words.
export async function PATCH(req: Request, ctx: RouteContext<"/api/readings/[id]">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  const reading = await getReading(id);
  const course = reading?.courseId ? await getCourse(reading.courseId) : null;
  if (!user || !reading || !course || course.professorId !== user.id) return Response.json({ error: "Not allowed." }, { status: 403 });

  const body = await readJsonBody(req);
  if (!body) return Response.json({ error: "That request wasn't understood. Reload the page and try again." }, { status: 400 });
  const title = (strField(body, "title") ?? reading.title).trim().slice(0, 300);
  if (!title) return Response.json({ error: "Give the reading a title." }, { status: 400 });
  const instructions = (strField(body, "instructions") ?? reading.instructions).trim().slice(0, MAX_INSTRUCTIONS_CHARS);
  // "" or null clears the due date; a missing field keeps it.
  let dueDate = reading.dueDate;
  if (body.dueDate === null || body.dueDate === "") dueDate = null;
  else if (typeof body.dueDate === "string") {
    dueDate = dueDateFromInput(body.dueDate);
    if (!dueDate) return Response.json({ error: "That due date isn't valid." }, { status: 400 });
  }
  await updateReadingDetails(reading.id, { title, dueDate, instructions });
  return Response.json({ ok: true });
}
