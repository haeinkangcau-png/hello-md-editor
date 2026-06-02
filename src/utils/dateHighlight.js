import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const dateHighlightKey = new PluginKey('dateHighlight')

function findDates(doc) {
  const results = []
  const re = /\d{4}-\d{2}-\d{2}/g
  doc.descendants((node, pos) => {
    if (!node.isText) return
    let m
    while ((m = re.exec(node.text)) !== null) {
      results.push({ from: pos + m.index, to: pos + m.index + m[0].length })
    }
  })
  return results
}

export const DateHighlight = Extension.create({
  name: 'dateHighlight',

  addProseMirrorPlugins() {
    return [new Plugin({
      key: dateHighlightKey,
      state: {
        init(_, state) {
          return buildDecoSet(state.doc)
        },
        apply(tr, old) {
          return tr.docChanged ? buildDecoSet(tr.doc) : old
        },
      },
      props: {
        decorations(state) {
          return dateHighlightKey.getState(state)
        },
      },
    })]
  },
})

function buildDecoSet(doc) {
  const dates = findDates(doc)
  if (!dates.length) return DecorationSet.empty
  const decos = dates.map(({ from, to }) =>
    Decoration.inline(from, to, { class: 'date-highlight' })
  )
  return DecorationSet.create(doc, decos)
}
