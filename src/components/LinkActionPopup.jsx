import React, { useEffect, useRef, useLayoutEffect, useState } from 'react'

/**
 * 링크/경로 클릭 시 뜨는 작은 액션 팝업.
 * kind: 'url'  → [링크 열기] [URL 복사]
 *       'path' → [폴더 열기] [경로 복사]
 */
export default function LinkActionPopup({ x, y, kind, value, onOpen, onCopy, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // 뷰포트를 벗어나지 않도록 위치 보정
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let left = x, top = y + 8
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8
    if (top + rect.height > window.innerHeight - 8) top = y - rect.height - 8
    setPos({ left: Math.max(8, left), top: Math.max(8, top) })
  }, [x, y])

  // 바깥 클릭 / ESC로 닫기 (열린 직후 같은 클릭으로 닫히지 않도록 다음 틱에 등록)
  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const openLabel = kind === 'path' ? '폴더 열기' : '링크 열기'
  const copyLabel = kind === 'path' ? '경로 복사' : 'URL 복사'

  return (
    <div ref={ref} className="link-action-popup" style={{ left: pos.left, top: pos.top }}>
      <div className="link-action-value" title={value}>{value}</div>
      <div className="link-action-buttons">
        <button type="button" onClick={onOpen}>{openLabel}</button>
        <button type="button" onClick={onCopy}>{copyLabel}</button>
      </div>
    </div>
  )
}
