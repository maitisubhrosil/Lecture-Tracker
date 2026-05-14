# ePGP Schedule — Product Requirements

## Original Problem Statement
> Modify this to add a reminder section where if a user selects a particular set of subjects and sets the reminder, the page will continue to send out notifications for the selected subjects for the particular date twice a day at the user selected time slot. Give the user n number of time slot options for the subjects selected by the user.

## Stack & Architecture
- Monorepo (pnpm workspaces), TypeScript 5.9, React 19 + Vite 7, wouter
- Schedule UI app at `/app/artifacts/schedule`
- Express API server at `/app/artifacts/api-server` (Drizzle ORM + Postgres)
- Reminders run **client-side only**: Browser `Notification` API + `localStorage` (no backend changes)

## What's Implemented (2026-01)

### Reminder Feature
- **New `Reminders` section** in the home page (collapsible card above the schedule list)
- **Subject multi-select** — same chip styling/colors as the existing filter bar
- **Date picker** — defaults to today, min = today (no past dates)
- **Time slot picker** — `n = 33` options every 30 min from 06:00 → 22:00, formatted in 12-hour AM/PM
- **Validation** — at least 1 subject, at least 2 time slots (enforces the "twice a day" requirement; more allowed)
- **Browser notification permission flow** — banner + explicit "Enable" button; permission requested on save if missing
- **Active reminders list** — shows subjects (color chips), date, all chosen slots; per-row delete (trash icon)
- **Persistence** — `localStorage` (`epgp_reminders` + `epgp_reminders_fired`); survives reloads
- **Scheduler** — runs every 30 s while tab is open; fires for today's reminders when current time is at-or-past a slot (60-min tolerance window for brief tab inactivity), deduped via fired-key registry
- **Notification body** — lists today's actual sessions for the selected subjects (slot # · time · subject) pulled from the schedule data

### Files
- New: `artifacts/schedule/src/lib/useReminders.ts` (hook + scheduler)
- New: `artifacts/schedule/src/components/RemindersSection.tsx` (UI)
- Modified: `artifacts/schedule/src/pages/home.tsx` (mount the section)

## Verified
- ✅ Form: subject chips, date, 33 time-slot grid render correctly
- ✅ Save creates reminder, badge updates to "1 active"
- ✅ Reload persists reminders (localStorage)
- ✅ Notification fires at slot time with subject + today's session details
- ✅ Dedupe prevents re-firing for same `reminderId|date|slot`

## Backlog
- P1: Real push notifications via service worker + VAPID (so reminders fire with tab closed)
- P2: "Apply once" → daily-rolling reminder option (every day until disabled)
- P2: Edit existing reminder (currently delete + recreate)
- P2: In-app toast fallback when permission is denied
