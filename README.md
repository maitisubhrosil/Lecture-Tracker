# Lecture Tracker

A lightweight lecture schedule and reminder app for ePGP classmates. The web app shows today's and upcoming lectures, can be installed from Chrome as a phone home-screen app, and sends Web Push reminders for selected subjects.

Live app: <https://maitisubhrosil.github.io/Lecture-Tracker/>

## What it does

- Shows today's lectures and future lectures in an easy-to-scan view.
- Lets users create any number of reminders for selected subjects.
- Supports multiple reminder time slots per reminder.
- Supports an optional 15-minute pre-class nudge before the actual lecture start time.
- Keeps reminders active until the selected subject's last lecture in the timetable has passed.
- Sends true Web Push notifications from the backend, so reminders can arrive even when the tab is closed.
- Refreshes the schedule automatically through GitHub Actions every day at 5:30 AM IST.
- Works on phones, tablets, laptops, and desktops. On phones, users can add it to the home screen for app-like access.

## How classmates should use it

1. Open the live link in Google Chrome.
2. On Android or iPhone, optionally choose **Add to Home Screen** from Chrome for quick app-like access.
3. Open the reminders section and allow notifications when the browser asks.
4. Select the subjects to track.
5. Select one or more reminder times.
6. Optionally enable the 15-minute pre-class reminder.
7. Save the reminder.

Users do **not** need to recreate reminders every day. A saved reminder continues automatically for the selected subjects until those subjects no longer appear in the timetable.

> If a user changes device/browser, clears browser data, blocks notifications, or uses incognito/private browsing, they may need to allow notifications and set up reminders again on that device.

## Repository structure

```text
.
├── artifacts/
│   ├── schedule/          # React + Vite frontend served through GitHub Pages
│   ├── worker/            # Cloudflare Worker API, scheduler, KV store, Web Push sender
│   ├── api-server/        # Express API alternative/legacy backend with push scheduler
│   ├── mobile/            # Mobile app artifact
│   └── mockup-sandbox/    # UI mockup sandbox
├── lib/
│   ├── api-spec/          # OpenAPI specification and Orval codegen config
│   ├── api-client-react/  # Generated React Query API client
│   ├── api-zod/           # Generated Zod API schemas
│   └── db/                # Drizzle database package
├── scripts/               # Utility scripts, including schedule fetcher
├── DEPLOY.md              # Production deployment guide for GitHub Pages + Cloudflare Workers
└── memory/PRD.md          # Product requirements and implementation notes
```

## Architecture

Production uses GitHub Pages for the frontend and a Cloudflare Worker for the API and notification scheduler.

```text
User browser / installed web app
        │
        ▼
GitHub Pages frontend
        │
        ▼
Cloudflare Worker API
        ├── GET /api/schedule
        ├── Push subscription/reminder CRUD endpoints
        ├── Google Sheets schedule fetch/cache
        ├── Cloudflare KV subscription + reminder storage
        └── 1-minute cron that evaluates reminders and sends Web Push
```

The Cloudflare Worker is the recommended production backend. The Express `api-server` remains in the repository as an alternative backend path for always-on server deployments.

## Tech stack

- **Monorepo:** pnpm workspaces
- **Frontend:** React 19, Vite, TypeScript, Tailwind CSS
- **Production backend:** Cloudflare Workers, Cloudflare KV, Web Push/VAPID
- **Alternative backend:** Express 5, Node.js, Web Push
- **API tooling:** OpenAPI, Orval, Zod, React Query
- **Deployment:** GitHub Actions, GitHub Pages, Cloudflare Wrangler

## Prerequisites

- Node.js 20+ for the frontend and scripts. Node.js 22 is used by the worker deployment workflow.
- pnpm 10 recommended for parity with GitHub Actions.
- A Cloudflare account for production Worker/KV deployment.
- GitHub Pages enabled through GitHub Actions for the frontend.

## Local development

Install dependencies:

```bash
pnpm install
```

Run the schedule frontend:

```bash
pnpm --filter @workspace/schedule run dev
```

Run the Cloudflare Worker locally:

```bash
pnpm --filter @workspace/worker run dev
```

Fetch the latest schedule data from Google Sheets:

```bash
pnpm --filter @workspace/scripts run fetch-schedule
```

Run type checks:

```bash
pnpm run typecheck
```

Build everything that has a build script:

```bash
pnpm run build
```

## Important environment/configuration values

### Frontend

`artifacts/schedule` reads the API base URL from:

```text
VITE_API_BASE_URL
```

For GitHub Pages production, this is supplied by the GitHub repository variable:

```text
WORKER_API_BASE_URL=https://epgp-reminders.<your-cloudflare-subdomain>.workers.dev
```

Do not include a trailing slash or `/api` in `WORKER_API_BASE_URL`.

### Cloudflare Worker

The Worker expects:

```text
EPGP_KV              # Cloudflare KV binding
VAPID_PUBLIC_KEY     # Web Push public key, stored as a Cloudflare secret
VAPID_PRIVATE_KEY    # Web Push private key, stored as a Cloudflare secret
VAPID_SUBJECT        # Contact subject for VAPID, configured in wrangler.toml/env
```

Never commit private VAPID keys. Use `wrangler secret put` for secrets.

## Deployment summary

See [`DEPLOY.md`](./DEPLOY.md) for the full production guide. In short:

1. Create the Cloudflare KV namespace and update `artifacts/worker/wrangler.toml` with the namespace id.
2. Store VAPID keys in Cloudflare with `wrangler secret put`.
3. Deploy the Worker once locally with Wrangler.
4. Add GitHub Actions secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
5. Add GitHub Actions repository variable:
   - `WORKER_API_BASE_URL`
6. Enable GitHub Pages with **GitHub Actions** as the source.
7. Push to `main`.

Automated workflows:

- Changes to `artifacts/worker/**`, `lib/**`, workspace files, or the worker workflow deploy the Cloudflare Worker.
- Pushes to `main` build and deploy the schedule frontend to GitHub Pages.
- A scheduled workflow runs daily at midnight UTC, which is 5:30 AM IST, to fetch the latest schedule and deploy the refreshed frontend.

## Smoke testing production

After deployment:

1. Open the live app in Chrome, not incognito/private browsing.
2. Enable reminders and allow notification permission.
3. Confirm `sw.js` is activated in browser DevTools under Application → Service Workers.
4. Confirm `POST /api/push/subscribe` returns 200 and points to the Worker URL.
5. Add a reminder for a subject that has a lecture today and a reminder slot 1–2 minutes in the future.
6. Close the tab and wait for the OS notification.

If notifications do not arrive, check Cloudflare Worker logs and the GitHub Actions run history.

## Useful commands

| Task | Command |
| --- | --- |
| Install dependencies | `pnpm install` |
| Start frontend | `pnpm --filter @workspace/schedule run dev` |
| Build frontend | `pnpm --filter @workspace/schedule run build` |
| Typecheck frontend | `pnpm --filter @workspace/schedule run typecheck` |
| Start Worker locally | `pnpm --filter @workspace/worker run dev` |
| Typecheck Worker | `pnpm --filter @workspace/worker run typecheck` |
| Deploy Worker | `pnpm --filter @workspace/worker exec wrangler deploy` |
| Fetch schedule | `pnpm --filter @workspace/scripts run fetch-schedule` |
| Typecheck workspace | `pnpm run typecheck` |
| Build workspace | `pnpm run build` |

## Notes for maintainers

- Web Push requires HTTPS in production, or localhost during development.
- The Worker cron runs every minute and deduplicates sent notifications.
- Reminders are subject-based, not date-based.
- Reminders auto-expire after the last matching subject occurrence in the schedule.
- Rotating VAPID keys invalidates existing subscriptions, so users must re-enable notifications afterward.
- Avoid committing generated secrets, local `.env` files, or private keys.
