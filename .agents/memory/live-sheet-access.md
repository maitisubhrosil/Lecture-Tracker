---
name: Live schedule sheet access
description: Access requirements for the remotely fetched lecture timetable.
---

The schedule source must be readable by the Cloudflare Worker and the scheduled static refresh job without an interactive university login.

**Why:** Both production paths fetch the Google Sheets CSV directly and have no supported session for a student's university account.

**How to apply:** If the administrator keeps the source private, obtain an administrator-provided public/exported source or change the backend architecture; never request or store personal credentials.

The Worker also needs a non-live fallback path and versioned schedule-cache keys when a term changes.

**Why:** A successful response from an old Worker KV cache can mask the newly deployed static schedule, while a private sheet prevents the Worker from refreshing that cache.

**How to apply:** Keep live-sheet fetches first, but use the current deployed schedule fallback when live access fails and invalidate old-term cache entries on timetable changes.