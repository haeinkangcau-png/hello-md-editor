import React, {
  useEffect, useRef, useCallback, useState,
  forwardRef, useImperativeHandle,
} from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Extension } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import Toolbar from './Toolbar'
import SelectionInfo from './SelectionInfo'
import SearchBar from './SearchBar'
import { normalizeHtmlTables } from '../utils/mdRenderer'
import { SearchHighlight, searchPluginKey } from '../utils/searchExtension'
import { DateHighlight } from '../utils/dateHighlight'
import { saveImage, isWeb, readImageAsBlob, openScheduleWindow } from '../api'

// ── 날짜 유틸 ────────────────────────────────────────────────
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function findDateAtPos(text, pos) {
  const s = Math.max(0, pos - 12)
  const e = Math.min(text.length, pos + 12)
  const chunk = text.substring(s, e)
  const re = /\d{4}-\d{2}-\d{2}/g
  let m
  while ((m = re.exec(chunk)) !== null) {
    const absStart = s + m.index
    const absEnd = absStart + m[0].length
    if (pos >= absStart && pos <= absEnd) return { dateStr: m[0], start: absStart, end: absEnd }
  }
  return null
}

// ── DatePickerPopup ──────────────────────────────────────────
function DatePickerPopup({ x, y, dateStr, onSelect, onClose }) {
  const parsed = new Date(dateStr + 'T00:00:00')
  const init = isNaN(parsed) ? new Date() : parsed
  const [year, setYear] = useState(init.getFullYear())
  const [month, setMonth] = useState(init.getMonth())
  const [selected, setSelected] = useState(dateStr)

  const today = new Date(); today.setHours(0, 0, 0, 0)

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1) }
  const nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1) }

  const first = new Date(year, month, 1)
  const dow = first.getDay()
  const lastDay = new Date(year, month + 1, 0).getDate()
  const prevLast = new Date(year, month, 0).getDate()
  const days = []
  for (let i = dow - 1; i >= 0; i--) {
    const dt = new Date(year, month - 1, prevLast - i)
    days.push({ day: prevLast - i, other: true, date: fmtDate(dt) })
  }
  for (let d = 1; d <= lastDay; d++) {
    const dt = new Date(year, month, d)
    days.push({ day: d, other: false, date: fmtDate(dt), isToday: dt.getTime() === today.getTime(), isSel: fmtDate(dt) === selected, isMon: dt.getDay() === 1 })
  }
  const remain = (7 - (dow + lastDay) % 7) % 7
  for (let d = 1; d <= remain; d++) {
    const dt = new Date(year, month + 1, d)
    days.push({ day: d, other: true, date: fmtDate(dt) })
  }

  // 화면 경계 처리
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  let left = x, top = y + 8
  if (left + 226 > vw) left = vw - 234
  if (left < 8) left = 8
  if (top + 270 > vh) top = y - 278
  if (top < 8) top = 8

  return (
    <div className="editor-cal-popup" style={{ top, left }} onMouseDown={e => e.stopPropagation()}>
      <button className="editor-cal-close" onClick={onClose}>✕</button>
      <div className="editor-cal-header">
        <button className="editor-cal-nav" onClick={prevMonth}>◀</button>
        <span>{year}.{String(month + 1).padStart(2, '0')}</span>
        <button className="editor-cal-nav" onClick={nextMonth}>▶</button>
      </div>
      <div className="editor-cal-dow">
        {['일','월','화','수','목','금','토'].map(d => <span key={d}>{d}</span>)}
      </div>
      <div className="editor-cal-grid">
        {days.map((d, i) => (
          <div
            key={i}
            className={[
              'editor-cal-day',
              d.other ? 'other' : '',
              d.isToday ? 'today' : '',
              d.isSel ? 'selected' : '',
              d.isMon && !d.isToday && !d.isSel ? 'mon' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => { setSelected(d.date); onSelect(d.date) }}
          >
            {d.day}
          </div>
        ))}
      </div>
    </div>
  )
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function nowStr() {
  const d = new Date()
  return `${todayStr()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

function meetingTemplate() {
  return `회의명: \n프로젝트: \n참석자: \n회의일시: ${nowStr()}\n\n---\n\n`
}

const SNIPPETS = [
  { trigger: '/날짜', replace: () => todayStr() },
  { trigger: '/회의', replace: () => meetingTemplate() },
]

function countWords(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0
}

function extractHeadings(editor) {
  const headings = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      headings.push({ level: node.attrs.level, text: node.textContent, pos })
    }
  })
  return headings
}

const Editor = forwardRef(function Editor(
  { initialContent, onContentChange, onHeadingsChange, onSave, currentFilePath, onOpenScheduleSplit },
  ref
) {
  const isSettingContent = useRef(false)
  const headingDebounceRef = useRef(null)
  const snippetGuardRef = useRef(false)
  const [editMode, setEditMode] = useState('wysiwyg') // 'wysiwyg' | 'raw'
  const [rawContent, setRawContent] = useState('')
  const [copied, setCopied] = useState(false)
  const [scheduleDropdownOpen, setScheduleDropdownOpen] = useState(false)
  const scheduleBtnGroupRef = useRef(null)
  const scheduleChannelRef = useRef(null)
  const rawContentRef = useRef('')
  const [calState, setCalState] = useState(null) // { x, y, dateStr, onApply }

  // ── Search state ───────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const [matchCount, setMatchCount] = useState(0)
  const [resultIndex, setResultIndex] = useState(0)
  // Raw-mode only: matches are {start, end} indices in rawContent
  const [rawMatches, setRawMatches] = useState([])
  const [rawMatchIdx, setRawMatchIdx] = useState(0)
  const textareaRef = useRef(null)

  // ── Image paste handler ─────────────────────────────────
  const currentFilePathRef = useRef(currentFilePath)
  useEffect(() => { currentFilePathRef.current = currentFilePath }, [currentFilePath])
  useEffect(() => { rawContentRef.current = rawContent }, [rawContent])

  const editorRef2 = useRef(null)
  const editModeRef = useRef(editMode)
  useEffect(() => { editModeRef.current = editMode }, [editMode])

  // ── Blob URL tracking (web mode only) ────────────────────────
  const blobToRelPath = useRef(new Map())  // blob URL → relative path

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      for (const url of blobToRelPath.current.keys()) URL.revokeObjectURL(url)
      blobToRelPath.current.clear()
    }
  }, [])

  // ── Image path conversion helpers ──────────────────────────
  // Markdown에 저장된 상대 경로 → 에디터 표시용 local-image:// 절대 경로
  const toAbsImagePaths = useCallback((md) => {
    const fp = currentFilePathRef.current
    if (!fp || !md) return md
    const dir = fp.replace(/\\/g, '/').replace(/\/[^/]+$/, '')
    return md.replace(
      /!\[([^\]]*)\]\(\.\//g,
      (match, alt) => `![${alt}](local-image://img/${dir}/`
    )
  }, [])

  // 웹 모드: ./x.assets/y.png → blob URL (비동기)
  const resolveWebImages = useCallback(async (md) => {
    const fp = currentFilePathRef.current
    if (!fp || !md) return md
    const dir = fp.replace(/\\/g, '/').replace(/\/[^/]+$/, '')
    const imgPattern = /!\[([^\]]*)\]\(\.(\/[^)]*\.(?:png|jpg|jpeg|gif|webp|svg|bmp))\)/gi
    const matches = [...md.matchAll(imgPattern)]
    if (!matches.length) return md
    let result = md
    for (const match of matches) {
      const relPath = `.${match[2]}`
      const absPath = `${dir}${match[2]}`
      try {
        const blobUrl = await readImageAsBlob(absPath)
        if (blobUrl) {
          blobToRelPath.current.set(blobUrl, relPath)
          result = result.replaceAll(match[0], `![${match[1]}](${blobUrl})`)
        }
      } catch { /* image not found, skip */ }
    }
    return result
  }, [])

  // 에디터 내부의 local-image:// 절대 경로 (Electron) 또는 blob URL (웹) → 마크다운 저장용 상대 경로
  const toRelImagePaths = useCallback((md) => {
    if (!md) return md
    if (isWeb) {
      // Replace blob URLs with original relative paths
      let result = md
      for (const [blobUrl, relPath] of blobToRelPath.current) {
        result = result.replaceAll(blobUrl, relPath)
      }
      return result
    }
    const fp = currentFilePathRef.current
    if (!fp) return md
    const dir = fp.replace(/\\/g, '/').replace(/\/[^/]+$/, '')
    const escaped = dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return md.replace(
      new RegExp(`!\\[([^\\]]*)\\]\\(local-image://img/${escaped}/`, 'g'),
      (match, alt) => `![${alt}](./`
    )
  }, [])

  const handleImagePaste = useCallback(async (files) => {
    try {
      const filePath = currentFilePathRef.current
      if (!filePath) {
        alert('이미지를 붙여넣으려면 먼저 파일을 저장해주세요.')
        return
      }
      const baseName = filePath.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '')
      const assetsDir = filePath.replace(/\\/g, '/').replace(/\/[^/]+$/, '') + '/' + baseName + '.assets'

      for (const file of files) {
        const ts = new Date()
        const stamp = `${ts.getFullYear()}${String(ts.getMonth()+1).padStart(2,'0')}${String(ts.getDate()).padStart(2,'0')}_${String(ts.getHours()).padStart(2,'0')}${String(ts.getMinutes()).padStart(2,'0')}${String(ts.getSeconds()).padStart(2,'0')}`
        const ext = file.type.split('/')[1] === 'jpeg' ? 'jpg' : (file.type.split('/')[1] || 'png')
        const imgName = `image_${stamp}.${ext}`

        const buf = await file.arrayBuffer()
        // Chunked base64 encoding to avoid stack overflow on large images
        const bytes = new Uint8Array(buf)
        let binary = ''
        const chunk = 8192
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
        }
        const b64 = btoa(binary)
        await saveImage(assetsDir, imgName, b64)

        const relPath = `./${baseName}.assets/${imgName}`
        if (editModeRef.current === 'wysiwyg' && editorRef2.current) {
          let displaySrc
          if (isWeb) {
            // Web: create blob URL and track for save-back conversion
            const blobUrl = await readImageAsBlob(`${assetsDir}/${imgName}`)
            if (blobUrl) {
              blobToRelPath.current.set(blobUrl, relPath)
              displaySrc = blobUrl
            } else {
              displaySrc = relPath
            }
          } else {
            displaySrc = `local-image://img/${assetsDir}/${imgName}`
          }
          editorRef2.current.chain().focus().setImage({ src: displaySrc, alt: 'image' }).run()
        } else {
          const insert = `![image](${relPath})`
          setRawContent(prev => {
            const ta = textareaRef.current
            const pos = ta?.selectionStart ?? prev.length
            const newContent = prev.slice(0, pos) + insert + prev.slice(pos)
            onContentChange(newContent, countWords(newContent))
            return newContent
          })
        }
      }
    } catch (err) {
      console.error('Image paste error:', err)
      alert(`이미지 붙여넣기 실패: ${err.message}`)
    }
  }, [onContentChange])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: { languageClassPrefix: 'language-' } }),
      Image.configure({ inline: false, allowBase64: false }),
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      Table.configure({ resizable: true, HTMLAttributes: { class: 'md-table' } }),
      TableRow,
      TableHeader,
      TableCell.configure({ HTMLAttributes: { style: 'min-width: 80px' } }),
      Placeholder.configure({ placeholder: '여기에 마크다운을 작성하세요…' }),
      Markdown.configure({
        html: true,
        tightLists: true,
        bulletListMarker: '-',
        transformPastedText: true,
      }),
      SearchHighlight,
      DateHighlight,
    ],
    content: '',
    editorProps: {
      handlePaste: (view, event) => {
        const items = Array.from(event.clipboardData?.items || [])
        const imageItems = items.filter(i => i.type.startsWith('image/'))
        if (imageItems.length > 0) {
          event.preventDefault()
          const files = imageItems.map(i => i.getAsFile()).filter(Boolean)
          if (files.length) handleImagePaste(files)
          return true
        }
        return false
      },
      handleDrop: (view, event) => {
        const files = Array.from(event.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'))
        if (files.length > 0) {
          event.preventDefault()
          handleImagePaste(files)
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor }) => {
      if (isSettingContent.current) return
      if (snippetGuardRef.current) { snippetGuardRef.current = false; return }

      // ── Snippet detection (non-IME input only) ──
      if (!editor.view.composing) {
        const { $from } = editor.state.selection
        if ($from.parentOffset > 0) {
          const textBefore = $from.parent.textBetween(
            Math.max(0, $from.parentOffset - 10), $from.parentOffset
          )
          for (const s of SNIPPETS) {
            if (textBefore.endsWith(s.trigger)) {
              snippetGuardRef.current = true
              const from = $from.pos - s.trigger.length
              const to = $from.pos
              const text = s.replace()
              setTimeout(() => {
                editor.chain().focus().deleteRange({ from, to }).insertContentAt(from, text).run()
              }, 0)
              return
            }
          }
        }
      }

      const rawMd = editor.storage.markdown.getMarkdown()
      const markdown = toRelImagePaths(rawMd)
      onContentChange(markdown, countWords(editor.getText()))
      const unescaped = markdown.replace(/\\([\[\]~*_`|\\<>])/g, '$1')
      scheduleChannelRef.current?.postMessage({ type: 'md-update', content: unescaped })
      // Debounce heading extraction — no need to traverse the full doc on every keystroke
      clearTimeout(headingDebounceRef.current)
      headingDebounceRef.current = setTimeout(() => {
        onHeadingsChange?.(extractHeadings(editor))
      }, 300)
    },
  })

  // Sync editor ref for image paste handler (avoids circular dependency)
  useEffect(() => { editorRef2.current = editor }, [editor])

  // ── Snippet detection for Korean IME (compositionend) ──────
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const onCompositionEnd = () => {
      queueMicrotask(() => {
        if (snippetGuardRef.current) return
        const { $from } = editor.state.selection
        if ($from.parentOffset <= 0) return
        const textBefore = $from.parent.textBetween(
          Math.max(0, $from.parentOffset - 10), $from.parentOffset
        )
        for (const s of SNIPPETS) {
          if (textBefore.endsWith(s.trigger)) {
            snippetGuardRef.current = true
            const from = $from.pos - s.trigger.length
            const to = $from.pos
            editor.chain().focus().deleteRange({ from, to }).insertContentAt(from, s.replace()).run()
            return
          }
        }
      })
    }
    dom.addEventListener('compositionend', onCompositionEnd)
    return () => dom.removeEventListener('compositionend', onCompositionEnd)
  }, [editor])

  useImperativeHandle(ref, () => ({
    scrollToPos: (pos) => {
      if (!editor) return
      editor.commands.setTextSelection(pos + 1)
      editor.view.focus()
      requestAnimationFrame(() => {
        const domNode = editor.view.nodeDOM(pos)
        if (!domNode) return
        const el = domNode instanceof Element ? domNode : domNode.parentElement
        if (!el) return
        const scrollEl = el.closest('.editor-scroll')
        if (!scrollEl) return
        const offset = el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top
        scrollEl.scrollBy({ top: offset, behavior: 'smooth' })
      })
    },
    openSearch: () => {
      setSearchOpen(true)
    },
    // Called after save-time normalization; updates display without marking as 'modified'
    applyNormalized: (content) => {
      if (editModeRef.current === 'wysiwyg' && editor) {
        isSettingContent.current = true
        editor.commands.setContent(content)
        setTimeout(() => {
          isSettingContent.current = false
          onHeadingsChange?.(extractHeadings(editor))
        }, 60)
      } else if (editModeRef.current === 'raw') {
        setRawContent(content)
      }
    },
  }), [editor])

  // Load initial content on mount
  useEffect(() => {
    if (!editor) return
    let cancelled = false
    isSettingContent.current = true
    const load = async () => {
      const content = isWeb
        ? await resolveWebImages(initialContent || '')
        : toAbsImagePaths(initialContent || '')
      if (cancelled) return
      editor.commands.setContent(content)
      setTimeout(() => {
        if (cancelled) return
        isSettingContent.current = false
        onHeadingsChange?.(extractHeadings(editor))
      }, 60)
    }
    load()
    return () => { cancelled = true }
  }, [editor])

  const scrollToEditorSelection = useCallback(() => {
    if (!editor) return
    requestAnimationFrame(() => {
      try {
        const { from } = editor.state.selection
        const coords = editor.view.coordsAtPos(from)
        const scrollEl = editor.view.dom.closest('.editor-scroll')
        if (!scrollEl) return
        const scrollRect = scrollEl.getBoundingClientRect()
        const relTop = coords.top - scrollRect.top + scrollEl.scrollTop
        scrollEl.scrollTo({ top: relTop - scrollEl.clientHeight / 2, behavior: 'smooth' })
      } catch (_) {}
    })
  }, [editor])

  // ── Sync WYSIWYG search term with plugin ───────────────────
  useEffect(() => {
    if (!editor || editMode !== 'wysiwyg') return
    if (!query) {
      editor.commands.clearSearch()
      setMatchCount(0)
      setResultIndex(0)
      return
    }
    editor.commands.setSearchTerm(query)
    // Read plugin state synchronously after dispatch
    const ps = searchPluginKey.getState(editor.state)
    setMatchCount(ps?.results?.length ?? 0)
    setResultIndex(ps?.resultIndex ?? 0)
    scrollToEditorSelection()
  }, [query, editor, editMode, scrollToEditorSelection])

  // ── Raw mode: compute match positions ──────────────────────
  useEffect(() => {
    if (editMode !== 'raw' || !query) {
      setRawMatches([])
      setRawMatchIdx(0)
      return
    }
    const lowerContent = rawContent.toLowerCase()
    const lowerQuery = query.toLowerCase()
    const matches = []
    let i = 0
    while ((i = lowerContent.indexOf(lowerQuery, i)) !== -1) {
      matches.push({ start: i, end: i + query.length })
      i += query.length
    }
    setRawMatches(matches)
    setRawMatchIdx(0)
  }, [query, rawContent, editMode])

  // ── Raw mode: highlight current match in textarea ──────────
  useEffect(() => {
    if (editMode !== 'raw' || !rawMatches.length || !textareaRef.current) return
    const match = rawMatches[rawMatchIdx]
    const ta = textareaRef.current
    ta.focus()
    ta.setSelectionRange(match.start, match.end)
    // Scroll match into view
    const lines = rawContent.substring(0, match.start).split('\n')
    const lineNum = lines.length - 1
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 24
    ta.scrollTop = Math.max(0, lineNum * lineHeight - ta.clientHeight / 2)
  }, [rawMatchIdx, rawMatches, editMode])

  // ── Mode switching ─────────────────────────────────────────
  const switchToRaw = useCallback(() => {
    if (!editor) return
    const md = editor.storage.markdown.getMarkdown()
    setRawContent(md)
    setEditMode('raw')
    editor.commands.clearSearch()
    const unescapedMd = md.replace(/\\([\[\]~*_`|\\<>])/g, '$1')
    scheduleChannelRef.current?.postMessage({ type: 'md-update', content: unescapedMd })
  }, [editor])

  const switchToWysiwyg = useCallback(() => {
    if (!editor) return
    isSettingContent.current = true
    editor.commands.setContent(rawContent)
    setTimeout(() => {
      isSettingContent.current = false
      onHeadingsChange?.(extractHeadings(editor))
      onContentChange(rawContent, countWords(rawContent))
    }, 60)
    setEditMode('wysiwyg')
  }, [editor, rawContent, onHeadingsChange, onContentChange])

  const handleNormalize = useCallback(() => {
    const md = editMode === 'wysiwyg'
      ? editor.storage.markdown.getMarkdown()
      : rawContent

    const count = (md.match(/<table[\s\S]*?<\/table>/gi) || []).length
    if (count === 0) {
      alert('변환할 HTML 테이블이 없습니다.')
      return
    }

    const normalized = normalizeHtmlTables(md)

    if (editMode === 'wysiwyg') {
      isSettingContent.current = true
      editor.commands.setContent(normalized)
      setTimeout(() => {
        isSettingContent.current = false
        onContentChange(normalized, countWords(normalized))
        onHeadingsChange?.(extractHeadings(editor))
      }, 60)
    } else {
      setRawContent(normalized)
      onContentChange(normalized, countWords(normalized))
    }
  }, [editMode, editor, rawContent, onContentChange, onHeadingsChange])

  // ── Date picker: raw mode ──────────────────────────────────
  const handleRawDateClick = useCallback((e) => {
    const ta = textareaRef.current
    if (!ta) return
    // 클릭 후 selectionStart 업데이트 대기
    requestAnimationFrame(() => {
      const pos = ta.selectionStart
      const result = findDateAtPos(ta.value, pos)
      if (result) {
        const { dateStr, start: ds, end: de } = result
        setCalState({
          x: e.clientX,
          y: e.clientY,
          dateStr,
          onApply: (newDate) => {
            setRawContent(prev => {
              const val = prev.slice(0, ds) + newDate + prev.slice(de)
              onContentChange(val, countWords(val))
              scheduleChannelRef.current?.postMessage({ type: 'md-update', content: val })
              return val
            })
            setCalState(null)
            requestAnimationFrame(() => {
              textareaRef.current?.focus()
              textareaRef.current?.setSelectionRange(ds, ds + newDate.length)
            })
          },
        })
      } else {
        setCalState(null)
      }
    })
  }, [onContentChange])

  // ── Date picker: WYSIWYG mode ─────────────────────────────
  const handleWysiwygDateClick = useCallback((e) => {
    if (!editor) return
    requestAnimationFrame(() => {
      const { $from } = editor.state.selection
      const offset = $from.parentOffset
      const nodeText = $from.parent.textContent
      const result = findDateAtPos(nodeText, offset)
      if (result) {
        const nodeStart = $from.start()
        const docStart = nodeStart + result.start
        const docEnd = nodeStart + result.end
        setCalState({
          x: e.clientX,
          y: e.clientY,
          dateStr: result.dateStr,
          onApply: (newDate) => {
            editor.chain().focus().command(({ tr, dispatch }) => {
              tr.insertText(newDate, docStart, docEnd)
              if (dispatch) dispatch(tr)
              return true
            }).run()
            setCalState(null)
          },
        })
      } else {
        setCalState(null)
      }
    })
  }, [editor])

  const ensureScheduleChannel = useCallback(() => {
    const unescapeMd = (s) => s.replace(/\\([\[\]~*_`|\\<>])/g, '$1')
    if (!scheduleChannelRef.current) {
      const ch = new BroadcastChannel('md-schedule-sync')
      ch.onmessage = (e) => {
        if (e.data?.type === 'md-request') {
          const raw = editModeRef.current === 'raw'
            ? rawContentRef.current
            : unescapeMd(editorRef2.current?.storage.markdown.getMarkdown() || '')
          const fp2 = currentFilePathRef.current || ''
          const fn = fp2 ? fp2.replace(/\\/g, '/').split('/').pop().replace(/\.md$/i, '') : ''
          ch.postMessage({ type: 'md-update', content: raw, fileName: fn })
        }
        if (e.data?.type === 'schedule-md-update') {
          const newContent = e.data.content
          if (newContent == null) return
          if (editModeRef.current === 'raw') {
            setRawContent(newContent)
          } else if (editorRef2.current) {
            isSettingContent.current = true
            editorRef2.current.commands.setContent(newContent)
            setTimeout(() => { isSettingContent.current = false }, 60)
          }
        }
        if (e.data?.type === 'schedule-focus-item') {
          const itemName = e.data.itemName
          if (!itemName) return
          if (editModeRef.current === 'raw') {
            const ta = textareaRef.current
            if (!ta) return
            const idx = ta.value.indexOf(itemName)
            if (idx === -1) return
            ta.focus()
            ta.setSelectionRange(idx, idx + itemName.length)
            const lineNum = ta.value.substring(0, idx).split('\n').length - 1
            const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 24
            ta.scrollTop = Math.max(0, lineNum * lineHeight - ta.clientHeight / 2)
          } else if (editorRef2.current) {
            const doc = editorRef2.current.state.doc
            let foundPos = null
            doc.descendants((node, pos) => {
              if (foundPos != null) return false
              if (node.isText && node.text.includes(itemName)) {
                foundPos = pos + node.text.indexOf(itemName)
              }
            })
            if (foundPos != null) {
              editorRef2.current.commands.setTextSelection(foundPos)
              editorRef2.current.view.focus()
              requestAnimationFrame(() => {
                const domNode = editorRef2.current?.view.nodeDOM(foundPos)
                if (!domNode) return
                const el = domNode instanceof Element ? domNode : domNode.parentElement
                el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
              })
            }
          }
        }
      }
      scheduleChannelRef.current = ch
    }
    const unescapeMd2 = (s) => s.replace(/\\([\[\]~*_`|\\<>])/g, '$1')
    const initialMd = editModeRef.current === 'raw'
      ? rawContentRef.current
      : unescapeMd2(editorRef2.current?.storage.markdown.getMarkdown() || '')
    const fp = currentFilePathRef.current || ''
    const fileName = fp ? fp.replace(/\\/g, '/').split('/').pop().replace(/\.md$/i, '') : '스케줄'
    return { initialMd, fileName }
  }, [])

  const handleOpenSchedule = useCallback(async () => {
    const { initialMd, fileName } = ensureScheduleChannel()
    await openScheduleWindow(initialMd, fileName)
  }, [ensureScheduleChannel])

  const handleOpenScheduleSplitAction = useCallback(() => {
    ensureScheduleChannel()
    onOpenScheduleSplit?.()
  }, [ensureScheduleChannel, onOpenScheduleSplit])

  // close schedule dropdown on outside click
  useEffect(() => {
    if (!scheduleDropdownOpen) return
    const handler = (e) => {
      if (scheduleBtnGroupRef.current && !scheduleBtnGroupRef.current.contains(e.target)) {
        setScheduleDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [scheduleDropdownOpen])

  const handleCopyAll = useCallback(async () => {
    const md = editMode === 'wysiwyg'
      ? editor.storage.markdown.getMarkdown()
      : rawContent
    try {
      await navigator.clipboard.writeText(md)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* silent */ }
  }, [editMode, editor, rawContent])

  const handleRawChange = useCallback((e) => {
    let val = e.target.value
    const ta = e.target
    const pos = ta.selectionStart
    const before = val.slice(0, pos)
    // 스니펫 치환: /날짜, /회의
    const snippets = [
      { trigger: '/날짜', len: 3, replace: todayStr },
      { trigger: '/회의', len: 3, replace: meetingTemplate },
    ]
    for (const s of snippets) {
      if (before.endsWith(s.trigger)) {
        const text = s.replace()
        val = before.slice(0, -s.len) + text + val.slice(pos)
        setRawContent(val)
        onContentChange(val, countWords(val))
        requestAnimationFrame(() => {
          const newPos = pos - s.len + text.length
          ta.setSelectionRange(newPos, newPos)
        })
        return
      }
    }
    setRawContent(val)
    onContentChange(val, countWords(val))
    scheduleChannelRef.current?.postMessage({ type: 'md-update', content: val })
  }, [onContentChange])

  // ── Search handlers ────────────────────────────────────────
  const handleSearchClose = useCallback(() => {
    setSearchOpen(false)
    setQuery('')
    setReplaceText('')
    setShowReplace(false)
    if (editor) editor.commands.clearSearch()
  }, [editor])

  const syncWysiwygSearchState = useCallback(() => {
    if (!editor) return
    const ps = searchPluginKey.getState(editor.state)
    setMatchCount(ps?.results?.length ?? 0)
    setResultIndex(ps?.resultIndex ?? 0)
  }, [editor])

  const handleNext = useCallback(() => {
    if (editMode === 'wysiwyg') {
      editor?.commands.nextSearchResult()
      syncWysiwygSearchState()
      scrollToEditorSelection()
    } else {
      setRawMatchIdx(i => rawMatches.length ? (i + 1) % rawMatches.length : 0)
    }
  }, [editMode, editor, rawMatches, syncWysiwygSearchState, scrollToEditorSelection])

  const handlePrev = useCallback(() => {
    if (editMode === 'wysiwyg') {
      editor?.commands.previousSearchResult()
      syncWysiwygSearchState()
      scrollToEditorSelection()
    } else {
      setRawMatchIdx(i => rawMatches.length ? (i - 1 + rawMatches.length) % rawMatches.length : 0)
    }
  }, [editMode, editor, rawMatches, syncWysiwygSearchState, scrollToEditorSelection])

  const handleReplace = useCallback(() => {
    if (editMode === 'wysiwyg') {
      editor?.commands.replaceCurrentResult(replaceText)
      syncWysiwygSearchState()
    } else {
      if (!rawMatches.length) return
      const match = rawMatches[rawMatchIdx]
      const newContent = rawContent.slice(0, match.start) + replaceText + rawContent.slice(match.end)
      setRawContent(newContent)
      onContentChange(newContent, countWords(newContent))
      // Matches will recompute via useEffect
    }
  }, [editMode, editor, replaceText, rawMatches, rawMatchIdx, rawContent, onContentChange, syncWysiwygSearchState])

  const handleReplaceAll = useCallback(() => {
    if (editMode === 'wysiwyg') {
      editor?.commands.replaceAllResults(replaceText)
      syncWysiwygSearchState()
    } else {
      if (!query) return
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const newContent = rawContent.replace(new RegExp(escaped, 'gi'), replaceText)
      setRawContent(newContent)
      onContentChange(newContent, countWords(newContent))
    }
  }, [editMode, editor, replaceText, query, rawContent, onContentChange, syncWysiwygSearchState])

  const handleKeyDown = useCallback((e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 's') {
      e.preventDefault()
      onSave(undefined, { isManual: true })
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault()
      setSearchOpen(true)
    }
  }, [onSave])

  // ── Raw textarea image paste ─────────────────────────────
  const handleRawPaste = useCallback((e) => {
    const items = Array.from(e.clipboardData?.items || [])
    const imageItems = items.filter(i => i.type.startsWith('image/'))
    if (imageItems.length > 0) {
      e.preventDefault()
      const files = imageItems.map(i => i.getAsFile()).filter(Boolean)
      if (files.length) handleImagePaste(files)
    }
  }, [handleImagePaste])

  if (!editor) return null

  // Compute display values from React state (reliable, no timing issues)
  const displayMatchCount = editMode === 'wysiwyg' ? matchCount : rawMatches.length
  const displayCurrentMatch = displayMatchCount === 0 ? 0
    : editMode === 'wysiwyg'
      ? resultIndex + 1
      : rawMatchIdx + 1

  return (
    <div className="editor-wrapper" onKeyDown={handleKeyDown}>
      {/* ── Search bar ── */}
      {searchOpen && (
        <SearchBar
          query={query}
          onQueryChange={setQuery}
          replaceText={replaceText}
          onReplaceTextChange={setReplaceText}
          showReplace={showReplace}
          onToggleReplace={() => setShowReplace(v => !v)}
          matchCount={displayMatchCount}
          currentMatch={displayCurrentMatch}
          onNext={handleNext}
          onPrev={handlePrev}
          onReplace={handleReplace}
          onReplaceAll={handleReplaceAll}
          onClose={handleSearchClose}
        />
      )}

      {/* ── Mode toggle bar ── */}
      <div className="mode-bar">
        <div className="mode-toggle">
          <button
            className={`mode-btn ${editMode === 'wysiwyg' ? 'active' : ''}`}
            onClick={() => editMode === 'raw' && switchToWysiwyg()}
            title="WYSIWYG 편집 모드"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            편집
          </button>
          <button
            className={`mode-btn ${editMode === 'raw' ? 'active' : ''}`}
            onClick={() => editMode === 'wysiwyg' && switchToRaw()}
            title="Raw 마크다운 편집 모드"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="16 18 22 12 16 6"/>
              <polyline points="8 6 2 12 8 18"/>
            </svg>
            Raw
          </button>
        </div>

        <div className="mode-bar-right">
          <div className="schedule-btn-group" ref={scheduleBtnGroupRef}>
            <button
              className="schedule-btn-main"
              onClick={handleOpenScheduleSplitAction}
              title="스플릿 뷰로 열기"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="16" rx="2"/>
                <line x1="3" y1="9" x2="21" y2="9"/>
                <line x1="8" y1="4" x2="8" y2="9"/>
                <line x1="16" y1="4" x2="16" y2="9"/>
                <line x1="7" y1="14" x2="11" y2="14"/>
                <line x1="7" y1="17" x2="15" y2="17"/>
              </svg>
              스케줄
            </button>
            <button
              className="schedule-btn-arrow"
              onClick={() => setScheduleDropdownOpen(v => !v)}
              title="스케줄 보기 옵션"
            >▾</button>
            {scheduleDropdownOpen && (
              <div className="schedule-dropdown">
                <button onClick={() => { handleOpenSchedule(); setScheduleDropdownOpen(false) }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <polyline points="15 3 21 3 21 9"/>
                    <line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                  새 창으로 보기
                </button>
                <button onClick={() => { handleOpenScheduleSplitAction(); setScheduleDropdownOpen(false) }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <line x1="12" y1="3" x2="12" y2="21"/>
                  </svg>
                  스플릿 뷰로 보기
                </button>
              </div>
            )}
          </div>
          <button
            className="copy-md-btn"
            onClick={handleCopyAll}
            title="전체 내용을 Markdown으로 클립보드에 복사"
          >
            {copied ? (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                복사됨
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                MD 복사
              </>
            )}
          </button>
          <button
            className="normalize-btn normalize-btn-icon"
            onClick={handleNormalize}
            title="MD 오류 수정"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── WYSIWYG mode ── */}
      {editMode === 'wysiwyg' && <Toolbar editor={editor} />}
      {editMode === 'wysiwyg' && <SelectionInfo editor={editor} />}
      {editMode === 'wysiwyg' && (
        <div
          className="editor-scroll"
          onClick={(e) => {
            if (e.ctrlKey || e.metaKey) {
              const a = e.target.closest('a')
              if (a?.href) { e.preventDefault(); window.open(a.href, '_blank', 'noopener,noreferrer') }
            } else {
              handleWysiwygDateClick(e)
            }
          }}
        >
          <EditorContent editor={editor} className="editor-content" />
        </div>
      )}

      {/* ── Raw mode ── */}
      {editMode === 'raw' && (
        <div className="editor-scroll raw-scroll">
          <textarea
            ref={textareaRef}
            className="raw-editor"
            value={rawContent}
            onChange={handleRawChange}
            onKeyDown={handleKeyDown}
            onPaste={handleRawPaste}
            onClick={handleRawDateClick}
            spellCheck={false}
            autoFocus
          />
        </div>
      )}

      {/* ── Date picker popup ── */}
      {calState && (
        <DatePickerPopup
          x={calState.x}
          y={calState.y}
          dateStr={calState.dateStr}
          onSelect={calState.onApply}
          onClose={() => setCalState(null)}
        />
      )}
    </div>
  )
})

export default Editor
