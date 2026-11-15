import { getCurrentUser } from "@/lib/auth";
import { takeAiCall } from "@/lib/db";
import { pdfToText } from "@/lib/pdf";
import { cleanExtractedText } from "@/lib/gemini";

// AI clean-up goes through a long PDF in chunks (see cleanExtractedText), which takes a while.
export const maxDuration = 300;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const form = await req.formData().catch(() => null);
  if (!form) return Response.json({ error: "No file uploaded." }, { status: 400 });
  const file = form.get("file");
  const useAi = form.get("ai") === "1";
  if (!(file instanceof File)) return Response.json({ error: "No file uploaded." }, { status: 400 });
  if (file.size > 25 * 1024 * 1024) return Response.json({ error: "PDF is too large (25 MB max)." }, { status: 400 });
  try {
    const { text, pages } = await pdfToText(await file.arrayBuffer());
    // A photocopy/scan has pages that are just pictures. The form then reads them as images.
    if (text.replace(/\s+/g, "").length < 40 * Math.max(1, pages))
      return Response.json({ scanned: true, pages });
    let finalText = text;
    let cleanedByAi = false;
    if (useAi) {
      const cleaned = await cleanExtractedText(text, () => takeAiCall(user.id));
      if (cleaned) {
        finalText = cleaned;
        cleanedByAi = true;
      }
    }
    const title = file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ");
    return Response.json({ text: finalText, pages, title, cleanedByAi });
  } catch (err) {
    console.error("[pdf] extraction failed:", err);
    return Response.json({ error: "Couldn't read that PDF." }, { status: 500 });
  }
}
