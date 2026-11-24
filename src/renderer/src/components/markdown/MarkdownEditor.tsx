import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { EditorState, type StateCommand } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import {
  Bold,
  Code,
  Heading,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  type LucideIcon,
  SquareCode,
  Strikethrough,
  TextQuote
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { present } from '@core/present.js'

import { useLatest } from '../../hooks/useLatest.js'
import { IconButton } from '../paneControls.js'
import { livePreview } from './livePreview.js'
import {
  bold,
  bulletList,
  code,
  codeBlock,
  heading,
  italic,
  link,
  orderedList,
  quote,
  strike,
  taskList
} from './markdownCommands.js'

type ToolName =
  | 'heading'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'quote'
  | 'code'
  | 'codeBlock'
  | 'link'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'

interface Tool {
  readonly name: ToolName
  readonly icon: LucideIcon
  readonly run: StateCommand
}

const GROUPS: readonly { readonly name: string; readonly tools: readonly Tool[] }[] = [
  {
    name: 'text',
    tools: [
      { name: 'heading', icon: Heading, run: heading },
      { name: 'bold', icon: Bold, run: bold },
      { name: 'italic', icon: Italic, run: italic },
      { name: 'strike', icon: Strikethrough, run: strike }
    ]
  },
  {
    name: 'insert',
    tools: [
      { name: 'quote', icon: TextQuote, run: quote },
      { name: 'code', icon: Code, run: code },
      { name: 'codeBlock', icon: SquareCode, run: codeBlock },
      { name: 'link', icon: Link, run: link }
    ]
  },
  {
    name: 'lists',
    tools: [
      { name: 'bulletList', icon: List, run: bulletList },
      { name: 'orderedList', icon: ListOrdered, run: orderedList },
      { name: 'taskList', icon: ListTodo, run: taskList }
    ]
  }
]

const theme = EditorView.theme({
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.625' },
  '.cm-content': { minHeight: '240px', padding: '6px 10px', caretColor: 'var(--ink)' },
  '.cm-line': { padding: '0' }
})

export interface MarkdownEditorProps {
  readonly label: string
  /** Read once, when the editor mounts; the editor owns the text from then on. */
  readonly initial: string
  readonly maxLength: number
  readonly autoFocus: boolean
  readonly onChange: (text: string) => void
  readonly onSave: (text: string) => void
  readonly onCancel: () => void
}

export function MarkdownEditor({
  label,
  initial,
  maxLength,
  autoFocus,
  onChange,
  onSave,
  onCancel
}: MarkdownEditorProps): React.JSX.Element {
  const { t } = useTranslation()
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const opening = useRef({ label, initial, maxLength, autoFocus, done: t('markdownEditor.done') })
  const handlers = useLatest({ onChange, onSave, onCancel })

  useEffect(() => {
    const { label, initial, maxLength, autoFocus, done } = opening.current
    const editor = new EditorView({
      parent: present(host.current, 'the mounted editor host'),
      state: EditorState.create({
        doc: initial,
        selection: { anchor: initial.length },
        extensions: [
          history(),
          keymap.of([
            { key: 'Mod-b', run: bold },
            { key: 'Mod-i', run: italic },
            { key: 'Mod-e', run: code },
            { key: 'Mod-k', run: link },
            {
              any: (target, event) => {
                if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return false
                if (event.isComposing) return false
                handlers.current.onSave(target.state.doc.toString())
                return true
              }
            },
            {
              key: 'Escape',
              run: () => {
                handlers.current.onCancel()
                return true
              }
            },
            ...defaultKeymap,
            ...historyKeymap
          ]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': label }),
          EditorState.transactionFilter.of((transaction) =>
            transaction.newDoc.length > Math.max(maxLength, transaction.startState.doc.length)
              ? []
              : transaction
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) handlers.current.onChange(update.state.doc.toString())
          }),
          livePreview(done),
          theme
        ]
      })
    })
    view.current = editor
    if (autoFocus) editor.focus()
    return () => {
      editor.destroy()
    }
  }, [handlers])

  const run = (command: StateCommand): void => {
    const editor = present(view.current, 'the mounted editor')
    command(editor)
    editor.focus()
  }

  return (
    <div className="input has-[.cm-focused]:outline-accent flex h-auto flex-col px-0 has-[.cm-focused]:outline-2 has-[.cm-focused]:outline-offset-2">
      <div
        role="group"
        aria-label={t('markdownEditor.toolbar')}
        className="border-line flex flex-wrap items-center gap-0.5 border-b px-1 py-0.5"
      >
        {GROUPS.map((group, index) => (
          <div key={group.name} className="flex items-center gap-0.5">
            {index > 0 && <span aria-hidden className="bg-line mx-1 h-4 w-px" />}
            {group.tools.map((tool) => (
              <IconButton
                key={tool.name}
                label={t(`markdownEditor.${tool.name}`)}
                onClick={() => {
                  run(tool.run)
                }}
              >
                <tool.icon aria-hidden size={13} />
              </IconButton>
            ))}
          </div>
        ))}
      </div>
      <div ref={host} />
    </div>
  )
}
