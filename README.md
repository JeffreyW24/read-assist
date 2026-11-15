# eyeRead

**Know what you actually read.** eyeRead uses an ordinary laptop webcam to follow your reading line by line. It shows which parts of a text you read, skimmed or skipped, then helps you catch up on what you missed.

Students read assigned (or their own) readings in a calm, distraction-free reader. Teachers create courses, assign readings, see class-wide maps of which passages were skipped or re-read, and get lesson plans built from that. For everyday reading, the Chrome extension works on news sites like the Wall Street Journal.

> Hackathon demo. Accounts use a username and password (on your own computer, two demo accounts also sign in with one click; they are turned off on a hosted site unless `DEMO_ACCOUNTS=1` is set), and data lives in a SQLite file, `data/read-assist.db`. Camera video never leaves the browser: only "which words were read" is saved. Reports are measured in the student's browser, so treat them as a study aid, not as proof of reading.

---

## The problem

- **Students outsource reading to AI.** It's easy to paste an assignment into a chatbot, read the summary, and pass the comprehension quiz.
- **Teachers can't tell what was read.** Reading checks are easy to game, and class time gets spent on material students never engaged with.
- **We all skim.** Short-form content trains us to read the headline and the first paragraph, then move on, thinking we know the story.

eyeRead gives readers and teachers an honest picture of *how* a text was read, not just whether a quiz was passed.

## What it does

### For students
1. **Quick setup.** A camera check (face, distance, lighting, glare), a 13-dot calibration, and a 45-second reading sample that measures *your* normal pace. Calibration is saved, so it's a one-time step.
2. **Read normally** in a calm, paginated, full-screen reader with wide line spacing. Light, dark and sepia themes, adjustable text size, and a dyslexia-friendly font.
3. **Gentle aids, never a moving cursor.** Look at your phone and a soft "You left off here" marker waits on your line. Skip ahead and it points to where you jumped from. Flip a page too fast and it asks if you want to go back.
4. **Save & exit** at any point. Your place is kept and later sittings add up to one report.
5. **Your reading report:**
   - coverage, focus, reading speed and time
   - the full text colored by read / skimmed / skipped, with re-read passages marked
   - a timeline of when you were reading, skimming, paused or away
   - **What you missed:** Gemini summaries of the skipped parts and a short quiz on them, using the *testing effect* to lock in what you skimmed
   - an "in your own words" box for each missed section
6. **Reading habits** across sessions: when you start skimming, whether focus fades in long readings, whether you skip endings, and minutes read per week.

### For teachers
- **Courses with join codes.** Assign readings by pasting text, uploading a PDF, or snapping **photos of photocopied pages** (Gemini transcribes them). Add due dates and notes to students.
- **Class reading map:** which paragraphs most students skipped, skimmed or re-read. Re-reads point to hard passages and skips point to passages nobody engaged with.
- **AI lesson plan and class digest** built around exactly what the class struggled with, so class time goes to the real pain points.
- **Per-student drill-down:** coverage, focus, eyes-on time, speed, sittings, and late or overdue readings. Plus a CSV export.

### For everyday reading: the Chrome extension
Open any article and the extension measures how much of it you read, with or without the camera.

- **Finds the article automatically**, like a browser's reader mode: paragraphs vote for the part of the page that holds them, and menus, ads, related links and comments are filtered out.
- **No-camera mode** estimates reading from how long each paragraph stays on screen while you're active.
- **Eye-tracking mode** runs the same tracker as the web app, built for scrolling pages: it re-measures which lines are on screen as you scroll and picks up paragraphs that load later.
- **Report in the toolbar:** coverage, reading time, and skipped sections (click one to jump back to it). It can also color each paragraph on the page green, yellow or red.
- **Optional sync:** connect it to your eyeRead account and your web articles appear alongside your other readings.

## How it works

All eye tracking runs **in the browser**. Camera video never leaves your computer. Only the reading report (which words were read) is saved.

1. **Face → eye features.** Google's MediaPipe Face Landmarker finds 478 face points, including both irises, in every webcam frame. These become about 14 numbers per frame: where each iris sits in its eye, eye openness and head pose.
2. **Personal calibration.** While you look at the dots, a ridge-regression model learns your mapping from those numbers to the screen. Leave-one-dot-out cross-validation picks the regularization, and 5 extra dots measure your real accuracy.
3. **Which line are you on?** Webcam gaze is only accurate to a few lines, so we don't trust it on its own. A **Hidden Markov Model over the lines of text** combines the noisy gaze with how people actually read: left to right along a line, then a big, fast **return sweep** back to the start of the next one. Return sweeps are large and regular, so they're easy to spot even with a cheap webcam.
4. **Constant self-correction.** The main error in webcam tracking isn't random noise, it's slow *drift*. eyeRead uses reading itself as free recalibration:
   - every new page: readers start at the top line
   - every page turn: your eyes were just on the last line, which corrects vertical stretch
   - every finished line and return sweep: corrects slow drift and how fast it's moving
   - the middle of your recent gaze lines up with the middle of the text column, which corrects sideways shift
5. **Read, skimmed or skipped.** Each moment's time is spread over the words on the lines you're probably on, then compared with *your own* reading pace:
   - **read:** at least 35% of normal reading time
   - **skimmed:** 15–35%
   - **skipped:** less than that
   - **re-read:** a jump back of one or more lines over text you had already read
6. **Distractions** (looking away, looking off the text, switching tabs) are tracked separately, so they don't count as reading.

## Results

We measured, not guessed:

- **Gaze lab.** We built an in-app lab that runs different gaze models on the *same* recorded camera frames. A newer deep-learning model (WebEyeTrack) looked smoother but had about **2.5 lines** of vertical error. Our MediaPipe + calibration pipeline had about **0.9 lines**, so we kept ours and left WebEyeTrack as an optional mode.
- **Simulations.** Synthetic readers with realistic noise, offsets and drift are run through the real tracker:
  - the estimated line is within ±1 of the true line **92–100%** of the time
  - with drift and noise of 1.25 lines, the exact line is right **89%** of the time (up from 68% before the drift work)
  - jumps back of 2+ lines are caught **96–98%** of the time, with about 0.03 false re-reads per page
  - in the behavior test, reports correctly tell apart reading, skimming, re-reading, skipping and looking away in **94%** of runs

## Challenges

- **Drift, not noise.** The tracker slowly slides off over a session. The fix was to make reading itself recalibrate the model: page starts, page turns and return sweeps.
- **Simulation ≠ real life.** Some changes that scored well in simulation did worse on a real webcam. Lighting, glasses, and head movement vary a lot between people, so we validated important changes with real reading sessions.
- **Scrolling pages.** The classroom reader is paginated, but news sites scroll. The extension had to keep re-measuring line positions on every scroll, or it would credit only the top of the article.
- **Bigger model ≠ better.** Understanding how people read did more for accuracy than a larger neural network.

## Responsible by design

- **Video stays on the device.** Only the reading report is stored.
- **A study aid, not a grade.** Eye data is an estimate. People read differently, including readers with dyslexia or ADHD, so reports show confidence levels (calibration quality) and are never an automatic grade.
- **Works without the camera.** Readers who don't want eye tracking can still use time-on-page mode.
- **No email needed.** Accounts use a username, with a recovery code for forgotten passwords.
- **Works without AI.** If Gemini is unavailable, summaries, lesson plans and transcription fall back to simpler built-in versions.

## Built with

- **Web app:** Next.js 16, React 19, TypeScript, Tailwind CSS
- **Database:** SQLite / libSQL (Turso when hosted)
- **Eye tracking:** MediaPipe Face Landmarker (WebAssembly + GPU), ridge regression, One-Euro filtering, a custom line Hidden Markov Model
- **AI:** Google Gemini for summaries, quizzes, lesson plans, class digests, PDF clean-up and page transcription
- **Documents:** pdf.js for PDFs, Tesseract.js as the on-device OCR fallback
- **Extension:** Chrome Manifest V3 with an offscreen document for the camera, bundled with esbuild

## What's next

- **Pilot in real classrooms** to learn how students and teachers actually use it, and what privacy questions come up.
- **Clearer consent tools** for schools, so students and parents see exactly what is and isn't recorded.
- **Publish the extension** on the Chrome Web Store.
- **Mobile**, for reading articles and email on the go.

## Repository map

| Path | What it is |
|---|---|
| `src/lib/gaze/faceTracker.ts` | Camera + MediaPipe → eye features |
| `src/lib/gaze/gazeModel.ts` | Calibration (ridge regression) and accuracy check |
| `src/lib/gaze/lineHmm.ts` | The line-tracking Hidden Markov Model |
| `src/lib/gaze/readingTracker.ts` | Reading states, coverage, re-reads, nudges, final report |
| `src/components/reader/` | Setup, calibration and reader screens |
| `src/components/lab/`, `src/app/gaze-lab/` | Gaze lab for comparing models on the same frames |
| `src/lib/gemini.ts` | All Gemini calls |
| `src/lib/db.ts` | Database |
| `extension/` | Chrome extension (article detection, scrolling-aware tracking, popup report) |
| `scripts/simulate*.ts` | Tracker simulations and benchmarks |
| `PLAN.md`, `GAZE_EVAL.md` | Original research plan and gaze-model evaluation |
