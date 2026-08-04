import React, {
  useEffect, useRef, useCallback, useState,
  forwardRef, useImperativeHandle,
} from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Extension } from '@tiptap/core'
import CodeBlock from '@tiptap/extension-code-block'
import { EditorState } from '@tiptap/pm/state'
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
import { saveImage, isWeb, readImageAsBlob, openScheduleWindow, openPath, openExternal, IMG_BASE } from '../api'
import { PathLink, findPathAtPos, isLocalPath } from '../utils/pathLink'
import LinkActionPopup from './LinkActionPopup'
import ImageLightbox from './ImageLightbox'

let mermaidEditorInstance = null
let mermaidEditorInitialized = false

async function getEditorMermaid() {
  if (!mermaidEditorInstance) {
    const module = await import('mermaid')
    mermaidEditorInstance = module.default || module
  }

  if (!mermaidEditorInitialized) {
    mermaidEditorInstance.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'default',
    })
    mermaidEditorInitialized = true
  }

  return mermaidEditorInstance
}

const MermaidCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ({ node }) => {
      let currentNode = node
      let renderToken = 0

      const dom = document.createElement('div')
      dom.className = 'editor-codeblock-node'

      const preview = document.createElement('div')
      preview.className = 'editor-mermaid-preview'
      preview.contentEditable = 'false'

      const pre = document.createElement('pre')
      const code = document.createElement('code')
      pre.appendChild(code)
      dom.append(pre)

      const renderMermaid = async () => {
        const language = (currentNode.attrs.language || '').toLowerCase()
        const isMermaid = language === 'mermaid'

        code.className = currentNode.attrs.language
          ? `${this.options.languageClassPrefix}${currentNode.attrs.language}`
          : ''
        dom.classList.toggle('is-mermaid', isMermaid)

        if (!isMermaid) {
          preview.remove()
          pre.style.display = ''
          return
        }

        if (!preview.parentNode) dom.insertBefore(preview, pre)
        pre.style.display = 'none'

        const source = currentNode.textContent.trim()
        const token = ++renderToken
        preview.classList.add('is-rendering')
        preview.classList.remove('is-error')
        preview.innerHTML = ''

        if (!source) return

        try {
          const mermaid = await getEditorMermaid()
          const { svg, bindFunctions } = await mermaid.render(
            `editor-mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            source
          )
          if (token !== renderToken) return
          preview.innerHTML = svg
          bindFunctions?.(preview)
          preview.classList.remove('is-rendering', 'is-error')
        } catch {
          if (token !== renderToken) return
          preview.classList.remove('is-rendering')
          preview.classList.add('is-error')
          preview.textContent = currentNode.textContent
          pre.style.display = ''
        }
      }

      renderMermaid()

      return {
        dom,
        contentDOM: code,
        update: updatedNode => {
          if (updatedNode.type.name !== currentNode.type.name) return false
          currentNode = updatedNode
          renderMermaid()
          return true
        },
        ignoreMutation: mutation => (
          mutation.target === preview ||
          preview.contains(mutation.target)
        ),
      }
    }
  },
})

// Tab / Shift-Tab으로 리스트 항목 depth 조절.
// StarterKit ListItem의 기본 Tab 바인딩이 이 버전 조합에서 발화하지 않아
// (Tab이 에디터 밖 툴바로 포커스가 새어나감) 명시적으로 다시 바인딩한다.
// 리스트 안: sink/lift 수행하고 Tab을 삼켜 포커스 이탈을 막는다.
// 리스트 밖: false를 반환해 표(셀 이동) 등 다른 핸들러/기본 동작에 양보한다.
const ListTabKeymap = Extension.create({
  name: 'listTabKeymap',
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (!this.editor.isActive('listItem')) return false
        this.editor.chain().focus().sinkListItem('listItem').run()
        return true // 첫 항목이라 sink 불가여도 Tab을 삼켜 포커스가 새지 않게 한다
      },
      'Shift-Tab': () => {
        if (!this.editor.isActive('listItem')) return false
        this.editor.chain().focus().liftListItem('listItem').run()
        return true
      },
    }
  },
})

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
    days.push({ day: d, other: false, date: fmtDate(dt), isToday: dt.getTime() === today.getTime(), isSel: fmtDate(dt) === selected, isSun: dt.getDay() === 0 })
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
        {['일','월','화','수','목','금','토'].map((d, i) => <span key={d} className={i === 0 ? 'sun' : ''}>{d}</span>)}
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
              d.isSun && !d.isToday && !d.isSel ? 'sun' : '',
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

// TipTap 2.x has NO clearHistory command (only undo/redo) — calling it is a silent
// no-op. To actually reset undo/redo, recreate the EditorState with the same doc and
// plugins. This makes the freshly-loaded content the undo baseline so repeated Ctrl+Z
// can never revert past it to an empty document.
function clearEditorHistory(editor) {
  if (!editor || editor.isDestroyed) return
  try {
    const { state, view } = editor
    view.updateState(EditorState.create({
      doc: state.doc,
      plugins: state.plugins,
      selection: state.selection,
    }))
  } catch { /* ignore */ }
}

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
  { initialContent, onContentChange, onHeadingsChange, onSave, currentFilePath, onOpenScheduleSplit, onOpenSpecWindow, onLoadTemplate, toolbarPrefs = { showSchedule: true, showSpecViewer: false, showTemplate: false }, wideTables = false, tableWidth = 1200, onToggleWide, onTableWidthChange },
  ref
) {
  const isSettingContent = useRef(false)
  const headingDebounceRef = useRef(null)
  // Suppress snippet re-detection for a short window after firing one.
  // Timestamp-based so it auto-expires and can never get stuck (Mac IME event-order safe).
  const snippetGuardUntil = useRef(0)
  const [editMode, setEditMode] = useState('wysiwyg') // 'wysiwyg' | 'raw'
  const [rawContent, setRawContent] = useState('')
  const [copied, setCopied] = useState(false)
  const [scheduleDropdownOpen, setScheduleDropdownOpen] = useState(false)
  const scheduleBtnGroupRef = useRef(null)
  const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false)
  const templateBtnGroupRef = useRef(null)
  const scheduleChannelRef = useRef(null)
  const rawContentRef = useRef('')
  const [calState, setCalState] = useState(null) // { x, y, dateStr, onApply }
  const [linkPopup, setLinkPopup] = useState(null) // { x, y, kind: 'url'|'path', value }
  const [lightbox, setLightbox] = useState(null) // { src, alt }

  // ── Search state ───────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false)
  // Bumped on each search-open request so an already-open search bar re-focuses its input.
  const [searchFocusToken, setSearchFocusToken] = useState(0)
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
      (match, alt) => `![${alt}](${IMG_BASE}${dir}/`
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
    const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const escaped = reEsc(dir)
    const escBase = reEsc(IMG_BASE)
    return md.replace(
      new RegExp(`!\\[([^\\]]*)\\]\\(${escBase}${escaped}/`, 'g'),
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
            displaySrc = `${IMG_BASE}${assetsDir}/${imgName}`
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
      StarterKit.configure({ codeBlock: false }),
      ListTabKeymap,
      MermaidCodeBlock.configure({ languageClassPrefix: 'language-' }),
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
      PathLink,
    ],
    content: '',
    editorProps: {
      // 웹 페이지에서 긁어온 HTML을 붙여넣을 때 이미지는 제외한다(잡음 제거).
      // 텍스트·링크·표 등은 그대로 마크다운으로 변환된다.
      // 클립보드 비트맵 이미지 붙여넣기는 handlePaste에서 별도 처리하므로 영향 없음.
      transformPastedHTML: (html) =>
        html
          .replace(/<img\b[^>]*>/gi, '')        // <img ...>
          .replace(/<picture\b[\s\S]*?<\/picture>/gi, ''), // <picture>...</picture>
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

      // ── Snippet detection (non-IME input only) ──
      // Skip detection (not propagation) while inside the post-fire suppression window.
      if (performance.now() >= snippetGuardUntil.current && !editor.view.composing) {
        const { $from } = editor.state.selection
        if ($from.parentOffset > 0) {
          const textBefore = $from.parent.textBetween(
            Math.max(0, $from.parentOffset - 10), $from.parentOffset
          )
          for (const s of SNIPPETS) {
            const hasSpace = textBefore.endsWith(s.trigger + ' ')
            if (textBefore.endsWith(s.trigger) || hasSpace) {
              const matchLen = s.trigger.length + (hasSpace ? 1 : 0)
              snippetGuardUntil.current = performance.now() + 250
              const from = $from.pos - matchLen
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
        if (performance.now() < snippetGuardUntil.current) return
        const { $from } = editor.state.selection
        if ($from.parentOffset <= 0) return
        const textBefore = $from.parent.textBetween(
          Math.max(0, $from.parentOffset - 10), $from.parentOffset
        )
        for (const s of SNIPPETS) {
          const hasSpace = textBefore.endsWith(s.trigger + ' ')
          if (textBefore.endsWith(s.trigger) || hasSpace) {
            const matchLen = s.trigger.length + (hasSpace ? 1 : 0)
            snippetGuardUntil.current = performance.now() + 250
            const from = $from.pos - matchLen
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
      setSearchFocusToken(t => t + 1)   // re-focus the field even if already open
    },
    // Called after save-time normalization; updates display without marking as 'modified'
    applyNormalized: (content) => {
      if (editModeRef.current === 'wysiwyg' && editor) {
        isSettingContent.current = true
        editor.commands.setContent(content)
        isSettingContent.current = false   // reset synchronously — never let it stick true
        setTimeout(() => {
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
      // setContent fires onUpdate synchronously (ignored via the flag); reset the flag
      // immediately so user edits propagate. Never rely on the timeout for this — if the
      // timeout is skipped (cancel/throw) the flag would stick true and block all edits.
      isSettingContent.current = false
      // Clear undo history synchronously so the loaded content is the undo baseline
      // (repeated Ctrl+Z must not revert past it to an empty doc). Don't depend on the
      // timeout — if it's skipped, undo would wipe the document.
      clearEditorHistory(editor)
      // Doc is updated synchronously — extract headings right away so the TOC populates.
      onHeadingsChange?.(extractHeadings(editor))
      setTimeout(() => {
        if (cancelled || editor.isDestroyed) return
        clearEditorHistory(editor)   // backup re-assert
        // Re-extract as a backup in case async markdown image resolution shifted the doc.
        onHeadingsChange?.(extractHeadings(editor))
      }, 150)
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
    isSettingContent.current = false   // reset synchronously — never let it stick true
    clearEditorHistory(editor)     // sync — loaded content is the undo baseline
    setTimeout(() => {
      clearEditorHistory(editor)   // backup re-assert
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
      isSettingContent.current = false   // reset synchronously — never let it stick true
      setTimeout(() => {
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
    // 하이라이트된 날짜 칩을 "직접" 클릭했을 때만 달력을 연다.
    // 날짜가 있는 줄의 빈 영역/끝을 클릭한 경우엔 열지 않고, 열려 있던 달력은 닫는다.
    // (기존엔 커서 주변 ±12자에서 날짜를 찾아, 줄 끝 클릭에도 뜨고 공백 클릭 시 따라다녔음)
    if (!e.target?.closest?.('.date-highlight')) { setCalState(null); return }
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
            isSettingContent.current = false   // reset synchronously — never let it stick true
          }
          // 에디터 뷰만 갱신하면 App 상태·자동저장이 안 걸려 파일에 반영되지 않는다.
          // 스케줄 창의 편집(날짜/드래그)이 실제 파일까지 저장되도록 변경을 전파한다.
          onContentChange(newContent, countWords(newContent))
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

  const handleOpenSpecWindowAction = useCallback(() => {
    onOpenSpecWindow?.()
  }, [onOpenSpecWindow])

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

  // close template dropdown on outside click
  useEffect(() => {
    if (!templateDropdownOpen) return
    const handler = (e) => {
      if (templateBtnGroupRef.current && !templateBtnGroupRef.current.contains(e.target)) {
        setTemplateDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [templateDropdownOpen])

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
      { trigger: '/날짜', replace: todayStr },
      { trigger: '/회의', replace: meetingTemplate },
    ]
    for (const s of snippets) {
      const hasSpace = before.endsWith(s.trigger + ' ')
      if (before.endsWith(s.trigger) || hasSpace) {
        const matchLen = s.trigger.length + (hasSpace ? 1 : 0)
        const text = s.replace()
        val = before.slice(0, -matchLen) + text + val.slice(pos)
        setRawContent(val)
        onContentChange(val, countWords(val))
        requestAnimationFrame(() => {
          const newPos = pos - matchLen + text.length
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

  // Cmd/Ctrl+S (save) and Cmd/Ctrl+F (search) are handled by the single
  // window-level listener in App.jsx. Handling them here too caused two
  // concurrent saves to collide on the File System Access writable stream
  // (manifested as save failures, notably on macOS), so this is intentionally empty.
  const handleKeyDown = useCallback(() => {}, [])

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
    <div
      className={`editor-wrapper${wideTables ? ' wide-tables' : ''}`}
      onKeyDown={handleKeyDown}
      style={{ '--table-width': `${tableWidth}px` }}
    >
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
          focusToken={searchFocusToken}
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
          {toolbarPrefs.showTemplate && (
          <div className="schedule-btn-group" ref={templateBtnGroupRef}>
            <button
              className="schedule-btn-main"
              onClick={() => setTemplateDropdownOpen(v => !v)}
              title="템플릿을 현재 문서 상단에 삽입"
              style={{ borderRadius: 'var(--radius-sm)' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="12" y1="18" x2="12" y2="12"/>
                <line x1="9" y1="15" x2="15" y2="15"/>
              </svg>
              Template ▾
            </button>
            {templateDropdownOpen && (
              <div className="schedule-dropdown">
                <button onClick={() => { onLoadTemplate?.('spec'); setTemplateDropdownOpen(false) }}>
                  기능정의서
                </button>
                <button onClick={() => { onLoadTemplate?.('changelog'); setTemplateDropdownOpen(false) }}>
                  기능정의서 변경이력
                </button>
              </div>
            )}
          </div>
          )}

          {toolbarPrefs.showSchedule && (
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
          )}

          <div className="wide-table-ctrl">
            <button
              className={`wide-table-toggle${wideTables ? ' active' : ''}`}
              onClick={() => onToggleWide?.()}
              title="표를 넓게 보기"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="5" width="18" height="14" rx="1"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
                <line x1="10" y1="5" x2="10" y2="19"/>
                <line x1="16" y1="5" x2="16" y2="19"/>
              </svg>
              표 넓게
            </button>
            <input
              type="range"
              className="wide-table-slider"
              min="760"
              max="2400"
              step="40"
              value={tableWidth}
              disabled={!wideTables}
              onChange={(e) => onTableWidthChange?.(Number(e.target.value))}
              title={wideTables ? `표 폭 ${tableWidth}px` : '표 넓게 보기를 켜면 폭을 조절할 수 있습니다'}
            />
          </div>

          {toolbarPrefs.showSpecViewer && (
          <div className="schedule-btn-group">
            <button
              className="schedule-btn-main"
              onClick={handleOpenSpecWindowAction}
              title="Spec Viewer 새 창으로 열기"
              style={{ borderRadius: 'var(--radius-sm)', borderRight: 'none' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="8" y1="13" x2="16" y2="13"/>
                <line x1="8" y1="17" x2="13" y2="17"/>
              </svg>
              Spec viewer
            </button>
          </div>
          )}

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
            // 링크/경로 열기·복사는 Ctrl(⌘)+클릭에서만 — 그냥 클릭은 커서 배치(편집)를 위해 비워둔다.
            if (e.ctrlKey || e.metaKey) {
              // 1) 링크(앵커) → URL/경로 액션 팝업
              const a = e.target.closest('a')
              if (a) {
                const raw = a.getAttribute('href') || a.href || ''
                if (raw) {
                  e.preventDefault()
                  setCalState(null)
                  // 앵커 링크(#제목) → 팝업 대신 문서 내 해당 제목으로 스크롤
                  if (raw.charAt(0) === '#' && editor) {
                    let want = raw.slice(1)
                    try { want = decodeURIComponent(want) } catch { /* keep raw */ }
                    const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ')
                    const target = norm(want)
                    let pos = null
                    editor.state.doc.descendants((node, p) => {
                      if (pos != null) return false
                      if (node.type.name === 'heading' && norm(node.textContent) === target) pos = p
                    })
                    if (pos != null) {
                      const dom = editor.view.nodeDOM(pos)
                      const el = dom instanceof Element ? dom : dom?.parentElement
                      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }
                    return
                  }
                  setLinkPopup({ x: e.clientX, y: e.clientY, kind: isLocalPath(raw) ? 'path' : 'url', value: raw })
                  return
                }
              }
              // 2) 평문 폴더/파일 경로
              const cx = e.clientX, cy = e.clientY
              requestAnimationFrame(() => {
                if (!editor) return
                const { $from } = editor.state.selection
                const pathHit = findPathAtPos($from.parent.textContent, $from.parentOffset)
                if (pathHit) {
                  setCalState(null)
                  setLinkPopup({ x: cx, y: cy, kind: 'path', value: pathHit.path })
                }
              })
              return
            }
            // 그냥 클릭: 날짜 피커만 (경로/링크 팝업 없음 → 자유롭게 편집/커서 이동)
            handleWysiwygDateClick(e)
          }}
          onDoubleClick={(e) => {
            const img = e.target.closest?.('img')
            if (img) { e.preventDefault(); setLightbox({ src: img.currentSrc || img.src, alt: img.alt }) }
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

      {/* ── Image lightbox ── */}
      {lightbox && (
        <ImageLightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      )}

      {/* ── Link/Path action popup ── */}
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
