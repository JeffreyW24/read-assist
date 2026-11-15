// The signed-in user's display settings (the Settings page).
import { getCurrentUser } from "@/lib/auth";
import { saveUserSettings } from "@/lib/db";
import { readJsonBody } from "@/lib/validate";

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const body = await readJsonBody(req);
  if (!body || typeof body.dyslexiaFont !== "boolean") return Response.json({ error: "That request wasn't understood. Reload the page and try again." }, { status: 400 });
  await saveUserSettings(user.id, { dyslexiaFont: body.dyslexiaFont });
  return Response.json({ ok: true, dyslexiaFont: body.dyslexiaFont });
}
