#!/usr/bin/env node
// 루트 package.json의 version을 네이티브 셸 설정에 전파한다.
// 대상: native/windows/src-tauri/tauri.conf.json, native/windows/src-tauri/Cargo.toml,
//       native/windows/package.json
// 릴리스 태깅 전에 실행할 것 (native support plan.md Phase 5).
//   node native/scripts/sync-version.mjs        # 적용
//   node native/scripts/sync-version.mjs --check # 검사만 (불일치 시 exit 1)

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const checkOnly = process.argv.includes('--check')

const version = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version
let mismatched = 0

function sync(relPath, replace) {
  const abs = resolve(ROOT, relPath)
  const before = readFileSync(abs, 'utf8')
  const after = replace(before)
  if (before === after) {
    console.log(`ok      ${relPath}`)
    return
  }
  mismatched++
  if (checkOnly) {
    console.log(`STALE   ${relPath}`)
  } else {
    writeFileSync(abs, after)
    console.log(`updated ${relPath} -> ${version}`)
  }
}

sync('native/windows/src-tauri/tauri.conf.json', (s) =>
  s.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`))

sync('native/windows/package.json', (s) =>
  s.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`))

sync('native/windows/src-tauri/Cargo.toml', (s) =>
  s.replace(/^(version = ")[^"]+(")/m, `$1${version}$2`))

// Cargo.lock의 자체 패키지 항목도 맞춰 준다 (cargo가 자동 갱신하지만 diff 소음 방지).
sync('native/windows/src-tauri/Cargo.lock', (s) =>
  s.replace(/(name = "hi-md-editor"\r?\nversion = ")[^"]+(")/, `$1${version}$2`))

if (checkOnly && mismatched > 0) {
  console.error(`\n${mismatched} file(s) out of sync with package.json version ${version}`)
  process.exit(1)
}
