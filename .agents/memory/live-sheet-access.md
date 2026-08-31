---
name: Live schedule sheet access
description: Access requirements for the remotely fetched lecture timetable.
---

The schedule source must be readable by the Cloudflare Worker and the scheduled static refresh job without an interactive university login.

**Why:** Both production paths fetch the Google Sheets CSV directly and have no supported session for a student's university account.

**How to apply:** If the administrator keeps the source private, obtain an administrator-provided public/exported source or change the backend architecture; never request or store personal credentials.