# ePGP Schedule — Product Requirements

## Original Problem Statement
Reminder section for the ePGP Schedule app: users select subjects + time slots and receive recurring notifications until each subject's last lecture date, including an optional 15-min pre-class nudge.

## Stack
- Monorepo (pnpm workspaces), TypeScript 5.9, React 19 + Vite 7 (frontend)
- Express 5 + Drizzle/Postgres (api-server, port 5000)
- Web Push (VAPID) for true push delivery — runs server-side, independent of client tabs

## What's Implemented (current state)

### Reminders v2 — Web Push (current)
- **True Web Push via VAPID** — notifications fire even with the tab/browser closed
- **Server-side scheduler** (60 s tick) checks today's schedule against every subscription's reminders and sends pushes via `web-push`
- **Subject-driven persistence** — a reminder fires on EVERY date its subjects appear in the timetable; auto-deleted when the last lecture date for those subjects has passed (no manual end-date needed)
- **Pre-class nudge** — opt-in checkbox; additionally fires 15 min before each matched session start (per subject, per session)
- **n=33 time slots**, every 30 min from 6 AM → 10 PM, presented as a **horizontal scrollable picker** with left/right arrow buttons
- **≥1 time slot** required per reminder (relaxed from previous "twice a day" minimum)
- **No date picker** — reminders are subject-bound, not date-bound
- **Delete all** button with inline confirmation, plus per-reminder delete
- **Auto-cleanup**: failed pushes (HTTP 404/410 from push service) purge the subscription; reminders with no matching schedule entries are auto-expired

### Files
**Frontend (`/app/artifacts/schedule`)**
- `src/lib/usePushReminders.ts` — push hook (subscribe, sync, CRUD reminders)
- `src/components/RemindersSection.tsx` — UI (scrollable slots, no date, pre-class nudge, delete all)
- `src/pages/home.tsx` — mounts the section
- `public/sw.js` — service worker push + notificationclick handlers (cache logic preserved)
- `vite.config.ts` — `/api` proxy to `http://localhost:5000`

**Backend (`/app/artifacts/api-server`)**
- `src/routes/push.ts` — `/api/push/{vapid-public-key,subscribe,unsubscribe,reminders}`
- `src/lib/pushScheduler.ts` — 60 s tick, fires + auto-expires
- `src/lib/pushStore.ts` — JSON-file persistence (`data/push-store.json`)
- `src/routes/schedule.ts` — exposed `getCachedSchedule()` for the scheduler
- `.env` — VAPID keys (generated locally; rotate before production deploy)

## Verified
- ✅ Backend CRUD endpoints (subscribe/list/add/delete/clear-all) work via curl
- ✅ Scheduler fires push at slot time; 410 from FCM causes auto-cleanup of dead subscription
- ✅ Auto-expiry: reminder with no matching subjects in schedule is removed by next tick (log: "reminder auto-expired (no occurrences)")
- ✅ UI: scrollable slot picker, pre-class checkbox, ≥1 slot, no date picker, delete-all flow
- ✅ Vite proxy routes frontend `/api/*` to api-server
- ✅ Frontend gracefully handles push-unsupported environments (incognito, some headless modes)

## Backlog
- P1: Add an icon/badge image (`icon-192.png`) to schedule's `public/` for notification visuals
- P2: Per-reminder edit (current: delete + recreate)
- P2: Snooze / mute-for-today
- P2: When deployed, migrate JSON store → Postgres (Drizzle schema already wired)

## Operational notes
- For pushes to fire, the api-server must be running 24/7
- VAPID keys live in `artifacts/api-server/.env` — rotate before public deploy
- Push delivery requires HTTPS (or localhost). Production deploys must serve frontend over HTTPS
