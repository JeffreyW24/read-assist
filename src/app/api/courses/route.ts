import { getCurrentUser } from "@/lib/auth";
import { createCourse } from "@/lib/db";
import { readJsonBody, strField } from "@/lib/validate";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "professor") return Response.json({ error: "Only professors can create courses." }, { status: 403 });
  const body = await readJsonBody(req);
  if (!body) return Response.json({ error: "That request wasn't understood. Reload the page and try again." }, { status: 400 });
  const [name, code, term] = ["name", "code", "term"].map((k) => strField(body, k));
  if (!name?.trim() || !code?.trim()) return Response.json({ error: "Course name and code are required." }, { status: 400 });
  const course = await createCourse(user.id, name.slice(0, 200), code.slice(0, 50), (term ?? "").slice(0, 100));
  return Response.json({ course });
}
