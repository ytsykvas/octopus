import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { RepoConfigItem, RepoConfigView, RepoItemId } from '@core/repoConfig.js'

import { useErrorMessage } from '../hooks/useErrorMessage.js'
import { Button } from './Button.js'

/** What each state is called to the reader. */
const STATES = {
  onlyInRepository: 'project.repoStateOnlyInRepository',
  onlyInApp: 'project.repoStateOnlyInApp',
  same: 'project.repoStateSame',
  differs: 'project.repoStateDiffers'
} as const

interface RepoConfigProps {
  readonly projectId: string
}

/**
 * Writing a project's settings into its repository.
 *
 * `~/.octopus` lives on one machine and disappears with it. A repository may
 * carry a copy under `.octopus/`, and the app reads it while it works —
 * scripts, instructions, the base branch and the env file, each the
 * repository's unless the project chose its own; the rest is taken once, when
 * the project is added. So there is nothing to bring back in by hand. This is
 * the one direction left: writing what this installation holds into the
 * checkout, as an ordinary uncommitted change.
 *
 * A file the repository already holds with other contents is somebody's
 * decision about the whole team's setup, so writing over it asks first.
 */
export function RepoConfig({ projectId }: RepoConfigProps): React.JSX.Element {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()

  const [view, setView] = useState<RepoConfigView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [given, setGiven] = useState<RepoItemId[]>([])
  const [busy, setBusy] = useState(false)
  /** The files that would be written over, once Export has been pressed. */
  const [confirming, setConfirming] = useState<readonly RepoConfigItem[] | null>(null)

  /**
   * Reads what both sides hold, and ticks everything the app can offer.
   *
   * The common case is writing the lot, and a list of empty boxes makes that
   * the longest path through the panel.
   */
  const load = useCallback(
    async (signal: AbortSignal) => {
      const result = await window.octopus.projects.repoConfig(projectId)
      if (signal.aborted) return

      if (!result.ok) {
        setError(describeFailure(result))
        setView({ present: false, ignored: false, items: [] })
        return
      }

      setError(null)
      setView(result.value)
      setGiven(result.value.items.filter(inApp).map((item) => item.id))
    },
    [projectId, describeFailure]
  )

  useEffect(() => {
    const controller = new AbortController()

    // Awaited inside, rather than called from the effect body: state set
    // synchronously there is a cascading render the linter refuses, and the
    // signal is what keeps a slow answer from landing on an unmounted panel.
    void (async () => {
      await load(controller.signal)
    })()

    return () => {
      controller.abort()
    }
  }, [load])

  const write = async (): Promise<void> => {
    setConfirming(null)
    setBusy(true)
    const result = await window.octopus.projects.exportRepoConfig(projectId, given)
    setBusy(false)

    if (!result.ok) {
      setError(describeFailure(result))
      return
    }

    await load(new AbortController().signal)
  }

  if (!view) return <p className="text-ink-faint">{t('project.repoLoading')}</p>

  const holdable = view.items.filter(inApp)

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="section-label">{t('project.repoOut')}</p>
        <Button
          size="sm"
          disabled={busy || given.length === 0}
          onClick={() => {
            const over = holdable.filter(
              (item) => given.includes(item.id) && item.state === 'differs'
            )
            if (over.length > 0) setConfirming(over)
            else void write()
          }}
        >
          {t('project.repoExport')}
        </Button>
      </div>

      <p className="text-ink-faint max-w-lg leading-relaxed">{t('project.repoHint')}</p>

      {error !== null && <p className="text-danger">{error}</p>}

      {view.ignored && <p className="text-warning max-w-lg">{t('project.repoIgnored')}</p>}

      {confirming !== null && (
        <div
          role="alert"
          className="border-warning/30 bg-warning-bg flex max-w-lg flex-col gap-2 rounded-[var(--radius-control)] border px-3 py-2"
        >
          <p className="leading-relaxed">
            {t('project.repoOverwrite', { count: confirming.length })}
          </p>
          <ul className="font-mono text-[11px]">
            {confirming.map((item) => (
              <li key={item.id}>{item.path}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button size="sm" variant="accent" onClick={() => void write()}>
              {t('project.repoOverwriteConfirm')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setConfirming(null)
              }}
            >
              {t('project.repoOverwriteCancel')}
            </Button>
          </div>
        </div>
      )}

      <ul className="panel divide-line divide-y">
        {holdable.map((item) => (
          <Row
            key={item.id}
            item={item}
            checked={given.includes(item.id)}
            onToggle={() => {
              setGiven(toggle(given, item.id))
            }}
          />
        ))}
      </ul>
    </section>
  )
}

function inApp(item: RepoConfigItem): boolean {
  return item.app !== null
}

function toggle(ids: readonly RepoItemId[], id: RepoItemId): RepoItemId[] {
  return ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id]
}

/**
 * One file the app can write.
 *
 * The path rather than a translated name for it: this is the file that shows
 * up in `git status`, and the reader is going to look for it under exactly
 * that name.
 */
function Row({
  item,
  checked,
  onToggle
}: {
  readonly item: RepoConfigItem
  readonly checked: boolean
  readonly onToggle: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <li className="flex items-center gap-2 px-2 py-1.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="choice focus-ring"
        aria-label={item.path}
      />
      <span className="text-ink flex-1 truncate font-mono text-[11px]">{item.path}</span>
      <span className="text-ink-faint">{t(STATES[item.state])}</span>
    </li>
  )
}
