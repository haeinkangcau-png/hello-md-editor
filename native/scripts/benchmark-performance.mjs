#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(here, '../..')
const distDir = join(root, 'dist')
const appBin = join(root, 'release/Hi MD Power.app/Contents/MacOS/HiMDPower')
const launchLog = join(process.env.HOME || tmpdir(), 'Library/Logs/HiMDPower/launch.log')
const chromeBin = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const shouldBuild = process.argv.includes('--build')
const runsArg = process.argv.find(arg => arg.startsWith('--runs='))
const runs = Math.max(1, Number(runsArg?.split('=')[1] || 3))
const loadFilesArg = process.argv.find(arg => arg.startsWith('--load-files='))
const loadFileCount = Math.max(1, Number(loadFilesArg?.split('=')[1] || 12))
const skipLoadBenchmark = process.argv.includes('--no-load')

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    ...options,
  })
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed with ${result.status}`)
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function mime(path) {
  switch (extname(path).toLowerCase()) {
    case '.html': return 'text/html'
    case '.js': return 'text/javascript'
    case '.css': return 'text/css'
    case '.svg': return 'image/svg+xml'
    case '.json': return 'application/json'
    default: return 'application/octet-stream'
  }
}

function parsePs() {
  const out = spawnSync('ps', ['-axo', 'pid=,ppid=,rss=,command='], { encoding: 'utf8' }).stdout
  const rows = new Map()
  for (const line of out.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/)
    if (!match) continue
    const [, pid, ppid, rss, command] = match
    rows.set(Number(pid), { pid: Number(pid), ppid: Number(ppid), rssKb: Number(rss), command })
  }
  return rows
}

function newProcesses(before, after, predicate) {
  return [...after.values()].filter(proc => !before.has(proc.pid) && predicate(proc))
}

function sumRssMb(processes) {
  return processes.reduce((sum, proc) => sum + proc.rssKb, 0) / 1024
}

function killProcesses(processes) {
  for (const proc of processes.sort((a, b) => b.pid - a.pid)) {
    try { process.kill(proc.pid, 'SIGTERM') } catch {}
  }
}

function safeRm(path) {
  try { rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) } catch {}
}

function waitForFileMatch(path, regex, timeoutMs) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
      const match = text.match(regex)
      if (match) return resolve({ match, text })
      if (Date.now() - started > timeoutMs) {
        return reject(new Error(`Timed out waiting for ${regex} in ${path}`))
      }
      setTimeout(tick, 50)
    }
    tick()
  })
}

function waitForLogCount(path, regex, count, timeoutMs) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
      const matches = [...text.matchAll(regex)]
      if (matches.length >= count) return resolve({ matches, text })
      if (Date.now() - started > timeoutMs) {
        return reject(new Error(`Timed out waiting for ${count} matches of ${regex} in ${path}; saw ${matches.length}`))
      }
      setTimeout(tick, 50)
    }
    tick()
  })
}

function createBenchmarkFiles(count) {
  const dir = mkdtempSync(join(tmpdir(), 'himd-md-load-'))
  const profiles = [
    { label: 'small', sections: 8, paragraphRepeats: 2 },
    { label: 'medium', sections: 45, paragraphRepeats: 4 },
    { label: 'large', sections: 130, paragraphRepeats: 7 },
  ]

  const files = []
  for (let index = 0; index < count; index += 1) {
    const profile = profiles[index % profiles.length]
    const name = `bench-${String(index + 1).padStart(2, '0')}-${profile.label}.md`
    const filePath = join(dir, name)
    const content = makeMarkdownFixture(name, profile)
    writeFileSync(filePath, content)
    files.push({
      path: filePath,
      name,
      sizeKb: statSync(filePath).size / 1024,
      profile: profile.label,
    })
  }

  return { dir, files }
}

function makeMarkdownFixture(name, profile) {
  const lines = [
    `# ${name}`,
    '',
    '이 문서는 Hi MD Power 다중 파일 로드 벤치마크를 위한 deterministic markdown fixture입니다.',
    '',
  ]

  for (let section = 1; section <= profile.sections; section += 1) {
    lines.push(`## Section ${section}`)
    for (let repeat = 0; repeat < profile.paragraphRepeats; repeat += 1) {
      lines.push(`- item ${section}.${repeat}: markdown editor load, parse, render, toc update, recent file update, and state transition benchmark text.`)
      lines.push(`본문 ${section}.${repeat}: 날짜 2026-07-01, 표/목록/링크 [example](https://example.com), inline code \`const value = ${section * repeat}\`.`)
    }
    lines.push('')
    if (section % 5 === 0) {
      lines.push('| 컬럼 A | 컬럼 B | 컬럼 C |')
      lines.push('|---|---:|---|')
      lines.push(`| ${section} | ${section * 3} | table row for rendering cost |`)
      lines.push('')
    }
    if (section % 7 === 0) {
      lines.push('```js')
      lines.push(`function section${section}() { return ${section}; }`)
      lines.push('```')
      lines.push('')
    }
  }

  return lines.join('\n')
}

async function serveDist() {
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const rawPath = url.pathname === '/' ? '/index.html' : url.pathname
      const filePath = resolve(distDir, decodeURIComponent(rawPath.slice(1)))
      if (!filePath.startsWith(resolve(distDir))) {
        res.writeHead(403)
        res.end('Forbidden')
        return
      }
      const data = readFileSync(filePath)
      res.writeHead(200, { 'Content-Type': mime(filePath), 'Cache-Control': 'no-store' })
      res.end(data)
    } catch {
      res.writeHead(404)
      res.end('Not found')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return { server, port: address.port }
}

async function fetchJson(url, timeoutMs = 5000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.json()
    } catch {}
    await sleep(50)
  }
  throw new Error(`Timed out fetching ${url}`)
}

async function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  let nextId = 1
  const pending = new Map()
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    }
  })

  return {
    send(method, params = {}) {
      const id = nextId++
      ws.send(JSON.stringify({ id, method, params }))
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    },
    close() {
      ws.close()
    },
  }
}

async function benchmarkChrome() {
  if (!existsSync(chromeBin)) throw new Error(`Chrome not found at ${chromeBin}`)

  const { server, port } = await serveDist()
  const debugPort = 9300 + Math.floor(Math.random() * 400)
  const userDataDir = mkdtempSync(join(tmpdir(), 'himd-chrome-'))
  const before = parsePs()
  const chrome = spawn(chromeBin, [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--disable-gpu',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] })

  try {
    const tabs = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`)
    const page = tabs.find(tab => tab.type === 'page') || tabs[0]
    const cdp = await cdpConnect(page.webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    const url = `http://127.0.0.1:${port}/index.html`
    await cdp.send('Page.navigate', { url })

    let rootReadyMs = null
    const started = Date.now()
    while (Date.now() - started < 10000) {
      const result = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const root = document.getElementById('root');
          return {
            href: location.href,
            readyState: document.readyState,
            rootChildCount: root ? root.childElementCount : -1,
            textLength: document.body ? document.body.innerText.length : 0,
            now: performance.now()
          };
        })();`,
      })
      const value = result.result.value
      if (value?.rootChildCount > 0) {
        rootReadyMs = value.now
        break
      }
      await sleep(50)
    }
    if (rootReadyMs == null) throw new Error('Chrome did not mount React root')

    await sleep(1000)
    const after = parsePs()
    const processes = newProcesses(before, after, proc =>
      proc.command.includes('Google Chrome') || proc.command.includes(userDataDir)
    )

    cdp.close()
    return {
      target: 'React build in Chrome headless',
      rootReadyMs,
      rssMb: sumRssMb(processes),
      processCount: processes.length,
      notes: `production dist over localhost:${port}`,
      cleanup: () => {
        killProcesses(processes)
        try { process.kill(chrome.pid, 'SIGTERM') } catch {}
        server.close()
        safeRm(userDataDir)
      },
    }
  } catch (error) {
    try { process.kill(chrome.pid, 'SIGTERM') } catch {}
    server.close()
    safeRm(userDataDir)
    throw error
  }
}

function makeElectronShim(files) {
  const fileMap = Object.fromEntries(files.map(file => [file.path, readFileSync(file.path, 'utf8')]))
  return `
(() => {
  const files = ${JSON.stringify(fileMap)};
  let openFileCallback = null;
  window.electronAPI = {
    listFiles: async () => ({ items: [], dir: '' }),
    readFile: async path => {
      if (!Object.prototype.hasOwnProperty.call(files, path)) throw new Error('Benchmark file not found: ' + path);
      return { content: files[path], path };
    },
    writeFile: async (path, content) => { files[path] = content; return { success: true, path }; },
    checkExists: async path => Object.prototype.hasOwnProperty.call(files, path),
    openFolder: async () => null,
    saveDialog: async () => null,
    captureAndCopy: async () => ({ success: true }),
    captureFullHtml: async () => ({ success: true }),
    revealInExplorer: async () => ({ success: true }),
    openPath: async () => ({ success: true }),
    createFolder: async () => ({ success: true }),
    renameFile: async () => ({ success: true }),
    saveImage: async () => ({ success: true }),
    cleanupImages: async () => ({ deleted: [] }),
    copyAssets: async () => ({ success: true }),
    readImageBase64: async () => null,
    getOpenFilePath: async () => null,
    openNewWindow: async () => null,
    openScheduleWindow: async () => null,
    openSpecWindow: async () => null,
    onOpenFile: cb => {
      openFileCallback = cb;
      window.__himdBenchOpenFile = path => {
        if (!openFileCallback) throw new Error('Open file callback is not ready');
        openFileCallback(path);
      };
      return () => {
        if (openFileCallback === cb) openFileCallback = null;
      };
    }
  };
})();
`
}

async function benchmarkChromeFileLoads(files) {
  if (!existsSync(chromeBin)) throw new Error(`Chrome not found at ${chromeBin}`)

  const { server, port } = await serveDist()
  const debugPort = 9300 + Math.floor(Math.random() * 400)
  const userDataDir = mkdtempSync(join(tmpdir(), 'himd-chrome-load-'))
  const before = parsePs()
  const chrome = spawn(chromeBin, [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--disable-gpu',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] })

  try {
    const tabs = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`)
    const page = tabs.find(tab => tab.type === 'page') || tabs[0]
    const cdp = await cdpConnect(page.webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: makeElectronShim(files) })
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` })

    const started = Date.now()
    while (Date.now() - started < 10000) {
      const result = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => ({
          rootReady: (document.getElementById('root')?.childElementCount || 0) > 0,
          callbackReady: typeof window.__himdBenchOpenFile === 'function',
        }))();`,
      })
      const value = result.result.value
      if (value?.rootReady && value?.callbackReady) break
      await sleep(50)
    }

    const afterRoot = parsePs()
    const rootProcesses = newProcesses(before, afterRoot, proc =>
      proc.command.includes('Google Chrome') || proc.command.includes(userDataDir)
    )
    const rssBeforeLoadMb = sumRssMb(rootProcesses)

    const sequenceResult = await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `
(async () => {
  const files = ${JSON.stringify(files.map(file => ({ path: file.path, name: file.name, sizeKb: file.sizeKb, profile: file.profile })))};
  const waitForTitle = expectedTitle => new Promise((resolve, reject) => {
    const startedWall = Date.now();
    const poll = () => {
      if (document.title === expectedTitle) resolve();
      else if (Date.now() - startedWall > 10000) reject(new Error('Timed out waiting for ' + expectedTitle));
      else requestAnimationFrame(poll);
    };
    poll();
  });
  const results = [];
  for (const file of files) {
    const started = performance.now();
    window.__himdBenchOpenFile(file.path);
    await waitForTitle(file.name + ' — Hi MD Editor');
    results.push({ ...file, ms: performance.now() - started });
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  return results;
})();
`,
    })

    await sleep(500)
    const afterLoads = parsePs()
    const loadProcesses = newProcesses(before, afterLoads, proc =>
      proc.command.includes('Google Chrome') || proc.command.includes(userDataDir)
    )

    cdp.close()
    return {
      target: 'React build in Chrome headless',
      files: sequenceResult.result.value,
      rssBeforeLoadMb,
      rssAfterLoadMb: sumRssMb(loadProcesses),
      processCount: loadProcesses.length,
      notes: `electronAPI shim over localhost:${port}`,
      cleanup: () => {
        killProcesses(loadProcesses)
        try { process.kill(chrome.pid, 'SIGTERM') } catch {}
        server.close()
        safeRm(userDataDir)
      },
    }
  } catch (error) {
    try { process.kill(chrome.pid, 'SIGTERM') } catch {}
    server.close()
    safeRm(userDataDir)
    throw error
  }
}

async function benchmarkNative() {
  if (!existsSync(appBin)) throw new Error(`Native app not found at ${appBin}`)

  writeFileSync(launchLog, '')
  const before = parsePs()
  const native = spawn(appBin, [], { stdio: ['ignore', 'ignore', 'ignore'] })
  const { match } = await waitForFileMatch(launchLog, /Native bench: root-ready-ms ([\d.]+)/, 10000)
  const rootReadyMs = Number(match[1])
  await sleep(1000)

  const after = parsePs()
  const processes = newProcesses(before, after, proc =>
    proc.pid === native.pid ||
    proc.command.includes('HiMDPower') ||
    proc.command.includes('Hi MD Power.app') ||
    proc.command.includes('com.apple.WebKit.')
  )

  return {
    target: 'Native WKWebView shell',
    rootReadyMs,
    rssMb: sumRssMb(processes),
    processCount: processes.length,
    notes: 'production dist via himd-app:// custom scheme',
    cleanup: () => {
      killProcesses(processes)
      try { process.kill(native.pid, 'SIGTERM') } catch {}
    },
  }
}

async function benchmarkNativeFileLoads(files) {
  if (!existsSync(appBin)) throw new Error(`Native app not found at ${appBin}`)

  const listFile = join(tmpdir(), `himd-native-load-${process.pid}-${Date.now()}.txt`)
  writeFileSync(listFile, files.map(file => file.path).join('\n'))
  writeFileSync(launchLog, '')
  const before = parsePs()
  const native = spawn(appBin, [], {
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, HIMD_BENCH_FILE_LIST: listFile },
  })

  try {
    await waitForFileMatch(launchLog, /Native bench: root-ready-ms ([\d.]+)/, 10000)
    const afterRoot = parsePs()
    const rootProcesses = newProcesses(before, afterRoot, proc =>
      proc.pid === native.pid ||
      proc.command.includes('HiMDPower') ||
      proc.command.includes('Hi MD Power.app') ||
      proc.command.includes('com.apple.WebKit.')
    )
    const rssBeforeLoadMb = sumRssMb(rootProcesses)

    const { matches } = await waitForLogCount(launchLog, /Native bench:file-ready-ms (\S+) ([\d.]+)/g, files.length, 60000)
    await sleep(500)
    const afterLoads = parsePs()
    const loadProcesses = newProcesses(before, afterLoads, proc =>
      proc.pid === native.pid ||
      proc.command.includes('HiMDPower') ||
      proc.command.includes('Hi MD Power.app') ||
      proc.command.includes('com.apple.WebKit.')
    )

    const byName = new Map(files.map(file => [file.name, file]))
    const loadedFiles = matches.slice(0, files.length).map(match => {
      const file = byName.get(match[1]) || { name: match[1], path: '', sizeKb: 0, profile: 'unknown' }
      return { ...file, ms: Number(match[2]) }
    })

    return {
      target: 'Native WKWebView shell',
      files: loadedFiles,
      rssBeforeLoadMb,
      rssAfterLoadMb: sumRssMb(loadProcesses),
      processCount: loadProcesses.length,
      notes: 'native readFile bridge via benchmark file list',
      cleanup: () => {
        killProcesses(loadProcesses)
        try { process.kill(native.pid, 'SIGTERM') } catch {}
        safeRm(listFile)
      },
    }
  } catch (error) {
    try { process.kill(native.pid, 'SIGTERM') } catch {}
    safeRm(listFile)
    throw error
  }
}

function bundleSizeMb(path) {
  const out = spawnSync('du', ['-sk', path], { encoding: 'utf8' }).stdout.trim()
  const kb = Number(out.split(/\s+/)[0])
  return kb / 1024
}

function printTable(results) {
  const rawRows = results.map(r => ({
    Run: String(r.run),
    Target: r.target,
    'Root Ready': `${r.rootReadyMs.toFixed(1)} ms`,
    'RSS After Ready': `${r.rssMb.toFixed(1)} MB`,
    Processes: String(r.processCount),
    Notes: r.notes,
  }))
  console.log('\nRaw runs')
  console.table(rawRows)

  const groups = Map.groupBy(results, r => r.target)
  const summaryRows = [...groups.entries()].map(([target, rows]) => ({
    Target: target,
    Runs: String(rows.length),
    'Avg Root Ready': `${avg(rows.map(r => r.rootReadyMs)).toFixed(1)} ms`,
    'Avg RSS': `${avg(rows.map(r => r.rssMb)).toFixed(1)} MB`,
    'Avg Processes': avg(rows.map(r => r.processCount)).toFixed(1),
    Notes: rows[0].notes,
  }))
  console.log('\nSummary')
  console.table(summaryRows)
  console.log(`dist size: ${bundleSizeMb(distDir).toFixed(1)} MB`)
  console.log(`native .app size: ${bundleSizeMb(join(root, 'release/Hi MD Power.app')).toFixed(1)} MB`)
}

function printLoadTable(results, fixture) {
  const rows = results.map(result => {
    const times = result.files.map(file => file.ms)
    return {
      Target: result.target,
      Files: String(result.files.length),
      'Total Load': `${times.reduce((sum, value) => sum + value, 0).toFixed(1)} ms`,
      Avg: `${avg(times).toFixed(1)} ms`,
      P50: `${percentile(times, 0.5).toFixed(1)} ms`,
      P95: `${percentile(times, 0.95).toFixed(1)} ms`,
      Max: `${Math.max(...times).toFixed(1)} ms`,
      'RSS Before': `${result.rssBeforeLoadMb.toFixed(1)} MB`,
      'RSS After': `${result.rssAfterLoadMb.toFixed(1)} MB`,
      'RSS Delta': `${(result.rssAfterLoadMb - result.rssBeforeLoadMb).toFixed(1)} MB`,
      Processes: String(result.processCount),
      Notes: result.notes,
    }
  })

  console.log('\nMulti-file load summary')
  console.table(rows)

  const fixtureRows = fixture.files.map(file => ({
    Name: file.name,
    Profile: file.profile,
    Size: `${file.sizeKb.toFixed(1)} KB`,
  }))
  console.log('\nFixture files')
  console.table(fixtureRows)
}

function avg(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)
  return sorted[index]
}

async function main() {
  if (shouldBuild) run('bash', ['native/scripts/build-mac-native-app.sh'])
  if (!existsSync(join(distDir, 'index.html'))) {
    throw new Error('dist/index.html missing; run `bash native/scripts/build-mac-native-app.sh` first')
  }

  const results = []
  for (let runNumber = 1; runNumber <= runs; runNumber += 1) {
    const chrome = await benchmarkChrome()
    results.push({ ...chrome, run: runNumber })
    chrome.cleanup()
    await sleep(500)

    const native = await benchmarkNative()
    results.push({ ...native, run: runNumber })
    native.cleanup()
    await sleep(500)
  }

  printTable(results)

  if (!skipLoadBenchmark) {
    const fixture = createBenchmarkFiles(loadFileCount)
    const loadResults = []
    const cleanups = []
    try {
      const chromeLoad = await benchmarkChromeFileLoads(fixture.files)
      loadResults.push(chromeLoad)
      cleanups.push(chromeLoad.cleanup)
      chromeLoad.cleanup()
      cleanups.pop()
      await sleep(500)

      const nativeLoad = await benchmarkNativeFileLoads(fixture.files)
      loadResults.push(nativeLoad)
      cleanups.push(nativeLoad.cleanup)
      nativeLoad.cleanup()
      cleanups.pop()

      printLoadTable(loadResults, fixture)
    } finally {
      for (const cleanup of cleanups.reverse()) cleanup()
      safeRm(fixture.dir)
    }
  }
}

main().catch(error => {
  console.error(error.stack || error.message)
  process.exit(1)
})
