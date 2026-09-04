#!/usr/bin/env bash
set -euo pipefail

# Post-merge runs without a TTY. CI mode keeps pnpm and workspace tooling
# non-interactive while Corepack selects the version pinned by package.json.
export CI=true

corepack pnpm install --frozen-lockfile --reporter=append-only

if [[ -n "${DATABASE_URL:-}" ]]; then
  corepack pnpm --filter @workspace/db run push
else
  echo "DATABASE_URL is not configured; skipping database schema push."
fi
