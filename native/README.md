# Native Strategy

This folder holds the native desktop shells that replace Electron, while the React/TipTap frontend in `src/` stays shared across every shell.

## Shell Assignment (confirmed)

- **macOS**: Swift/AppKit + WKWebView (`native/mac`) — the main subject of this document.
- **Windows**: Tauri 2 + WebView2 (`native/windows`) — build runbook in `native/windows/docs/`.
- **Electron** (`electron/`): kept for now as the verified fallback that shares the web-deploy build.

Full integration plan: `native support plan.md` (repo root).

## Repository Shape

- Native shells, native scripts, and native docs live under `native/` in the main repository.
- Keep shared frontend files untouched when possible. Platform differences go through the
  `window.electronAPI` contract (`native/api-contract.md`); each shell implements that surface.

## Native Shell Approach

The first native target is a Swift/AppKit executable that hosts the existing Vite bundle in `WKWebView`.

Why this shape:

- It removes Electron and its bundled Chromium/Node runtime from the macOS app.
- It keeps the React/TipTap editor intact for now, so upstream updates can still be merged.
- It implements the same `window.electronAPI` surface from a native bridge, so `src/api.js` does not need a forked code path yet.

Tradeoff:

- This is native packaging and native filesystem/dialog integration, not a full rewrite of the editor UI in Swift.
- The editor bundle still includes TipTap/ProseMirror. The current production JS bundle is roughly 780 KB before gzip and roughly 260 KB after gzip; the larger app-size win comes from removing Electron.

## Performance Strategy

The goal is not only packaging. The native path exists to improve startup time, memory use, and editing responsiveness.

Use three performance tiers:

1. Shell replacement: replace Electron with a native AppKit/WKWebView shell while keeping the upstream React editor unchanged.
   - Expected win: much smaller app bundle, less duplicated runtime weight, less Electron/Node overhead.
   - Limit: React, TipTap, ProseMirror, DOM layout, and JavaScript execution are still in the hot path.
2. Native host services: keep the upstream UI, but move expensive desktop work into native code.
   - File tree scanning, image IO, HTML capture/export, path resolution, and large file reads/writes should be native bridge calls.
   - This preserves upstream follow-up because the contract stays `window.electronAPI`.
3. Native editor path: replace the editor surface itself only if measurement shows React/TipTap is still the bottleneck.
   - Expected win: lower idle memory, lower typing latency, faster large document handling.
   - Cost: this is where upstream compatibility becomes hard, because editor behavior must be reimplemented or isolated behind a stricter document model.

Do not assume native rewrite is required before measurement. Electron removal may solve the app-size/runtime problem, but it will not solve React/TipTap editing costs if those are the dominant bottleneck.

## Performance Budgets

Track these numbers before and after each native step:

- Cold launch to editable document.
- Idle resident memory after launch.
- Resident memory after opening representative small, medium, and large markdown files.
- Typing latency in a large document.
- File tree load time for a large folder.
- Save/export latency.

Native work should keep the upstream update surface small. If a performance fix requires changing upstream React code, prefer a small adapter or API contract over broad edits.

## Commands

Run the native shell from source:

```bash
bash native/scripts/run-mac-native.sh
```

Build a local `.app` bundle:

```bash
bash native/scripts/build-mac-native-app.sh
open "release/Hi MD Power.app"
```

Create a Developer ID signed and notarized zip for distribution:

```bash
export DEVELOPER_ID_APPLICATION='Developer ID Application: Your Name (TEAMID)'
xcrun notarytool store-credentials himd-notary \
  --apple-id you@example.com \
  --team-id TEAMID \
  --password app-specific-password
export NOTARY_KEYCHAIN_PROFILE=himd-notary
bash native/scripts/sign-notarize-mac-app.sh
```

The unsigned local build is only for private testing. A downloaded unsigned or ad-hoc-signed app can trigger Gatekeeper malware warnings because macOS cannot verify the developer or notarization ticket.

For one-off local testing on a trusted machine:

```bash
xattr -dr com.apple.quarantine "Hi MD Power.app"
```

## Pre-PR Checks

The native shell is optional. Before opening or updating a PR, verify that the existing surfaces still work:

```bash
npm run copy:specviewer
npx vite build
bash native/scripts/build-mac-native-app.sh
node native/scripts/benchmark-performance.mjs --runs=1 --load-files=6
```

The existing Windows/Electron release workflow should keep using `npm run build:win` or `npx electron-builder --win` on Windows. The native Swift scripts should not be called from Windows jobs. The Windows *native* build is a separate Tauri shell — see `native/windows/docs/`.

Useful native debug logging:

```bash
HIMD_NATIVE_DEBUG=1 "release/Hi MD Power.app/Contents/MacOS/HiMDPower"
tail -f ~/Library/Logs/HiMDPower/launch.log
```

External forks only — if you keep a fork that tracks this repository as `upstream`, update with:

```bash
bash native/scripts/sync-upstream.sh
```

The sync script requires a clean worktree, fast-forwards `main` from `upstream/main`, then rebases the current feature branch on top of the updated `main`. Inside the main repository itself this script is not needed.

## Follow-Up Path

1. Complete parity testing for the native bridge: folder open, file read/write, image paste/save, schedule window, spec viewer.
2. Add app signing/notarization once the native bundle shape is stable.
3. If React still feels too heavy after Electron is gone, then evaluate extracting or replacing the editor surface itself. That should be a later step because it creates the largest upstream merge cost.
