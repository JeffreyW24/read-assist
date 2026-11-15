// "Sign out of all other devices" (Settings): every session but this browser's is deleted.
import { endOtherSessions, getCurrentUser } from "@/lib/auth";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  await endOtherSessions(user.id, true);
  return Response.json({ ok: true });
}
