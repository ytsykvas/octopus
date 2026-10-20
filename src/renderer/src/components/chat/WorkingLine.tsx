import { useTranslation } from 'react-i18next'

import { useNow } from '../../hooks/useNow.js'
import { formatDuration } from './format.js'

/**
 * The line under a turn while the agent works: how long it has been at it.
 *
 * Claude Code's spinner line, and kept on screen while the answer streams as
 * the CLI keeps it: text arriving says the agent is talking, not that the turn
 * is over. It holds its own clock, so the tick each second redraws this line
 * and never the log above it.
 *
 * Without a start — nothing said since the last turn closed — it says only that
 * the agent is working, rather than counting from nowhere.
 */
export function WorkingLine({ since }: { readonly since: string | null }): React.JSX.Element {
  const { t } = useTranslation()
  const now = useNow()

  const started = since === null ? Number.NaN : Date.parse(since)
  const label = Number.isNaN(started)
    ? t('chat.working')
    : t('chat.workingElapsed', {
        elapsed: formatDuration(now - started, {
          minutes: t('usage.minutes'),
          seconds: t('usage.seconds')
        })
      })

  return (
    <p className="text-ink-faint flex items-center gap-2" role="status">
      <span className="bg-accent inline-block size-1.5 animate-pulse rounded-full motion-reduce:animate-none" />
      <span className="tabular-nums">{label}</span>
    </p>
  )
}
