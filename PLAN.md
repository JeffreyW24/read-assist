# eyeRead: Research, Feasibility & Plan

_Brainstorm doc. No code yet. Last updated 2026-11-12._

---

## 1. Verdict

| Piece | Feasible? | Notes |
|---|---|---|
| Webcam gaze on a laptop screen | **Yes, roughly** | Webcam trackers are off by about 1–4° (about 1–4 cm on screen at arm's length). That's enough for paragraph-level and probabilistic line-level tracking. It's **not** enough for individual words. |
| "Is the student actually reading, line by line?" | **Yes, if we control the layout** | We get this from the *pattern* (left→right sweeps, then a jump back to the next line), not from exact gaze points. It needs large text, generous line spacing and our own reader view. |
| Distraction detection (looked away, tab switch, scrolled too fast) | **Yes, very reliable** | Face presence, head pose, tab visibility and scroll speed are exact signals that don't depend on gaze precision. |
| Skipped/skimmed report + AI summary of skipped text | **Yes** | Paragraph-level coverage is solid. Gemini Flash is cheap and good at this. |
| Teacher dashboard (class heatmaps, "confusing passages") | **Yes** | It's normal web-app work. Aggregating over many students also averages out each student's noise, so class-level data is *more* trustworthy than any one student's. |
| Browser extension that works on any website | **Not for MVP** | We can't control line spacing or layout on arbitrary sites, which kills line tracking. |
| Physical books, full line-level tracking | **Not realistically** (without a head-mounted eye tracker costing about $6k) | A **"Book mode lite"** is feasible: page-turn detection, attention on the book vs. away, time per page, and photos of pages fed to Gemini for summaries. |

**The key insight:** we don't have to know *exactly* where the eyes are. Reading has a very strong, predictable rhythm, so we can fit noisy gaze data to "which line would someone reading in order be on right now?" That's how professional reading researchers already correct drift (see §3.5).

---

## 2. Product shape (recommendation)

**A web app, not an extension.** Students paste text or upload a PDF/DOCX. We extract the text and **re-render it in our own reader**. That gives us the exact pixel box of every line and word, and lets us pick font size, line spacing and pagination for trackability.

- **Paginated reader, not free scrolling.** Each "page" fits the viewport and you turn pages with a key or button. That removes scroll ambiguity, makes "scrolled too fast" become "turned the page too fast", and every page turn is a free recalibration anchor (we know they were at the end of the last line).
- Optional "original layout" view for PDFs (figures, tables). Tracking there is paragraph-level only.

Two sides:
- **Student:** courses → assignments → reader session → report → history and trends.
- **Teacher:** create class → post reading (paste/upload) → see class heatmap per paragraph (% skipped, % re-read, average time), per-student summaries, and an AI digest of where the class struggled.

---

## 3. The eye-tracking pipeline (the core)

All of this runs **in the browser, on-device**. Video never leaves the laptop; only derived events (line/paragraph-level) are stored. That matters for privacy law (see §7).

### 3.1 Capture
- `getUserMedia` webcam at 30 fps, 640×480 is enough.
- **MediaPipe Face Landmarker** (`@mediapipe/tasks-vision`) in a Web Worker. It gives 478 face landmarks including **iris centers**, plus a head-pose matrix and blendshapes (blinks).
- WebGazer.js is the classic alternative, but it's older and less accurate. Studies put it at about 3.7–4.2° error. MediaPipe iris + calibration has been reported at about 1.1–1.3° in controlled conditions. Plan on MediaPipe and expect 2–3° in real classrooms.

### 3.2 Calibration (about 30–45 s, before each session)
1. **Environment check:** face centered, distance OK, lighting OK (reject backlit or dark rooms), glasses glare warning.
2. **9–13 dot calibration:** the user looks at a dot and clicks it. Features are iris position relative to eye corners (both eyes), eye openness and head pose (yaw/pitch/roll, distance). Model: per-user **ridge regression** (simple, fast, robust). Upgrade path is a small few-shot MLP (WebEyeTrack-style, about 9 samples).
3. **Validation:** 4–5 more dots, then report the error. If the error is too high, redo it or fall back to **"attention-only mode"** (distraction + pacing stats, no line tracking). The app should degrade gracefully, not fail.
4. **Implicit recalibration while reading:** every return sweep lands at the left margin of a known line, and every page turn happens at a known spot. We continuously re-estimate the offset from these. This is the biggest accuracy lever, because most webcam error is *systematic offset/drift*, not random jitter, and offset can be learned away.

### 3.3 Signal cleaning
- Drop samples during blinks (eye-openness threshold) and when the face is lost.
- Smooth with a **One Euro filter** or a Kalman filter: low lag on fast moves, heavy smoothing when still.
- Track head movement. If the head moves a lot, lower confidence or prompt a quick re-check.

### 3.4 Event detection
At 30 Hz with a few degrees of noise we can't reliably see individual reading fixations (about 200 ms each). We work with **windows of about 0.5–2 s** and look for:
- **Forward progression:** slow drift of x to the right on a roughly constant y.
- **Return sweep:** a big jump left and slightly down. This is the most detectable event in reading: 40–70 characters wide, which is about 10–15° on a normal line, far above the noise level.
- **Regression:** a leftward or upward jump that isn't a return sweep (re-reading).
- **Off-text:** gaze outside the text column, or face turned away / not found.

### 3.5 Line assignment: map noisy gaze → which line
This is a researched problem. Carr et al. (2021, *Behavior Research Methods*) compared 9 algorithms for "assigning fixations to lines of text with vertical drift". The winner family is **Warp**, which uses dynamic time warping to align the gaze sequence to the expected reading order. Later hybrids (Warp+Attach, plus implicit-recalibration variants from 2024) handle regressions better. Their code is open source (`jwcarr/drift`, Python), so we can port the ideas.

Our approach:
- **Live (during the session): a Hidden Markov Model.** The hidden state is the current line. Transitions strongly favor *stay on the line* or *move to the next line*, with small probabilities for going back a line, jumping ahead, or going off-text. Emissions are Gaussian around each line's y-position, plus a learned per-user offset. The forward algorithm gives "probably on line 14 (p=0.7)" every frame. Cheap enough for real time.
- **Offline (for the final report): Viterbi / Warp-style alignment** over the whole session gives the cleanest line-by-line path. That path drives the coverage map.
- **Word level:** not attempted. At most, estimate how far along each line the reader got (did they read to the end, or bail halfway?).

### 3.6 Reading-state classifier (per window)
States: **Reading · Skimming · Re-reading · Off-text · Away**
- Start with **rules**: return sweeps per minute, implied lines per second vs. the user's baseline, share of rightward motion, vertical progress per sweep (skimming = big vertical jumps, few sweeps), and face/tab signals.
- Later, train a small classifier on labeled sessions (instructed "read this carefully" vs. "skim this"). Published lab work hits about 80% article-level accuracy with real eye trackers. Assume lower for webcam, which is why we report with confidence levels.

### 3.7 What we measure (the report)
- **Coverage map:** each paragraph (and probabilistically each line) is tagged **read / skimmed / skipped / re-read**, shown as a soft heat overlay on the text.
- **Reading speed:** WPM *only during "Reading" windows*, per paragraph. That also gives the student's baseline.
- **Distraction:** count, total time, longest stretch, and where in the text it happened (face away, gaze off-text over N s, tab switch).
- **Struggle signals:** paragraphs with many regressions or slow WPM relative to the student's baseline, likely confusing parts.
- **"Pick up where you left off":** after a distraction, where they resumed vs. where they left. Detecting a jump forward is exactly your "looked back at a different part" case.
- **AI section (Gemini):** a summary of skipped/skimmed passages, plus (strongly recommended) **2–3 comprehension questions** about those parts. Eye tracking can show the eyes passed over text, but only a question shows understanding.

### 3.8 Real-time feedback: be gentle
False alarms will make students hate it. Rules:
- Only nudge when confidence is high and the behavior lasts (hysteresis: e.g. 3+ s of skipping, not one noisy jump).
- A nudge is a **subtle margin marker**: "You jumped ahead. Your place was here ↑", with the left-off line softly highlighted. No modal popups, sounds or red flashes.
- Optional strictness (teacher-configurable): *off* / *gentle nudges* / *must cover every page before continuing*.

---

## 4. Front-end / reading UI design

Goal: the reader should feel *calmer* than a normal web page. The UI disappears while you read.

**Reader typography (also tuned for tracking):**
- Font about 20–22 px. Readable serif (Literata, Source Serif) or Atkinson Hyperlegible (good for dyslexia, offer it as an option).
- **Line height about 1.9–2.1.** Wider spacing means lines sit farther apart, so the HMM separates them more easily. This is the single most important layout choice for accuracy.
- Measure (line length) about 60–70 characters, single centered column, wide margins. Paragraph spacing larger than line spacing.
- Paginated with page turns via →/space. Short page-turn animation (≤150 ms) or none.

**Chrome during a session:** nearly none. Thin top bar (title, page x/y, a tiny tracking-status dot: green/amber/grey) that fades out after a few seconds of reading and comes back when the mouse moves. Webcam preview is hidden after calibration, with an optional tiny corner thumbnail. No notifications, badges or sidebars.

**Light / dark:**
- Light: warm off-white (#FAF8F3-ish), text near-black (#1F1D1A), not pure #000 on #FFF.
- Dark: #121212–#16161A background, text #E4E0D8 (off-white, lower contrast to cut halation).
- Also a sepia option. Follows the system setting by default.
- ⚠️ **Tracking note:** in a dim room, dark mode means less light on the face, which hurts iris detection. The pre-session lighting check should warn about this.

**Calibration screen:** friendly and fast (dots that shrink when clicked, a progress ring). It explains in one line *why* ("so we can tell which line you're on"). It shows the validation result as a simple quality meter, not degrees.

**Report screen:** the text shown with a soft heat overlay (no harsh red), a few headline stats at top (time, WPM, focus %, coverage %), then "Parts you skipped" cards, each with its Gemini summary and a "go read it" button, then comprehension questions.

**Teacher dashboard:** a class roster table plus a per-reading view. The text is shown with a class-aggregate heat overlay (skipped % / re-read %), "most confusing passages" ranked, and a Gemini digest ("12 of 24 students re-read ¶7 several times; it introduces X").

**General LMS shell:** left nav (Courses, Assignments, Reports, Settings), course cards, assignment list with due dates and status. Keep it plain. Canvas/Schoology complexity isn't the point.

---

## 5. Gemini usage

- **Model:** a current **Gemini Flash** tier for nearly everything. The 3.x Flash models list at roughly $0.75 / $3.75 per 1M input/output tokens at an introductory rate. A summary of a 3,000-word reading costs well under a cent. Use Pro only if summary quality disappoints. _(Check ai.google.dev for the exact current model name and price when we build.)_
- **Calls:**
  1. *Skipped-text summary.* Input: full text plus the skipped/skimmed paragraph IDs. Output: structured JSON (`{paragraphId, summary}` + overall), using Gemini's JSON schema output.
  2. *Comprehension questions* on skipped/struggled parts (multiple choice plus 1 short answer). Gemini also grades the short answer.
  3. *Teacher class digest* from aggregated stats.
  4. *Ingestion helper:* PDF/scanned pages → clean reflowable text with paragraph boundaries. Gemini reads PDFs and images directly. Try plain pdf.js extraction first and use Gemini when that fails (scans, columns).
  5. *Book mode:* page photos → text (OCR) → summaries.
- **The API key stays on the server.** Calls go through our backend, never from the browser. Rate-limit per user.

---

## 6. Physical books

**Why it's hard:** with a book flat on a desk, the laptop camera sees the eyes from above at a steep angle, mostly covered by eyelids, and the gaze target (the page) is outside the screen calibration area with an unknown position. We also don't know the layout of the page.

| Option | What you get | Cost / difficulty |
|---|---|---|
| A. Head-mounted eye tracker with a scene camera (research-grade, e.g. Pupil Labs) | True line-level tracking on paper, as academic systems have done since around 2010 | About $6k hardware. Not a student product. |
| B. Two cameras: webcam on the face + phone overhead on the book | Maybe paragraph-level with a lot of geometric calibration | Research project. Fragile. |
| **C. "Book mode lite" (recommended)** | Phone on a cheap stand overhead (or the laptop webcam) detects **page turns** and reads page numbers. Face/head pose says **looking at the book vs. away**. Gives **time per page → speed, skipped/rushed pages, distractions**. Page photos → Gemini OCR → **summaries of rushed pages + quiz**. | Very feasible. Uses hardware students already have. |

Recommendation: ship C as a later phase, framed honestly as "page-level insights for physical books". Keep A as a "future research" note.

---

## 7. Risks & things to take seriously

- **Accuracy and fairness:** face/iris tracking accuracy varies with glasses, lighting, camera quality, eyelid shape and skin tone (MediaPipe is better than older tools but not perfect). Some students have conditions (nystagmus, strabismus, ADHD, dyslexia) where "abnormal" eye patterns are normal for them. **Never auto-grade on eye data.** Present it as insight with confidence levels.
- **Gaming:** a student can scan their eyes over lines without reading. Comprehension questions are the honest check, which is another reason to include them.
- **Privacy / law:** face geometry can be a **biometric identifier** (e.g. Illinois BIPA). Student data falls under **FERPA**, and under-13s under **COPPA**. Mitigations: on-device processing, never store video or face landmarks, store only text-position events, clear consent screen, data deletion. Get proper legal review before any real school deployment. Fine for a personal/portfolio project.
- **Surveillance vibe:** position it as a *study coach for the student first*. On the teacher side, show aggregates more prominently than per-student "gotchas".
- **Performance:** MediaPipe plus HMM at 30 fps is fine on modern laptops. Low-end Chromebooks (common in schools) may need 15 fps.

---

## 8. Proposed tech stack

- **Frontend:** Next.js (React + TypeScript), Tailwind, CSS-variable theming for light/dark/sepia.
- **Vision:** `@mediapipe/tasks-vision` Face Landmarker in a Web Worker. Calibration, filters, HMM and classifier are hand-written TS modules (pure functions, easy to unit-test with recorded sessions).
- **Backend / DB / Auth:** Supabase (Postgres + auth + row-level security for teacher/student roles + file storage). Firebase also works.
- **AI:** Gemini API via the `@google/genai` SDK, server-side route handlers.
- **Docs:** pdf.js for PDF text, mammoth for DOCX, with Gemini as the fallback.
- **Dev tooling:** a hidden **debug overlay** (live gaze dot, line probabilities, state label) and a **session recorder/replayer**. Record raw gaze plus layout once and re-run algorithm versions on it offline. This is how we'll tune the algorithm.

---

## 9. Phased plan

**Phase 0: Feasibility spike (do first, about 1 week).** Go/no-go on the core idea.
- Bare page: calibration, live gaze dot over a paragraph of text, debug overlay.
- Record ourselves reading 10 passages at different line heights (1.5 / 2.0 / 2.5) and font sizes, plus deliberate skims and look-aways.
- Measure: raw error in px, HMM line accuracy, return-sweep detection rate, skim-vs-read separability.
- **Go criteria (proposal):** ≥85% correct paragraph coverage, ≥70% correct line assignment at line-height 2.0, look-aways caught ≥95%.

**Phase 1: Student reader MVP (single user, no accounts).**
Paste/upload → reader → calibrate → session with live state + gentle nudges → end session → report (coverage heat map, WPM, distractions, struggle spots).

**Phase 2: Gemini layer.**
Skipped-part summaries, comprehension questions and answer checking, PDF ingestion fallback.

**Phase 3: Accounts + teacher side.**
Auth with roles, courses, assignments, class aggregate heatmaps, teacher digest, student history and trends. Optionally a grade/completion column (completion, not eye-data scores).

**Phase 4: Make the algorithm better.**
Implicit recalibration, Warp-style offline alignment, a trained skim classifier from collected sessions, per-student baselines.

**Phase 5: Book mode lite.**
Phone-as-camera pairing (QR code → phone web page streams page-turn events), page OCR via Gemini, page-level report.

**Later / maybe:** browser extension for "reader view" of web articles (we re-render the article ourselves, like Safari Reader), mobile/tablet support, accessibility modes.

---

## 10. Open questions for you

See the chat. Answers will be folded back into this doc.

---

## Sources
- WebGazer accuracy (about 4.17°) and webcam reading dataset: https://arxiv.org/pdf/2303.17876
- WebGazer in Gorilla, 3.65° and drift: https://studenttheses.uu.nl/handle/20.500.12932/40709
- MediaPipe iris gaze, about 1.1–1.3° (IEEE Access 2024): https://doaj.org/article/21ad3ac72299486a9497a31f1eb60713
- WebEyeTrack few-shot browser gaze: https://www.themoonlight.io/review/webeyetrack-scalable-eye-tracking-for-the-browser-via-on-device-few-shot-personalization
- Session-wise calibration for landmark gaze (2026): https://arxiv.org/pdf/2603.12388
- Carr et al., vertical drift correction algorithms: https://lrlac.sissa.it/node/571 · code: https://github.com/jwcarr/drift
- Fixation-to-line hybrids / semi-automated correction: https://arxiv.org/pdf/2501.06977
- Real-time reading vs skimming detection (ETRA'19): https://www3.cs.stonybrook.edu/~arunab/gaze/etra19.html
- Biedert et al., realtime reading/skimming classifier: https://www-live.dfki.de/fileadmin/user_upload/import/8152_Biedert_et_al._-_2012_-_A_Robust_Realtime_Reading-Skimming_Classifier.pdf
- Return sweeps: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6647890/
- Paper-document eye tracking with a scene camera (EPFL): https://infoscience.epfl.ch/record/166347?ln=en
- Gaze-based annotation of read/skimmed text with OCR (DFKI): https://www.dfki.uni-kl.de/~elst/papers/BuscherDengel08_GazeAnnotations.pdf
- Gemini pricing overview (verify on ai.google.dev): https://www.morphllm.com/gemini-api-pricing
