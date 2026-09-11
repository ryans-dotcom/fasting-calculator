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
- **Schedule**: `.github/workflows/commute-weather-alert.yml` runs on
  GitHub Actions every night, targeting ~9:30pm America/Chicago (drifts
  ~1 hour across the twice-yearly DST change, since the cron is fixed in
  UTC). The workflow always sends when it runs, rather than skipping if
  it's not exactly the target time — see note on timing below.
- **Delivery**: [ntfy.sh](https://ntfy.sh) push notifications — free, no
  account required.

**A note on timing accuracy:** GitHub's `schedule` trigger is documented as
best-effort, not exact — on this repo it has run up to ~5 hours late on
occasion. There is no way to force GitHub's own scheduler to fire exactly
on time from within the workflow file. If you need the notification to
reliably land at 9:30pm sharp rather than "sometime that night," the fix is
to trigger the workflow from an external cron service instead of relying
on GitHub's built-in schedule — ask if you'd like this set up.

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
3. Done. You'll get a notification most nights around 9:30pm (subject to
   GitHub's scheduling delay, see above), and can also trigger a test run
   any time from the **Actions** tab → "Commute Weather Alert" →
   **Run workflow**.

No further action is needed after setup — the workflow runs on GitHub's
servers independent of any local machine or Claude session.
