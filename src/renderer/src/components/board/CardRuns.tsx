import type { TFunction } from 'i18next'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import type { CardRunEntry } from '@core/boardSchema.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { formatDuration, formatTokens } from '../chat/format.js'
import { newestFirst, type RunState, runState } from './boardRuns.js'

const STATE_LABELS: Readonly<
  Record<RunState, 'board.runs.merged' | 'board.runs.removed' | 'board.runs.open'>
> = {
  merged: 'board.runs.merged',
  removed: 'board.runs.removed',
  open: 'board.runs.open'
}

function pullLabel(url: string): string {
  const number = /\/pull\/(\d+)/.exec(url)?.[1]
  return number === undefined ? url : `#${number}`
}

function runFigures(run: CardRunEntry, turns: number, t: TFunction): string {
  const accounts = run.accounts ?? []
  return [
    t('board.runs.turns', { count: turns }),
    formatDuration(run.activeMs ?? 0, { minutes: t('usage.minutes'), seconds: t('usage.seconds') }),
    t('board.runs.tokens', {
      input: formatTokens(run.tokensIn ?? 0),
      output: formatTokens(run.tokensOut ?? 0)
    }),
    ...(accounts.length > 0 ? [accounts.join(', ')] : [])
  ].join(' · ')
}

export function CardRuns({
  runs,
  deviceId,
  linked
}: {
  readonly runs: readonly CardRunEntry[]
  readonly deviceId: string
  readonly linked: WorkspaceView | null
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const headingId = useId()
  if (runs.length === 0) return null
  const day = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' })
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <h3 id={headingId} className="section-label">
        {t('board.runs.title')}
      </h3>
      <ol className="flex flex-col gap-1.5">
        {newestFirst(runs).map((run) => (
          <li key={run.started} className="text-ink-soft text-[11px]">
            <p>
              {[
                day.format(new Date(run.started)),
                run.machine,
                t(STATE_LABELS[runState(run, deviceId, linked)])
              ].join(' · ')}
              {run.pr !== undefined && (
                <>
                  {' · '}
                  <a
                    href={run.pr}
                    target="_blank"
                    rel="noreferrer"
                    className="focus-ring text-accent rounded hover:underline"
                  >
                    {pullLabel(run.pr)}
                  </a>
                </>
              )}
            </p>
            {run.turns !== undefined && <p>{runFigures(run, run.turns, t)}</p>}
          </li>
        ))}
      </ol>
    </section>
  )
}
