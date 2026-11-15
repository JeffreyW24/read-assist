# eyeRead

A reading coach that uses your laptop webcam to follow your reading line by line. It tells you what you read, skimmed or skipped, and uses Google Gemini to summarize anything you missed.

Students read assigned (or their own) readings in a calm, distraction-free reader. Teachers create courses, assign readings, see class-wide maps of which passages were skipped or re-read, and get lesson plans built from that.

> Hackathon demo. Accounts use a username and password (on your own computer, two demo accounts also sign in with one click; they are turned off on a hosted site unless `DEMO_ACCOUNTS=1` is set), and data lives in a SQLite file, `data/read-assist.db`. Camera video never leaves the browser: only "which words were read" is saved. Reports are measured in the student's browser, so treat them as a study aid, not as proof of reading.

---

## Teammates: get it running from GitHub (about 10 minutes)

**You need:** a Mac or PC with a webcam, Google Chrome, and access to the GitHub repo (ask Jeffrey to add you under the repo's **Settings → Collaborators**).

1. **Install Node.js** (first time only): download the **LTS** version from https://nodejs.org and install it. Check it worked in Terminal: `node -v` should print v20 or newer.
2. **Get the code**, either way works:
   - **GitHub Desktop:** File → Clone repository → pick `JeffreyW24/read-assist` → Clone.
   - **Terminal:** `git clone https://github.com/JeffreyW24/read-assist.git` (the repo is private, so this asks you to sign in; GitHub Desktop is easier)
3. **Open a terminal in that folder.** In GitHub Desktop: Repository → Open in Terminal. Or `cd` into the folder you cloned.
4. **Install** (first time only, and again whenever `package.json` changes after a pull):
   ```bash
   npm install
   ```
   This also downloads the eye-tracking model (about 4 MB).
5. **Optional, for AI summaries/quizzes/lesson plans:** make your own settings file:
   ```bash
   cp .env.example .env.local
   ```
   Then put a Gemini key in it (free at https://aistudio.google.com/apikey). Never commit this file: it's ignored on purpose. Skip this step and everything still works with simpler non-AI versions.
6. **Start it:**
   ```bash
   npm run dev
   ```
   Wait for `Ready`, then open **http://localhost:3000** in Chrome.
7. **Sign in:** click a demo button (**Prof. Rivera** = teacher, **Sam Student** = student), or create your own account. The demo teacher's course has join code **READ01**.
8. Follow **TESTING.md** for the full test checklist.

Good to know:
- Your copy has **its own empty database**. You won't see Jeffrey's test data, and yours stays on your laptop. Delete `data/read-assist.db` to start fresh.
- Getting the latest changes: GitHub Desktop → **Fetch origin** → **Pull**, then `npm install`, then restart `npm run dev`.
- The camera only works at `http://localhost:3000` (or an `https` site), and only in one tab at a time. Close Zoom/FaceTime if it says the camera is busy.

---

## How to run it (step by step)

### 1. Open a terminal in this folder

In the Claude app you can use the Terminal panel. Otherwise open the **Terminal** app and run:

```bash
cd ~/Documents/CodingStuff/claudeforfun/read-assist
```

### 2. Install (first time only)

```bash
npm install
```

This also downloads the eye-tracking model into `public/mediapipe/`.

### 3. Add your Gemini API key (optional but recommended)

1. Get a key at https://aistudio.google.com/apikey
2. If there's no `.env.local` file yet, create it with `cp .env.example .env.local`. Then open `.env.local` (it's hidden in Finder; open it from your editor).
3. Replace `your-key-here` with your key, so the line reads `GEMINI_API_KEY=AIza...`
4. Save. If the app is already running, stop it (Ctrl + C) and start it again.

Without a key everything still works. Summaries fall back to "first lines of what you missed" and there's no quiz.

### 4. Start the app

```bash
npm run dev
```

Wait for `Ready`, then open **http://localhost:3000** in **Google Chrome**. Chrome is recommended; the camera only works on `localhost` or `https` addresses.

To stop the app, click the terminal and press **Ctrl + C**.

---

## Test it as a student (about 5 minutes)

1. On the sign-in page click **Create an account**, choose **Student**, and enter a name, email and password (8+ characters). Or click the **Sam Student** demo button (no password).
   - New accounts start with no courses: click **Join a course** and type **READ01** (the demo course's join code).
2. Under **Assigned readings**, click **How Your Eyes Actually Read**, then **Start reading**.
3. Click **Turn on camera** and allow camera access when Chrome asks.
4. Wait until all five checks are green (face visible, centered, distance, lighting, glare). If lighting is red, face a lamp or window; don't sit with a window behind you. If you wear glasses and glare is yellow, move the lamp to the side or tilt the screen until it turns green. Sitting closer also makes tracking sharper.
5. Click **Calibrate & start**. The app goes full screen. Calibration and reading only happen in full screen: if you leave it (Esc), everything pauses behind a **Return to full screen** button (calibration restarts from the first dot; a reading session just waits, and the time away counts like leaving the tab). Browser zoom doesn't matter: gaze is converted to physical screen pixels.
   - **Look at each dot, then click it** (13 dots). Keep your head roughly still.
   - Then **just look** at 5 more dots (no clicking).
   - You'll get a rating (Great / Okay / Rough). Move your eyes around: a circle should roughly follow your gaze. If it's "Rough", click **Recalibrate**.
6. Click **Start reading**. One more short step follows: **read a one-page passage (about 45 seconds) once at your normal pace**, then press **Space**. This measures your own reading speed (it doesn't change the eye tracking), so "read" vs "skimmed" is judged against *your* pace (shown on the report as "your usual N"). You can skip it; the last pace measured on this browser is used instead.
7. Click **Start reading** again and read normally. Use **→** / **Space** for the next page and **←** to go back.

You calibrate **once per account**: the calibration (and your reading pace) is saved, and every later reading (including continuing a saved session) shows **Start reading** right after the camera checks, with a **Recalibrate** button beside it. You're never asked to calibrate again unless you press **Recalibrate**, so do that if you switch to a different screen or the tracking feels off. (With the experimental `?gaze=webeyetrack` engine, you calibrate every time: its calibration can't be saved.)

### Things to try while reading

| Try this | What should happen |
|---|---|
| Press **G** | Debug view: a dot shows where the tracker thinks you're looking, and the line it thinks you're on is softly highlighted. Press G again to hide it. |
| Look away (at your phone) for ~5 seconds, then look back | A soft **"You left off here"** marker sits next to the line you were on. It fades once you're back on that line. |
| While reading, jump ahead ~5 lines and keep reading there | After a couple of seconds, **"Your place was here"** points to where you skipped from. |
| Flip to the next page within a few seconds | A small note at the top: *"Page 1 went by quickly. Want to go back to it?"* |
| Switch to another browser tab and come back | Counted as a distraction in your report. |
| Gear icon (top right) | Change theme (light / dark / sepia), font, text size, turn reading aids off, or recalibrate. |

8. Need a break? Click **Save & exit** (top right). Your place and everything measured so far are saved. Back on the reading's page, **Continue reading** picks up on the same page, and the sittings add up to ONE report. (**Start over instead** begins a fresh session.)
9. Click **Finish & see report** on the last page, or **Finish session** at the top. After a few seconds you'll see:
   - coverage, focus, reading speed and time
   - a paragraph-by-paragraph strip, and the full text colored by read / skimmed / skipped, with re-read paragraphs marked
   - **What you missed**: Gemini summaries of the skipped parts, plus a 3-question quiz on them
   - a timeline of reading, moving quickly, paused and away

### Upload your own reading

**Upload a reading** (top bar) has three tabs:
- **Paste text**
- **Upload PDF**: pulls out the text. A scanned/photocopied PDF (pages that are just pictures) is detected and read like photos.
- **Photos or scans**: drop phone photos of pages (several at once; they're read in filename order). With a Gemini key, Gemini reads them; without one, the text is recognised on your laptop (the first time downloads a ~10 MB English model). Always skim the result and fix any mistakes before saving.

With a Gemini key you can tick *"Clean up messy formatting with Gemini"* for tricky PDFs (two columns, lots of headers).

### Your reading habits

**Reading habits** (top bar) shows patterns across your sessions once you have a few: when you start skimming, whether focus fades in long sessions, whether you skip the ends of readings, and a weekly chart of minutes with your eyes on the page.

---

## Test it as a professor

1. Sign out (the arrow icon at the top right).
2. Click the **Prof. Rivera** demo button, or create your own account as a **Teacher**.
3. Your home page is **the courses you teach**. **New course** creates one with its own join code.
4. Open a course to see its stats (students, share of readings finished, class reading time), the **readings with their due dates**, and the **students**.
5. **Click a student** to see how they did on every reading: coverage, focus, eyes-on reading time, speed, sessions/sittings, late or overdue, plus their reading habits.
6. **Click a reading** for its class report: per-student table, class reading map (which paragraphs many students skipped or re-read), a **Lesson plan** built around what the class struggled with and skipped, and a class digest. Without a Gemini key both are template versions built from the numbers.
7. **Post a reading** to assign something new: paste text, upload a PDF, or upload photos/scans of photocopied pages; optional due date and instructions.

## Testing with other people

- **Same laptop:** sign out, then create another account. Everyone gets their own reports, and the teacher view combines them.
- **Their own laptop:** the camera only works on `localhost` or `https`. The easiest option is to run the app on their laptop (copy this folder and repeat steps 2–4). They'll have their own separate data.

## Where the data lives / resetting it

Everything is in a SQLite database file, `data/read-assist.db` (accounts, courses, readings, sessions, lesson plans). Passwords are stored hashed.

- **Reset:** stop the app (Ctrl + C), delete `data/read-assist.db` **and** `data/db.json`, and start it again. It recreates the demo teacher, demo student, course and reading.
- `data/db.json` is the old storage format. If it's present when the database is first created, its contents are copied in, so earlier test data carried over. You can keep it as a backup.

## Troubleshooting

- **"Camera access was blocked"**: click the camera icon in Chrome's address bar, choose *Allow*, and reload. On macOS also check System Settings → Privacy & Security → Camera → Google Chrome.
- **Calibration says "Rough"**: improve the light on your face, sit about an arm's length away, and try to keep your head still during calibration and reading. Glasses with strong glare can hurt accuracy.
- **The gaze dot drifts after a while**: that's normal for webcams. The app slowly corrects drift on its own; if it gets bad, use gear icon → **Recalibrate eye tracking** (or **Recalibrate** on the camera screen before reading). A new calibration replaces your saved one.
- **Gemini errors** (the terminal shows `[gemini] ... failed`): check the key in `.env.local`. If the model name is rejected, add a line like `GEMINI_MODEL=gemini-2.5-flash` (any model listed in Google AI Studio) and restart.

---

## How the eye tracking works (short version)

1. **Face → eye features.** Google's MediaPipe Face Landmarker runs in your browser (WebAssembly + GPU) and finds 478 face points, including both irises. We turn those into ~14 numbers per frame: where each iris sits inside its eye, eye openness and head pose.
2. **Calibration.** While you look at the dots, we learn a personal mapping from those numbers to a screen position. It uses ridge regression, with the strength picked by leave-one-dot-out cross-validation. The 5 validation dots measure your real accuracy. Head position only gets as much weight as normal reading movement justifies (people hold very still for the dots, then move while reading), and when predicting, each input stays within what calibration saw (plus a margin), so the gaze can't fly off the screen.
3. **Which line?** Webcam gaze is only accurate to a few lines, so a *Hidden Markov Model* combines that rough position with how reading works. You stay on a line, and after a big left-jump you're usually on the next one (a *return sweep*). The jump's vertical size decides between that, a hop back within the line and a jump back to re-read. It also:
   - learns your calibration drift from the start of every page, since people begin reading at the top line, and from the middle of every line you finish (never from the moments around a line change, when the smoothed gaze is still on its way). It also learns how fast the drift is going, so the correction keeps up with it
   - learns whether the gaze is stretched or squashed vertically from the end of every page: when you press **→**, your eyes were on the last line
   - corrects a sideways shift: while you read, your gaze sweeps across the text column, so the middle of your recent gaze is lined up with the middle of the column
   - uses short paragraph-ending lines as landmarks
   - treats consecutive webcam frames as weak, correlated evidence, so noise can't overpower the reading-order logic
4. **What did you read?** Each moment's time is spread over the words on the lines you're probably on.
   - **Read:** at least 35% of normal reading time
   - **Skimmed:** 15–35%
   - **Skipped:** less than that
   - **Re-read:** jumping back 1+ lines, counted once the evidence that you're on earlier lines has built up (not from any single moment), and only over lines you had already *read*. Going back to lines you skimmed or skipped just counts as reading them. Lingering much longer than your usual pace on a paragraph also counts.
5. **Gentle aids.** The tracker never shows anything that moves with your eyes. The bookmark appears only when you look away or skip a block of lines, and fades on its own.

Simulation check: `npm run simulate` feeds a fake reader with noisy, offset gaze through the real tracker. In recent runs, the estimated line was within ±1 of the true line 92–100% of the time, skipped blocks and look-aways were caught with the marker on the right line, and re-reading was detected in about 6 of 10 runs (it's the least reliable signal with webcam-level noise).

`npx tsx scripts/simulate-reread.ts` is a seeded benchmark for drift and re-reading: simulated readers hop back within lines, jump back 1–5 lines to re-read, blink, and (optionally) drift slowly downward. On 2026-11-14 (gaze noise 1.25 lines) it reported: exact line 89% (was 68%), jumps back of 2+ lines caught 96–98% of the time (1 line back: under 10%, since half a line of re-reading is hard to see at this noise), about 0.03 false re-readings per page, and the drawn gaze dot 0.32 lines off on average (was 0.45; under a strong 1 px/s downward drift it still trails by about half a line).

### Where things live

| Path | What it is |
|---|---|
| `src/lib/gaze/faceTracker.ts` | Camera + MediaPipe → eye features |
| `src/lib/gaze/gazeModel.ts` | Calibration (ridge regression) and accuracy check |
| `src/lib/gaze/lineHmm.ts` | The line-tracking Hidden Markov Model |
| `src/lib/gaze/readingTracker.ts` | Reading states, coverage, re-reads, nudges, final report |
| `src/components/reader/` | Setup, calibration and reader screens |
| `src/lib/gemini.ts` | All Gemini calls (summaries, quiz, class digest, PDF clean-up) |
| `src/lib/pdf.ts` | PDF → clean paragraphs |
| `src/lib/db.ts` | The SQLite database (a local file, or Turso when hosted) |
| `src/lib/validate.ts` | Checks on data sent by the browser (session reports, form fields) |
| `scripts/simulate.ts` | Algorithm simulation |
| `scripts/simulate-pages.ts` | Multi-page simulation with offset, drift and vertical stretch |
| `scripts/simulate-reread.ts` | Benchmark for downward drift and re-reading detection |
| `src/lib/gaze/devLog.ts`, `src/app/api/dev/gaze-log/` | Development only: logs real sessions' gaze-tracking internals to `data/gaze-debug.jsonl` |
| `scripts/replay-gaze-log.ts` | Replays a logged real session through the tracker and scores it |
| `scripts/simulate-behaviors.ts` | Simulation: does the report tell reading, skimming, re-reading, skipping and looking away apart? (`npm run simulate:behaviors`) |
| `PLAN.md` | Original research and feasibility plan |
