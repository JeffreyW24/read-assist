// Articles read on other sites, handed over by the Read Assist browser extension.
// The dashboard page receives them from the extension (in the student's own browser) and
// posts them here with the student's normal sign-in cookie, so the extension needs no login.
import { getCurrentUser } from "@/lib/auth";
import { upsertWebReadings } from "@/lib/db";
import { readJsonBody } from "@/lib/validate";
import { checkWebReading } from "@/lib/webReadingCheck";

const MAX_ARTICLES = 200;
// Up to MAX_ARTICLES articles with a short snippet per paragraph.
const MAX_BODY = 20_000_000;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const body = await readJsonBody(req, MAX_BODY);
  const list = body && Array.isArray(body.articles) ? body.articles : null;
  if (!list) return Response.json({ error: "Expected { articles: [...] }." }, { status: 400 });
  const items = list.slice(0, MAX_ARTICLES).map(checkWebReading).filter((x) => x !== null);
  const changed = await upsertWebReadings(user.id, items);
  return Response.json({ received: list.length, accepted: items.length, changed });
}
