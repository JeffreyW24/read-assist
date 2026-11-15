import { hashPassword, startSession } from "@/lib/auth";
import { createUser, getUserByUsername, normalizeUsername, setRecoveryHash, USERNAME_RULE } from "@/lib/db";
import { MIN_PASSWORD, newRecoveryCode, normalizeRecoveryCode } from "@/lib/recoveryCode";
import { readJsonBody, strField } from "@/lib/validate";

export async function POST(req: Request) {
  const body = await readJsonBody(req);
  if (!body) return Response.json({ error: "That request wasn't understood. Reload the page and try again." }, { status: 400 });
  const [name, rawUsername, password, role] = ["name", "username", "password", "role"].map((k) => strField(body, k));
  if (!name?.trim() || name.trim().length > 200) return Response.json({ error: "Enter your name." }, { status: 400 });
  const username = normalizeUsername(rawUsername ?? "");
  if (!USERNAME_RULE.test(username))
    return Response.json({ error: "Pick a username of 3–30 letters or numbers (you can also use . _ -), starting with a letter or number." }, { status: 400 });
  if (!password || password.length < MIN_PASSWORD) return Response.json({ error: `Use a password of at least ${MIN_PASSWORD} characters.` }, { status: 400 });
  if (role !== "student" && role !== "professor") return Response.json({ error: "Pick student or teacher." }, { status: 400 });
  const taken = "That username is taken. Try another one.";
  if (await getUserByUsername(username)) return Response.json({ error: taken }, { status: 409 });
  const user = await createUser(name, username, role, await hashPassword(password));
  // Taken between the check above and now (two sign-ups at once).
  if (!user) return Response.json({ error: taken }, { status: 409 });
  // The recovery code is how a forgotten password gets reset. It's shown once, right after sign-up.
  const recoveryCode = newRecoveryCode();
  await setRecoveryHash(user.id, await hashPassword(normalizeRecoveryCode(recoveryCode)));
  await startSession(user.id);
  return Response.json({ ok: true, recoveryCode });
}
