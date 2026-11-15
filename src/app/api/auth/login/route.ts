import { checkPassword, startSession } from "@/lib/auth";
import { getUserForSignIn } from "@/lib/db";
import { demoAccountsEnabled } from "@/lib/demo";
import { readJsonBody, strField } from "@/lib/validate";

export async function POST(req: Request) {
  const body = await readJsonBody(req);
  if (!body) return Response.json({ error: "That request wasn't understood. Reload the page and try again." }, { status: 400 });
  const username = strField(body, "username");
  const password = strField(body, "password");
  if (!username?.trim()) return Response.json({ error: "Enter your username." }, { status: 400 });
  const user = await getUserForSignIn(username);
  // Demo accounts have no password and sign in from the demo buttons (when they are turned on).
  const ok = !!user && (user.passwordHash ? !!password && (await checkPassword(password, user.passwordHash)) : user.demo === true && demoAccountsEnabled());
  if (!user || !ok) return Response.json({ error: "Wrong username or password." }, { status: 401 });
  await startSession(user.id);
  return Response.json({ ok: true });
}
