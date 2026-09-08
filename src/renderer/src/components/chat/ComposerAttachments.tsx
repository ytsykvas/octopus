import { Paperclip, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { type ChatNote, noteKey } from './attachments.js'

/**
 * What each note is called on its chip.
 *
 * A diff note by the file and the lines it covers; a review remark by the
 * request and whoever wrote it. Both are the shortest thing that would let
 * somebody find it again.
 *
 * The side is on it for the same reason it is in the message: two notes at the
 * same number on opposite sides are different notes, and this is the last
 * moment before sending when saying so still lets somebody take one back.
 */
function label(note: ChatNote, oldSide: string): string {
  if (note.kind === 'diff') {
    const lines =
      note.endLine === note.line
        ? String(note.line)
        : `${String(note.line)}-${String(note.endLine)}`
    const mark = note.side === 'old' ? ` ${oldSide}` : ''

    return `${note.path.slice(note.path.lastIndexOf('/') + 1)}:${lines}${mark}`
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
 * The notes and files riding along with the next message.
 *
 * Shown rather than merely counted: what goes out is written into the message
 * itself (§4), and a chip that names the file and the line is what makes that
 * checkable before it is sent rather than after. An attached file is the same
 * bargain — the message carries its **path**, and the chip is what says so
 * before the message goes.
 *
 * One strip for both kinds rather than two. They are one answer to "what else
 * is going out with this", and two rules over one field would say the opposite.
 *
 * The strip disappears when there is nothing to say, the way the attic above it
 * does — an empty rule over the field would be chrome asserting that a review
 * exists.
 */
export function ComposerAttachments({
  notes,
  onRemove,
  files,
  onRemoveFile
}: {
  readonly notes: readonly ChatNote[]
  readonly onRemove: (note: ChatNote) => void
  /** Paths the message will name; never copies of the files themselves. */
  readonly files: readonly string[]
  readonly onRemoveFile: (path: string) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()

  if (notes.length === 0 && files.length === 0) return null

  return (
    /* Room above as well as below. The strip sits directly under the attic's
       bottom rule, and with padding on one side only the chips touched the line
       while floating over the field — which read as though they belonged to the
       row above rather than to the message. */
    <div className="flex flex-wrap gap-1 px-1 pt-2 pb-1">
      {/* Files first: they are what the message is about more often than a note
          is, and a strip that reorders as notes arrive would be hard to aim at. */}
      {files.map((path) => (
        <span
          key={path}
          className="border-line bg-muted text-ink-soft flex max-w-full items-center gap-1 rounded-[var(--radius-control)] border px-1.5 py-0.5"
        >
          <Paperclip aria-hidden size={11} className="text-ink-faint shrink-0" />
          {/* The name, with the whole path on hover: a chip wide enough for
              `/Users/…/Desktop/Screenshot 2026-09-06 at 14.02.11.png` is a chip
              that pushes everything else off the strip. */}
          <span className="min-w-0 truncate text-[11px]" title={path}>
            {path.slice(path.lastIndexOf('/') + 1)}
          </span>
          <button
            type="button"
            onClick={() => {
              onRemoveFile(path)
            }}
            aria-label={t('chat.attachRemove')}
            className="focus-ring text-ink-faint hover:text-danger shrink-0 rounded-[var(--radius-control)]"
          >
            <X aria-hidden size={11} />
          </button>
        </span>
      ))}

      {notes.map((note) => (
        <span
          key={noteKey(note)}
          className="border-line bg-muted text-ink-soft flex max-w-full items-center gap-1 rounded-[var(--radius-control)] border px-1.5 py-0.5"
        >
          <span className="text-ink-faint shrink-0 font-mono text-[11px]">
            {label(note, t('diff.noteOldSideShort'))}
          </span>
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
