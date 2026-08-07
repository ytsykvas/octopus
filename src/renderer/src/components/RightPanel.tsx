import { PanelRightClose } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { WorkspaceView } from '@core/workspaces.js'

import { ResizeHandle } from './ResizeHandle.js'
import { WorkspaceTerminals } from './WorkspaceTerminals.js'

/**
 * Right pane — changes and terminal in tabs (§10.8).
 *
 * The changes tab gets its content with the diff viewer; the terminal is live.
 */
type RightTab = 'diff' | 'terminal'

const TABS: readonly {
  readonly id: RightTab
  readonly labelKey: 'panel.changes' | 'panel.terminal'
}[] = [
  { id: 'diff', labelKey: 'panel.changes' },
  { id: 'terminal', labelKey: 'panel.terminal' }
]

/** Matches the bounds on `rightPanelWidth` in the config schema. */
const MIN_WIDTH = 280
const MAX_WIDTH = 900

interface RightPanelProps {
  readonly workspaces: readonly WorkspaceView[]
  readonly activeWorkspaceId: string | null
  readonly width: number
  /** Persists the width; called when a drag ends, not during it. */
  readonly onWidthChange: (width: number) => void
  readonly onCollapse: () => void
}

export function RightPanel({
  workspaces,
  activeWorkspaceId,
  width,
  onWidthChange,
  onCollapse
}: RightPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const [tab, setTab] = useState<RightTab>('diff')
  // The pane follows the cursor from local state; the config only hears about
  // the width once the drag is over.
  const [dragWidth, setDragWidth] = useState<number | null>(null)

  return (
    <section
      style={{ width: dragWidth ?? width }}
      className="border-line bg-surface relative flex shrink-0 flex-col border-l"
    >
      <ResizeHandle
        width={dragWidth ?? width}
        min={MIN_WIDTH}
        max={MAX_WIDTH}
        onResize={setDragWidth}
        onCommit={(committed) => {
          setDragWidth(null)
          onWidthChange(committed)
        }}
      />

      <div className="border-line flex h-11 shrink-0 items-center gap-1 border-b px-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id)
            }}
            className={`focus-ring h-7 rounded-[var(--radius-control)] px-2.5 font-medium transition-colors ${
              tab === item.id ? 'bg-muted text-ink' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {t(item.labelKey)}
          </button>
        ))}

        <button
          type="button"
          onClick={onCollapse}
          title={t('panel.collapse')}
          className="text-ink-faint hover:text-ink focus-ring ml-auto rounded p-1 transition-colors"
        >
          <PanelRightClose aria-hidden size={14} />
        </button>
      </div>

      {/* The terminal gets no padding and no scroll container of its own:
          xterm scrolls itself, and padding throws off its column count. The
          changes tab keeps both. */}
      {tab === 'diff' ? (
        <div className="flex-1 overflow-auto p-4">
          <p className="text-ink-faint leading-relaxed">{t('panel.changesPlaceholder')}</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <WorkspaceTerminals workspaces={workspaces} activeId={activeWorkspaceId} />
        </div>
      )}
    </section>
  )
}
