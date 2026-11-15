// Everything that talks to Google Gemini lives here. It only ever runs on the server,
// so your API key is never sent to the browser.
import { GoogleGenAI } from "@google/genai";
import type { AiResult, ParagraphStat, QuizQuestion, Reading, SessionReport, SkippedSection } from "./types";
import { isHeading } from "./text";

const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

function client(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === "your-key-here") return null;
  // The library defaults to API version "v1", which doesn't know the "gemini-flash-latest"
  // alias (it answers 404 "not found for API version v1"). "v1beta" does, and also supports
  // the JSON-schema responses used below.
  return new GoogleGenAI({ apiKey: key, apiVersion: process.env.GEMINI_API_VERSION || "v1beta" });
}

export function geminiConfigured(): boolean {
  return client() !== null;
}

/**
 * Longest we wait for Gemini (ms). Finishing a reading session waits for its summary, so
 * without a limit a slow or unreachable Gemini would leave the student stuck on "saving".
 * After this the basic (non-AI) version is used instead, and can be retried from the report.
 */
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 25_000;

function withTimeout<T>(work: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Gemini took longer than ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/** What the student sees when Gemini fails. The technical error goes to the server log only. */
export const AI_FAILED_NOTE = "The AI summary couldn't be created this time, so this is a basic version.";

/**
 * Asked right before a Gemini call; false = this user has used their AI allowance for now
 * (see takeAiCall in db.ts), so the basic version is used instead.
 */
const AI_BUSY_NOTE = "You've used the AI a lot in the last few minutes, so this is the basic version. Generate again in a few minutes.";

export type AiGate = () => Promise<boolean>;
const always: AiGate = async () => true;

async function generateJson<T>(prompt: string, schema: object): Promise<T> {
  const ai = client();
  if (!ai) throw new Error("GEMINI_API_KEY is not set");
  const res = await withTimeout(ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: schema,
      temperature: 0.4,
    },
  }));
  const text = res.text;
  if (!text) throw new Error("Gemini returned an empty response");
  return JSON.parse(text) as T;
}

/** Group neighbouring skipped/skimmed paragraphs into sections (headings are ignored). */
export function missedSections(reading: Reading, stats: ParagraphStat[]): number[][] {
  const groups: number[][] = [];
  let current: number[] = [];
  for (const s of stats) {
    const missed = s.status !== "read" && !isHeading(reading.paragraphs[s.index] ?? "");
    if (missed) current.push(s.index);
    else if (current.length) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

const SESSION_SCHEMA = {
  type: "object",
  properties: {
    overview: { type: "string", description: "2-3 sentences: what the student missed and why it matters." },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          section: { type: "integer", description: "The section number given in the prompt." },
          title: { type: "string", description: "A 3-7 word title for the section." },
          summary: { type: "string", description: "A clear 2-4 sentence summary of the section." },
        },
        required: ["section", "title", "summary"],
      },
    },
    quiz: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
          answerIndex: { type: "integer", minimum: 0, maximum: 3 },
          explanation: { type: "string" },
        },
        required: ["question", "options", "answerIndex", "explanation"],
      },
    },
  },
  required: ["overview", "sections", "quiz"],
};

export async function generateSessionAi(reading: Reading, report: SessionReport, allowAi: AiGate = always): Promise<AiResult> {
  const groups = missedSections(reading, report.paragraphs);
  if (groups.length === 0) {
    return {
      generatedBy: "fallback",
      overview: "You covered the whole reading. Nothing was skipped, so there's nothing to summarize.",
      sections: [],
      quiz: [],
    };
  }

  if (!geminiConfigured()) return fallbackSessionAi(reading, groups, "Add a GEMINI_API_KEY to get AI summaries and quiz questions.");
  // Over the limit: the basic version, marked failed so "Try again" works later.
  if (!(await allowAi())) return { ...fallbackSessionAi(reading, groups, AI_FAILED_NOTE), failed: true };

  const fullText = reading.paragraphs.join("\n\n").slice(0, 60000);
  const sectionText = groups
    .map((g, i) => `SECTION ${i + 1}:\n${g.map((p) => reading.paragraphs[p]).join("\n\n")}`)
    .join("\n\n---\n\n");

  const prompt = `You are a supportive study assistant for a college student.
The student just read "${reading.title}" in a reading app that tracks which parts they actually read.
They skipped or only skimmed the sections below. Help them catch up quickly.

1. "overview": 2-3 sentences, written to the student ("you"), about what the missed parts cover and why they matter for the reading as a whole. Be encouraging, never scolding.
2. "sections": one entry per numbered section with a short title and a clear 2-4 sentence summary. Use only information from the text.
3. "quiz": exactly 3 multiple-choice questions that check understanding of the MISSED sections (not trivia). 4 options each, one correct, with a one-sentence explanation.

MISSED SECTIONS:
${sectionText}

FULL READING (for context only):
${fullText}`;

  try {
    const out = await generateJson<{
      overview: string;
      sections: { section: number; title: string; summary: string }[];
      quiz: QuizQuestion[];
    }>(prompt, SESSION_SCHEMA);
    const sections: SkippedSection[] = groups.map((g, i) => {
      const match = out.sections.find((s) => s.section === i + 1) ?? out.sections[i];
      return {
        paragraphs: g,
        title: match?.title ?? `Section ${i + 1}`,
        summary: match?.summary ?? "",
      };
    });
    const quiz = (out.quiz ?? [])
      .filter((q) => Array.isArray(q.options) && q.options.length >= 2 && Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex < q.options.length)
      .slice(0, 3);
    return { generatedBy: "gemini", overview: out.overview, sections, quiz };
  } catch (err) {
    console.error("[gemini] session summary failed:", err);
    return { ...fallbackSessionAi(reading, groups, AI_FAILED_NOTE), failed: true };
  }
}

/** Without an API key we still show *something* useful: the first sentences of each missed section. */
function fallbackSessionAi(reading: Reading, groups: number[][], note: string): AiResult {
  const sections = groups.map((g, i) => {
    const text = g.map((p) => reading.paragraphs[p]).join(" ");
    const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
    return {
      paragraphs: g,
      title: `Missed section ${i + 1}`,
      summary: sentences.slice(0, 2).join(" ").trim(),
    };
  });
  return {
    generatedBy: "fallback",
    overview: `You moved quickly past ${groups.length} part${groups.length > 1 ? "s" : ""} of this reading. Here are their opening lines so you know what you missed.`,
    sections,
    quiz: [],
    note,
  };
}

// ---------- Professor class digest ----------

export interface ClassParagraphAggregate {
  index: number;
  text: string;
  skippedPct: number;
  skimmedPct: number;
  avgRereads: number;
  avgDwellRatio: number; // dwell / expected
  /** Students who have got this far (all who finished, plus those still reading who reached it). */
  readers: number;
}

export async function generateClassDigest(
  reading: Reading,
  studentCount: number,
  aggregates: ClassParagraphAggregate[],
  allowAi: AiGate = always,
): Promise<{ text: string; generatedBy: "gemini" | "fallback" }> {
  const body = aggregates.filter((a) => !isHeading(a.text));
  const hardest = [...body].sort((a, b) => b.avgRereads - a.avgRereads).slice(0, 3);
  const mostSkipped = [...body].sort((a, b) => b.skippedPct - a.skippedPct).slice(0, 3);

  // The version without AI: used when there's no key, and when Gemini doesn't answer.
  const basic = (lastLine: string): { text: string; generatedBy: "fallback" } => {
    const lines = [
      `${studentCount} student${studentCount === 1 ? " has" : "s have"} read this so far.`,
      mostSkipped[0] && mostSkipped[0].skippedPct > 0
        ? `Most skipped: paragraph ${mostSkipped[0].index + 1} (${Math.round(mostSkipped[0].skippedPct)}% of ${
            mostSkipped[0].readers < studentCount ? `the ${mostSkipped[0].readers} who have reached it so far` : "students"
          }).`
        : "No paragraph was widely skipped.",
      hardest[0] && hardest[0].avgRereads > 0
        ? `Most re-read: paragraph ${hardest[0].index + 1} (${hardest[0].avgRereads.toFixed(1)} re-reads per student), which may be a confusing passage.`
        : "Re-reading was low across the text.",
      lastLine,
    ];
    return { text: lines.join(" "), generatedBy: "fallback" };
  };
  if (!geminiConfigured()) return basic("Add a GEMINI_API_KEY for a written analysis.");
  if (!(await allowAi())) return basic(AI_BUSY_NOTE);

  const table = aggregates
    .map(
      (a) =>
        `¶${a.index + 1} | reached by ${a.readers} | skipped ${a.skippedPct.toFixed(0)}% | skimmed ${a.skimmedPct.toFixed(0)}% | re-reads/student ${a.avgRereads.toFixed(1)} | time vs expected ${a.avgDwellRatio.toFixed(2)}x | "${a.text.slice(0, 220)}"`,
    )
    .join("\n");

  const prompt = `You are helping a college professor understand how their class engaged with an assigned reading, "${reading.title}".
Data comes from a webcam reading tracker for ${studentCount} students. It's approximate, so speak in tendencies, not certainties.

Per-paragraph class data:
${table}

Write a short digest (120-180 words, plain text, no markdown headings) with:
- Which ideas the class likely struggled with (heavy re-reading or slow reading) and what those passages are about.
- Which parts were commonly skipped or skimmed, and whether that matters.
- One or two concrete suggestions for the next class meeting.
Refer to paragraphs as "¶N".`;

  try {
    const out = await generateJson<{ digest: string }>(prompt, {
      type: "object",
      properties: { digest: { type: "string" } },
      required: ["digest"],
    });
    return { text: out.digest, generatedBy: "gemini" };
  } catch (err) {
    console.error("[gemini] class digest failed:", err);
    return basic("The AI version couldn't be created this time, so this is the basic one. Generate again to retry.");
  }
}

// ---------- PDF clean-up helper ----------
// What it's for: the built-in extractor (lib/pdf.ts) rebuilds paragraphs from where text sits
// on the page and drops page numbers and repeated headers/footers. That handles most PDFs,
// but two-column layouts, footnotes, figure captions and unusual headers can still leave
// paragraphs broken or stray lines in the text. This optional pass (the "clean up with AI"
// box on the upload form) asks Gemini to fix those. It works through the whole document in
// chunks, and any chunk it can't clean is kept exactly as extracted, so nothing is ever lost.

/** Characters per chunk: small enough that Gemini answers well within the time limit. */
const CLEAN_CHUNK_CHARS = 12_000;
/** Chunks cleaned at the same time. */
const CLEAN_PARALLEL = 6;
/** A cleaned chunk keeping less of the text than this was cut short: the original is kept. */
const CLEAN_MIN_KEPT = 0.8;

/** Split extracted text into chunks at paragraph breaks (or line breaks, for a huge paragraph). */
export function chunkText(text: string, max = CLEAN_CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let cur = "";
  const pieces = text.split(/\n\s*\n/).flatMap((p) => (p.length <= max ? [p] : splitLong(p, max)));
  for (const p of pieces) {
    if (cur && cur.length + 2 + p.length > max) {
      chunks.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

/** A single paragraph longer than a chunk: cut it at sentence ends (or spaces). */
function splitLong(p: string, max: number): string[] {
  const out: string[] = [];
  let rest = p;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf(" "));
    const at = cut > max / 2 ? cut + 1 : max;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

const letters = (t: string) => t.replace(/\s+/g, "").length;

async function cleanChunk(chunk: string): Promise<string | null> {
  try {
    const out = await generateJson<{ paragraphs: string[] }>(
      `The following text was extracted from part of a PDF and may have broken paragraphs, stray page numbers, running headers/footers and hyphenation artifacts.
Return the body text as a clean list of paragraphs. Keep every sentence of the body verbatim (only fix line-break hyphenation). Keep section headings as their own short paragraphs. Remove page numbers, running headers/footers, and reference-list noise.
This is one part of a longer document: it may start or end mid-sentence. Keep those partial sentences exactly as they are.

TEXT:
${chunk}`,
      {
        type: "object",
        properties: { paragraphs: { type: "array", items: { type: "string" } } },
        required: ["paragraphs"],
      },
    );
    const cleaned = (Array.isArray(out.paragraphs) ? out.paragraphs : []).map((p) => String(p).trim()).filter(Boolean).join("\n\n");
    // Clean-up removes a little (page numbers, headers); losing much more means text was dropped.
    if (letters(cleaned) < letters(chunk) * CLEAN_MIN_KEPT) {
      console.warn("[gemini] PDF cleanup dropped too much of a chunk; keeping the original");
      return null;
    }
    return cleaned;
  } catch (err) {
    console.error("[gemini] PDF cleanup failed for a chunk:", err);
    return null;
  }
}

/**
 * Optional: ask Gemini to repair paragraph breaks in messy PDF text. Returns the whole
 * document (every chunk cleaned or, where that failed, as extracted), or null when no chunk
 * could be cleaned.
 */
export async function cleanExtractedText(raw: string, allowAi: AiGate = always): Promise<string | null> {
  if (!geminiConfigured() || !raw.trim()) return null;
  if (!(await allowAi())) return null;
  const chunks = chunkText(raw);
  const results: (string | null)[] = new Array(chunks.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      results[i] = await cleanChunk(chunks[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CLEAN_PARALLEL, chunks.length) }, worker));
  if (results.every((r) => r === null)) return null;
  return results.map((r, i) => r ?? chunks[i]).join("\n\n");
}

// ---------- Professor lesson plan ----------

/**
 * A lesson plan for the next class, built around what students struggled with or skipped.
 * Without a Gemini key we still produce a useful plan from the numbers (a template).
 */
export async function generateLessonPlan(
  reading: Reading,
  studentCount: number,
  aggregates: ClassParagraphAggregate[],
  classStats: { avgCoverage: number | null; avgFocus: number | null; notStarted: number },
  allowAi: AiGate = always,
): Promise<{ text: string; generatedBy: "gemini" | "fallback" }> {
  const body = aggregates.filter((a) => !isHeading(a.text));
  const struggled = [...body].filter((a) => a.avgRereads > 0 || a.avgDwellRatio > 1.4).sort((a, b) => b.avgRereads + b.avgDwellRatio - (a.avgRereads + a.avgDwellRatio)).slice(0, 3);
  const skipped = [...body].filter((a) => a.skippedPct + a.skimmedPct / 2 >= 25).sort((a, b) => b.skippedPct - a.skippedPct).slice(0, 3);
  const quote = (a: ClassParagraphAggregate) => `"${a.text.slice(0, 140).trim()}${a.text.length > 140 ? "…" : ""}"`;

  // The template plan without AI: used when there's no key, and when Gemini doesn't answer.
  const basicPlan = (lastLine: string): { text: string; generatedBy: "fallback" } => {
    const out: string[] = [];
    out.push(`Lesson plan: ${reading.title}`);
    out.push(
      `Based on ${studentCount} student${studentCount === 1 ? "" : "s"}` +
        (classStats.avgCoverage !== null ? ` · average coverage ${Math.round(classStats.avgCoverage)}%` : "") +
        (classStats.notStarted > 0 ? ` · ${classStats.notStarted} haven't started` : "") +
        ".",
    );
    out.push("");
    out.push("1. Warm-up (5 min)");
    out.push("Ask students to write the reading's main argument in one sentence, without notes. Collect a few and compare.");
    out.push("");
    out.push("2. Revisit the hardest passages (15 min)");
    if (struggled.length)
      struggled.forEach((a) => out.push(`• ¶${a.index + 1} ${quote(a)}: students went back over it ${a.avgRereads.toFixed(1)} times on average and spent ${a.avgDwellRatio.toFixed(1)}× the expected time. Walk through it together and ask what made it hard.`));
    else out.push("• No passage stood out as hard. Pick the most central paragraph and have pairs paraphrase it.");
    out.push("");
    out.push("3. Cover what was skipped (10 min)");
    if (skipped.length)
      skipped.forEach((a) => out.push(`• ¶${a.index + 1} ${quote(a)}: skipped by ${Math.round(a.skippedPct)}%, skimmed by ${Math.round(a.skimmedPct)}%. Summarize it briefly or assign a small group to explain it.`));
    else out.push("• Most of the class read the whole text. Use this time for discussion instead.");
    out.push("");
    out.push("4. Discussion and exit ticket (10 min)");
    out.push("Pose one question that connects the hard passage to the skipped one. Close with a one-line exit ticket: \"What is still unclear?\"");
    out.push("");
    out.push(lastLine);
    return { text: out.join("\n"), generatedBy: "fallback" };
  };
  if (!geminiConfigured()) return basicPlan("Add a GEMINI_API_KEY for a written plan with discussion questions tailored to the text.");
  if (!(await allowAi())) return basicPlan(AI_BUSY_NOTE);

  const table = aggregates
    .map(
      (a) =>
        `¶${a.index + 1} | reached by ${a.readers} | skipped ${a.skippedPct.toFixed(0)}% | skimmed ${a.skimmedPct.toFixed(0)}% | re-reads/student ${a.avgRereads.toFixed(1)} | time vs expected ${a.avgDwellRatio.toFixed(2)}x | "${a.text.slice(0, 400)}"`,
    )
    .join("\n");
  const prompt = `You are helping a college instructor plan the next class session on the assigned reading "${reading.title}".
A webcam reading tracker measured how ${studentCount} students read it (approximate; speak in tendencies).
Class averages: coverage ${classStats.avgCoverage === null ? "unknown" : Math.round(classStats.avgCoverage) + "%"}, focus ${classStats.avgFocus === null ? "unknown" : Math.round(classStats.avgFocus) + "%"}, ${classStats.notStarted} students have not started.

Per-paragraph data:
${table}

Write a practical 45-50 minute lesson plan in plain text (no markdown symbols like # or **). Use numbered sections with times in parentheses, for example "1. Warm-up (5 min)". Include:
- A short warm-up that checks comprehension of the main idea.
- Focused work on the passages students struggled with (high re-reads or slow reading): say what those passages are about and give 2-3 specific discussion questions.
- A plan for content most students skipped or skimmed (if any), e.g. a quick summary or a small-group task.
- An exit ticket.
Refer to paragraphs as "¶N". Keep it under 350 words.`;
  try {
    const out = await generateJson<{ plan: string }>(prompt, { type: "object", properties: { plan: { type: "string" } }, required: ["plan"] });
    return { text: out.plan, generatedBy: "gemini" };
  } catch (err) {
    console.error("[gemini] lesson plan failed:", err);
    return basicPlan("The AI version couldn't be created this time, so this is the basic one. Generate again to retry.");
  }
}

// ---------- Photos / scans of pages → text ----------

/** Transcribe photographed or scanned pages (images or an image-only PDF) with Gemini. */
export async function transcribePages(files: { mimeType: string; data: Buffer }[]): Promise<string | null> {
  const ai = client();
  if (!ai) return null;
  const res = await withTimeout(ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [
          ...files.map((f) => ({ inlineData: { mimeType: f.mimeType, data: f.data.toString("base64") } })),
          {
            text: `These are photos or scans of pages from a reading, in order. Transcribe the body text exactly, page after page.
Join lines into paragraphs (fix line-break hyphenation), put a blank line between paragraphs, keep headings as their own short lines.
Leave out page numbers, running headers/footers, and handwriting in the margins. Output only the text.`,
          },
        ],
      },
    ],
    config: { temperature: 0 },
  }), 60_000); // several page images take longer to read than a summary takes to write
  return res.text?.trim() || null;
}
