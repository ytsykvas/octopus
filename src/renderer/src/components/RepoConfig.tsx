import { ChevronDown, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { RepoConfigItem, RepoConfigView, RepoItemId } from '@core/repoConfig.js'
import type { ScriptsInWorkspace } from '@core/repoSource.js'
import { SCRIPT_KINDS } from '@core/scriptEnv.js'

import type { Result } from '../../../preload/index.js'

import { useErrorMessage } from '../hooks/useErrorMessage.js'
import { Button } from './Button.js'

/** What each script is called to the reader, in the order they run. */
const SCRIPT_LABELS = {
  setup: 'project.setupScript',
  run: 'project.runScript',
  archive: 'project.archiveScript'
} as const

/** What each state is called to the reader. */
const STATES = {
  onlyInRepository: 'project.repoStateOnlyInRepository',
  onlyInApp: 'project.repoStateOnlyInApp',
  same: 'project.repoStateSame',
  differs: 'project.repoStateDiffers'
} as const

interface RepoConfigProps {
  readonly projectId: string
  /** Whether this repository's scripts run without being read first. */
  readonly trusted: boolean
  /** Applies the switch; the dialog holds the project and has to be told. */
  readonly onTrustChange: (trusted: boolean) => void
  /**
   * Reports that something was imported.
   *
   * The project's own fields are among what can arrive, and the dialog around
   * this holds a copy of the project — so a base branch or a name taken from
   * the repository has to reach it, or the form goes on showing the old value.
   */
  readonly onImported: () => void
}

/**
 * Moving a project's settings between the app and its repository.
 *
 * `~/.octopus` lives on one machine and disappears with it. A repository may
 * carry a copy under `.octopus/`, and this is the whole of how it moves: two
 * lists, one in each direction, and nothing that happens on its own.
 *
 * Deliberately not automatic. Applying a repository's scripts as they arrive
 * would mean running shell somebody pushed, so what a repository carries is
 * shown — every byte of it, on the row — and imported only when asked.
 */
export function RepoConfig({
  projectId,
  trusted,
  onTrustChange,
  onImported
}: RepoConfigProps): React.JSX.Element {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()

  const [view, setView] = useState<RepoConfigView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [taken, setTaken] = useState<RepoItemId[]>([])
  const [given, setGiven] = useState<RepoItemId[]>([])
  const [open, setOpen] = useState<readonly RepoItemId[]>([])
  const [busy, setBusy] = useState(false)
  /** Which scripts the repository supplies, and whether they may run. */
  const [runs, setRuns] = useState<ScriptsInWorkspace | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const answer = await window.octopus.projects.scripts(projectId)
      // A repository whose settings will not parse supplies nothing as far as
      // this list is concerned; the Scripts tab is where the reason belongs.
      if (!controller.signal.aborted) setRuns(answer.ok ? answer.value : null)
    })()

    return () => {
      controller.abort()
    }
  }, [projectId, trusted])

  const supplied = SCRIPT_KINDS.flatMap((kind) => {
    const script = runs?.scripts[kind]
    return script === undefined || script.source === 'project' ? [] : [script]
  })
  const approved = runs?.approved ?? false

  /**
   * Reads what both sides hold, and ticks everything each can offer.
   *
   * The common case is taking or writing the lot, and a list of empty boxes
   * makes that the longest path through the panel.
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
      setTaken(result.value.items.filter(inRepository).map((item) => item.id))
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

  const run = async (
    call: (ids: readonly RepoItemId[]) => Promise<Result<RepoItemId[]>>,
    ids: readonly RepoItemId[],
    imported: boolean
  ): Promise<void> => {
    setBusy(true)
    const result = await call(ids)
    setBusy(false)

    if (!result.ok) {
      setError(describeFailure(result))
      return
    }

    if (imported) onImported()
    await load(new AbortController().signal)
  }

  if (!view) return <p className="text-ink-faint">{t('project.repoLoading')}</p>

  const offered = view.items.filter(inRepository)
  const holdable = view.items.filter(inApp)

  return (
    <div className="flex flex-col gap-5">
      <p className="text-ink-faint max-w-lg leading-relaxed">{t('project.repoHint')}</p>

      {error !== null && <p className="text-danger">{error}</p>}

      {view.ignored && <p className="text-warning max-w-lg">{t('project.repoIgnored')}</p>}

      {/* What this repository is allowed to *run*, beside what it carries.
          Both are the same question — how much of this checkout does the app
          believe — so they belong in one place rather than in a banner on
          another tab that appears once and is gone. */}
      <section className="flex flex-col gap-2">
        <p className="section-label">{t('project.repoRuns')}</p>

        {supplied.length === 0 ? (
          <p className="text-ink-faint max-w-lg leading-relaxed">{t('project.repoRunsNone')}</p>
        ) : (
          <>
            <ul className="max-w-lg space-y-1">
              {supplied.map((script) => (
                <li key={script.kind} className="flex items-baseline justify-between gap-3">
                  <span>{t(SCRIPT_LABELS[script.kind])}</span>
                  <span className="text-ink-faint truncate font-mono text-[11px]">
                    {script.from}
                  </span>
                </li>
              ))}
            </ul>

            <p className={approved ? 'text-ink-faint' : 'text-warning'}>
              {t(approved ? 'project.repoRunsAllowed' : 'project.repoRunsWaiting')}
            </p>
          </>
        )}

        <label className="mt-1 flex max-w-lg items-start gap-2">
          <input
            type="checkbox"
            checked={trusted}
            onChange={(event) => {
              onTrustChange(event.target.checked)
            }}
            className="focus-ring mt-0.5"
          />
          <span className="text-ink-soft leading-relaxed">{t('project.repoTrustHint')}</span>
        </label>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <p className="section-label">{t('project.repoIn')}</p>
          <Button
            size="sm"
            variant="accent"
            disabled={busy || taken.length === 0}
            onClick={() =>
              void run(
                (ids) => window.octopus.projects.importRepoConfig(projectId, ids),
                taken,
                true
              )
            }
          >
            {t('project.repoImport')}
          </Button>
        </div>

        {offered.length === 0 ? (
          <p className="text-ink-faint">{t('project.repoNothingOffered')}</p>
        ) : (
          <ul className="panel divide-line divide-y">
            {offered.map((item) => (
              <Row
                key={item.id}
                item={item}
                checked={taken.includes(item.id)}
                onToggle={() => {
                  setTaken(toggle(taken, item.id))
                }}
                expanded={open.includes(item.id)}
                onExpand={() => {
                  setOpen(toggle(open, item.id))
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <p className="section-label">{t('project.repoOut')}</p>
          <Button
            size="sm"
            disabled={busy || given.length === 0}
            onClick={() =>
              void run(
                (ids) => window.octopus.projects.exportRepoConfig(projectId, ids),
                given,
                false
              )
            }
          >
            {t('project.repoExport')}
          </Button>
        </div>

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
    </div>
  )
}

function inRepository(item: RepoConfigItem): boolean {
  return item.repository !== null
}

function inApp(item: RepoConfigItem): boolean {
  return item.app !== null
}

function toggle(ids: readonly RepoItemId[], id: RepoItemId): RepoItemId[] {
  return ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id]
}

/**
 * One file, on one side of the move.
 *
 * The path rather than a translated name for it: this is the file that shows
 * up in `git status`, and the reader is going to look for it under exactly
 * that name.
 */
function Row({
  item,
  checked,
  onToggle,
  expanded,
  onExpand
}: {
  readonly item: RepoConfigItem
  readonly checked: boolean
  readonly onToggle: () => void
  readonly expanded?: boolean
  readonly onExpand?: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const Chevron = expanded === true ? ChevronDown : ChevronRight

  return (
    <li className="flex flex-col">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="focus-ring accent-accent"
          aria-label={item.path}
        />
        <span className="text-ink flex-1 truncate font-mono text-[11px]">{item.path}</span>
        <span className="text-ink-faint">{t(STATES[item.state])}</span>

        {onExpand !== undefined && (
          <button
            type="button"
            onClick={onExpand}
            className="focus-ring text-ink-faint hover:text-ink rounded-[var(--radius-control)]"
            aria-label={t('project.repoShow', { path: item.path })}
            aria-expanded={expanded === true}
          >
            <Chevron size={14} />
          </button>
        )}
      </div>

      {/* What would be written, before it is written. A script arriving from a
          repository is somebody else's shell, and importing one nobody has read
          is the thing this panel exists to avoid. */}
      {expanded === true && item.repository !== null && (
        <pre className="bg-muted text-ink-soft max-h-64 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
          {item.repository}
        </pre>
      )}
    </li>
  )
}
