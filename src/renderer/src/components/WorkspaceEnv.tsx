import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Modal } from './Modal.js'

/**
 * A workspace's env file, as it stands on disk.
 *
 * The file itself, never a reconstruction from the project's block: the
 * question this answers is "what will the scripts actually read", and a preview
 * assembled here would agree with everything except reality — the carried
 * lines, a hand edit inside the worktree, the port as it was settled.
 *
 * Read-only. Editing it here would fight the block, which is rewritten on every
 * run; the place to change what it says is the project's variables.
 */
export function WorkspaceEnv({
  workspaceId,
  onClose
}: {
  readonly workspaceId: string
  readonly onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [contents, setContents] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const answer = await window.octopus.workspaces.env(workspaceId)
      if (controller.signal.aborted) return

      // A workspace with no env file at all is the ordinary state of one whose
      // project adds nothing, and saying so beats an empty box.
      setMissing(!answer.ok || answer.value === null)
      setContents(answer.ok ? answer.value : null)
    })()

    return () => {
      controller.abort()
    }
  }, [workspaceId])

  return (
    <Modal title={t('scripts.showEnv')} onClose={onClose} size="md">
      <div className="px-4 py-3">
        {missing ? (
          <p className="text-ink-faint">{t('scripts.noEnv')}</p>
        ) : (
          <pre className="bg-canvas border-line overflow-x-auto rounded-[var(--radius-control)] border px-2 py-1.5 font-mono text-[11px] leading-relaxed">
            {contents}
          </pre>
        )}
      </div>
    </Modal>
  )
}
