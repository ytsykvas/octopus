import { Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { contextShare } from '@core/chats.js'
import type { ContextBreakdown, ContextCategoryId } from '@core/contextBreakdown.js'

import { useAnchoredPanel } from '../../hooks/useAnchoredPanel.js'
import { UsageBar } from '../UsageBar.js'
import { formatTokens, tailPath } from './format.js'

/** Room for a name, a size and a bar without either wrapping. */
const PANEL_WIDTH = 320
/** The panel never asks for more than this; the list inside scrolls instead. */
const MAX_HEIGHT = 480

// What the panel is made of, in pixels: the title strip and the footer note, a
// heading over each section that has rows, and a row. Estimates, since the
// panel is placed before it is drawn — like `panelHeight` for the skills — and
// `maxHeight` plus the scroll keeps it right when they are off.
const HEADER = 36
const FOOTER = 44
const HEADING = 24
const ROW = 30
const CHROME = HEADER + FOOTER

interface ContextPanelProps {
  readonly breakdown: ContextBreakdown
  /** What the window holds now, which every row is a share of. */
  readonly usedTokens: number
}

/**
 * How tall the panel will be with these rows, to place it before it is drawn.
 *
 * A section with nothing in it is not drawn and has no heading to count.
 */
export function contextPanelHeight(breakdown: ContextBreakdown): number {
  const sections = [
    breakdown.categories.length,
    breakdown.memoryFiles.length,
    breakdown.mcpServers.length,
    breakdown.tools.length
  ]
  const body = sections.reduce((sum, rows) => (rows === 0 ? sum : sum + HEADING + rows * ROW), 0)

  return Math.min(MAX_HEIGHT, CHROME + body)
}

interface Row {
  readonly key: string
  readonly label: string
  readonly tokens: number
  /** The whole of what the label shortens, where it does. */
  readonly title?: string
}

/**
 * What fills the context window, from the reading the strip already holds.
 *
 * Four sections — the kinds of row, the memory files, the MCP servers and the
 * heaviest tools — each drawn only when it has rows, all in the one neutral
 * colour. `warning` and `danger` already say how full the window is, and
 * painting a category with them would claim something about it that is not so.
 *
 * It lists and does not act. Nothing here can take a single message out of the
 * conversation, because no API does; the footer says where forgetting what
 * follows a message is done instead.
 */
export function ContextPanel({ breakdown, usedTokens }: ContextPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const { open, position, container, toggle } = useAnchoredPanel()

  // A record rather than a list, so an id with no label is a type error here
  // instead of a row drawn with a blank name.
  const kinds: Record<ContextCategoryId, string> = {
    system_prompt: t('chat.contextCategorySystemPrompt'),
    system_tools: t('chat.contextCategorySystemTools'),
    mcp_tools: t('chat.contextCategoryMcpTools'),
    mcp_instructions: t('chat.contextCategoryMcpInstructions'),
    custom_agents: t('chat.contextCategoryCustomAgents'),
    memory_files: t('chat.contextCategoryMemoryFiles'),
    skills: t('chat.contextCategorySkills'),
    messages: t('chat.contextCategoryMessages')
  }

  const sections: { id: string; heading: string; rows: readonly Row[] }[] = [
    {
      id: 'categories',
      heading: t('chat.contextBreakdownCategories'),
      rows: breakdown.categories.map(({ id, tokens }) => ({ key: id, label: kinds[id], tokens }))
    },
    {
      id: 'memory',
      heading: t('chat.contextBreakdownMemoryFiles'),
      rows: breakdown.memoryFiles.map(({ path, tokens }) => ({
        key: path,
        label: tailPath(path),
        tokens,
        title: path
      }))
    },
    {
      id: 'mcp',
      heading: t('chat.contextBreakdownMcpServers'),
      rows: breakdown.mcpServers.map(({ name, tokens }) => ({ key: name, label: name, tokens }))
    },
    {
      id: 'tools',
      heading: t('chat.contextBreakdownTools'),
      rows: breakdown.tools.map(({ name, tokens }) => ({ key: name, label: name, tokens }))
    }
  ]

  return (
    <div ref={container} className="contents">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('chat.contextBreakdownTitle')}
        title={t('chat.contextBreakdownTitle')}
        onClick={(event) => {
          event.stopPropagation()
          toggle(event.currentTarget, {
            width: PANEL_WIDTH,
            height: contextPanelHeight(breakdown)
          })
        }}
        // The skills button's surface, so the two sit on the strip as a pair.
        className={`focus-ring hover:bg-muted hover:text-ink-soft -my-0.5 inline-flex items-center rounded-[var(--radius-control)] px-1 py-0.5 transition-colors ${
          open ? 'bg-muted text-ink-soft' : ''
        }`}
      >
        <Layers aria-hidden size={11} className="shrink-0 opacity-70" />
      </button>

      {open && position && (
        <div
          role="dialog"
          aria-label={t('chat.contextBreakdownTitle')}
          style={{ ...position, width: PANEL_WIDTH }}
          className="border-line bg-canvas fixed z-50 rounded-[var(--radius-panel)] border shadow-[var(--shadow-pop)]"
        >
          <p className="border-line text-ink-faint border-b px-3 py-2 text-[11px]">
            {t('chat.contextBreakdownTitle')}
          </p>

          <div className="overflow-y-auto pb-1" style={{ maxHeight: MAX_HEIGHT - CHROME }}>
            {sections
              .filter((section) => section.rows.length > 0)
              .map((section) => (
                <section key={section.id}>
                  <p className="text-ink-faint px-3 pt-2 text-[10px] tracking-wide uppercase">
                    {section.heading}
                  </p>
                  <ul>
                    {section.rows.map((row) => (
                      <li key={row.key} className="space-y-1 px-3 py-1">
                        <div className="flex justify-between gap-3 text-[11px]">
                          <span className="text-ink-soft truncate" title={row.title}>
                            {row.label}
                          </span>
                          <span className="text-ink-faint tabular-nums">
                            {formatTokens(row.tokens)}
                          </span>
                        </div>
                        <UsageBar
                          kind="share"
                          label={row.label}
                          percentage={contextShare(row.tokens, usedTokens)}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
          </div>

          <p className="border-line text-ink-faint border-t px-3 py-2 text-[11px]">
            {t('chat.contextBreakdownRewindNote')}
          </p>
        </div>
      )}
    </div>
  )
}
