import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const pathLinkKey = new PluginKey('pathLink')

// 윈도우 절대 경로(E:\... , C:/...) 또는 UNC 경로(\\server\share\...)를 매칭.
// 경로에 공백이 포함될 수 있으므로(예: "hi workspace") 줄바꿈/파일명 금지문자 전까지 받아들인다.
export const PATH_RE = /(?:[A-Za-z]:[\\/]|\\\\)[^\n\r<>"|?*]*/g

// href/문자열이 로컬 경로(또는 file://)인지 판별
export function isLocalPath(href) {
  if (!href) return false
  return /^(?:[A-Za-z]:[\\/]|\\\\)/.test(href) || /^file:\/\//i.test(href)
}

// 텍스트 내 pos 위치에 걸친 경로를 찾아 { path, start, end } 반환 (없으면 null)
export function findPathAtPos(text, pos) {
  if (!text) return null
  const re = new RegExp(PATH_RE.source, 'g')
  let m
  while ((m = re.exec(text)) !== null) {
    const trimmed = m[0].replace(/\s+$/, '') // 뒤쪽 공백 제거
    if (trimmed.length < 4) continue
    const start = m.index
    const end = start + trimmed.length
    if (pos >= start && pos <= end) return { path: trimmed, start, end }
  }
  return null
}

function findPaths(doc) {
  const results = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const re = new RegExp(PATH_RE.source, 'g')
    let m
    while ((m = re.exec(node.text)) !== null) {
      const trimmed = m[0].replace(/\s+$/, '')
      if (trimmed.length < 4) continue
      results.push({ from: pos + m.index, to: pos + m.index + trimmed.length })
    }
  })
  return results
}

function buildDecoSet(doc) {
  const paths = findPaths(doc)
  if (!paths.length) return DecorationSet.empty
  const decos = paths.map(({ from, to }) =>
    Decoration.inline(from, to, { class: 'path-link', title: 'Ctrl(⌘)+클릭으로 열기/복사' })
  )
  return DecorationSet.create(doc, decos)
}

// 평문 폴더/파일 경로를 시각적으로 링크처럼 표시한다(클릭 동작은 Editor의 onClick에서 처리).
export const PathLink = Extension.create({
  name: 'pathLink',

  addProseMirrorPlugins() {
    return [new Plugin({
      key: pathLinkKey,
      state: {
        init(_, state) { return buildDecoSet(state.doc) },
        apply(tr, old) { return tr.docChanged ? buildDecoSet(tr.doc) : old },
      },
      props: {
        decorations(state) { return pathLinkKey.getState(state) },
      },
    })]
  },
})
