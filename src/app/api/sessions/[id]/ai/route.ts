import { getCurrentUser } from "@/lib/auth";
import { getReading, getSession, saveSessionAi, takeAiCall } from "@/lib/db";
import { generateSessionAi, geminiConfigured } from "@/lib/gemini";

// "Try again" for a report whose AI summary failed (Gemini was slow or unreachable when the
// session was saved). Only the student who owns the session can ask, and only while the
// report still shows the basic version, so this can't be used to call Gemini over and over.
export async function POST(_req: Request, ctx: RouteContext<"/api/sessions/[id]/ai">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  const session = await getSession(id);
  if (!user || !session || session.userId !== user.id) return Response.json({ error: "Not allowed." }, { status: 403 });
  if (session.status !== "done" || !session.ai) return Response.json({ error: "This session has no summary to redo." }, { status: 400 });
  if (session.ai.generatedBy === "gemini") return Response.json({ ok: true, generatedBy: "gemini" });
  if (!geminiConfigured()) return Response.json({ error: "AI summaries aren't set up on this server." }, { status: 400 });
  const reading = await getReading(session.readingId);
  if (!reading) return Response.json({ error: "Reading not found." }, { status: 404 });
  const ai = await generateSessionAi(reading, session.report, () => takeAiCall(user.id));
  if (ai.generatedBy !== "gemini") return Response.json({ error: "The AI summary still couldn't be created. Try again in a minute." }, { status: 502 });
  await saveSessionAi(session.id, ai);
  return Response.json({ ok: true, generatedBy: "gemini" });
}
