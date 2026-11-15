import { startSession } from "@/lib/auth";
import { getUser } from "@/lib/db";
import { demoAccountsEnabled } from "@/lib/demo";
import { readJsonBody, strField } from "@/lib/validate";

// One-click sign-in for the seeded demo accounts (and accounts carried over from the old demo).
export async function POST(req: Request) {
  if (!demoAccountsEnabled()) return Response.json({ error: "Demo accounts are turned off here. Create an account instead." }, { status: 403 });
  const body = await readJsonBody(req);
  const userId = body ? strField(body, "userId") : undefined;
  const user = userId ? await getUser(userId) : null;
  if (!user?.demo) return Response.json({ error: "That isn't a demo account." }, { status: 403 });
  await startSession(user.id);
  return Response.json({ ok: true });
}
