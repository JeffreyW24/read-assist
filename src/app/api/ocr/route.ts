import { getCurrentUser } from "@/lib/auth";
import { geminiConfigured, transcribePages } from "@/lib/gemini";
import { takeAiCall } from "@/lib/db";

// Photos or scans of pages → text, using Gemini (much better than on-device OCR at
// handwriting-free but crooked/shadowed photocopies). Without a key the browser does it instead.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!geminiConfigured()) return Response.json({ error: "no-ai" }, { status: 501 });
  const form = await req.formData().catch(() => null);
  if (!form) return Response.json({ error: "No file uploaded." }, { status: 400 });
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) return Response.json({ error: "No files uploaded." }, { status: 400 });
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > 18 * 1024 * 1024) return Response.json({ error: "That's too much at once (18 MB max). Try fewer pages." }, { status: 400 });
  const ok = files.every((f) => f.type.startsWith("image/") || f.type === "application/pdf");
  if (!ok) return Response.json({ error: "Upload images (JPG, PNG, HEIC) or a PDF." }, { status: 400 });
  // Over the AI allowance: the browser reads the pages on the device instead.
  if (!(await takeAiCall(user.id))) return Response.json({ error: "no-ai" }, { status: 501 });
  try {
    const text = await transcribePages(await Promise.all(files.map(async (f) => ({ mimeType: f.type, data: Buffer.from(await f.arrayBuffer()) }))));
    if (!text) return Response.json({ error: "Couldn't find any text in those pages." }, { status: 422 });
    return Response.json({ text, pages: files.length });
  } catch (err) {
    console.error("[ocr] Gemini transcription failed:", err);
    return Response.json({ error: "no-ai" }, { status: 501 }); // let the browser try instead
  }
}
