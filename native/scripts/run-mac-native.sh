#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cd "$ROOT"
npm run copy:specviewer
npx vite build
swift run --package-path "$ROOT/native/mac" HiMDPower --dist "$ROOT/dist" "$@"
