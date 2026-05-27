// HTML Export utility: renders markdown + TOC into a standalone HTML file
import { isWeb, readImageAsBlob } from '../api'
import { mdBlock, makeHeadingId } from './mdRenderer'

// Convert a blob URL or file path to a base64 data URL
async function toDataUrl(absPath) {
  if (isWeb) {
    const blobUrl = await readImageAsBlob(absPath)
    if (!blobUrl) return null
    const res = await fetch(blobUrl)
    const blob = await res.blob()
    return await new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.readAsDataURL(blob)
    })
  } else {
    // Electron: read file via IPC and convert to base64
    try {
      const { readImageBase64 } = await import('../api')
      return await readImageBase64(absPath)
    } catch { return null }
  }
}

// Replace ./relative image paths in markdown with base64 data URLs
async function embedImages(content, dir) {
  if (!dir) return content
  const pattern = /!\[([^\]]*)\]\(\.(\/[^)]*\.(?:png|jpg|jpeg|gif|webp|svg|bmp))\)/gi
  const matches = [...content.matchAll(pattern)]
  if (!matches.length) return content
  let result = content
  for (const m of matches) {
    const absPath = `${dir}/${m[2].slice(1)}`
    const dataUrl = await toDataUrl(absPath)
    if (dataUrl) result = result.replaceAll(m[0], `![${m[1]}](${dataUrl})`)
  }
  return result
}

const EXPORT_CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { font-size: 14px; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', sans-serif;
  color: #1a1f2e; background: #fff; display: flex; height: 100vh; overflow: hidden; }
/* TOC sidebar */
#toc { width: 240px; flex-shrink: 0; border-right: 1px solid #d1d9e0;
  overflow-y: auto; padding: 20px 0 20px 0; background: #f6f8fa; display: flex; flex-direction: column; }
#toc-title { font-size: 10.5px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.08em; color: #7a8799; padding: 0 14px 10px;
  border-bottom: 1px solid #d1d9e0; margin-bottom: 8px; }
.toc-item { display: block; padding: 3px 14px 3px 14px; font-size: 12.5px; color: #4a5568;
  text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.55; }
.toc-item:hover { background: #edf0f3; color: #0969da; }
.toc-item.active { background: #dbeafe; color: #0969da; font-weight: 500; }
/* Content area */
#content { flex: 1; overflow-y: auto; padding: 32px max(32px, calc(50% - 380px)); }
/* dp-* markdown styles */
.md-doc { font-family: 'Noto Sans KR', -apple-system, sans-serif; font-size: 13px; color: #1a1a18; line-height: 1.6; }
.dp-h1 { font-size: 20px; font-weight: 700; color: #1a1a18; margin: 28px 0 8px; padding-bottom: 8px; border-bottom: 2px solid #d0cec6; }
.dp-h2 { font-size: 15px; font-weight: 600; color: #1a1a18; margin: 20px 0 5px; padding-bottom: 4px; border-bottom: 1px solid #e4e2da; }
.dp-h3 { font-size: 13px; font-weight: 600; color: #1a1a18; margin: 14px 0 4px; }
.dp-h4 { font-size: 12px; font-weight: 600; color: #5f5e5a; margin: 10px 0 3px; }
.dp-h5, .dp-h6 { font-size: 11px; font-weight: 500; color: #a09e98; margin: 6px 0 2px; }
.dp-h1:first-child, .dp-h2:first-child { margin-top: 0; }
.dp-para { font-size: 13px; color: #5f5e5a; line-height: 1.7; margin: 0 0 8px; }
.dp-para:last-child { margin-bottom: 0; }
.dp-list { font-size: 13px; color: #5f5e5a; line-height: 1.7; margin: 0 0 8px; padding-left: 18px; }
.dp-list li { margin-bottom: 2px; }
.dp-quote { font-size: 13px; color: #a09e98; line-height: 1.6; margin: 0 0 8px; padding: 8px 12px; border-left: 3px solid #d0cec6; background: #fff; border-radius: 0 4px 4px 0; }
.dp-hr { border: none; border-top: 1px solid #e4e2da; margin: 14px 0; }
.dp-codeblock { background: #f2f1ed; border: 1px solid #e4e2da; border-radius: 6px; padding: 10px 12px; font-family: 'Cascadia Code', 'Fira Code', monospace; font-size: 12px; color: #1a1a18; overflow-x: auto; margin-bottom: 10px; white-space: pre; }
.dp-code { font-family: 'Cascadia Code', 'Fira Code', monospace; font-size: 11px; background: #f2f1ed; border: 1px solid #e4e2da; border-radius: 3px; padding: 1px 4px; color: #1a1a18; }
.dp-link { color: #0f4f8a; text-decoration: none; border-bottom: 1px solid #7BB8EE; }
.dp-link:hover { opacity: 0.75; }
.dp-block { margin-bottom: 14px; }
.dp-tbl { width: 100%; font-size: 12px; border-collapse: collapse; background: #fff; border: 1px solid #e4e2da; border-radius: 6px; overflow: hidden; }
.dp-tbl th { font-size: 11px; font-weight: 600; color: #a09e98; text-align: left; padding: 6px 10px; background: #f2f1ed; border-bottom: 1px solid #e4e2da; white-space: nowrap; }
.dp-tbl td { padding: 7px 10px; border-bottom: 1px solid #e4e2da; color: #1a1a18; vertical-align: top; line-height: 1.5; }
.dp-tbl tr:last-child td { border-bottom: none; }
.dp-tbl tr:hover td { background: #f9f8f5; }
.md-doc img { max-width: 100%; height: auto; border-radius: 4px; }
`

const EXPORT_JS = `
(function() {
  const content = document.getElementById('content')
  const tocItems = Array.from(document.querySelectorAll('.toc-item'))
  const headings = Array.from(document.querySelectorAll('[data-hidx]'))
  if (!headings.length) return
  let activeIdx = 0
  function updateActive(idx) {
    if (idx === activeIdx) return
    activeIdx = idx
    tocItems.forEach((el, i) => el.classList.toggle('active', i === idx))
    const active = tocItems[idx]
    if (active) active.scrollIntoView({ block: 'nearest' })
  }
  const observer = new IntersectionObserver(entries => {
    let best = null
    entries.forEach(e => {
      if (e.isIntersecting) {
        const i = parseInt(e.target.dataset.hidx, 10)
        if (!isNaN(i) && (best === null || i < best)) best = i
      }
    })
    if (best !== null) updateActive(best)
  }, { root: content, rootMargin: '-5% 0px -75% 0px', threshold: 0 })
  headings.forEach(el => observer.observe(el))
  tocItems.forEach((el, i) => {
    el.addEventListener('click', e => {
      e.preventDefault()
      headings[i]?.scrollIntoView({ behavior: 'smooth' })
    })
  })
  updateActive(0)
})()
`

export async function exportHtml({ content, title, headings, filePath }) {
  const dir = filePath?.replace(/[/\\][^/\\]+$/, '') || ''

  // Embed images as base64
  const processedContent = await embedImages(content, dir)

  // Render markdown to HTML
  const bodyHtml = mdBlock(processedContent)

  // Build TOC
  const tocHtml = headings.map((h, i) => {
    const indent = (h.level - 1) * 12
    return `<a class="toc-item" href="#${makeHeadingId(h.text)}" data-hidx="${i}" style="padding-left:${indent + 14}px">${h.text}</a>`
  }).join('\n')

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title || 'Export'}</title>
  <style>${EXPORT_CSS}</style>
</head>
<body>
  <nav id="toc">
    <div id="toc-title">목차</div>
    ${tocHtml}
  </nav>
  <main id="content">
    <div class="md-doc">${bodyHtml}</div>
  </main>
  <script>${EXPORT_JS}<\/script>
</body>
</html>`

  // Trigger download
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = (title || 'export').replace(/\.md$/, '') + '.html'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
