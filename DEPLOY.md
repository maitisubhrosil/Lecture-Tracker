# GitHub-only Deployment Guide

The whole stack is deployed via **GitHub Actions** on every `git push` to `main`:

```
                ┌────────────────────────────────────────────┐
                │ GitHub repo                                │
                │ ┌──────────────────────────────────────┐   │
                │ │ artifacts/schedule  (Vite app)       │   │
                │ │ artifacts/worker    (CF Worker)      │   │
                │ │ .github/workflows/  (CI)             │   │
                │ └──────────────────────────────────────┘   │
                └────────────────────────────────────────────┘
                  │ push to main                  │ push to main
                  ▼                               ▼
         GitHub Pages                    Cloudflare Workers
         (frontend HTTPS)                (1-min cron + CRUD API)
                  │                               │
                  └─────── subscribers, reminders, push send ──┘
```

End users open `https://maitisubhrosil.github.io/Lecture-Tracker/` → frontend talks to the Worker → Worker sends Web Push every minute.

You do **one** one-time setup, then everything else is `git push`.

---

## One-time setup (≈10 min)

### 1. Create the Cloudflare account + KV namespace + secrets

> You only do this once. Everything below is free tier and **does not require a credit card**.

```bash
# On your laptop, after cloning the repo:
git clone https://github.com/maitisubhrosil/Lecture-Tracker.git
cd Lecture-Tracker
pnpm install

# Sign up & log in to Cloudflare (opens browser):
pnpm --filter @workspace/worker exec wrangler login

# Create the KV namespace that stores push subscriptions
pnpm --filter @workspace/worker exec wrangler kv namespace create EPGP_KV
# It prints something like:
#   { binding = "EPGP_KV", id = "abc123def456..." }
# Copy that `id` value.
```

Open `artifacts/worker/wrangler.toml` and replace `REPLACE_WITH_KV_ID_AFTER_FIRST_CREATE` with the id you just got. Commit that change.

Now upload the VAPID secrets (one-time — they're encrypted at rest in Cloudflare):

```bash
# Production VAPID keys (generated 2026-01-14 — DO NOT commit these anywhere else)
echo "BOLPbCpXpoc7NmO5BHwGaIPiQS8FgMtVYZalUFYWc544sX7_-wkatKccVntfQWvpSQAj1MvWWRkOVvt-pvO2-D8" | \
  pnpm --filter @workspace/worker exec wrangler secret put VAPID_PUBLIC_KEY

echo "HC6NGa6Qq9_M85Vx1dymhEWoikBLuEPPxOJfl3bkJSc" | \
  pnpm --filter @workspace/worker exec wrangler secret put VAPID_PRIVATE_KEY
```

> ⚠️ Treat `VAPID_PRIVATE_KEY` like a password. The pair lives only in Cloudflare's secret store and this one-time setup; never commit it. Rotating it invalidates every existing subscription.

### 2. First deploy of the Worker (locally)

```bash
pnpm --filter @workspace/worker exec wrangler deploy
```

Wrangler prints the live URL, something like:
```
Published epgp-reminders → https://epgp-reminders.<your-cf-subdomain>.workers.dev
```

Copy that URL — you'll need it in step 4.

### 3. Add GitHub Actions secrets (so future deploys run automatically)

Create a scoped Cloudflare API token:
- Visit https://dash.cloudflare.com/profile/api-tokens → **Create Token** → use the **"Edit Cloudflare Workers"** template
- Account permissions: `Workers Scripts: Edit`, `Workers KV Storage: Edit`, `Workers Routes: Edit`
- Account resources: pick your account
- Copy the generated token (only shown once)

Find your Cloudflare Account ID: dash.cloudflare.com → right sidebar → "Account ID".

Then on GitHub:
- `https://github.com/maitisubhrosil/Lecture-Tracker/settings/secrets/actions` → New repository secret:
  - `CLOUDFLARE_API_TOKEN` = (paste the token from above)
  - `CLOUDFLARE_ACCOUNT_ID` = (paste the account id)

### 4. Tell the frontend where the Worker lives

Same page → **Variables** tab → **New repository variable**:
- Name: `WORKER_API_BASE_URL`
- Value: `https://epgp-reminders.<your-cf-subdomain>.workers.dev`  (the URL from step 2, **no trailing slash**, **no `/api`**)

### 5. Enable GitHub Pages

Repo Settings → **Pages**:
- Source: **GitHub Actions**

That's it. Pages will be live at `https://maitisubhrosil.github.io/Lecture-Tracker/` after the next workflow run.

---

## Day-to-day workflow

```bash
git add .
git commit -m "feat: tweak reminder UI"
git push origin main
```

- Pushes that touch `artifacts/worker/**` → triggers `deploy-worker.yml` → Worker redeploys automatically (~30 s)
- Pushes that touch `artifacts/schedule/**` → triggers `deploy-pages.yml` → frontend rebuilds and Pages goes live (~1 min)
- Once a day at 5:30 AM IST, `deploy-pages.yml` also fetches a fresh schedule from the Google Sheet and rebuilds.

No tokens to refresh, no machine to keep alive, no bill to monitor.

---

## Smoke test the live stack

After your first deploy:

1. Open `https://maitisubhrosil.github.io/Lecture-Tracker/` in **Chrome** (not incognito).
2. Open the **Reminders** section → click **Enable** → grant the permission prompt.
3. DevTools → Application → Service Workers — should show `sw.js` is **activated**.
4. DevTools → Network — find the `POST /api/push/subscribe` request → should be 200 and hit the Worker URL.
5. Add a reminder for a subject that has a session today + a slot 1–2 min away.
6. **Close the browser tab.** Wait. Notification should arrive at the slot time (within a minute), with the bell icon and "ePGP" branding.

If anything's off:
- Check the Cloudflare dashboard → Workers → epgp-reminders → **Logs** (live tail)
- Check the GitHub repo → Actions tab → click the latest workflow run

---

## Free-tier ceiling

| Resource | Limit | Our typical usage |
|---|---|---|
| Workers requests | 100,000/day | ~3,000/day for a 150-person class |
| KV reads | 100,000/day | ~5,000/day |
| KV writes | 1,000/day | ~200/day (1 per subscription change) |
| Cron triggers | unlimited on free | 1,440/day (every minute) |
| GitHub Actions minutes | 2,000/mo (private) / unlimited (public) | ~30 min/mo |
| GitHub Pages bandwidth | 100 GB/mo soft | ~1 GB/mo |

You will not hit any of these.

---

## Rotating VAPID keys

This invalidates **every existing subscription** — only do it if a key leaks.

```bash
# Generate fresh keys locally
node -e "const wp=require('web-push'); console.log(wp.generateVAPIDKeys())"

# Push new secrets to Cloudflare
pnpm --filter @workspace/worker exec wrangler secret put VAPID_PUBLIC_KEY
pnpm --filter @workspace/worker exec wrangler secret put VAPID_PRIVATE_KEY

# Wipe the KV namespace (forces every user to re-subscribe with the new key)
pnpm --filter @workspace/worker exec wrangler kv namespace list
# copy the id, then:
pnpm --filter @workspace/worker exec wrangler kv key list --namespace-id=<id> | \
  jq -r '.[].name' | \
  while read k; do pnpm --filter @workspace/worker exec wrangler kv key delete "$k" --namespace-id=<id>; done

git commit --allow-empty -m "chore: rotate VAPID keys" && git push
```
