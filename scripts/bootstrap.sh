#!/usr/bin/env bash
# Prepares a fresh git worktree so an agent can start working immediately.
# Point Orca's worktree setup hook at this script.
#
# Worktrees don't carry gitignored files, so a new checkout has no .env.local and
# no node_modules. Without this, every agent's first database call fails.

set -euo pipefail

# Where your primary checkout lives. Override with WW_MAIN_CHECKOUT if it differs.
MAIN_CHECKOUT="${WW_MAIN_CHECKOUT:-$HOME/Projects/Waiver-Wire}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> bootstrapping $HERE"

if [ "$HERE" = "$MAIN_CHECKOUT" ]; then
  echo "    this is the main checkout; skipping env copy"
elif [ -f "$MAIN_CHECKOUT/.env.local" ]; then
  cp "$MAIN_CHECKOUT/.env.local" "$HERE/.env.local"
  echo "    copied .env.local from main checkout"
else
  echo "!!! no .env.local at $MAIN_CHECKOUT"
  echo "    create it from .env.example, or set WW_MAIN_CHECKOUT"
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "!!! pnpm not found — run: corepack enable && corepack prepare pnpm@latest --activate"
  exit 1
fi

echo "==> installing dependencies"
pnpm install --frozen-lockfile

echo "==> typechecking"
pnpm typecheck

echo "==> ready. all worktrees share one dev database; expect to see each other's rows."
