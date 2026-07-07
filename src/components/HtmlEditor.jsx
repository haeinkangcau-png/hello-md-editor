import React, { useState, useRef, useEffect, useCallback, useMemo, useImperativeHandle, forwardRef } from 'react'
import { openPath, IMG_BASE } from '../api'

const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }
const escHtml = (s) => s.replace(/[&<>]/g, (c) => HTML_ESC[c])

// HTML 소스를 토큰(태그/주석/스크립트·스타일 코드/텍스트)으로 나눠 색칠한 <code> 내용 문자열을 만든다.
// hit({start,end})가 있으면 그 구간을 <mark>로 감싼다. 실제 화면에 보이는 텍스트(tok-text)와
// 마크업/코드를 시각적으로 분리하는 것이 목적.
function highlightHtml(src, marks = [], collapse = false, expanded = null, editable = false) {
  const tokens = []
  const len = src.length
  let i = 0
  let raw = null // script/style 내부일 때 찾을 종료 태그(소문자, '>' 제외)
  while (i < len) {
    if (raw) {
      const close = src.toLowerCase().indexOf(raw, i)
      const end = close === -1 ? len : close
      if (end > i) {
        const kind = raw.slice(2)
        if (kind === 'script') {
          // script 본문을 줄 단위 토큰으로 분할 → 편집·하이라이트가 세밀해짐(거대한 단일 span 방지)
          const body = src.slice(i, end)
          const lines = body.split('\n')
          let off = i
          lines.forEach((ln, li) => {
            const seg = li < lines.length - 1 ? ln + '\n' : ln
            if (seg.length) tokens.push({ type: 'code', start: off, text: seg, raw: kind })
            off += seg.length
          })
        } else {
          // style 본문은 통째로(접힘 뷰에서 하나의 칩으로)
          tokens.push({ type: 'code', start: i, text: src.slice(i, end), raw: kind })
        }
      }
      i = end
      raw = null
      continue
    }
    if (src[i] === '<') {
      if (src.startsWith('<!--', i)) {
        const c = src.indexOf('-->', i)
        const end = c === -1 ? len : c + 3
        tokens.push({ type: 'comment', start: i, text: src.slice(i, end) })
        i = end
        continue
      }
      const gt = src.indexOf('>', i)
      const end = gt === -1 ? len : gt + 1
      const tagText = src.slice(i, end)
      tokens.push({ type: 'tag', start: i, text: tagText })
      const m = /^<\s*(script|style)(\s|>|\/)/i.exec(tagText)
      if (m && !/\/>\s*$/.test(tagText)) raw = '</' + m[1].toLowerCase()
      i = end
      continue
    }
    const lt = src.indexOf('<', i)
    const end = lt === -1 ? len : lt
    tokens.push({ type: 'text', start: i, text: src.slice(i, end) })
    i = end
  }

  const clsMap = { tag: 'tok-tag', comment: 'tok-comment', code: 'tok-code', text: 'tok-text' }
  let out = ''
  for (const t of tokens) {
    const cls = clsMap[t.type]
    const ts = t.start, te = ts + t.text.length
    // 선택(마크)이 이 토큰 안에 있거나, 사용자가 개별 펼친 토큰은 접지 않는다
    const overlapsMark = marks.length > 0 && marks.some(mk => mk.end > ts && mk.start < te)
    const isExpanded = expanded && expanded.has(ts)
    // 읽기 전용 축약 모드: 태그·속성/style 본문을 클릭 가능한 칩으로 접는다(텍스트·주석·script는 그대로).
    if (collapse && !overlapsMark && !isExpanded && (t.type === 'tag' || (t.type === 'code' && t.raw === 'style'))) {
      const chip = `<span class="fold-chip" data-s="${ts}" title="클릭하여 펼치기">…</span>`
      if (t.type === 'tag') {
        const m = /^<\s*(\/?)\s*([a-zA-Z][\w:-]*)([\s\S]*?)(\/?)\s*>$/.exec(t.text)
        if (m) {
          const [, slash, name, attrs, selfClose] = m
          if (slash) {
            out += `<span class="${cls}">${escHtml(`</${name}>`)}</span>`
          } else if (attrs.trim()) {
            // <button id=".." ..> → <button […]>  ([…] = 펼치기 칩)
            out += `<span class="${cls}">${escHtml(`<${name} `)}${chip}${escHtml(`${selfClose ? ' /' : ''}>`)}</span>`
          } else {
            out += `<span class="${cls}">${escHtml(`<${name}${selfClose ? ' /' : ''}>`)}</span>`
          }
        } else {
          out += `<span class="${cls}">${escHtml(t.text)}</span>`
        }
      } else {
        // <style> 본문 → 칩
        out += t.text.trim() ? `<span class="${cls}">${chip}</span>` : `<span class="${cls}">${escHtml(t.text)}</span>`
      }
      continue
    }
    // 편집(접힘) 뷰: 비-칩 토큰은 span 단위로 제자리 편집 가능
    const hitHere = marks.some(mk => mk.cls === 'html-loc-hit' && mk.end > ts && mk.start < te)
    const editAttr = (collapse && (editable || hitHere))
      ? ` contenteditable="true" spellcheck="false" data-s="${ts}" data-e="${te}"`
      : ''
    // 이 토큰과 겹치는 마크(검색/클릭 하이라이트)를 잘라서 삽입
    const local = []
    for (const mk of marks) {
      if (mk.end <= ts || mk.start >= te) continue
      local.push({ s: Math.max(mk.start, ts) - ts, e: Math.min(mk.end, te) - ts, cls: mk.cls })
    }
    if (!local.length) { out += `<span class="${cls}"${editAttr}>${escHtml(t.text)}</span>`; continue }
    local.sort((a, b) => a.s - b.s)
    let inner = '', pos = 0
    for (const lm of local) {
      if (lm.s < pos) continue // 겹치면 스킵
      inner += escHtml(t.text.slice(pos, lm.s))
      inner += `<mark class="${lm.cls}">${escHtml(t.text.slice(lm.s, lm.e))}</mark>`
      pos = lm.e
    }
    inner += escHtml(t.text.slice(pos))
    out += `<span class="${cls}"${editAttr}>${inner}</span>`
  }
  return out
}

// Extract headings from HTML string using DOMParser
function extractHeadings(html) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const els = doc.querySelectorAll('h1,h2,h3,h4,h5,h6')
    return Array.from(els).map((el, i) => ({
      level: parseInt(el.tagName[1], 10),
      text: el.textContent.trim(),
      pos: i,   // pos = index, used by scrollToHeading
    }))
  } catch { return [] }
}

const HtmlEditor = forwardRef(function HtmlEditor({ initialContent, filePath, onContentChange, onHeadingsChange }, ref) {
  const [mode] = useState('raw') // (레거시) 내부 편집 모드 — 항상 'raw'
  const [rawTextarea, setRawTextarea] = useState(initialContent)
  const [previewSrc, setPreviewSrc] = useState(initialContent)
  const [copyStatus, setCopyStatus] = useState(null) // null | 'copying' | 'copied'
  const [captureScale, setCaptureScale] = useState(2)
  const [captureWidth, setCaptureWidth] = useState('')  // '' = use iframe width

  // 뷰어/편집 상단 모드(설정 기억) — HTML은 기본 뷰어로 연다
  const [htmlView, setHtmlViewState] = useState(() => {
    try { return localStorage.getItem('html-view-mode') === 'edit' ? 'edit' : 'viewer' } catch { return 'viewer' }
  })
  const setHtmlView = useCallback((v) => {
    setHtmlViewState(v)
    try { localStorage.setItem('html-view-mode', v) } catch { /* ignore */ }
  }, [])
  const viewerIframeRef = useRef(null)

  const [hit, setHit] = useState(null) // { start, end } — 미리보기 클릭으로 찾은 소스 구간
  const [previewWidth, setPreviewWidth] = useState(50) // Raw 모드 좌측 미리보기 폭(%)
  const [dragging, setDragging] = useState(false)
  // 코드편집기 검색
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [currentIdx, setCurrentIdx] = useState(0)
  const searchInputRef = useRef(null)
  const [collapseStyle, setCollapseStyle] = useState(true) // 태그 접기(읽기 전용 축약 뷰) — 기본 ON
  const [expandedFolds, setExpandedFolds] = useState(() => new Set()) // 개별로 펼친 접힘 토큰들(소스 offset)

  const textIframeRef = useRef(null)
  const rawPreviewRef = useRef(null)
  const rawTextareaRef = useRef(null)
  const rawHighlightRef = useRef(null)
  const rawModeRef = useRef(null)
  const rawContentRef = useRef(initialContent) // tracks latest content across mode switches
  const debounceRef = useRef(null)
  const copyTimerRef = useRef(null)
  const previewScrollRef = useRef({ x: 0, y: 0 }) // 미리보기 리로드 시 스크롤 위치 보존

  // 검색 매치(대소문자 무시, 리터럴)
  const searchMatches = useMemo(() => {
    if (!searchOpen || !query) return []
    const res = []
    const q = query.toLowerCase()
    const hay = rawTextarea.toLowerCase()
    let i = 0
    while (i <= hay.length) {
      const idx = hay.indexOf(q, i)
      if (idx === -1) break
      res.push({ start: idx, end: idx + q.length })
      i = idx + q.length
    }
    return res
  }, [searchOpen, query, rawTextarea])

  const highlighted = useMemo(() => {
    const marks = []
    if (hit) marks.push({ start: hit.start, end: hit.end, cls: 'html-loc-hit' })
    // 검색 마크는 태그 오프셋이 달라지는 접힘 모드에선 생략(텍스트 hit은 그대로 표시됨)
    if (!collapseStyle) {
      searchMatches.forEach((mm, i) =>
        marks.push({ start: mm.start, end: mm.end, cls: i === currentIdx ? 'search-current' : 'search-hit' }))
    }
    marks.sort((a, b) => a.start - b.start)
    // 접힘 뷰에선 모든 비-칩 텍스트를 항상 편집 가능하게 한다(그냥 클릭해서 편하게 편집)
    return highlightHtml(rawTextarea, marks, collapseStyle, expandedFolds, collapseStyle)
  }, [rawTextarea, hit, searchMatches, currentIdx, collapseStyle, expandedFolds])

  // 미리보기용 문서:
  //  1) 상대경로 리소스(이미지 등)를 이 HTML 파일 폴더 기준으로 해석하도록 <base> 주입(local-image://)
  //  2) 앵커 클릭 가드 — base 때문에 '#책갈피'나 링크 클릭이 iframe을 이동시켜 하얗게 되는 것 방지
  //     (책갈피는 스크롤, 나머지 링크는 이동 차단; 미리보기는 렌더링 전용)
  const previewDoc = useMemo(() => {
    if (!filePath || !window.electronAPI) return previewSrc
    const dir = filePath.replace(/\\/g, '/').replace(/\/[^/]+$/, '')
    const base = `<base href="${IMG_BASE}${dir}/">`
    const guard = '<script>(function(){document.addEventListener("click",function(e){'
      + 'var a=e.target&&e.target.closest?e.target.closest("a"):null;if(!a)return;'
      + 'var h=a.getAttribute("href")||"";'
      + 'if(h.charAt(0)==="#"){e.preventDefault();var id=decodeURIComponent(h.slice(1));'
      + 'var t=id&&(document.getElementById(id)||document.getElementsByName(id)[0]);'
      + 'if(t)t.scrollIntoView({behavior:"smooth",block:"start"});}'
      + 'else if(h){e.preventDefault();}'
      + '},true);})();<\/script>'

    let doc = previewSrc
    if (/<head[^>]*>/i.test(doc)) doc = doc.replace(/<head[^>]*>/i, (m) => m + base)
    else if (/<html[^>]*>/i.test(doc)) doc = doc.replace(/<html[^>]*>/i, (m) => m + '<head>' + base + '</head>')
    else doc = base + doc

    const bi = doc.toLowerCase().lastIndexOf('</body>')
    if (bi !== -1) doc = doc.slice(0, bi) + guard + doc.slice(bi)
    else doc += guard
    return doc
  }, [previewSrc, filePath])

  // ── Scroll to heading by index ─────────────────────────────
  useImperativeHandle(ref, () => ({
    scrollToHeading(idx) {
      const iframe = htmlView === 'viewer' ? viewerIframeRef.current : rawPreviewRef.current
      const doc = iframe?.contentDocument
      if (!doc) return
      const headingEls = doc.querySelectorAll('h1,h2,h3,h4,h5,h6')
      headingEls[idx]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    openSearch() { setHtmlView('edit'); setSearchOpen(true) }, // 검색은 편집 모드에서
  }), [htmlView, setHtmlView])

  // ── Copy full-page rendered HTML as PNG to clipboard ──────
  // Renders the HTML in a hidden Electron window sized to full content,
  // then captures and writes to clipboard — no viewport cropping.
  const handleCopyImage = useCallback(async () => {
    const iframe = mode === 'text' ? textIframeRef.current : rawPreviewRef.current
    if (!iframe) return

    if (!window.electronAPI) {
      alert('이미지 복사는 데스크탑 앱에서만 지원됩니다.')
      return
    }
    if (!window.electronAPI.captureFullHtml) {
      alert('앱을 재시작하면 이미지 복사를 사용할 수 있습니다.')
      return
    }

    setCopyStatus('copying')
    clearTimeout(copyTimerRef.current)

    try {
      const w = parseInt(captureWidth, 10)
      await window.electronAPI.captureFullHtml({
        html: rawContentRef.current,
        viewWidth: (w > 0 ? w : iframe.clientWidth),
        scale: captureScale,
      })
      setCopyStatus('copied')
      copyTimerRef.current = setTimeout(() => setCopyStatus(null), 2000)
    } catch (err) {
      setCopyStatus(null)
      alert('이미지 복사 실패: ' + (err.message || String(err)))
    }
  }, [mode, captureWidth, captureScale])

  // ── Raw 모드: 미리보기 클릭 → 소스 텍스트 위치로 포커싱 ──────
  // 렌더링된 텍스트는 소스에서 항상 `>...<` 사이에 있으므로, 그 경계를 기준으로
  // 정확히 매칭한다(더 긴 텍스트의 일부가 잘못 잡히는 것을 방지).
  const locateInSource = useCallback((target, occurrence, word) => {
    if (!target) return
    // 소스는 항상 최신값을 담은 rawContentRef에서 읽는다
    // (태그 접기 모드에선 textarea가 렌더되지 않아 rawTextareaRef가 null이므로)
    const src = rawContentRef.current
    if (!src) return
    const found = (start, end) => { setHit({ start, end }) } // 클릭 위치로 포커스·스크롤

    // 줄바꿈/들여쓰기/HTML 엔티티 차이를 허용하는 유연 패턴 생성
    const flexible = (text) => text
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '\\s+')
      .replace(/&/g, '(?:&|&amp;)')
      .replace(/</g, '(?:<|&lt;)')
      .replace(/>/g, '(?:>|&gt;)')

    // <script> 영역 — 폴백에서 JS 원본 문자열을 우선 잡기 위해
    const scriptRanges = []
    const sre = /<script\b[^>]*>([\s\S]*?)<\/script>/gi
    let sm
    while ((sm = sre.exec(src)) !== null) {
      const s0 = sm.index + sm[0].indexOf('>') + 1
      scriptRanges.push([s0, s0 + sm[1].length])
    }
    const inScript = (i) => scriptRanges.some(([a, b]) => i >= a && i < b)

    // 1) 정적 요소 텍스트: `>텍스트<` 경계로 정확히
    try {
      const re = new RegExp('>(\\s*)(' + flexible(target) + ')(\\s*)<', 'g')
      const bm = []
      let m
      while ((m = re.exec(src)) !== null) bm.push(m)
      if (bm.length && occurrence < bm.length) {
        const b = bm[occurrence]
        const start = b.index + 1 + b[1].length
        found(start, start + b[2].length)
        return
      }
      if (bm.length && !scriptRanges.length) { // 정적만 있고 넘치면 마지막 정적
        const b = bm[bm.length - 1]
        const start = b.index + 1 + b[1].length
        found(start, start + b[2].length)
        return
      }
    } catch { /* ignore */ }

    // 2) 폴백: 소스 어디서든(주로 JS로 생성되는 표/카드의 원본 문자열)
    const searchPlain = (text) => {
      let r
      try { r = new RegExp(flexible(text), 'g') } catch { return null }
      const all = []
      let m
      while ((m = r.exec(src)) !== null) {
        all.push(m)
        if (m.index === r.lastIndex) r.lastIndex++
      }
      if (!all.length) return null
      return all.find(mm => inScript(mm.index)) || all[0] // <script> 내부 우선
    }

    // 2) JS 데이터 값 우선: <script> 안에서 따옴표로 감싼 값('G1'/"G1")을 클릭 순서(occurrence)에 맞춰
    //    탐색 → 주석·산문의 맨텍스트(예: 주석 속 G1)를 건너뛰고 실제 데이터 값으로 이동
    const quotedPick = (text) => {
      const esc2 = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      let r
      try { r = new RegExp(`(['"])(${esc2})\\1`, 'g') } catch { return null }
      const all = []
      let m
      while ((m = r.exec(src)) !== null) { if (inScript(m.index)) all.push(m) }
      if (!all.length) return null
      const c = all[occurrence] || all[0]
      return { index: c.index + 1, length: text.length } // 여는 따옴표 다음(값 시작)
    }
    let qp = quotedPick(target)
    if (!qp && word && word !== target) qp = quotedPick(word)
    if (qp) { found(qp.index, qp.index + qp.length); return }

    // 3) 폴백: 소스 어디서든(주로 JS로 생성되는 표/카드의 원본 문자열)
    let pick = searchPlain(target)
    // 4) 날짜 등 계산값이 섞인 조합 문자열이면 앞부분(접두어)만으로 재시도
    if (!pick) {
      const prefix = target.replace(/\s+/g, ' ').trim().slice(0, 28).replace(/\s+\S*$/, '')
      if (prefix.length >= 4) pick = searchPlain(prefix)
    }
    // 5) 클릭한 "단어/값"만으로 <script> 안에서 찾기 (예: '0.09' → vol: '0.09')
    if (!pick && word && word.length >= 2 && word !== target) pick = searchPlain(word)
    if (!pick) return
    found(pick.index, pick.index + pick[0].length)
  }, [])

  // hit이 바뀌면: 접힘 뷰는 그 위치의 편집 span에 포커스+선택, 일반 뷰는 textarea 캐럿+스크롤
  useEffect(() => {
    if (!hit) return
    const hl = rawHighlightRef.current
    if (collapseStyle) {
      requestAnimationFrame(() => {
        const mark = hl?.querySelector('.html-loc-hit')
        if (!mark) return
        mark.scrollIntoView({ block: 'center' })
        const span = mark.closest('[contenteditable]')
        if (span) {
          span.focus()
          try {
            const sel = window.getSelection()
            const range = document.createRange()
            range.selectNodeContents(mark) // 선택 텍스트 전체 선택 → 바로 덮어쓰기/삭제
            sel.removeAllRanges()
            sel.addRange(range)
          } catch { /* ignore */ }
        }
      })
      return
    }
    const ta = rawTextareaRef.current
    if (!ta) return
    ta.focus()
    try { ta.setSelectionRange(hit.start, hit.start) } catch { /* range out of date */ }
    requestAnimationFrame(() => {
      const mark = hl?.querySelector('.html-loc-hit')
      if (!mark || !hl) return
      const mr = mark.getBoundingClientRect()
      const hr = hl.getBoundingClientRect()
      const topWithin = (mr.top - hr.top) + hl.scrollTop
      const leftWithin = (mr.left - hr.left) + hl.scrollLeft
      ta.scrollTop = Math.max(0, topWithin - ta.clientHeight / 2)
      if (leftWithin < ta.scrollLeft || leftWithin > ta.scrollLeft + ta.clientWidth - 40) {
        ta.scrollLeft = Math.max(0, leftWithin - 60)
      }
      hl.scrollTop = ta.scrollTop
      hl.scrollLeft = ta.scrollLeft
    })
  }, [hit, collapseStyle])

  // ── Undo/Redo (문서 스냅샷 기반) ──────────────────────────
  const historyRef = useRef({ undo: [], redo: [] })
  const lastPushTsRef = useRef(0)
  const pushUndo = useCallback((content) => {
    const h = historyRef.current
    if (h.undo[h.undo.length - 1] === content) return
    h.undo.push(content)
    if (h.undo.length > 100) h.undo.shift()
    h.redo = []
  }, [])
  const applyContent = useCallback((newSrc) => {
    rawContentRef.current = newSrc
    setRawTextarea(newSrc)
    onContentChange(newSrc, 0)
    setPreviewSrc(newSrc)
    setHit(null)
  }, [onContentChange])
  const doUndo = useCallback(() => {
    const h = historyRef.current
    if (!h.undo.length) return
    document.activeElement?.blur?.() // 편집 중 span 커밋 방지용 해제
    h.redo.push(rawContentRef.current)
    applyContent(h.undo.pop())
  }, [applyContent])
  const doRedo = useCallback(() => {
    const h = historyRef.current
    if (!h.redo.length) return
    h.undo.push(rawContentRef.current)
    applyContent(h.redo.pop())
  }, [applyContent])
  const onEditorKeyDown = useCallback((e) => {
    if (!(e.ctrlKey || e.metaKey)) return
    const k = e.key.toLowerCase()
    if (k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo() }
    else if (k === 'y') { e.preventDefault(); doRedo() }
  }, [doUndo, doRedo])

  // 접힘 뷰: 편집한 span(contenteditable, data-s/data-e)을 소스에 반영
  const commitSpan = useCallback((el) => {
    if (!el?.dataset || el.dataset.s == null) return
    const s = Number(el.dataset.s), e = Number(el.dataset.e)
    if (Number.isNaN(s) || Number.isNaN(e)) return
    const newText = el.textContent
    const src = rawContentRef.current
    if (newText === src.slice(s, e)) return // 변경 없음
    pushUndo(src) // 커밋 전 스냅샷 저장
    const newSrc = src.slice(0, s) + newText + src.slice(e)
    rawContentRef.current = newSrc
    setRawTextarea(newSrc)
    onContentChange(newSrc, 0)
    // 미리보기는 디바운스로 갱신 — 즉시 리로드하면 진행 중인 클릭(이동)을 방해해 "2번 클릭" 문제 발생
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const win = rawPreviewRef.current?.contentWindow
      if (win) previewScrollRef.current = { x: win.scrollX || 0, y: win.scrollY || 0 }
      setPreviewSrc(newSrc)
    }, 500)
    setHit(null) // 커밋 후 하이라이트 해제(특히 큰 <script> 토큰 전체가 강조되는 문제 방지)
  }, [onContentChange, pushUndo])
  const onFoldedBlur = useCallback((e) => { commitSpan(e.target) }, [commitSpan])
  const onFoldedKeyDown = useCallback((e) => {
    const el = e.target
    if (!el?.dataset || el.dataset.s == null) return
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur() } // Enter=반영(줄바꿈은 Shift+Enter)
    else if (e.key === 'Escape') { e.preventDefault(); el.blur() } // 선택 해제
  }, [])

  // Raw 모드 진입/마운트 시 헤딩 추출(개요 패널용)
  useEffect(() => {
    if (mode === 'raw') onHeadingsChange?.(extractHeadings(rawContentRef.current))
  }, [mode, onHeadingsChange])

  // ── 검색 ────────────────────────────────────────────────
  const closeSearch = useCallback(() => { setSearchOpen(false) }, [])
  const gotoMatch = useCallback((dir) => {
    setCurrentIdx((i) => {
      const n = searchMatches.length
      if (!n) return 0
      return (i + dir + n) % n
    })
  }, [searchMatches.length])
  const onSearchKey = useCallback((e) => {
    if (e.key === 'Enter') { e.preventDefault(); gotoMatch(e.shiftKey ? -1 : 1) }
    else if (e.key === 'Escape') { e.preventDefault(); closeSearch() }
  }, [gotoMatch, closeSearch])

  // 검색창 열리면 입력에 포커스 / 새 검색어면 첫 매치부터
  useEffect(() => { if (searchOpen) searchInputRef.current?.focus() }, [searchOpen])
  useEffect(() => { setCurrentIdx(0) }, [query, searchOpen])

  // 현재 검색 매치로 스크롤
  useEffect(() => {
    if (!searchOpen || !searchMatches.length) return
    const hl = rawHighlightRef.current, ta = rawTextareaRef.current
    if (!hl || !ta) return
    requestAnimationFrame(() => {
      const mark = hl.querySelector('.search-current')
      if (!mark) return
      const mr = mark.getBoundingClientRect(), hr = hl.getBoundingClientRect()
      ta.scrollTop = Math.max(0, (mr.top - hr.top) + hl.scrollTop - ta.clientHeight / 2)
      hl.scrollTop = ta.scrollTop
    })
  }, [currentIdx, searchMatches, searchOpen])

  // 세로 분할 divider 드래그(미리보기 ↔ 코드편집기 폭 조절)
  // 드래그 중 iframe이 마우스 이벤트를 가로채지 않도록 dragging 상태로 pointer-events 차단
  const onDividerDown = useCallback((e) => {
    e.preventDefault()
    setDragging(true)
    const onMove = (ev) => {
      const el = rawModeRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const pct = ((ev.clientX - rect.left) / rect.width) * 100
      setPreviewWidth(Math.max(20, Math.min(80, pct)))
    }
    const onUp = () => {
      setDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  // 미리보기 새로고침 — 편집 중 내용을 커밋하고 "최신 소스"로 즉시 반영 + 강제 재파싱
  // (디바운스된 previewSrc가 아니라 rawContentRef의 최신값을 사용해야 실제로 갱신됨)
  const refreshPreview = useCallback(() => {
    // 편집 중이던 span이 있으면 커밋(blur → commitSpan)
    const ae = document.activeElement
    if (ae && typeof ae.blur === 'function' && ae !== document.body) ae.blur()
    clearTimeout(debounceRef.current)
    // 최신 소스를 미리보기에 반영(변경됐으면 React가 리로드)
    setPreviewSrc(rawContentRef.current)
    // 내용이 동일해도 시각적으로 재로드되도록 srcdoc 재설정(React 커밋 이후)
    const f = htmlView === 'edit' ? rawPreviewRef.current : viewerIframeRef.current
    if (!f) return
    requestAnimationFrame(() => {
      const cur = f.getAttribute('srcdoc')
      if (cur == null) return
      f.removeAttribute('srcdoc')
      requestAnimationFrame(() => { f.setAttribute('srcdoc', cur) })
    })
  }, [htmlView])

  // F5 → 미리보기 새로고침(기본 페이지 리로드는 막음)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F5') { e.preventDefault(); refreshPreview() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [refreshPreview])

  // textarea 스크롤 → 하이라이트 레이어 동기화
  const syncScroll = useCallback(() => {
    const ta = rawTextareaRef.current
    const hl = rawHighlightRef.current
    if (ta && hl) { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft }
  }, [])

  const setupRawLocator = useCallback((iframe) => {
    const doc = iframe?.contentDocument
    if (!doc?.body || doc.__hmeLocator) return
    doc.__hmeLocator = true
    const norm = s => (s || '').replace(/\s+/g, ' ').trim()
    doc.body.style.cursor = 'pointer'
    doc.addEventListener('click', (e) => {
      const range = doc.caretRangeFromPoint?.(e.clientX, e.clientY)
      let node = range?.startContainer
      let snippet, word = ''
      if (node && node.nodeType === 3) {
        snippet = node.textContent
        // 클릭 지점의 단어/값만 추출(공백·구분점 경계) — JS로 조합된 라벨에서 정확도↑
        const t = node.textContent
        const off = range.startOffset
        const isB = (ch) => !ch || /[\s·|,()[\]{}]/.test(ch)
        let s = off, en = off
        while (s > 0 && !isB(t[s - 1])) s--
        while (en < t.length && !isB(t[en])) en++
        word = t.slice(s, en).trim()
      } else {
        snippet = e.target?.textContent
        node = null
      }
      const target = norm(snippet)
      if (target.length < 2) return
      // 동일 텍스트 노드 중 몇 번째인지 계산(중복 텍스트 구분)
      let occurrence = 0
      if (node) {
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
        let n
        while ((n = walker.nextNode())) {
          if (n === node) break
          if (norm(n.textContent) === target) occurrence++
        }
      }
      locateInSource(target, occurrence, word)
    })
  }, [locateInSource])

  // 편집 모드의 미리보기 iframe에 클릭 로케이터 부착(콘텐츠 리로드/모드 전환마다 재부착)
  useEffect(() => {
    if (htmlView !== 'edit') return
    const iframe = rawPreviewRef.current
    if (!iframe) return
    const onLoad = () => setupRawLocator(iframe)
    iframe.addEventListener('load', onLoad)
    if (iframe.contentDocument?.readyState === 'complete') setupRawLocator(iframe)
    return () => iframe.removeEventListener('load', onLoad)
  }, [htmlView, setupRawLocator])

  // ── Raw textarea change ────────────────────────────────────
  const handleRawChange = useCallback((e) => {
    const val = e.target.value
    // Undo 스냅샷: 연속 타이핑은 묶고, 400ms 이상 간격이면 새 스냅샷
    const now = performance.now()
    if (now - lastPushTsRef.current > 400) { pushUndo(rawContentRef.current); lastPushTsRef.current = now }
    setRawTextarea(val)
    rawContentRef.current = val
    setHit(null) // 편집하면 이전 위치 하이라이트 해제(오프셋이 틀어짐)
    onContentChange(val, 0)
    // Debounce preview update to avoid iframe thrashing (리로드 직전 스크롤 위치 저장)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const win = rawPreviewRef.current?.contentWindow
      if (win) previewScrollRef.current = { x: win.scrollX || 0, y: win.scrollY || 0 }
      setPreviewSrc(val)
    }, 500)
  }, [onContentChange, pushUndo])

  return (
    <div className="html-editor" onKeyDown={onEditorKeyDown}>
      {/* Toolbar */}
      <div className="html-editor-toolbar">
        <span className="html-file-label">HTML</span>
        <div className="html-mode-tabs">
          <button
            className={`html-mode-tab ${htmlView === 'viewer' ? 'active' : ''}`}
            onClick={() => setHtmlView('viewer')}
          >
            뷰어
          </button>
          <button
            className={`html-mode-tab ${htmlView === 'edit' ? 'active' : ''}`}
            onClick={() => setHtmlView('edit')}
          >
            편집
          </button>
        </div>
        <button
          className="html-mode-tab"
          onClick={refreshPreview}
          title="미리보기 새로고침(스크립트 재실행)"
        >
          ↻ 새로고침
        </button>
        {window.electronAPI && filePath && (
          <button
            className="html-mode-tab"
            onClick={() => openPath(filePath)}
            title="이 HTML 파일을 브라우저(기본 앱)에서 엽니다"
          >
            ↗ 브라우저에서 열기
          </button>
        )}
        <span className="html-mode-hint">
          {htmlView === 'viewer'
            ? '렌더링된 HTML 보기 (읽기 전용)'
            : collapseStyle
              ? '아무 텍스트나 클릭해 바로 편집(Enter 반영) · 미리보기 클릭 시 해당 위치로 이동 · […] 칩은 눌러 펼침'
              : '미리보기에서 텍스트를 클릭하면 소스에서 해당 위치를 선택합니다'}
        </span>

        {htmlView === 'edit' && (
          <button
            className={`html-mode-tab html-fold-toggle ${collapseStyle ? 'active' : ''}`}
            onClick={() => { setExpandedFolds(new Set()); setCollapseStyle(v => !v) }}
            title="태그와 속성을 […] 칩으로 접어 텍스트만 잘 보이게. 미리보기 텍스트 클릭 → 그 자리 편집, Esc → 아무 데나 편집."
          >
            {'< > 태그 접기'}
          </button>
        )}

        {/* 이미지 캡처 UI(Copy Image 등) 일단 숨김 */}
        {false && (
        <div className="html-capture-group">
          <div className="html-width-input-wrap">
            <input
              className="html-width-input"
              type="number"
              min="200"
              max="5000"
              step="100"
              value={captureWidth}
              onChange={e => setCaptureWidth(e.target.value)}
              placeholder={
                (mode === 'text' ? textIframeRef.current?.clientWidth : rawPreviewRef.current?.clientWidth) || '자동'
              }
              title="캡처 너비 (px). 비우면 현재 뷰 너비 사용"
            />
            <span className="html-width-unit">px</span>
          </div>

          <div className="html-scale-tabs">
            {[1, 2, 3].map(s => (
              <button
                key={s}
                className={`html-scale-tab ${captureScale === s ? 'active' : ''}`}
                onClick={() => setCaptureScale(s)}
                title={`${s}x 해상도로 캡처`}
              >{s}x</button>
            ))}
          </div>

          <button
            className={`html-copy-btn ${copyStatus === 'copied' ? 'copied' : ''}`}
            onClick={handleCopyImage}
            disabled={copyStatus === 'copying'}
            title="렌더링 화면을 PNG로 클립보드에 복사"
          >
          {copyStatus === 'copied' ? (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              복사됨
            </>
          ) : (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              {copyStatus === 'copying' ? '캡처 중…' : 'Copy Image'}
            </>
          )}
          </button>
        </div>
        )}
      </div>

      {/* Editor body */}
      <div className="html-editor-body">
        {htmlView === 'viewer' ? (
          <iframe
            ref={viewerIframeRef}
            className="html-viewer-iframe"
            sandbox="allow-same-origin allow-scripts"
            srcDoc={previewDoc}
            title="HTML Viewer"
          />
        ) : (
          <div className={`html-raw-mode ${dragging ? 'dragging' : ''}`} ref={rawModeRef}>
            {/* 왼쪽: HTML 미리보기 */}
            <iframe
              ref={rawPreviewRef}
              className="html-raw-preview"
              style={{ width: `${previewWidth}%`, flex: 'none' }}
              sandbox="allow-same-origin allow-scripts"
              srcDoc={previewDoc}
              title="HTML Preview"
              onLoad={() => {
                // 리로드 후 이전 스크롤 위치 복원 → "툭 튀는" 현상 완화
                const win = rawPreviewRef.current?.contentWindow
                if (!win) return
                const { x, y } = previewScrollRef.current
                win.scrollTo(x, y)
                requestAnimationFrame(() => win.scrollTo(x, y))
              }}
            />
            <div className="html-raw-divider" onMouseDown={onDividerDown} />
            {/* 오른쪽: 코드 편집기(구문 하이라이트 오버레이) */}
            <div className={`html-raw-editor ${collapseStyle ? 'folded' : ''}`}>
              {searchOpen && (
                <div className="html-search-bar">
                  <input
                    ref={searchInputRef}
                    className="html-search-input"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onSearchKey}
                    placeholder="검색…"
                    spellCheck={false}
                  />
                  <span className="html-search-count">
                    {searchMatches.length ? `${currentIdx + 1}/${searchMatches.length}` : '0/0'}
                  </span>
                  <button type="button" onClick={() => gotoMatch(-1)} title="이전 (Shift+Enter)">▲</button>
                  <button type="button" onClick={() => gotoMatch(1)} title="다음 (Enter)">▼</button>
                  <button type="button" onClick={closeSearch} title="닫기 (Esc)">✕</button>
                </div>
              )}
              <pre
                className="html-raw-highlight"
                aria-hidden={collapseStyle ? undefined : 'true'}
                ref={rawHighlightRef}
                onClick={collapseStyle ? (e) => {
                  const chip = e.target.closest?.('.fold-chip')
                  if (chip) {
                    const s = Number(chip.dataset.s)
                    if (!Number.isNaN(s)) setExpandedFolds(prev => new Set(prev).add(s))
                  }
                } : undefined}
                onKeyDown={collapseStyle ? onFoldedKeyDown : undefined}
                onBlur={collapseStyle ? onFoldedBlur : undefined}
              >
                <code dangerouslySetInnerHTML={{ __html: highlighted }} />
              </pre>
              {!collapseStyle && (
                <textarea
                  ref={rawTextareaRef}
                  className="html-raw-textarea"
                  value={rawTextarea}
                  onChange={handleRawChange}
                  onScroll={syncScroll}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
                      e.preventDefault(); setSearchOpen(true)
                    }
                  }}
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
})

export default HtmlEditor
