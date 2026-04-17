// Ported from D:/hi workspace/UXspecviewer/innk_manager_UXspec_standalone.html
// Functions: mdInline, parseHtmlTable, parseTblLines, mdBlock

export function mdInline(s) {
  if (!s) return ''
  return s
    .replace(/\\([-*_~`[\]()#!|])/g, '$1')
    .replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/gi, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/\*([^*\s][^*]*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="dp-code">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="dp-link">$1</a>')
}

export function parseHtmlTable(html) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const table = doc.querySelector('table')
    if (!table) return null
    const h = [], r = []
    table.querySelectorAll('tr').forEach(tr => {
      const ths = tr.querySelectorAll('th')
      const tds = tr.querySelectorAll('td')
      if (ths.length) ths.forEach(th => h.push(th.textContent.trim()))
      else if (tds.length) r.push(Array.from(tds).map(td => td.textContent.trim()))
    })
    return (h.length || r.length) ? { h, r } : null
  } catch (e) { return null }
}

export function parseTblLines(lines) {
  const tl = lines.filter(l => l.trim().startsWith('|'))
  if (tl.length < 3) return null
  const cells = l => l.split('|').slice(1, -1).map(c => c.trim())
  const h = cells(tl[0])
  const r = tl.slice(2).map(cells)
  return h.some(Boolean) ? { h, r } : null
}

// Convert all <table>...</table> HTML blocks in markdown to standard Markdown table syntax
export function normalizeHtmlTables(markdown) {
  return markdown.replace(/<table[\s\S]*?<\/table>/gi, (tableHtml) => {
    try {
      const doc = new DOMParser().parseFromString(tableHtml, 'text/html')
      const table = doc.querySelector('table')
      if (!table) return tableHtml

      const rows = Array.from(table.querySelectorAll('tr'))
      if (rows.length < 2) return tableHtml

      const processedRows = rows.map(row =>
        Array.from(row.querySelectorAll('th, td')).map(cell =>
          cell.textContent.trim()
            .replace(/\r?\n+/g, ' ')
            .replace(/\|/g, '\\|')
        )
      )

      const colCount = Math.max(...processedRows.map(r => r.length))
      const padded = processedRows.map(row => {
        const r = [...row]
        while (r.length < colCount) r.push('')
        return r
      })

      const header = padded[0]
      const sep = header.map(() => '---')
      const body = padded.slice(1)

      return [
        `| ${header.join(' | ')} |`,
        `| ${sep.join(' | ')} |`,
        ...body.map(r => `| ${r.join(' | ')} |`),
      ].join('\n')
    } catch {
      return tableHtml
    }
  })
}

export function mdBlock(md) {
  if (!md) return ''
  const lines = md.split('\n')
  let html = '', i = 0
  while (i < lines.length) {
    const l = lines[i].trimEnd()
    const tr = l.trim()
    if (!tr) { i++; continue }

    // HTML table (TipTap markdown export)
    if (/^<table/.test(tr)) {
      let tableHtml = ''
      while (i < lines.length) {
        tableHtml += lines[i] + '\n'
        if (lines[i].includes('</table>')) { i++; break }
        i++
      }
      const t = parseHtmlTable(tableHtml)
      if (t && (t.h.length || t.r.length)) {
        const hdrs = t.h.map(h => `<th>${mdInline(h)}</th>`).join('')
        const rows = t.r.map(row => `<tr>${row.map(c => `<td>${mdInline(c)}</td>`).join('')}</tr>`).join('')
        html += `<div class="dp-block"><table class="dp-tbl"><thead><tr>${hdrs}</tr></thead><tbody>${rows}</tbody></table></div>`
      }
      continue
    }

    // Code block
    if (/^```/.test(tr)) {
      const lang = tr.slice(3).trim()
      let code = ''; i++
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) { code += lines[i] + '\n'; i++ }
      if (i < lines.length) i++
      html += `<pre class="dp-codeblock"><code${lang ? ` class="language-${lang}"` : ''}>${
        code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      }</code></pre>`
      continue
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(tr)) { html += `<hr class="dp-hr">`; i++; continue }

    // Headings
    const hm = tr.match(/^(#{1,6})\s+(.+)/)
    if (hm) { html += `<div class="dp-h${hm[1].length}">${mdInline(hm[2])}</div>`; i++; continue }

    // Markdown table
    if (tr.startsWith('|') && i + 1 < lines.length && /^\|[\s\-:|]+\|/.test(lines[i + 1].trim())) {
      const tblLines = [lines[i++], lines[i++]]
      while (i < lines.length && lines[i].trim().startsWith('|')) tblLines.push(lines[i++])
      const t = parseTblLines(tblLines)
      if (t) {
        const hdrs = t.h.map(h => `<th>${mdInline(h)}</th>`).join('')
        const rows = t.r.map(row => `<tr>${row.map(c => `<td>${mdInline(c)}</td>`).join('')}</tr>`).join('')
        html += `<div class="dp-block"><table class="dp-tbl"><thead><tr>${hdrs}</tr></thead><tbody>${rows}</tbody></table></div>`
      }
      continue
    }

    // Standalone bold → table label if table follows, else bold paragraph
    if (/^\*\*[^*\n]+\*\*\s*$/.test(tr)) {
      const label = tr.replace(/^\*\*|\*\*$/g, '')
      let j = i + 1
      while (j < lines.length && !lines[j].trim()) j++
      const isLabel = j < lines.length && lines[j].trim().startsWith('|') &&
        j + 1 < lines.length && /^\|[\s\-:|]+\|/.test(lines[j + 1].trim())
      html += isLabel
        ? `<div class="dp-blabel">${mdInline(label)}</div>`
        : `<p class="dp-para"><strong>${mdInline(label)}</strong></p>`
      i++; continue
    }

    // Blockquote (recursive)
    if (/^>/.test(l)) {
      const bqLines = []
      while (i < lines.length && /^>/.test(lines[i])) { bqLines.push(lines[i].replace(/^>\s?/, '')); i++ }
      html += `<div class="dp-quote">${mdBlock(bqLines.join('\n'))}</div>`
      continue
    }

    // Unordered list
    if (/^[-*+] /.test(tr) && !/^\s/.test(l)) {
      html += '<ul class="dp-list">'
      while (i < lines.length && /^[-*+] /.test(lines[i].trim()) && !/^\s/.test(lines[i])) {
        const content = lines[i].replace(/^[-*+] /, ''); i++
        let sub = ''
        if (i < lines.length && /^\s{2,}[-*+] /.test(lines[i])) {
          sub = '<ul class="dp-list">'
          while (i < lines.length && /^\s{2,}[-*+] /.test(lines[i])) {
            sub += `<li>${mdInline(lines[i].replace(/^\s+[-*+] /, ''))}</li>`; i++
          }
          sub += '</ul>'
        }
        html += `<li>${mdInline(content)}${sub}</li>`
      }
      html += '</ul>'; continue
    }

    // Ordered list
    if (/^\d+[.)]\s/.test(tr) && !/^\s/.test(l)) {
      html += '<ol class="dp-list">'
      while (i < lines.length && /^\d+[.)]\s/.test(lines[i].trim()) && !/^\s/.test(lines[i])) {
        const content = lines[i].replace(/^\d+[.)]\s/, ''); i++
        let sub = ''
        if (i < lines.length && /^\s{2,}\d+[.)]\s/.test(lines[i])) {
          sub = '<ol class="dp-list">'
          while (i < lines.length && /^\s{2,}\d+[.)]\s/.test(lines[i])) {
            sub += `<li>${mdInline(lines[i].replace(/^\s+\d+[.)]\s/, ''))}</li>`; i++
          }
          sub += '</ol>'
        }
        html += `<li>${mdInline(content)}${sub}</li>`
      }
      html += '</ol>'; continue
    }

    // Paragraph
    const si = i
    let para = ''
    while (i < lines.length) {
      const c = lines[i].trimEnd(), ct = c.trim()
      if (!ct || /^>/.test(c) || /^[-*+] /.test(ct) || /^\d+[.)]\s/.test(ct) ||
        ct.startsWith('|') || ct.startsWith('<table') ||
        /^\*\*[^*\n]+\*\*\s*$/.test(ct) || /^#{1,}/.test(ct) ||
        /^```/.test(ct) || /^(-{3,}|\*{3,}|_{3,})$/.test(ct)) break
      para += (para ? ' ' : '') + c; i++
    }
    if (para) html += `<p class="dp-para">${mdInline(para)}</p>`
    else if (i === si) i++
  }
  return html || `<p class="dp-para">${mdInline(md)}</p>`
}
