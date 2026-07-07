#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit or stash local changes first." >&2
  git status --short
  exit 1
fi

CURRENT_BRANCH="$(git branch --show-current)"

git fetch upstream
git checkout main
git merge --ff-only upstream/main

if [[ -n "$CURRENT_BRANCH" && "$CURRENT_BRANCH" != "main" ]]; then
  git checkout "$CURRENT_BRANCH"
  git rebase main
fi

git status -sb
