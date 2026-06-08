#!/usr/bin/env node
/**
 * Copies the standalone UX Spec Viewer (single HTML file) into this app's
 * public/ folder so it can be embedded same-origin (iframe split view + new window).
 *
 * Source repo lives next to this one:  ../UXspecviewer/Spec viewer/index.html
 * If the source is missing (e.g. CI without the sibling repo), we warn and skip
 * so the build doesn't fail — a previously-copied snapshot stays in place.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const DEST = path.join(ROOT, 'public', 'specviewer.html')

// Candidate source locations (first existing wins)
const CANDIDATES = [
  path.join(ROOT, '..', 'UXspecviewer', 'Spec viewer', 'index.html'),
  path.join(ROOT, '..', 'UXspecviewer', 'index.html'),
]

const src = CANDIDATES.find(p => fs.existsSync(p))

if (!src) {
  const exists = fs.existsSync(DEST)
  console.warn(
    `[copy-specviewer] source not found in:\n` +
    CANDIDATES.map(p => `  - ${p}`).join('\n') +
    `\n[copy-specviewer] ${exists ? 'keeping existing public/specviewer.html' : 'NO snapshot present — spec viewer will be unavailable'}`
  )
  process.exit(0)
}

fs.mkdirSync(path.dirname(DEST), { recursive: true })
fs.copyFileSync(src, DEST)
console.log(`[copy-specviewer] copied\n  from ${src}\n  to   ${DEST}`)
