import React, { useState, useRef, useEffect, useCallback } from 'react'

export default function HtmlEditor({ initialContent, onContentChange }) {
  const [mode, setMode] = useState('text')
  const [rawTextarea, setRawTextarea] = useState(initialContent)
  const [previewSrc, setPreviewSrc] = useState(initialContent)
  const [copyStatus, setCopyStatus] = useState(null) // null | 'copying' | 'copied'
  const [captureScale, setCaptureScale] = useState(2)
  const [captureWidth, setCaptureWidth] = useState('')  // '' = use iframe width

  const textIframeRef = useRef(null)
  const rawPreviewRef = useRef(null)
  const rawContentRef = useRef(initialContent) // tracks latest content across mode switches
  const debounceRef = useRef(null)
  const copyTimerRef = useRef(null)

  // ── Serialize edited iframe DOM back to HTML string ────────
  function serialize(doc) {
    const hClone = doc.head.cloneNode(true)
    const bClone = doc.body.cloneNode(true)
    hClone.querySelector('#__hme_highlight')?.remove()
    bClone.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'))
    const head = hClone.innerHTML.trim()
    const body = bClone.innerHTML.trim()
    return head ? `${head}\n${body}` : body
  }

  // ── Inject contenteditable into leaf text elements ─────────
  const setupTextMode = useCallback((iframe) => {
    const doc = iframe?.contentDocument
    if (!doc?.body) return

    // Highlight style for editable elements
    const style = doc.createElement('style')
    style.id = '__hme_highlight'
    style.textContent = `
      [contenteditable] { cursor: text; }
      [contenteditable]:hover {
        outline: 2px solid rgba(130,201,130,.75);
        outline-offset: 1px;
        border-radius: 2px;
      }
      [contenteditable]:focus {
        outline: 2px solid #2E4A2E;
        background: rgba(240,250,240,.3);
        outline-offset: 1px;
        border-radius: 2px;
      }
    `
    doc.head.appendChild(style)

    // Make leaf text nodes editable (skip structural/invisible tags)
    doc.body.querySelectorAll('*').forEach(el => {
      if (['STYLE', 'SCRIPT', 'NOSCRIPT', 'META', 'LINK'].includes(el.tagName)) return
      if (el.children.length > 0) return   // only leaf elements
      if (!el.textContent.trim()) return    // skip empty
      el.contentEditable = 'plaintext-only'
    })

    // Serialize on every input and propagate upward
    doc.body.addEventListener('input', () => {
      const html = serialize(doc)
      rawContentRef.current = html
      onContentChange(html, 0)
    })
  }, [onContentChange])

  // ── Initialize text iframe each time it mounts ─────────────
  // The text iframe is unmounted when switching to Raw mode and
  // remounted when switching back, so [] here runs once per mount.
  useEffect(() => {
    const iframe = textIframeRef.current
    if (!iframe) return
    const onLoad = () => setupTextMode(iframe)
    iframe.addEventListener('load', onLoad)
    // Use latest content (may differ from initialContent if raw edits were made)
    iframe.srcdoc = rawContentRef.current
    return () => iframe.removeEventListener('load', onLoad)
  }, [setupTextMode])

  // ── Mode switching ─────────────────────────────────────────
  const goRawMode = useCallback(() => {
    const current = rawContentRef.current
    setRawTextarea(current)
    setPreviewSrc(current)
    setMode('raw')
  }, [])

  const goTextMode = useCallback(() => {
    // rawContentRef already has the latest — text iframe will pick it up on mount
    setMode('text')
  }, [])

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

  // ── Raw textarea change ────────────────────────────────────
  const handleRawChange = useCallback((e) => {
    const val = e.target.value
    setRawTextarea(val)
    rawContentRef.current = val
    onContentChange(val, 0)
    // Debounce preview update to avoid iframe thrashing
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setPreviewSrc(val), 400)
  }, [onContentChange])

  return (
    <div className="html-editor">
      {/* Toolbar */}
      <div className="html-editor-toolbar">
        <span className="html-file-label">HTML</span>
        <div className="html-mode-tabs">
          <button
            className={`html-mode-tab ${mode === 'text' ? 'active' : ''}`}
            onClick={goTextMode}
          >
            Text 모드
          </button>
          <button
            className={`html-mode-tab ${mode === 'raw' ? 'active' : ''}`}
            onClick={goRawMode}
          >
            Raw 모드
          </button>
        </div>
        <span className="html-mode-hint">
          {mode === 'text'
            ? '텍스트 요소를 클릭해 편집하세요'
            : 'HTML 소스를 직접 편집합니다'}
        </span>

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
      </div>

      {/* Editor body */}
      <div className="html-editor-body">
        {mode === 'text' ? (
          <iframe
            ref={textIframeRef}
            className="html-text-iframe"
            sandbox="allow-same-origin"
            title="HTML Text Editor"
          />
        ) : (
          <div className="html-raw-mode">
            <textarea
              className="html-raw-textarea"
              value={rawTextarea}
              onChange={handleRawChange}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
            <div className="html-raw-divider" />
            <iframe
              ref={rawPreviewRef}
              className="html-raw-preview"
              sandbox="allow-same-origin allow-scripts"
              srcDoc={previewSrc}
              title="HTML Preview"
            />
          </div>
        )}
      </div>
    </div>
  )
}
