#!/usr/bin/env node
/**
 * Electron launcher — strips ELECTRON_RUN_AS_NODE from the environment
 * so Electron runs as a proper GUI app, not in Node.js-compatible mode.
 * This is needed when launched from inside VS Code (which sets ELECTRON_RUN_AS_NODE=1).
 */
const { spawn } = require('child_process')
const path = require('path')

const electronBin = require(path.join(__dirname, '../node_modules/electron'))

// Build clean env: remove ELECTRON_RUN_AS_NODE, add NODE_ENV
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.NODE_ENV = 'development'

const appDir = path.join(__dirname, '..')
const child = spawn(electronBin, [appDir], {
  stdio: 'inherit',
  windowsHide: false,
  env,
})

child.on('close', (code, signal) => {
  if (code === null) {
    console.error('Electron exited with signal', signal)
    process.exit(1)
  }
  process.exit(code)
})

process.on('SIGINT',  () => { if (!child.killed) child.kill('SIGINT') })
process.on('SIGTERM', () => { if (!child.killed) child.kill('SIGTERM') })
