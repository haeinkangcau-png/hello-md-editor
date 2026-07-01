import React, { useEffect, useState } from 'react'

/**
 * 이미지 확대 보기 오버레이.
 * - 배경/✕/ESC로 닫기
 * - 이미지 클릭 시 '화면 맞춤' ↔ '원본 크기(100%)' 토글
 */
export default function ImageLightbox({ src, alt, onClose }) {
  const [actual, setActual] = useState(false) // false: 화면 맞춤, true: 원본 크기

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    // 배경 스크롤 방지
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  if (!src) return null

  return (
    <div className="image-lightbox" onClick={onClose}>
      <button className="image-lightbox-close" onClick={onClose} title="닫기 (Esc)" type="button">✕</button>
      <img
        className={`image-lightbox-img ${actual ? 'actual' : 'fit'}`}
        src={src}
        alt={alt || ''}
        onClick={(e) => { e.stopPropagation(); setActual(v => !v) }}
        title={actual ? '클릭: 화면에 맞추기' : '클릭: 원본 크기로 보기'}
        draggable={false}
      />
    </div>
  )
}
