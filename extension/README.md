# eyeRead — browser extension (prototype)

A Chrome (Manifest V3) extension that tells you how much of a news article you
actually read: coverage %, reading time, and which sections you skipped. It is a
separate thing from the Next.js app in `read-assist/`, but it reuses the app's
gaze code (`src/lib/gaze/*`) for the optional eye-tracking mode.

Everything runs on your computer. Nothing is sent anywhere; history is kept in
`chrome.storage.local`.

## Build and load it

```bash
cd read-assist
npm install            # once, if you haven't: also fetches the MediaPipe face model into public/mediapipe
node extension/build.mjs
```

`build.mjs` bundles `extension/src/*.js` into `extension/dist/` with esbuild (fetched
by `npx` the first time, nothing is added to `package.json`), and copies the
MediaPipe face model + WebAssembly (~19 MB) into `extension/mediapipe/`. Both folders
are git-ignored.

Then in Chrome (or Edge / Brave / Opera — any Chromium browser):

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `read-assist/extension` folder.
4. Pin the extension (puzzle icon → pin), so its button is in the toolbar.
5. **Reload any tabs that were already open** — the content script only gets into
   pages loaded after the extension.

After changing code: run `node extension/build.mjs` again, click the reload ↻ on
the extension's card, and reload the article tab.

## How it works

### No-camera mode (always on)

`src/content.js` runs on every http(s) page:

1. **Finds the article.** Readability-style: each `<p>` with ≥12 words votes for its
   parent (and less for grandparents); the winning element (or its enclosing
   `<article>`) is the article root. Navigation, asides, figures, "related", ads,
   newsletter and comment blocks are ignored. Pages with under ~250 words of body
   text are not tracked.
2. **Splits it into paragraphs** (`p`, `li`, `blockquote`, `pre`; `h1`–`h4` are kept
   as section labels but don't count toward coverage). A MutationObserver re-scans
   when the page loads more text, keeping the time already measured.
3. **Measures time on screen.** Every 250 ms, while the tab is visible and focused
   and you've scrolled / moved the mouse / pressed a key in the last 60 s, the
   elapsed time is spread evenly over the words currently on screen (each partially
   visible paragraph contributes just its visible share of words). If only a sliver
   of text is on screen, the time is divided by at least half a screenful of words,
   so staring at a photo doesn't mark the one visible line as "read".
4. **Classifies** each word and paragraph with the same thresholds as
   `src/lib/gaze/readingTracker.ts`:
   - word **read** at ≥35% of the time a 240-wpm reader needs (0.25 s/word),
     **skimmed** at 15–35%, **skipped** below;
   - paragraph **read** when ≥60% of its words are read, **skipped** when <35% are at
     least skimmed, **skimmed** otherwise;
   - coverage = (read words + ½ skimmed words) / all words.
5. **Saves** to `chrome.storage.local` every 5 s and when you leave the tab (key
   `art:<origin + path>`; the last 200 articles are kept). Revisiting the same URL
   continues where you left off.

This mode can't know where your eyes are, only what was on screen and for how long.
Scrolling slowly past a paragraph without reading it counts as reading it.

### The popup

- **This article**: coverage %, reading time vs. the 240-wpm estimate, a
  read/skimmed/skipped bar, and the list of skipped sections (click one to jump to
  it on the page).
- **Show on page** draws a green / yellow / red bar next to each paragraph.
- **Reset** clears this article's data.
- **History**: past articles with coverage and time; click to reopen.

### Eye-tracking mode (optional, Phase 2)

"Start eye-tracked reading" in the popup:

1. The service worker (`src/background.js`) opens an **offscreen document**
   (`offscreen.html`, reason `USER_MEDIA`) that runs the app's `FaceTracker`
   (MediaPipe Face Landmarker, on-device) and streams compact eye-feature frames.
2. The first time, Chrome has to ask for camera permission, which an offscreen
   document can't do, so a small `permission.html` tab opens with an **Allow camera**
   button. Allow it, go back to the article and press **Try again**.
3. A calibration overlay appears on the article: click 13 blue dots while looking at
   them, then look at 5 purple dots. `GazeModel.fit` + `validate` from the app build
   the gaze model and report the quality.
4. While reading, each gaze point goes through the same One-Euro smoothing and
   `LineHmm` (line hidden Markov model with return-sweep detection and drift
   correction) as the web app. The lines are the article's real text lines
   (measured with `Range.getClientRects`), in page coordinates, so scrolling doesn't
   confuse it. Time is credited to the words of the lines you're probably on,
   replacing the no-camera estimate while the camera is on.
5. A "● Eye tracking · Stop" pill stays in the corner while the camera is on (the
   camera light is on too). Stop it there or in the popup; it also stops when the
   tab closes or navigates.

## Files

| File | What it does |
| --- | --- |
| `manifest.json` | MV3 manifest: `storage` + `offscreen` permissions, content script on http(s) pages, CSP with `wasm-unsafe-eval` for MediaPipe |
| `src/content.js` | Article detection, dwell tracking, storage, page overlay, calibration UI, gaze → line mapping |
| `src/report.js` | Turns per-word dwell into the report (shared by content script and popup) |
| `src/popup.js`, `popup.html`, `popup.css` | Toolbar popup |
| `src/background.js` | Service worker: creates/closes the offscreen document, relays gaze frames to the tab |
| `src/offscreen.js`, `offscreen.html` | Runs `FaceTracker` on the webcam |
| `src/permission.js`, `permission.html` | One-time camera permission prompt |
| `build.mjs` | Bundles to `dist/` and copies MediaPipe files |

## Known limits

- **Paywalled sites** (WSJ, NYT…): only the text you can see is tracked; if you're
  logged in, the full article is in the page and works normally.
- Article detection is heuristic. Live blogs, galleries and pages that render text
  in unusual ways (canvas, `<br>`-separated text with no paragraphs) may be missed
  or partially detected.
- No-camera mode overestimates reading when you scroll slowly without reading, and
  counts any visible text — multi-column layouts get credit for both columns.
- Eye-tracking mode was checked to build and to start the offscreen document, but
  not tested end-to-end with a real webcam. Two known risks: Chrome might pause
  video decoding in the hidden offscreen page (the offscreen script drives the frame
  loop with a timer instead of `requestAnimationFrame` for this reason, and reports
  an error if no frames arrive within 8 s), and frames are relayed through the
  service worker at ~30 messages/s.
- Some sites put a full-screen sticky header over the text; that area still counts
  as "on screen".
