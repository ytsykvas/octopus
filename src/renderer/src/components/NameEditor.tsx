import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface NameEditorProps {
  readonly initial: string
  readonly onCommit: (name: string) => void
  readonly onCancel: () => void
}

/**
 * Inline rename, shared by projects and workspaces.
 *
 * Commits on blur as well as on Enter: clicking away is a common way to mean
 * "done", and losing the edit there would be surprising. An empty name cancels
 * rather than erroring — it is clearly a mistake mid-typing, not a request.
 */
export function NameEditor({ initial, onCommit, onCancel }: NameEditorProps): React.JSX.Element {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(initial)

  const commit = (): void => {
    const trimmed = draft.trim()
    if (trimmed === '') {
      onCancel()
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
      className="input focus-ring"
    />
  )
}
