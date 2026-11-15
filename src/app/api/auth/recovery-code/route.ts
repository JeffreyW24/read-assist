// Settings: make a new recovery code (replacing the old one). Needs the current password, so
// someone using a borrowed, signed-in computer can't quietly give themselves a way in.
import { checkPassword, getCurrentUser, hashPassword } from "@/lib/auth";
import { getPasswordHash, setRecoveryHash } from "@/lib/db";
import { newRecoveryCode, normalizeRecoveryCode } from "@/lib/recoveryCode";
import { readJsonBody, strField } from "@/lib/validate";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (user.demo) return Response.json({ error: "Demo accounts are shared and don't have a recovery code." }, { status: 403 });
  const body = await readJsonBody(req);
  const password = body ? strField(body, "password") : undefined;
  const stored = await getPasswordHash(user.id);
  if (!stored || !password || !(await checkPassword(password, stored))) return Response.json({ error: "Your password isn't right." }, { status: 400 });
  const recoveryCode = newRecoveryCode();
  await setRecoveryHash(user.id, await hashPassword(normalizeRecoveryCode(recoveryCode)));
  return Response.json({ ok: true, recoveryCode });
}
