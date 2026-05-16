# Production Deployment Guide

The reminders feature relies on the api-server's **60-second background scheduler** to send Web Push notifications. That means the server must run continuously — no spin-down / serverless / cold starts. This guide picks the right strategy and walks through it step-by-step.

---

## Architecture summary

```
┌─────────────────────┐         ┌───────────────────────────┐
│ Static frontend     │  HTTPS  │ api-server (Node 20+)     │
│ Vite build → CDN    │ ──────▶ │ • /api/schedule (Sheets)  │
│ (Vercel/Netlify/    │         │ • /api/push/*            │
│  Cloudflare Pages)  │         │ • pushScheduler (60s tick)│
└─────────────────────┘         │ • web-push → FCM/Mozilla  │
                                └───────────────┬───────────┘
                                                │
                                       ┌────────▼────────┐
                                       │ data/push-store │
                                       │ .json (volume)  │
                                       └─────────────────┘
```

| Concern | Constraint | Why |
|---|---|---|
| Always-on backend | **no** spin-down | The scheduler must tick every 60 s |
| Persistent disk | YES (for now) | `push-store.json` holds subscriptions |
| HTTPS frontend | required | Browsers refuse to register service workers / push subscriptions on plain HTTP |

---

## Recommended strategy

**Frontend on Vercel + api-server on Fly.io** (free tier covers everything).

- **Vercel**: zero-config Vite deploy, free HTTPS, global CDN
- **Fly.io**: free always-on tier (3 shared VMs, 3 GB volume), pay-as-you-grow
- Both have first-class env-var management for VAPID keys

Alternatives ranked:

| Option | Cost | Always-on | Persistent disk | Notes |
|---|---|---|---|---|
| Fly.io (recommended) | Free tier | ✅ | ✅ (volumes) | Best fit, simple Dockerfile |
| Railway | $5/mo credit | ✅ | ✅ | Easier UX, slightly costlier |
| Render Web Service | $7/mo (Starter) | ✅ paid only | ✅ paid disk | Free tier spins down → ❌ kills scheduler |
| AWS Lightsail / DO Droplet | $4–5/mo | ✅ | ✅ | Full VM, more setup |
| Replit Reserved VM | $1+/mo | ✅ | ✅ | Native fit if you stay on Replit |

---

## Part 1 — Deploy api-server to Fly.io

### 1.1 Prerequisites

```bash
# Install flyctl (macOS/Linux/WSL)
curl -L https://fly.io/install.sh | sh
# Sign up + log in (browser flow)
fly auth signup   # or: fly auth login
```

### 1.2 Add a Dockerfile

The api-server already builds to a single bundled `dist/index.mjs`, so the Docker image is tiny. Create `/app/artifacts/api-server/Dockerfile`:

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
# Bring in the whole workspace so pnpm can resolve workspace:* deps
COPY ../../pnpm-workspace.yaml /app/
COPY ../../package.json /app/
COPY ../../pnpm-lock.yaml /app/
COPY ../../tsconfig.base.json /app/
COPY ../../lib /app/lib
COPY ./ /app/artifacts/api-server
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/api-server run build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/artifacts/api-server/dist /app/dist
RUN mkdir -p /data
ENV PUSH_STORE_PATH=/data/push-store.json
ENV PORT=8080
EXPOSE 8080
CMD ["node", "--enable-source-maps", "/app/dist/index.mjs"]
```

> **Note**: Fly's build context is the project root, not the api-server folder. Run `fly launch` from `/app` so the relative `COPY` paths resolve correctly.

### 1.3 `fly.toml`

Create `/app/fly.toml`:

```toml
app = "epgp-api"           # change to a unique app name
primary_region = "sin"     # closest to your users (Singapore for IIM Raipur)

[build]
  dockerfile = "artifacts/api-server/Dockerfile"

[env]
  VAPID_SUBJECT = "mailto:you@example.com"
  PUSH_STORE_PATH = "/data/push-store.json"

[[mounts]]
  source = "epgp_data"
  destination = "/data"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = false   # ← CRITICAL: keep the scheduler running
  auto_start_machines = true
  min_machines_running = 1

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"
```

### 1.4 Launch & set secrets

```bash
cd /app
fly launch --no-deploy --copy-config        # accepts the fly.toml above
fly volumes create epgp_data --size 1 --region sin
fly secrets set \
  VAPID_PUBLIC_KEY="BHapKvgIyjUdT1-dX2RjXaFLBs5oeFJyvEo6H3LAWCBPt3nIpgaHXI8zxL5qR4MrVSEzOQNkq2lka8cvHUpOJrU" \
  VAPID_PRIVATE_KEY="yl6whLXrw_SQ9Gmf3Y58uYFq5UG2CJY2f0SxhkcdKjw"
fly deploy
```

> ⚠️ The VAPID keys above are the **dev** keys. Generate fresh production keys:
> ```bash
> node -e "const wp=require('web-push'); console.log(wp.generateVAPIDKeys())"
> ```
> Then `fly secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=...` and redeploy.

### 1.5 Verify

```bash
fly logs                                                # tail logs
curl https://epgp-api.fly.dev/api/healthz               # {"status":"ok"}
curl https://epgp-api.fly.dev/api/push/vapid-public-key # {"publicKey":"..."}
```

---

## Part 2 — Deploy frontend to Vercel

### 2.1 Set the public VAPID key & API URL

The frontend only needs the **public** key (already exposed by `/api/push/vapid-public-key` — fetched dynamically). Make sure the dev proxy is replaced with a production rewrite.

Create `/app/artifacts/schedule/vercel.json`:

```json
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "https://epgp-api.fly.dev/api/$1" }
  ]
}
```

> Using a same-origin rewrite (rather than CORS) keeps the service worker happy: it sees `/api/*` on its own scope.

### 2.2 Deploy

```bash
cd /app/artifacts/schedule
npm i -g vercel
vercel link                       # follow prompts
vercel --prod
```

Vercel auto-detects Vite. Build command: `pnpm install && pnpm --filter @workspace/schedule build`. Output: `dist/public`. Set those in Project Settings if not auto-detected.

### 2.3 Service worker sanity check

After the first deploy:

1. Visit your `https://your-app.vercel.app/` in Chrome
2. DevTools → Application → Service Workers → confirm `sw.js` is registered and **activated**
3. Application → Manifest → confirm icons load
4. Open Reminders → click **Enable** → grant permission
5. DevTools → Application → Service Workers → "Push" button to dispatch a test push payload
6. Add a real reminder for a slot 1–2 minutes from now → close the tab → confirm the OS notification appears

---

## Part 3 — Ops checklist

### Rotate VAPID keys

Subscriptions are bound to the public key. Rotating invalidates **all existing subscriptions**, forcing every user to re-subscribe. To rotate:

```bash
node -e "const wp=require('web-push'); console.log(wp.generateVAPIDKeys())"
fly secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=...
fly deploy
```

Then nuke the store on first deploy:

```bash
fly ssh console -C "rm -f /data/push-store.json"
```

### Backups

`push-store.json` lives on the Fly volume. Snapshot occasionally:

```bash
fly ssh console -C "cat /data/push-store.json" > backup-$(date +%F).json
```

### When you outgrow JSON storage

The Drizzle schema package is already wired. To migrate:

1. Add `subscriptions` + `reminders` tables in `lib/db/src/schema/`
2. Run `pnpm --filter @workspace/db run push`
3. Swap `lib/pushStore.ts` from `fs`-backed to `drizzle` queries (same interface, so `pushScheduler.ts` doesn't change)
4. Migrate existing JSON → Postgres with a one-off script (loop over `subscribers`, `INSERT ... ON CONFLICT`)

### Monitoring

- Fly metrics: `fly dashboard` → app → Metrics
- Alert on push failures: tail logs for `push failed` and forward to Sentry / Logtail
- Add a `/api/push/stats` endpoint returning `{ subscribers, reminders, lastTickAt }` for a status badge

---

## Part 4 — Cost estimate

Single-user / class-of-150 scale (well within free tiers):

| Service | Usage | Cost |
|---|---|---|
| Fly.io | 1 shared-1x VM, 1 GB volume, ~5 MB egress/day | **$0** (free tier) |
| Vercel | Static hobby plan, <1 GB bandwidth/mo | **$0** |
| FCM / Mozilla autopush | Push delivery | **$0** (free, no quota for normal usage) |
| **Total** | | **$0/mo** |

If you scale past 3 always-on VMs or 160 GB-hours/mo on Fly, upgrade to the Hobby plan (~$5/mo).

---

## TL;DR

```bash
# api-server → Fly.io
cd /app && fly launch --no-deploy --copy-config
fly volumes create epgp_data --size 1 --region sin
fly secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=...
fly deploy

# frontend → Vercel
cd /app/artifacts/schedule && vercel --prod
```

Notifications now fire 24/7 across phones and desktops without a single tab needing to be open. 🎉
