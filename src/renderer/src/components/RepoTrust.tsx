import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ScriptsInWorkspace } from '@core/repoSource.js'
import type { RepositoryTrust } from '@core/repoTrust.js'
import { SCRIPT_KINDS } from '@core/scriptEnv.js'

import { useErrorMessage } from '../hooks/useErrorMessage.js'
import { Button } from './Button.js'
import { RepoTrustReview } from './RepoTrustReview.js'
import { Switch } from './Switch.js'

/** What each script is called to the reader, in the order they run. */
const SCRIPT_LABELS = {
  setup: 'project.setupScript',
  run: 'project.runScript',
  archive: 'project.archiveScript'
} as const

interface RepoTrustProps {
  readonly projectId: string
  /**
   * The workspace the dialog was opened from, or null for the checkout.
   *
   * Both gates are facts about a worktree, so this answers about the same
   * directory the Scripts section and the chat do.
   */
  readonly workspaceId: string | null
  /** The one switch: scripts, settings, hooks and MCP servers alike. */
  readonly trusted: boolean
  /** The older scripts-only switch, still honoured for scripts alone. */
  readonly trustedScripts: boolean
  readonly onTrustChange: (trusted: boolean) => void
}

/**
 * Everything a repository can make the app do on its own, and the one switch
 * that says whether it is believed.
 *
 * Two gates sit behind it — the scripts the Run button executes, and the
 * Claude settings, hooks and MCP servers a session loads — and they used to
 * live in two places: a switch here for the first, a banner in the chat for
 * the second and no switch at all. A project whose scripts were trusted went on
 * asking about its settings on every new workspace. One repository, one
 * decision, one place to see what it covers.
 *
 * The digests stay separate underneath on purpose: reading a hook file must
 * not quietly approve a build script. This is one view of both, not one list.
 */
export function RepoTrust({
  projectId,
  workspaceId,
  trusted,
  trustedScripts,
  onTrustChange
}: RepoTrustProps): React.JSX.Element {
  const { t } = useTranslation()
  const describe = useErrorMessage()

  const [runs, setRuns] = useState<ScriptsInWorkspace | null>(null)
  const [settings, setSettings] = useState<RepositoryTrust | null>(null)
  const [readingScripts, setReadingScripts] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Bumped to ask both gates again: after an approval, and after a refusal.
  const [asked, setAsked] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const [scripts, trust] = await Promise.all([
        window.octopus.projects.scripts(projectId, workspaceId),
        window.octopus.projects.trust(projectId, workspaceId)
      ])
      if (controller.signal.aborted) return
      // A repository that cannot be read supplies nothing as far as this list
      // is concerned; the Scripts tab is where the reason belongs.
      setRuns(scripts.ok ? scripts.value : null)
      setSettings(trust.ok ? trust.value : null)
    })()

    return () => {
      controller.abort()
    }
  }, [projectId, workspaceId, trusted, asked])

  const supplied = SCRIPT_KINDS.flatMap((kind) => {
    const script = runs?.scripts[kind]
    return script === undefined || script.source === 'project' ? [] : [script]
  })
  const scriptsAllowed = runs?.approved ?? false
  const files = settings?.files ?? []
  const settingsAllowed = settings?.approved ?? false

  return (
    <section className="flex flex-col gap-4">
      <p className="section-label">{t('project.trustTitle')}</p>

      <div className="flex max-w-lg items-start gap-3">
        <Switch checked={trusted} onChange={onTrustChange} label={t('project.trustSwitch')} />
        <div className="space-y-1">
          <p>{t('project.trustSwitch')}</p>
          <p className="text-ink-faint leading-relaxed">{t('project.trustHint')}</p>
          {!trusted && trustedScripts && (
            <p className="text-warning leading-relaxed">{t('project.trustLegacy')}</p>
          )}
        </div>
      </div>

      {error !== null && (
        <p role="alert" className="text-danger max-w-lg">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-ink-soft font-medium">{t('project.trustScripts')}</p>

        {supplied.length === 0 ? (
          <p className="text-ink-faint max-w-lg leading-relaxed">{t('project.repoRunsNone')}</p>
        ) : (
          <>
            <ul className="max-w-lg space-y-1">
              {supplied.map((script) => (
                <li key={script.kind} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span>{t(SCRIPT_LABELS[script.kind])}</span>
                    <span className="text-ink-faint truncate font-mono text-[11px]">
                      {script.from}
                    </span>
                  </div>
                  {readingScripts && (
                    <pre className="border-line bg-canvas max-h-60 overflow-auto rounded-[var(--radius-control)] border px-2 py-1.5 font-mono text-[11px] break-words whitespace-pre-wrap">
                      {script.contents}
                    </pre>
                  )}
                </li>
              ))}
            </ul>

            <p className={scriptsAllowed ? 'text-ink-faint' : 'text-warning'}>
              {t(scriptsAllowed ? 'project.repoRunsAllowed' : 'project.repoRunsWaiting')}
            </p>

            {!scriptsAllowed && runs !== null && (
              <div className="flex gap-2">
                {readingScripts ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      void (async () => {
                        setError(null)
                        // The digest of what is on screen, so a script that
                        // changed since it was shown is refused, not allowed.
                        const done = await window.octopus.projects.approveScripts(
                          projectId,
                          workspaceId,
                          runs.digest
                        )
                        if (!done.ok) setError(describe(done))
                        setReadingScripts(false)
                        setAsked((count) => count + 1)
                      })()
                    }}
                  >
                    {t('scripts.repoApprove')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => {
                      setReadingScripts(true)
                    }}
                  >
                    {t('project.trustReview')}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-ink-soft font-medium">{t('project.trustSettings')}</p>

        {files.length === 0 ? (
          <p className="text-ink-faint max-w-lg leading-relaxed">
            {t('project.trustSettingsNone')}
          </p>
        ) : (
          <>
            <ul className="max-w-lg space-y-1">
              {files.map((file) => (
                <li key={file.path} className="text-ink-faint truncate font-mono text-[11px]">
                  {file.path}
                </li>
              ))}
            </ul>

            <p className={settingsAllowed ? 'text-ink-faint' : 'text-warning'}>
              {t(settingsAllowed ? 'project.trustSettingsAllowed' : 'project.trustSettingsWaiting')}
            </p>

            {!settingsAllowed && (
              <div>
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => {
                    setReviewing(true)
                  }}
                >
                  {t('project.trustReview')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {reviewing && (
        <RepoTrustReview
          projectId={projectId}
          workspaceId={workspaceId}
          onApproved={() => {
            setReviewing(false)
            setAsked((count) => count + 1)
          }}
          onClose={() => {
            setReviewing(false)
          }}
        />
      )}
    </section>
  )
}
