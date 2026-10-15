import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { RepositoryTrust } from '@core/repoTrust.js'

import { useErrorMessage } from '../hooks/useErrorMessage.js'
import { Button } from './Button.js'
import { Modal } from './Modal.js'

/**
 * What this repository can make the agent do, shown before it is allowed to.
 *
 * octopus loads every settings source, as the CLI does — so a repository's
 * `.claude/settings.json` pre-approves tools without a dialog, its hooks run
 * shell commands around every tool call, and `.mcp.json` starts servers. This
 * is the one place somebody sees that before it happens.
 *
 * Read-only, and the whole contents rather than a summary: a summary of a file
 * that grants capability is a summary somebody has to trust instead.
 */
export function RepoTrustReview({
  projectId,
  workspaceId,
  onApproved,
  onClose
}: {
  readonly projectId: string
  /** The worktree to read, or null for the checkout — as Project settings asks. */
  readonly workspaceId: string | null
  readonly onApproved: () => void
  readonly onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const describe = useErrorMessage()
  const [trust, setTrust] = useState<RepositoryTrust | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Bumped to read again after a refusal, so what is shown is what is there.
  const [reading, setReading] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const answer = await window.octopus.projects.trust(projectId, workspaceId)
      if (!controller.signal.aborted && answer.ok) setTrust(answer.value)
    })()

    return () => {
      controller.abort()
    }
  }, [projectId, workspaceId, reading])

  const files = trust?.files ?? []

  return (
    <Modal
      title={t('trust.title')}
      onClose={onClose}
      size="md"
      footer={
        // Nothing read yet is nothing to allow, so the button has no digest to
        // send until there is one on screen.
        trust === null ? (
          <Button disabled>{t('trust.approve')}</Button>
        ) : (
          <Button
            onClick={() => {
              void (async () => {
                // The digest of what is on screen, so a repository that changed
                // since it was read is refused rather than allowed unseen.
                const done = await window.octopus.projects.approveSettings(
                  projectId,
                  workspaceId,
                  trust.digest
                )
                if (done.ok) {
                  onApproved()
                  return
                }
                setError(describe(done))
                setReading((count) => count + 1)
              })()
            }}
          >
            {t('trust.approve')}
          </Button>
        )
      }
    >
      <div className="space-y-4 px-4 py-3">
        <p className="text-ink-soft max-w-2xl leading-relaxed">{t('trust.explain')}</p>

        {error !== null && (
          <p role="alert" className="text-danger leading-relaxed">
            {error}
          </p>
        )}

        {files.map((file) => (
          <div key={file.path} className="space-y-1.5">
            <p className="font-mono text-[11px] font-medium">{file.path}</p>

            {/* A link out of the worktree is neither read nor left out. Reading
                it would put whatever it points at — a private key, say — into
                this card, and leaving it out is how a hook came to run without
                anybody being shown it. So the destination stands in for the
                contents, here and in the digest. */}
            {file.link === true ? (
              <p className="text-warning border-warning/25 border-l pl-3 text-[11px] leading-relaxed">
                {file.contents === ''
                  ? t('trust.linkBroken')
                  : t('trust.linkRefused', { target: file.contents })}
              </p>
            ) : (
              <pre className="bg-canvas border-line overflow-x-auto rounded-[var(--radius-control)] border px-2 py-1.5 font-mono text-[11px] leading-relaxed">
                {file.contents}
              </pre>
            )}
          </div>
        ))}
      </div>
    </Modal>
  )
}
