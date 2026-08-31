---
name: Pinned pnpm in Replit
description: A workspace packageManager pin can trigger repeated pnpm bootstrap processes during local workflow or parallel command startup.
---

When the workspace package-manager pin differs from the preinstalled pnpm version, local workflows may try to bootstrap the pinned version repeatedly and exhaust available Node worker threads.

**Why:** Parallel verification commands produced orphaned bootstrap processes and caused unrelated workflow failures, while direct local binaries continued to work.

**How to apply:** Run pnpm commands serially. If bootstrapping is stuck, clean up only the pinned-version bootstrap processes and use already-installed package binaries for one-off verification.