// Change password (Settings). Needs the current one. Other devices are signed out.
import { checkPassword, endOtherSessions, getCurrentUser, hashPassword } from "@/lib/auth";
import { getPasswordHash, setPasswordHash } from "@/lib/db";
import { MIN_PASSWORD } from "@/lib/recoveryCode";
import { readJsonBody, strField } from "@/lib/validate";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (user.demo) return Response.json({ error: "Demo accounts are shared and don't have a password." }, { status: 403 });
  const body = await readJsonBody(req);
  const current = body ? strField(body, "current") : undefined;
  const next = body ? strField(body, "next") : undefined;
  if (!next || next.length < MIN_PASSWORD) return Response.json({ error: `Use a new password of at least ${MIN_PASSWORD} characters.` }, { status: 400 });
  const stored = await getPasswordHash(user.id);
  if (!stored || !current || !(await checkPassword(current, stored))) return Response.json({ error: "Your current password isn't right." }, { status: 400 });
  await setPasswordHash(user.id, await hashPassword(next));
  await endOtherSessions(user.id, true);
  return Response.json({ ok: true });
}
