import { type EditorState, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'

import {
  type LineStyle,
  type MarkdownMark,
  markdownMarks,
  type TextStyle
} from './markdownMarks.js'

const LINE: Record<LineStyle, string> = {
  h1: 'text-[15px] font-semibold',
  h2: 'font-semibold',
  h3: 'text-ink-soft font-semibold',
  quote: 'border-line text-ink-soft border-l pl-3',
  code: 'bg-muted font-mono text-[11px]',
  table: 'font-mono text-[11px]'
}

const TEXT: Record<TextStyle, string> = {
  strong: 'font-semibold',
  em: 'italic',
  strike: 'text-ink-faint line-through',
  code: 'bg-muted rounded-[4px] px-1 font-mono text-[11px]',
  link: 'text-accent underline decoration-dotted'
}

const hide = Decoration.replace({})
const faint = Decoration.mark({ class: 'text-ink-faint' })

class Bullet extends WidgetType {
  toDOM(): HTMLElement {
    const dot = document.createElement('span')
    dot.className = 'text-ink-faint'
    dot.textContent = '•'
    return dot
  }
}

class Checkbox extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly label: string
  ) {
    super()
  }

  override eq(other: Checkbox): boolean {
    return other.checked === this.checked
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'choice align-middle'
    box.checked = this.checked
    box.setAttribute('aria-label', this.label)
    box.addEventListener('change', () => {
      const at = view.posAtDOM(box) + 1
      view.dispatch({ changes: { from: at, to: at + 1, insert: box.checked ? 'x' : ' ' } })
    })
    return box
  }
}

const bullet = Decoration.replace({ widget: new Bullet() })

function decoration(mark: MarkdownMark, taskLabel: string): Range<Decoration> {
  switch (mark.kind) {
    case 'line':
      return Decoration.line({ class: LINE[mark.style] }).range(mark.at)
    case 'text':
      return Decoration.mark({ class: TEXT[mark.style] }).range(mark.from, mark.to)
    case 'syntax':
      return (mark.hidden ? hide : faint).range(mark.from, mark.to)
    case 'bullet':
      return bullet.range(mark.from, mark.to)
    case 'task':
      return Decoration.replace({ widget: new Checkbox(mark.checked, taskLabel) }).range(
        mark.from,
        mark.to
      )
  }
}

export function livePreview(taskLabel: string): StateField<DecorationSet> {
  const build = (state: EditorState): DecorationSet =>
    Decoration.set(
      markdownMarks(state.doc.toString(), state.selection.main).map((mark) =>
        decoration(mark, taskLabel)
      ),
      true
    )
  return StateField.define<DecorationSet>({
    create: build,
    update: (decorations, transaction) =>
      transaction.docChanged || transaction.selection !== undefined
        ? build(transaction.state)
        : decorations,
    provide: (field) => EditorView.decorations.from(field)
  })
}
