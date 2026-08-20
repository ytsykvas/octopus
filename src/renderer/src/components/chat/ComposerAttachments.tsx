import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { type ChatNote, noteKey } from './attachments.js'

/**
 * What each note is called on its chip.
 *
 * A diff note by the file and the lines it covers; a review remark by the
 * request and whoever wrote it. Both are the shortest thing that would let
 * somebody find it again.
 */
function label(note: ChatNote): string {
  if (note.kind === 'diff') {
    const lines =
      note.endLine === note.line
        ? String(note.line)
        : `${String(note.line)}-${String(note.endLine)}`

    return `${note.path.slice(note.path.lastIndexOf('/') + 1)}:${lines}`
  }

  const place = note.place === null ? null : note.place.slice(note.place.lastIndexOf('/') + 1)

  return [note.reference, note.author === null ? null : `@${note.author}`, place]
    .filter((part) => part !== null)
    .join(' ')
}

/** The remark itself, which is the user's own on a diff note and GitHub's here. */
function said(note: ChatNote): string {
  return note.kind === 'diff' ? note.text : note.body
}

/**
 * The notes riding along with the next message.
 *
 * Shown rather than merely counted: what goes out is written into the message
 * itself (§4), and a chip that names the file and the line is what makes that
 * checkable before it is sent rather than after.
 *
 * The strip disappears when there is nothing to say, the way the attic above it
 * does — an empty rule over the field would be chrome asserting that a review
 * exists.
 */
export function ComposerAttachments({
  notes,
  onRemove
}: {
  readonly notes: readonly ChatNote[]
  readonly onRemove: (note: ChatNote) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()

  if (notes.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1 px-1 pb-1">
      {notes.map((note) => (
        <span
          key={noteKey(note)}
          className="border-line bg-muted text-ink-soft flex max-w-full items-center gap-1 rounded-[var(--radius-control)] border px-1.5 py-0.5"
        >
          <span className="text-ink-faint shrink-0 font-mono text-[11px]">{label(note)}</span>
          <span className="min-w-0 truncate text-[11px]">{said(note)}</span>
          <button
            type="button"
            onClick={() => {
              onRemove(note)
            }}
            aria-label={t('diff.commentRemove')}
            className="focus-ring text-ink-faint hover:text-danger shrink-0 rounded-[var(--radius-control)]"
          >
            <X aria-hidden size={11} />
          </button>
        </span>
      ))}
    </div>
  )
}
