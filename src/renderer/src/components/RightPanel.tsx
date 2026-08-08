import { PanelRightClose } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { WorkspaceView } from '@core/workspaces.js'

import { ResizeHandle } from './ResizeHandle.js'
import { ScriptRunner } from './ScriptRunner.js'
import { WorkspaceTerminals } from './WorkspaceTerminals.js'

/**
 * Right pane — changes and terminal in tabs (§10.8).
 *
 * The changes tab gets its content with the diff viewer; the terminal is live.
 */
type RightTab = 'diff' | 'terminal' | 'build' | 'server'

const TABS: readonly {
  readonly id: RightTab
  readonly labelKey: 'panel.changes' | 'panel.terminal' | 'scripts.build' | 'scripts.server'
}[] = [
  { id: 'diff', labelKey: 'panel.changes' },
  { id: 'terminal', labelKey: 'panel.terminal' },
  { id: 'build', labelKey: 'scripts.build' },
  { id: 'server', labelKey: 'scripts.server' }
]

/** Matches the lower bound on `rightPanelWidth` in the config schema. */
const MIN_WIDTH = 280

/**
 * Room the rest of the window keeps: the sidebar (`w-64`) plus enough centre
 * pane to still be one. The pane can take everything else, so on a wide
 * display the terminal gets genuinely wide, while on a laptop the working area
 * survives.
 */
const SIDEBAR_WIDTH = 256
const MIN_CENTRE_WIDTH = 360

function maxWidthFor(windowWidth: number): number {
  return Math.max(MIN_WIDTH, windowWidth - SIDEBAR_WIDTH - MIN_CENTRE_WIDTH)
}

interface RightPanelProps {
  readonly workspaces: readonly WorkspaceView[]
  readonly activeWorkspaceId: string | null
  /** Absolute paths of the project's scripts; null when never written. */
  readonly scriptPaths: { readonly setup: string | null; readonly run: string | null }
  readonly onEditScripts: () => void
  readonly width: number
  /** Persists the width; called when a drag ends, not during it. */
  readonly onWidthChange: (width: number) => void
  readonly onCollapse: () => void
}

export function RightPanel({
  workspaces,
  activeWorkspaceId,
  scriptPaths,
  onEditScripts,
  width,
  onWidthChange,
  onCollapse
}: RightPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const [tab, setTab] = useState<RightTab>('diff')
  // The pane follows the cursor from local state; the config only hears about
  // the width once the drag is over.
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [maxWidth, setMaxWidth] = useState(() => maxWidthFor(window.innerWidth))

  const active = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null

  // The ceiling moves with the window: shrinking it must not leave the pane
  // covering the centre, and growing it should make the extra room available.
  useEffect(() => {
    const onResize = (): void => {
      setMaxWidth(maxWidthFor(window.innerWidth))
    }

    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
    }
  }, [])

  // Clamped on the way out rather than on the way in, so a width saved on a
  // wide display is kept in the config and comes back when the window does.
  const applied = Math.min(dragWidth ?? width, maxWidth)

  return (
    <section
      style={{ width: applied }}
      className="border-line bg-surface relative flex shrink-0 flex-col border-l"
    >
      <ResizeHandle
        width={applied}
        min={MIN_WIDTH}
        max={maxWidth}
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

      {/* Anything holding a terminal gets no padding and no scroll container
          of its own: xterm scrolls itself, and padding throws off its column
          count. The changes tab keeps both. */}
      {tab === 'diff' && (
        <div className="flex-1 overflow-auto p-4">
          <p className="text-ink-faint leading-relaxed">{t('panel.changesPlaceholder')}</p>
        </div>
      )}

      {tab === 'terminal' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <WorkspaceTerminals workspaces={workspaces} activeId={activeWorkspaceId} />
        </div>
      )}

      {(tab === 'build' || tab === 'server') && (
        <ScriptRunner
          // Remounted per workspace and per tab: a run belongs to one
          // workspace, and carrying its output to another would be a lie.
          key={`${tab}-${activeWorkspaceId ?? 'none'}`}
          workspace={active}
          kind={tab === 'build' ? 'setup' : 'run'}
          scriptPath={tab === 'build' ? scriptPaths.setup : scriptPaths.run}
          port={active?.port ?? 0}
          onOpenSettings={onEditScripts}
        />
      )}
    </section>
  )
}
