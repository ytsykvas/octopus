import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Writing a note on code: a field, Cancel and Add. ⌘Enter saves, Escape leaves
 * things as they were.
 *
 * Shared by the diff, where a note is written under the line it is about, and
 * the file viewer, where it floats under a selection. The frame around it is
 * the caller's, which is why `className` styles the outside only.
 */
export function NoteEditor({
  initial,
  placeholder,
  allowEmpty = false,
  className,
  onChange,
  onSave,
  onCancel
}: {
  readonly initial: string
  readonly placeholder: string
  /**
   * Whether a note with no words may be saved. The viewer's may: the lines
   * and their place are worth sending on their own. The diff's may not, since
   * its line is already in front of the agent as part of the change.
   */
  readonly allowEmpty?: boolean
  readonly className: string
  readonly onChange?: (text: string) => void
  readonly onSave: (text: string) => void
  readonly onCancel: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [text, setText] = useState(initial)

  const trimmed = text.trim()
  const empty = trimmed === '' && !allowEmpty

  const save = (): void => {
    if (!empty) onSave(trimmed)
  }

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <textarea
        // Focused on arrival: the trigger was a click that says "write here",
        // and a field that then waits to be clicked again says otherwise.
        autoFocus
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          onChange?.(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) save()
        }}
        placeholder={placeholder}
        aria-label={placeholder}
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
          // An empty note has nothing to send, and a button that accepts the
          // click and does nothing is worse than one that says it cannot.
          disabled={empty}
          className="focus-ring bg-accent text-on-accent hover:bg-accent-hover rounded-[var(--radius-control)] px-2 py-0.5 disabled:opacity-40"
        >
          {t('diff.commentSave')}
        </button>
      </div>
    </div>
  )
}
