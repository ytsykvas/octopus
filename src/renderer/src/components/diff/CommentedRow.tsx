import { MessageSquarePlus, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { DiffLine } from '@core/diff.js'

import type { DiffComment } from '../../hooks/useDiffComments.js'

/** What a row needs to offer a note, hold one, and give it back. */
export interface CommentSurface {
  readonly pending: readonly DiffComment[]
  /** The anchor of the line whose editor is open, or null when none is. */
  readonly editing: string | null
  readonly onEdit: (anchor: string | null) => void
  readonly onSave: (comment: DiffComment) => void
  readonly onRemove: (comment: DiffComment) => void
}

/**
 * Where a note sits: the file, which side of it, and the line.
 *
 * Null when the line carries no number on its own side. Nothing git produces
 * looks like that, but the type admits it and a row with nowhere to anchor a
 * note is better off offering none than anchoring it wrongly.
 */
export function anchorOf(path: string, line: DiffLine): Omit<DiffComment, 'text'> | null {
  const side = line.kind === 'removed' ? 'old' : 'new'
  const number = line.kind === 'removed' ? line.oldNumber : line.newNumber

  return number === null ? null : { path, side, line: number, code: line.text }
}

export function anchorKey(anchor: Omit<DiffComment, 'text'>): string {
  return `${anchor.path}:${anchor.side}:${String(anchor.line)}`
}

interface CommentedRowProps {
  readonly path: string
  readonly line: DiffLine
  readonly comments: CommentSurface
  readonly children: React.ReactNode
}

/**
 * A row of the diff, with somewhere to say something about it.
 *
 * The trigger is revealed on hover and reachable from the keyboard rather than
 * hidden outright: a control that only exists under a cursor is a control
 * nobody navigating by keyboard can find.
 */
export function CommentedRow({
  path,
  line,
  comments,
  children
}: CommentedRowProps): React.JSX.Element {
  const { t } = useTranslation()

  const anchor = anchorOf(path, line)
  if (!anchor) return <>{children}</>

  const key = anchorKey(anchor)
  const held = comments.pending.find((comment) => anchorKey(comment) === key)

  return (
    <div className="group relative">
      {children}

      <button
        type="button"
        onClick={() => {
          comments.onEdit(comments.editing === key ? null : key)
        }}
        // The two sides can carry the same number for different lines, so the
        // label has to say which file it means or the two are indistinguishable
        // to anything that reads it aloud.
        aria-label={t(anchor.side === 'old' ? 'diff.commentOld' : 'diff.comment', {
          line: anchor.line
        })}
        className="focus-ring bg-surface border-line text-ink-faint hover:text-accent absolute top-0 left-0.5 rounded-[var(--radius-control)] border p-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        <MessageSquarePlus aria-hidden size={11} />
      </button>

      {held && (
        <Note
          comment={held}
          onRemove={() => {
            comments.onRemove(held)
          }}
        />
      )}

      {comments.editing === key && (
        <Editor
          initial={held?.text ?? ''}
          onCancel={() => {
            comments.onEdit(null)
          }}
          onSave={(text) => {
            comments.onSave({ ...anchor, text })
            comments.onEdit(null)
          }}
        />
      )}
    </div>
  )
}

/** A note already written, shown where it was written. */
function Note({
  comment,
  onRemove
}: {
  readonly comment: DiffComment
  readonly onRemove: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="border-accent bg-muted ml-14 flex items-start gap-2 border-l-2 px-2 py-1">
      <p className="text-ink min-w-0 flex-1 break-words">{comment.text}</p>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('diff.commentRemove')}
        className="focus-ring text-ink-faint hover:text-danger shrink-0 rounded-[var(--radius-control)] p-0.5"
      >
        <X aria-hidden size={12} />
      </button>
    </div>
  )
}

/** Writing one. ⌘Enter saves, Escape leaves the line as it was. */
function Editor({
  initial,
  onSave,
  onCancel
}: {
  readonly initial: string
  readonly onSave: (text: string) => void
  readonly onCancel: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [text, setText] = useState(initial)

  const save = (): void => {
    const trimmed = text.trim()
    if (trimmed !== '') onSave(trimmed)
  }

  return (
    <div className="border-line bg-canvas ml-14 flex flex-col gap-1 border-l-2 px-2 py-1.5">
      <textarea
        // Focused on arrival: the trigger was a click that says "write here",
        // and a field that then waits to be clicked again says otherwise.
        autoFocus
        value={text}
        onChange={(event) => {
          setText(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) save()
        }}
        placeholder={t('diff.commentPlaceholder')}
        aria-label={t('diff.commentPlaceholder')}
        rows={2}
        className="input h-auto resize-none py-1 leading-relaxed"
      />
      <div className="flex justify-end gap-1">
        <button
          type="button"
          onClick={onCancel}
          className="focus-ring text-ink-soft hover:text-ink rounded-[var(--radius-control)] px-2 py-0.5"
        >
          {t('diff.commentCancel')}
        </button>
        <button
          type="button"
          onClick={save}
          className="focus-ring bg-accent text-on-accent hover:bg-accent-hover rounded-[var(--radius-control)] px-2 py-0.5"
        >
          {t('diff.commentSave')}
        </button>
      </div>
    </div>
  )
}
