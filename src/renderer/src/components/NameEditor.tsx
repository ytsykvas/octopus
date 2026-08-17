import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface NameEditorProps {
  readonly initial: string
  readonly onCommit: (name: string) => void
  readonly onCancel: () => void
  /**
   * What an empty name means, where it means something.
   *
   * A project and a workspace must be called something, so emptying the field
   * there is a slip mid-typing and cancels. A conversation has a name it is
   * given when it has none of its own, so clearing the field is a request —
   * the same shape as clearing a project's icon.
   */
  readonly onClear?: () => void
  /** Overridden where the field is not a whole row — the tab strip's is narrow. */
  readonly className?: string
}

/**
 * Inline rename, shared by projects and workspaces.
 *
 * Commits on blur as well as on Enter: clicking away is a common way to mean
 * "done", and losing the edit there would be surprising. An empty name cancels
 * rather than erroring — it is clearly a mistake mid-typing, not a request.
 */
export function NameEditor({
  initial,
  onCommit,
  onCancel,
  onClear,
  className = 'input focus-ring'
}: NameEditorProps): React.JSX.Element {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(initial)

  const commit = (): void => {
    const trimmed = draft.trim()
    if (trimmed === '') {
      if (onClear) onClear()
      else onCancel()
      return
    }
    onCommit(trimmed)
  }

  return (
    <input
      type="text"
      autoFocus
      value={draft}
      title={t('sidebar.renameHint')}
      spellCheck={false}
      onChange={(event) => {
        setDraft(event.target.value)
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
      onFocus={(event) => {
        event.target.select()
      }}
      className={className}
    />
  )
}
