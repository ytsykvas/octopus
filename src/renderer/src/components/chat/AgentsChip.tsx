import { useTranslation } from 'react-i18next'

import { liveAgents, liveCount, visibleTasks } from '@core/backgroundTasks.js'

import { useAnchoredPanel } from '../../hooks/useAnchoredPanel.js'
import { chatStatusTone } from '../agentStatus.js'
import { AgentMap, PANEL_MAX_SHARE } from './AgentMap.js'
import { useAgentTasks } from './agentTasks.js'

/** Wide enough for a description, its time and a model without the row wrapping. */
const PANEL_WIDTH = 380

/**
 * How many agents this conversation has at work, in the composer's attic.
 *
 * The one place it says so without opening anything — Claude Code's VS Code
 * panel keeps it in the same spot. Absent until an agent has run; then the
 * count of those working with a dot that turns amber when one is waiting on
 * an answer, or, once all are done, how many there were, quietly. While any
 * is working the chip wears the composer's colours as a turning line: work
 * nobody is watching is the one thing on the strip worth a second look.
 *
 * Opens the agent map.
 */
export function AgentsChip(): React.JSX.Element | null {
  const { t } = useTranslation()
  const tasks = useAgentTasks()
  const { open, position, container, toggle, close } = useAnchoredPanel()

  const shown = visibleTasks(tasks)
  // Nothing left to list — the conversation was reset under an open map — and
  // the panel must not come back by itself with the next agent.
  if (shown.length === 0 && open) close()
  if (shown.length === 0) return null

  // Any work at all keeps the line turning; the number is agents, and falls
  // back to commands only where commands are all there is.
  const working = liveCount(shown)
  const agents = shown.filter((task) => task.kind !== 'shell')
  const waiting = shown.some((task) => task.waiting)
  const live = liveAgents(shown)
  const label =
    agents.length === 0
      ? t('agents.commandCount', { count: working > 0 ? working : shown.length })
      : t('agents.count', { count: live > 0 ? live : agents.length })

  const title = waiting
    ? t('agents.chipWaiting')
    : working > 0
      ? t('agents.chipWorking', { count: working })
      : t('agents.chipDone')

  // The tab strip's dot for the same three states, so the two never disagree.
  const dot = chatStatusTone(
    waiting ? 'waiting_permission' : working > 0 ? 'running' : 'idle',
    true
  )

  return (
    <div ref={container} className="contents">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        onClick={(event) => {
          event.stopPropagation()
          toggle(event.currentTarget, {
            width: PANEL_WIDTH,
            height: window.innerHeight * PANEL_MAX_SHARE
          })
        }}
        // The attic's own hover surface, cancelled by negative margins as the
        // readings beside it are, so the strip does not grow taller.
        className={`agents-chip focus-ring relative -my-0.5 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-1.5 py-0.5 tabular-nums transition-colors ${
          working > 0 ? 'text-ink-soft' : 'text-ink-faint'
        }`}
      >
        {working > 0 && <span aria-hidden className="agents-chip-line" />}
        <span aria-hidden className={`${dot} size-1.5 shrink-0 rounded-full`} />
        {label}
      </button>

      {open && position && (
        <div
          role="dialog"
          aria-label={t('agents.title')}
          style={{ ...position, width: PANEL_WIDTH }}
          className="border-line bg-canvas text-ink fixed z-50 overflow-hidden rounded-[var(--radius-panel)] border text-[13px] shadow-[var(--shadow-pop)]"
        >
          <AgentMap />
        </div>
      )}
    </div>
  )
}
