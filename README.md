# Fasting Weight Loss Calculator

Science-based fasting weight loss estimator. Built with React + Vite.

---

## 🚀 Deploy to Vercel in 5 minutes (recommended, free)

### Option A — Drag & Drop (no GitHub needed)

1. Open your terminal and run:
   ```
   npm install
   npm run build
   ```
2. This creates a `dist/` folder.
3. Go to [vercel.com](https://vercel.com) → sign up free → click **"Add New Project"**
4. Drag and drop the `dist/` folder onto the Vercel dashboard
5. Done — you get a live URL like `fasting-calculator-xyz.vercel.app`

---

### Option B — GitHub + Vercel (auto-deploys on every change)

1. Create a free account at [github.com](https://github.com)
2. Create a new repository (click **+** → **New repository**)
3. Upload this entire project folder to the repo (drag & drop in the GitHub UI, or use git)
4. Go to [vercel.com](https://vercel.com) → **Add New Project** → **Import Git Repository**
5. Select your GitHub repo → click **Deploy**
6. Vercel auto-detects Vite — no config needed. Click **Deploy**.
7. Every time you push a change to GitHub, Vercel redeploys automatically.

---

## 💻 Run locally (to preview before deploying)

```bash
# Install dependencies (one time)
npm install

# Start local dev server
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🌐 Custom domain (optional, ~$10–15/year)

1. Buy a domain at [namecheap.com](https://namecheap.com) or [cloudflare.com](https://cloudflare.com/products/registrar/) (Cloudflare is cheapest, at-cost pricing)
   - Good names: `fastingcalc.com`, `fastweightloss.app`, `fastingprotocol.com`
2. In your Vercel project → **Settings** → **Domains** → **Add Domain**
3. Type your domain name and follow Vercel's instructions (you'll copy 2 DNS records into your domain registrar — takes 5 minutes)
4. HTTPS is automatic and free via Vercel

---

## 📁 Project structure

```
fasting-calculator/
├── index.html          ← Page shell + SEO meta tags
├── package.json        ← Dependencies
├── vite.config.js      ← Build config
└── src/
    ├── main.jsx        ← React entry point
    └── App.jsx         ← The calculator (all logic + UI)
```

---

## 🔧 Making changes

All the calculator logic and UI lives in `src/App.jsx`. Edit it, save,
and the dev server hot-reloads instantly. When you're happy, run
`npm run build` and redeploy.

---

## Tech stack

- **React 18** — UI
- **Vite 5** — Build tool (fast, modern)
- No other dependencies — pure React with inline styles

---

## 🚗🌨️ Commute weather alert (Chicago ⇄ Naperville)

A fully automated nightly check for adverse driving conditions (rain, snow,
ice, fog, high wind) during the 4–7am commute window, with a push
notification to your phone's lock/home screen at 9:30pm the night before.

- **Script**: `scripts/commute-weather-alert.mjs` — checks the free NOAA/NWS
  hourly forecast (no API key needed) for Chicago, Naperville, and the
  I-88 corridor between them, and flags anything adverse.
- **Delay estimate**: the notification title leads with a ballpark commute
  impact — "Normal commute time," "Extra 5-10 min expected," up through
  "Extra 35-60+ min expected — leave early" for ice/blizzard conditions.
  This is a rule-of-thumb bucket by condition severity (see
  `SEVERITY_LEVELS` in the script), not live traffic data — nothing free
  gives a weather-adjusted ETA for a specific route, so treat it as a
  ballpark calibrated against typical real-world impact rather than a
  precise prediction.
- **Trigger**: `.github/workflows/commute-weather-alert.yml` has no
  `schedule:` block on purpose — GitHub's own cron scheduler ran this
  workflow 4.5-5 hours late, repeatedly, which is a documented risk of
  that trigger ("best effort," not exact). Instead, an external cron
  service calls the workflow's dispatch API directly at 9:30pm
  America/Chicago every night (see setup step 3 below), which is
  immediate rather than queued.
- **Delivery**: [ntfy.sh](https://ntfy.sh) push notifications — free, no
  account required.

### One-time setup

1. Install the [ntfy app](https://ntfy.sh/#subscribe) on your phone
   (iOS/Android) and subscribe to this topic:
   ```
   ryan-commute-wx-287f1063d3d1
   ```
2. In this GitHub repo, go to **Settings → Secrets and variables →
   Actions → New repository secret** and add:
   - Name: `NTFY_TOPIC`
   - Value: `ryan-commute-wx-287f1063d3d1`
   (Treat this topic name as a shared secret — anyone who knows it can
   read or post to it on the public ntfy.sh server.)
3. **Reliable exact-time triggering** — set up an external cron service
   to call GitHub's API at 9:30pm sharp every night:

   **a. Create a scoped GitHub access token** (only you can do this —
   it can't be created via any tool or API call):
   - Go to [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
   - Set **Repository access** → **Only select repositories** →
     `fasting-calculator`
   - Under **Permissions → Repository permissions**, set **Actions** to
     **Read and write**. Leave everything else as "No access."
   - Set an expiration (e.g. 1 year) and generate the token. **Copy it
     immediately** — GitHub only shows it once. Never commit this token
     or add it as a repo secret; it only goes into the cron service
     below.

   **b. Sign up for a free cron-ping service** (e.g.
   [cron-job.org](https://cron-job.org)) and create a job with:
   - **URL**: `https://api.github.com/repos/ryans-dotcom/fasting-calculator/actions/workflows/commute-weather-alert.yml/dispatches`
   - **Method**: `POST`
   - **Headers**:
     ```
     Accept: application/vnd.github+json
     Authorization: Bearer <the token from step a>
     X-GitHub-Api-Version: 2022-11-28
     Content-Type: application/json
     ```
   - **Body**: `{"ref":"main"}`
   - **Schedule**: daily at 9:30 PM, timezone **America/Chicago** (most
     cron-ping services let you pick a timezone per job, which handles
     the twice-yearly DST shift automatically — confirm this in
     whichever service you choose).
   - A successful call returns HTTP 204 with no body. Trigger it once
     manually from the service's dashboard to confirm you get a 204 (and
     a real notification), then leave it on its schedule.

   **Token upkeep**: when the token nears its expiration date, generate
   a new one (same steps) and update it in the cron service — the old
   job silently starts failing (401) once the token expires.

Once step 3 is configured, everything runs independently of any local
machine, browser tab, or Claude session — the cron service calls GitHub
directly on schedule.
