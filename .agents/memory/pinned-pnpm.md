---
name: Pinned pnpm in Replit
description: A workspace packageManager pin can trigger repeated pnpm bootstrap processes during local workflow or parallel command startup.
---

When the workspace package-manager pin differs from the preinstalled pnpm version, local workflows may try to bootstrap the pinned version repeatedly and exhaust available Node worker threads. Replit's package firewall can also block stale transitive tarball versions during the resulting reinstall.

**Why:** Parallel verification commands produced orphaned bootstrap processes and caused unrelated workflow failures, while direct local binaries continued to work; blocked stale transitive releases can leave the workspace partially linked.

**How to apply:** Run pnpm commands serially. If bootstrapping is stuck, clean up only the pinned-version bootstrap processes and use already-installed package binaries for one-off verification. If install hits a firewall 403, update the responsible parent or use a narrow compatible override; never bypass the firewall.