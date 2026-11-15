import { getCurrentUser } from "@/lib/auth";
import { createReading, getCourse } from "@/lib/db";
import { dueDateFromInput, toParagraphs } from "@/lib/text";
import { MAX_INSTRUCTIONS_CHARS, readJsonBody, strField } from "@/lib/validate";

// About 150,000 words: far more than any single assignment, small enough to keep pages fast.
const MAX_TEXT_CHARS = 1_000_000;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const raw = await readJsonBody(req, MAX_TEXT_CHARS + 100_000);
  if (!raw) return Response.json({ error: "That request wasn't understood (or the reading is too long). Reload the page and try again." }, { status: 400 });
  const body = {
    title: strField(raw, "title"),
    text: strField(raw, "text") ?? "",
    courseId: strField(raw, "courseId"),
    dueDate: strField(raw, "dueDate"),
    instructions: strField(raw, "instructions"),
    source: strField(raw, "source"),
  };
  if (body.text.length > MAX_TEXT_CHARS)
    return Response.json({ error: "That reading is too long. Split it into smaller readings." }, { status: 400 });
  const paragraphs = toParagraphs(body.text);
  if (!body.title?.trim()) return Response.json({ error: "Give the reading a title." }, { status: 400 });
  if (paragraphs.length === 0) return Response.json({ error: "The reading has no text." }, { status: 400 });

  const dueDate = body.dueDate ? dueDateFromInput(body.dueDate) : null;
  if (body.dueDate && !dueDate) return Response.json({ error: "That due date isn't a real date." }, { status: 400 });

  let courseId: string | null = null;
  if (body.courseId) {
    const course = await getCourse(body.courseId);
    if (!course || course.professorId !== user.id)
      return Response.json({ error: "Only the course's professor can post readings to it." }, { status: 403 });
    courseId = course.id;
  }

  const reading = await createReading({
    title: body.title.trim().slice(0, 300),
    paragraphs,
    ownerId: user.id,
    courseId,
    dueDate,
    instructions: body.instructions?.trim().slice(0, MAX_INSTRUCTIONS_CHARS) ?? "",
    source: body.source === "pdf" || body.source === "image" ? body.source : "paste",
  });
  return Response.json({ reading });
}
