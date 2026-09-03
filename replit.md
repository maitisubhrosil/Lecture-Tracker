# Lecture Tracker

Lecture schedule and Web Push reminder app for ePGP classmates.

## Run & Operate

- `pnpm --filter @workspace/schedule run dev` — run the frontend (port 23496)
- `pnpm --filter @workspace/worker run dev` — run the Cloudflare Worker locally when its bindings and secrets are available
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- The Replit run button starts the frontend through the `Start application` workflow.
- No environment variable is required for the bundled fallback schedule.
- Set `VITE_API_BASE_URL` to the Worker base URL to use live schedule and reminder APIs.
- The schedule refresh uses the public administrator-maintained CSV mirror in the repository, so GitHub Actions and the Worker do not need an interactive university login.

## Stack

- pnpm workspaces, Node.js 20+, TypeScript 5.9
- Frontend: React 19, Vite, TypeScript, Tailwind CSS
- Production API: Cloudflare Workers, KV, and Web Push
- Alternative API: Express 5
- API codegen: Orval (from OpenAPI spec)
- Build: Vite

## Where things live

- `artifacts/schedule` — React/Vite frontend and bundled schedule fallback
- `artifacts/worker` — recommended Cloudflare Worker API and reminder scheduler
- `artifacts/api-server` — Express API alternative
- `scripts/src/fetch-schedule.ts` — administrator CSV fetcher and schedule parser
- `DEPLOY.md` — GitHub Pages and Cloudflare deployment guide

## Product

- View today’s and upcoming lectures.
- Filter the schedule by subject.
- Save multiple reminder times and optional 15-minute pre-class nudges.
- Receive Web Push reminders while the selected subjects remain in the timetable.

## Gotchas

- Web Push requires HTTPS in production, or localhost during development.
- The frontend intentionally falls back to `artifacts/schedule/public/schedule-data.json` when the Worker or live schedule source is unavailable.
- Do not commit VAPID private keys; configure them as Cloudflare Worker secrets.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
