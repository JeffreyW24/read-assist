# How to test everything (step by step)

Use **Chrome on your MacBook**, not the preview inside the Claude app, which blocks the camera.
Plan on about 30 minutes for all of it. Each part also works on its own.

---

## 0. Start the app

1. Open Terminal and run:
   ```bash
   cd ~/Documents/CodingStuff/claudeforfun/read-assist
   npm run dev
   ```
2. Wait for `Ready`, then open **http://localhost:3000** in Chrome.
   - If it says the port is in use, the app is already running: just open the link.

**Tip:** to be a teacher and a student at the same time, use a normal Chrome window for the
teacher and an **Incognito window** (⌘ + Shift + N) for the student. Each window stays signed in separately.

---

## 1. Teacher: create a course and post readings

1. On the sign-in page click **Create an account**, choose **Teacher**, and enter a name, an email and a password (8+ characters).
   - ✅ You land on **"Courses you teach"** (empty).
2. Click **New course**, then enter a name and code (e.g. `ENGL 101`) → **Create course**.
   - ✅ The course page opens with a big **join code** (6 letters). Write it down.
3. Click **Post a reading** and try each tab:
   - **Paste text:** paste a few paragraphs from any article, add a title and a due date → **Post reading**.
   - **Upload PDF:** drop any text PDF. ✅ The text appears below; check it and post it.
   - **Photos or scans:** take 1–2 phone photos of a printed page (AirDrop them to the Mac) and drop them in.
     - ✅ A progress bar shows "Reading page 1 of 2…".
     - ✅ The text appears with paragraph breaks.
     - Fix any typos and post it.
     - The first time takes longer because it downloads the text recognizer (~10 MB).
   - A **scanned PDF** from a photocopier works in the **Upload PDF** tab too: it's detected and read like photos.
4. ✅ Back on the course page, each reading shows its due date and "0/0 finished".

## 2. Student: join the course

1. In the **Incognito window**, open http://localhost:3000, click **Create an account**, choose **Student**, and enter a different email.
2. Click **Join a course** and type the join code from step 1.2.
   - ✅ The teacher's readings show under **Assigned readings**, with due dates.
   - ✅ Stats appear at the top: readings done, time reading, coverage, speed.

## 3. Read with eye tracking (MediaPipe + ridge is the default again)

1. As the student, click a reading → **Start reading** → **Turn on camera** → allow the camera.
2. Wait for all five checks to turn green: face, centered, distance, lighting, glare. Face a lamp, not a window. Only "face" and "too dark" block calibration; the others are warnings.
3. **Calibrate & start**: look at each dot and click it (13 dots), then just look at 5 more.
   - ✅ You get a rating: Great, Okay or Rough. If it's Rough, click **Recalibrate**.
   - ✅ **Full screen only:** while reading, press **Esc**. A card says **Reading happens in full screen** and the page can't be read or turned until you click **Return to full screen**; you're back on the same page. (Doing this during calibration restarts it from the first dot.)
   - ✅ **Calibrate once:** open a *different* reading afterwards, and also **Save & exit** then **Continue reading**. Neither asks you to calibrate: after the camera checks the button says **Start reading**, with **Recalibrate** beside it and the date of your calibration. **Recalibrate** runs the dots (and pace passage) again and replaces the saved calibration.
   - ✅ **Different screen:** a saved calibration is only reused on the screen it was made on. On another computer or an external monitor the button says **Calibrate & start** again, with a line explaining why. Browser zoom doesn't count as a different screen.
   - ✅ **Looking beside the page:** stare at something next to the text for 20 seconds, then finish. The report should show that time as a distraction, not as reading.
4. Read normally. Use **→** for the next page.
5. Press **G** to show the debug dot (where it thinks you look) and the highlighted line. Press **G** again to hide them.
   - ✅ The highlighted line should mostly follow the line you're reading, within a line or so.
   - The debug line also shows **stretch**. It starts at 1.00 and may change after you finish a page with the **→** key: the tracker is correcting itself. Turn pages with the keyboard, not the mouse, so it can learn.
   - **Diagnosing problems (dev server only):** every reading session's gaze-tracking numbers are written to `data/gaze-debug.jsonl` (numbers only, no video or text). Press **M** at the moment you go back to re-read, to mark it in the log. Then `npx tsx scripts/replay-gaze-log.ts data/gaze-debug.jsonl` replays the session through the tracker and lists the re-reads it found next to your marks.
6. **Compare with WebEyeTrack:** open the same reading with `?gaze=webeyetrack` added to the reader URL, e.g. `http://localhost:3000/read/<id>?gaze=webeyetrack`, and calibrate again. Note which one follows your lines better.
   - This is the one thing I couldn't test myself (my browser has no camera), so please tell me how both feel.

## 4. Save & exit, then continue (one report)

1. Mid-reading, click **Save & exit** (top right).
   - ✅ You're back on the reading page with **"Progress saved. You've read about X%"** and a **Continue reading** card.
2. Click **Continue reading**, then **Start reading** with your saved calibration (or click **Read without eye tracking**).
   - ✅ It opens on the **same page** you paused on.
3. Read to the end and click **Finish & see report**.
   - ✅ The report header says **"2 sittings"** and the time covers both sittings.
   - ✅ There's only **one** session for this reading, not two.
4. **Start over instead** (on the reading page) begins a fresh session.

## 5. Re-reading rule

1. In a new session, **skim a paragraph fast**, then go back and read it properly.
   - ✅ In the report it counts as **read**, not re-read (no purple re-read mark).
2. **Read a paragraph properly**, keep going 2–3 lines, then go back and read it again for a couple of seconds. (Do the reading-pace passage first: "read properly" is judged against your own pace, and at the default 240 wpm a fast reader's first pass can count as skimmed, so going back doesn't count as re-reading.)
   - ✅ The report marks it **re-read**.

## 6. Reading habits

1. As the student, click **Reading habits** (top bar).
   - ✅ Totals and a weekly minutes chart.
   - Patterns (e.g. "You start skimming after about 10 minutes") appear after a few sessions of at least 1 minute each. With only 1–2 short sessions it says to read more first.

## 7. Teacher views

Back in the teacher window, refresh the course page.

1. ✅ **Course stats:** students, readings finished, average coverage, class reading time (eyes on the page).
2. Click the **student's name** → their page.
   - ✅ Every reading: status, focus, reading time, speed, skipped paragraphs, sessions/sittings, and late or overdue.
   - ✅ Their reading habits at the bottom.
3. Click a **reading** → class report.
   - ✅ Per-student table and class reading map.
   - Click **Generate plan** → ✅ a lesson plan built around the hardest and most-skipped paragraphs. Without a Gemini key it's a template version; with a key in `.env.local`, Gemini writes it.
   - **Download CSV** still works.

## 8. Gaze lab (optional, compares trackers with numbers)

1. Open **http://localhost:3000/gaze-lab** → **Begin**, then click 13 dots and look at 5.
2. ✅ A table compares the current tracker, WebEyeTrack and a hybrid. Press **Validate again** a couple of times.
3. **Copy JSON** and send it to me. More rounds tell us which tracker really wins.

## 9. Browser extension (personal reading, e.g. the WSJ)

1. Build it once:
   ```bash
   cd ~/Documents/CodingStuff/claudeforfun/read-assist
   node extension/build.mjs
   ```
2. In Chrome, open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the folder `read-assist/extension`.
4. Pin it: click the puzzle icon, then the pin next to eyeRead.
5. Open a long article, e.g. a Wikipedia page or a WSJ article you're logged in to. **Reload the tab** if it was already open.
6. Read part of it, then click the extension button.
   - ✅ Coverage %, time, a read/skimmed/skipped bar, and a list of skipped sections. Click one to jump to it.
   - **Show on page** colors each paragraph green, yellow or red.
7. No camera is needed: it measures what's on screen while you're active.
   - **Start eye-tracked reading** in the popup is an experimental camera mode. It's untested with a real webcam, so expect rough edges.
8. **Bring it into your student account:** sign in to eyeRead as a student and open the home page.
   - ✅ The first time, a box asks "Add your web reading to eyeRead?" Click **Allow**.
   - ✅ The articles appear under **Your own readings** with the site, reading time and a "Read N%" pill. Click one for a paragraph-by-paragraph view, a link back to the article and **Remove**.
   - After that, new or re-read articles come in each time you open the home page. Only short snippets of each paragraph are saved, not the article.

---

## 10. Put it on GitHub

Everything is already saved in git locally, on the `main` branch. Your keys, the database
(`data/`) and downloaded models are deliberately left out.

1. Go to **https://github.com/new** and create a repository:
   - Name: `read-assist`
   - Visibility: **Private**
   - Leave it **empty**: no README, .gitignore or license.
   - Click **Create repository**.
2. In Terminal:
   ```bash
   ssh -T git@github.com
   ```
   - The first time, type `yes`.
   - ✅ "Hi JeffreyW24!" means you're set.
   - If it says "Permission denied", run `pbcopy < ~/.ssh/id_rsa.pub`, paste the key at https://github.com/settings/ssh/new, and repeat this step.
3. Upload:
   ```bash
   cd ~/Documents/CodingStuff/claudeforfun/read-assist
   git remote add origin git@github.com:JeffreyW24/read-assist.git
   git push -u origin main
   ```
4. Refresh the GitHub page. ✅ The code is there.

Later changes: `git add -A`, `git commit -m "what changed"`, `git push`.
For putting the site on the web, see **DEPLOY.md**.
