import React, { useMemo, useEffect, useRef, useCallback, useState } from 'react'
import { mdBlock } from '../utils/mdRenderer'
import { isWeb, readImageAsBlob, openPath, openExternal } from '../api'
import { isLocalPath } from '../utils/pathLink'
import LinkActionPopup from './LinkActionPopup'
import ImageLightbox from './ImageLightbox'

let mermaidInstance = null
let mermaidInitialized = false

async function getMermaid() {
  if (!mermaidInstance) {
    const module = await import('mermaid')
    mermaidInstance = module.default || module
  }

  if (!mermaidInitialized) {
    mermaidInstance.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'default',
    })
    mermaidInitialized = true
  }

  return mermaidInstance
}

export default function MarkdownPreview({ content, scrollRef, linkReg, sectionTitle, onClearSection, currentFilePath }) {
  const html = useMemo(() => mdBlock(content || '', linkReg), [content, linkReg])
  const bodyRef = useRef(null)
  const [linkPopup, setLinkPopup] = useState(null) // { x, y, kind, value }
  const [lightbox, setLightbox] = useState(null) // { src, alt }

  const handleDoubleClick = useCallback((e) => {
    const img = e.target.closest?.('img')
    if (img) { e.preventDefault(); setLightbox({ src: img.currentSrc || img.src, alt: img.alt }) }
  }, [])

  // 링크 클릭 시: 외부로 바로 이동하지 않고 액션 팝업(열기/복사)을 띄운다.
  const handleClick = useCallback((e) => {
    const a = e.target.closest?.('a')
    if (!a) return
    const raw = a.getAttribute('href') || a.href || ''
    if (!raw) return
    // 앵커 링크(#id): 팝업 대신 문서 내 해당 제목으로 스크롤
    if (raw.charAt(0) === '#') {
      e.preventDefault()
      const id = raw.slice(1)
      const target = bodyRef.current?.querySelector(`[id="${CSS.escape(id)}"]`)
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    e.preventDefault()
    setLinkPopup({ x: e.clientX, y: e.clientY, kind: isLocalPath(raw) ? 'path' : 'url', value: raw })
  }, [])

  // Web mode: replace ./relative image paths with blob URLs after render
  useEffect(() => {
    if (!isWeb || !currentFilePath) return
    const el = bodyRef.current
    if (!el) return
    const dir = currentFilePath.replace(/[/\\][^/\\]+$/, '')
    el.querySelectorAll('img').forEach(async (img) => {
      const src = img.getAttribute('src')
      if (!src?.startsWith('./')) return
      const absPath = `${dir}/${src.slice(2)}`
      const blobUrl = await readImageAsBlob(absPath)
      if (blobUrl) img.src = blobUrl
    })
  }, [html, currentFilePath])

  // Render fenced ```mermaid code blocks into SVG diagrams.
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return undefined

    const diagrams = Array.from(el.querySelectorAll('.dp-mermaid[data-mermaid-source]'))
    if (!diagrams.length) return undefined

    let cancelled = false

    ;(async () => {
      const mermaid = await getMermaid()
      if (cancelled) return

      diagrams.forEach(async (diagram, index) => {
        const source = decodeURIComponent(diagram.getAttribute('data-mermaid-source') || '')
        if (!source.trim()) return

        const renderId = `dp-mermaid-${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`
        diagram.classList.add('is-rendering')

        try {
          const { svg, bindFunctions } = await mermaid.render(renderId, source)
          if (cancelled) return
          diagram.innerHTML = svg
          bindFunctions?.(diagram)
          diagram.classList.remove('is-rendering', 'is-error')
          diagram.classList.add('is-rendered')
        } catch (error) {
          if (cancelled) return
          diagram.innerHTML = ''
          diagram.classList.remove('is-rendering')
          diagram.classList.add('is-error')

          const message = document.createElement('div')
          message.className = 'dp-mermaid-error'
          message.textContent = 'Mermaid 다이어그램을 렌더링할 수 없습니다.'

          const fallback = document.createElement('pre')
          fallback.className = 'dp-codeblock'
          fallback.textContent = source

          diagram.append(message, fallback)
          console.warn('Mermaid render failed:', error)
        }
      })
    })()

    return () => { cancelled = true }
  }, [html])

  const setBodyRef = useCallback((el) => {
    bodyRef.current = el
    if (scrollRef && typeof scrollRef === 'object') scrollRef.current = el
  }, [scrollRef])

  return (
    <div className="preview-pane">
      <div className="preview-header">
        {sectionTitle ? (
          <div className="preview-section-header">
            <button className="preview-section-back" onClick={onClearSection} type="button" title="전체 보기로 돌아가기">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            <span className="preview-title">{sectionTitle}</span>
          </div>
        ) : (
          <span className="preview-title">미리보기</span>
        )}
      </div>
      <div className="preview-body" ref={setBodyRef}>
        <div
          className="md-doc"
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
      {linkPopup && (
        <LinkActionPopup
          x={linkPopup.x}
          y={linkPopup.y}
          kind={linkPopup.kind}
          value={linkPopup.value}
          onOpen={async () => {
            const lp = linkPopup
            setLinkPopup(null)
            if (lp.kind === 'path') {
              const r = await openPath(lp.value)
              if (r && r.success === false) alert(r.error || '경로를 열 수 없습니다.')
            } else {
              openExternal(lp.value)
            }
          }}
          onCopy={async () => {
            try { await navigator.clipboard.writeText(linkPopup.value) } catch { /* ignore */ }
            setLinkPopup(null)
          }}
          onClose={() => setLinkPopup(null)}
        />
      )}
      {lightbox && (
        <ImageLightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      )}
    </div>
  )
}
