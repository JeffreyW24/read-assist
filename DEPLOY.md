# Putting eyeRead on GitHub and on the web

Everything below uses free tiers. Nothing here needs a credit card.

---

## Part 1: GitHub (do this now)

The project is already a git repository with one saved snapshot (commit) on the `main` branch.
What's left is creating the empty repo on GitHub and pushing to it.

1. Go to **https://github.com/new** (signed in as JeffreyW24).
   - Repository name: `read-assist`
   - Choose **Private** (you can make it public later).
   - **Don't** tick "Add a README", ".gitignore" or "license". The repo must start empty.
   - Click **Create repository**.
2. In Terminal, check that GitHub recognises your SSH key:
   ```bash
   ssh -T git@github.com
   ```
   - The first time it asks "Are you sure you want to continue connecting?": type `yes`.
   - If it says **"Hi JeffreyW24! You've successfully authenticated"**, go to step 3.
   - If it says **"Permission denied (publickey)"**, add your key: copy it with `pbcopy < ~/.ssh/id_rsa.pub`, then paste it at https://github.com/settings/ssh/new and run the check again.
3. Connect the folder to GitHub and upload:
   ```bash
   cd ~/Documents/CodingStuff/claudeforfun/read-assist
   git remote add origin git@github.com:JeffreyW24/read-assist.git
   git push -u origin main
   ```
4. Refresh the GitHub page. You should see the code.

What is **not** uploaded (on purpose, see `.gitignore`):
- `.env.local` (your keys)
- `data/` (the database with everyone's sessions and your test accounts)
- `node_modules/`
- the downloaded eye-tracking model (`public/mediapipe`, recreated by `npm install`)

After later changes: `git add -A`, `git commit -m "what changed"`, `git push`.

---

## Part 2: Hosting on a real website (recommended: set it up now, keep deploying as you go)

**Why not wait until the end:** a few things only show up once the site is hosted, and it's much
calmer to find them in week 1 than the night before the demo:
- the camera only works on `https` (hosting gives you that automatically)
- the hosted database is a different place than your laptop's file
- upload size limits (see below)

Once it's connected, every `git push` updates the site by itself, so there's no "big deploy" at the end.

### Recommended setup

| Piece | Service | Free tier |
|---|---|---|
| Website (Next.js) | **Vercel** (vercel.com) | Hobby plan, gives you `read-assist-xxx.vercel.app` with https |
| Database | **Turso** (turso.tech) | Free plan, SQLite in the cloud |
| AI | Google Gemini | free tier at aistudio.google.com |

The app already supports this: on your laptop it uses the file `data/read-assist.db`; when
`DATABASE_URL` is set it uses Turso instead. Same code, no changes needed.

### Steps

1. **Database:** sign up at turso.tech (GitHub login works) → **Create database** → name it `read-assist`.
   - Copy its **URL** (starts with `libsql://`).
   - Click **Generate token** and copy the token.
   - The tables are created automatically on the first visit, and a demo teacher, student and course are added.
2. **Website:** sign up at vercel.com with GitHub → **Add New → Project** → import `read-assist`.
3. Before clicking Deploy, open **Environment Variables** and add:
   - `DATABASE_URL`: the Turso URL
   - `DATABASE_AUTH_TOKEN`: the Turso token
   - `AUTH_SECRET`: any long random string (run `openssl rand -hex 32` in Terminal and paste the result)
   - `GEMINI_API_KEY`: optional, your Gemini key
4. Click **Deploy**. After ~2 minutes you get a link like `https://read-assist-abc.vercel.app`.
5. Open it on your MacBook, create an account, allow the camera, and try a reading.

### Things to know about the hosted version

- **Upload size:** Vercel limits a single upload to about **4.5 MB**.
  - Text PDFs are usually far smaller, so they're fine.
  - Large scanned PDFs or many phone photos at once may be too big: upload a few pages at a time. On-device text recognition (no Gemini key) is unaffected, since it runs in the browser.
- **Your local test data stays local.** The hosted site starts with a fresh database. That's usually what you want for a demo (no test clutter).
- **Demo accounts** (one-click buttons on the sign-in page) also exist on the hosted site. That's handy for judges. Real users should create accounts with a password.
- **Camera privacy** is unchanged: video is processed in the browser; only the reading statistics are saved.
