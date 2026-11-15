// "Forgot password": username + recovery code + new password, no email involved.
// A right code sets the new password, replaces the code with a fresh one (shown once), signs
// out every other device and signs this browser in. Wrong tries are limited per account.
import { checkPassword, endOtherSessions, hashPassword, startSession } from "@/lib/auth";
import {
  clearRecoveryAttempts, countRecoveryAttemptsSince, getRecoveryHash, getUserByUsername, recordRecoveryAttempt, setPasswordHash, setRecoveryHash,
} from "@/lib/db";
import { MIN_PASSWORD, newRecoveryCode, normalizeRecoveryCode, RECOVERY_TRIES, RECOVERY_WINDOW_MIN } from "@/lib/recoveryCode";
import { readJsonBody, strField } from "@/lib/validate";

const NO_MATCH = "That username and recovery code don't match.";

export async function POST(req: Request) {
  const body = await readJsonBody(req);
  if (!body) return Response.json({ error: "That request wasn't understood. Reload the page and try again." }, { status: 400 });
  const username = strField(body, "username") ?? "";
  const code = normalizeRecoveryCode(strField(body, "code") ?? "");
  const password = strField(body, "password");
  if (!username.trim() || !code) return Response.json({ error: "Enter your username and recovery code." }, { status: 400 });
  if (!password || password.length < MIN_PASSWORD) return Response.json({ error: `Use a new password of at least ${MIN_PASSWORD} characters.` }, { status: 400 });

  const user = await getUserByUsername(username);
  // Same answer for "no such user", "demo account", "no code" and "wrong code".
  if (!user || user.demo) return Response.json({ error: NO_MATCH }, { status: 400 });
  const since = new Date(Date.now() - RECOVERY_WINDOW_MIN * 60_000).toISOString();
  if ((await countRecoveryAttemptsSince(user.id, since)) >= RECOVERY_TRIES)
    return Response.json({ error: `Too many tries. Wait ${RECOVERY_WINDOW_MIN} minutes and try again.` }, { status: 429 });
  const stored = await getRecoveryHash(user.id);
  if (!stored || !(await checkPassword(code, stored))) {
    await recordRecoveryAttempt(user.id);
    return Response.json({ error: NO_MATCH }, { status: 400 });
  }

  await setPasswordHash(user.id, await hashPassword(password));
  const recoveryCode = newRecoveryCode(); // the old code is used up
  await setRecoveryHash(user.id, await hashPassword(normalizeRecoveryCode(recoveryCode)));
  await clearRecoveryAttempts(user.id);
  await endOtherSessions(user.id, false);
  await startSession(user.id);
  return Response.json({ ok: true, recoveryCode });
}
