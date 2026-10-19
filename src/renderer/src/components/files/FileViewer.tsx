import { Copy, ExternalLink, MessageSquarePlus, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { CodeNote } from '../../hooks/useCodeNotes.js'
import { useFileContent } from '../../hooks/useFileContent.js'
import { codeReference, lineRange } from '../codeReference.js'
import { NoteEditor } from '../NoteEditor.js'
import { ColouredLines, useColouredText } from '../diff/colouredText.js'
import { fileSize } from '../fileSize.js'
import { IconButton, Notice } from '../paneControls.js'
import { type CodeSelection, codeSelection } from './codeSelection.js'

/** A conversation a note on the selected lines can be sent to. */
export interface NoteTarget {
  readonly key: string
  readonly name: string
  /** The one that was in front last, offered as the primary action. */
  readonly active: boolean
}

interface FileViewerProps {
  readonly workspaceId: string
  readonly path: string
  readonly onError: (message: string | null) => void
  /** The workspace's conversations, each a button over a selection. */
  readonly targets: readonly NoteTarget[]
  /** Hands a note to one conversation. The file stays in front. */
  readonly onNote: (tabKey: string, note: CodeNote) => void
}

/**
 * A file of the workspace, read-only, in the centre where the conversations
 * are.
 *
 * Read-only on purpose: the agent writes these files, and an editor here would
 * be a second writer racing it with nothing to say which won. "Open in editor"
 * is the way to change one.
 */
export function FileViewer({
  workspaceId,
  path,
  onError,
  targets,
  onNote
}: FileViewerProps): React.JSX.Element {
  const { t } = useTranslation()
  const { content, error, reload, openExternally } = useFileContent(workspaceId, path)

  const open = async (): Promise<void> => {
    const failure = await openExternally()
    if (failure !== null) onError(failure)
  }

  const body = (): React.JSX.Element => {
    if (error !== null) return <Notice tone="danger">{error}</Notice>
    if (content === null) return <Notice>{t('viewer.loading')}</Notice>

    switch (content.kind) {
      case 'text':
        return <Code path={path} text={content.text} targets={targets} onNote={onNote} />
      case 'binary':
        return <Notice>{t('viewer.binary', { size: fileSize(content.bytes) })}</Notice>
      case 'tooLarge':
        return (
          <Notice>
            {t('viewer.tooLarge', {
              size: fileSize(content.bytes),
              limit: fileSize(content.limit)
            })}
          </Notice>
        )
      case 'missing':
        return <Notice>{t('viewer.missing')}</Notice>
      case 'deleted':
        return content.text === null ? (
          <Notice>{t('viewer.deletedUnreadable')}</Notice>
        ) : (
          <>
            <p className="bg-danger-bg text-danger border-line shrink-0 border-b px-4 py-1.5 text-[12px]">
              {t('viewer.deleted')}
            </p>
            <Code path={path} text={content.text} targets={targets} onNote={onNote} />
          </>
        )
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-line flex shrink-0 items-center gap-2 border-b px-4 py-1.5">
        <span className="text-ink-faint min-w-0 flex-1 truncate font-mono text-[11px]" title={path}>
          {path}
        </span>
        <IconButton label={t('viewer.reload')} onClick={reload}>
          <RefreshCw aria-hidden size={13} />
        </IconButton>
        <IconButton label={t('viewer.openExternally')} onClick={() => void open()}>
          <ExternalLink aria-hidden size={13} />
        </IconButton>
      </div>
      {body()}
    </div>
  )
}

/** How long "Path copied" stays before the button offers the copy again. */
const SETTLE_MS = 2000

type Copied = 'idle' | 'done' | 'failed'

const COPY_LABELS: Record<Copied, 'viewer.copyReference' | 'viewer.copied' | 'viewer.copyFailed'> =
  {
    idle: 'viewer.copyReference',
    done: 'viewer.copied',
    failed: 'viewer.copyFailed'
  }

/** Room between the toolbar and the selection it floats over. */
const TOOLBAR_GAP = 34
const EDITOR_WIDTH = 320
const EDGE = 12

/** A note being written: the lines it is about and the conversation it goes to. */
interface Writing extends CodeSelection {
  readonly target: NoteTarget
}

/**
 * The text with line numbers, coloured once the highlighter has it.
 *
 * Two `<pre>`s side by side rather than a row per line: a 5 000-line file is
 * then a handful of elements instead of ten thousand, and a selection in the
 * code never picks up the numbers.
 *
 * Selecting lines floats a toolbar over them: a button per conversation, which
 * opens a note on them aimed at that one, and a copy of their reference. ⌘C
 * copies the same reference rather than the text — this is a place to point
 * at code from, and "Open in editor" is there for taking the text itself.
 */
function Code({
  path,
  text,
  targets,
  onNote
}: {
  readonly path: string
  readonly text: string
  readonly targets: readonly NoteTarget[]
  readonly onNote: (tabKey: string, note: CodeNote) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { lines, tokens, tooLarge } = useColouredText(path, text)

  const scroller = useRef<HTMLDivElement>(null)
  const code = useRef<HTMLPreElement>(null)
  const [selected, setSelected] = useState<CodeSelection | null>(null)
  const [writing, setWriting] = useState<Writing | null>(null)
  const [copied, setCopied] = useState<Copied>('idle')

  /*
   * What is selected, watched rather than asked for — the diff's arrangement:
   * `selectionchange` fires for every way a selection is made, and a scroll
   * moves the range, so the toolbar's place is read again rather than closed.
   */
  useEffect(() => {
    const node = scroller.current
    const lines = code.current
    /* v8 ignore next */
    if (!node || !lines) return

    const read = (): void => {
      setSelected(codeSelection(lines, window.getSelection()))
    }

    document.addEventListener('selectionchange', read)
    node.addEventListener('scroll', read)
    return () => {
      document.removeEventListener('selectionchange', read)
      node.removeEventListener('scroll', read)
    }
  }, [])

  // Back to offering the copy on its own; a label still claiming one happened
  // describes a clipboard that has moved on.
  useEffect(() => {
    if (copied === 'idle') return
    const timer = setTimeout(() => {
      setCopied('idle')
    }, SETTLE_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [copied])

  const copy = async (passage: CodeSelection): Promise<void> => {
    try {
      await navigator.clipboard.writeText(codeReference(path, passage.line, passage.endLine))
      setCopied('done')
    } catch {
      // A refused clipboard is real — an unfocused document is enough.
      setCopied('failed')
    }
  }

  const save = (note: Writing, remark: string): void => {
    onNote(note.target.key, {
      path,
      line: note.line,
      endLine: note.endLine,
      code: lines.slice(note.line - 1, note.endLine).join('\n'),
      text: remark
    })
    setWriting(null)
    // The lines are dealt with; a selection left standing would bring the
    // toolbar straight back over them.
    window.getSelection()?.removeAllRanges()
  }

  // Kept inside the window whichever edge the selection is near.
  const within = (left: number, width: number): number =>
    Math.max(EDGE, Math.min(left, window.innerWidth - EDGE - width))

  return (
    <>
      {tooLarge && (
        <p className="text-ink-faint border-line shrink-0 border-b px-4 py-1.5 text-[11px]">
          {t('viewer.plain')}
        </p>
      )}
      <div ref={scroller} className="flex min-h-0 flex-1 overflow-auto">
        <pre
          aria-hidden
          // Its own ground, or long lines scrolled sideways show through it.
          className="text-ink-faint bg-canvas sticky left-0 shrink-0 py-3 pr-3 pl-4 text-right font-mono text-[12px] leading-[18px] select-none"
        >
          {lines.map((_, index) => index + 1).join('\n')}
        </pre>
        <pre
          ref={code}
          onCopy={(event) => {
            const passage = codeSelection(event.currentTarget, window.getSelection())
            if (passage === null) return
            event.clipboardData.setData(
              'text/plain',
              codeReference(path, passage.line, passage.endLine)
            )
            event.preventDefault()
          }}
          className="diff-code text-ink min-w-0 flex-1 py-3 pr-4 font-mono text-[12px] leading-[18px]"
        >
          <ColouredLines lines={lines} tokens={tokens} />
        </pre>
      </div>

      {/* Over the selection, where the eye already is. Above it unless that
          would leave the window, as on a selection at the very top. */}
      {selected !== null && writing === null && (
        <div
          role="toolbar"
          aria-label={t('viewer.selection', {
            range: lineRange(selected.line, selected.endLine)
          })}
          // Pressing a button must not take the selection away first: it is
          // what the button acts on.
          onMouseDown={(event) => {
            event.preventDefault()
          }}
          style={{
            top:
              selected.top - TOOLBAR_GAP < EDGE ? selected.bottom + 6 : selected.top - TOOLBAR_GAP,
            left: Math.max(EDGE, selected.left)
          }}
          className="bg-surface border-line fixed z-40 flex items-center gap-1 rounded-[var(--radius-control)] border p-1 shadow-[var(--shadow-pop)]"
        >
          {targets.map((target) => (
            <button
              key={target.key}
              type="button"
              onClick={() => {
                setWriting({ ...selected, target })
              }}
              className={`focus-ring flex h-6 items-center gap-1 rounded-[var(--radius-control)] px-2 text-[12px] whitespace-nowrap ${
                target.active
                  ? 'bg-accent text-on-accent hover:bg-accent-hover'
                  : 'text-ink-soft hover:bg-muted hover:text-ink'
              }`}
            >
              <MessageSquarePlus aria-hidden size={12} />
              {t('viewer.addTo', { name: target.name })}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void copy(selected)}
            className="focus-ring text-ink-soft hover:bg-muted hover:text-ink flex h-6 items-center gap-1 rounded-[var(--radius-control)] px-2 text-[12px] whitespace-nowrap"
          >
            <Copy aria-hidden size={12} />
            {t(COPY_LABELS[copied])}
          </button>
        </div>
      )}

      {writing !== null && (
        <div
          style={{
            top: writing.bottom + 6,
            left: within(writing.left, EDITOR_WIDTH),
            width: EDITOR_WIDTH
          }}
          className="bg-surface border-line fixed z-40 flex flex-col gap-1.5 rounded-[var(--radius-panel)] border p-2 shadow-[var(--shadow-pop)]"
        >
          <p className="text-ink-soft flex min-w-0 items-center gap-1.5 text-[12px]">
            <span className="shrink-0">{t('viewer.addTo', { name: writing.target.name })}</span>
            <span className="text-ink-faint truncate font-mono text-[11px]">
              {codeReference(path, writing.line, writing.endLine)}
            </span>
          </p>
          <NoteEditor
            className=""
            initial=""
            allowEmpty
            placeholder={t('viewer.notePlaceholder')}
            onSave={(remark) => {
              save(writing, remark)
            }}
            onCancel={() => {
              setWriting(null)
            }}
          />
        </div>
      )}
    </>
  )
}
