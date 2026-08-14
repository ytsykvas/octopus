import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ProjectColor } from '@core/colors.js'
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

/**
 * Floor before the tabs are measured, and the lower bound the config schema
 * holds. The real floor is whatever the tab row needs — see `measureTabs`.
 */
const MIN_WIDTH = 280

/**
 * How narrow the pane can be before its tabs stop fitting.
 *
 * Measured rather than chosen: the labels change width with the language, and
 * a number picked against English left the Ukrainian ones overflowing. The pane
 * does not shrink, so anything sticking out of it pushed the whole window wider
 * and put a horizontal scrollbar under the application.
 *
 * Everything is read back from the DOM — padding, gap, each button — so it
 * cannot drift from the classes that produce them.
 */
function measureTabs(row: HTMLElement): number {
  const styles = getComputedStyle(row)
  const side = Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight)
  const gap = Number.parseFloat(styles.columnGap) || 0

  const buttons = [...row.children].reduce(
    (total, button) => total + button.getBoundingClientRect().width,
    0
  )

  return Math.ceil(side + buttons + gap * Math.max(0, row.children.length - 1))
}

/**
 * Enough centre pane to still be one. The pane can take everything else, so on
 * a wide display the terminal gets genuinely wide, while on a laptop the
 * working area survives.
 */
const MIN_CENTRE_WIDTH = 360

/**
 * How much of the window the left column takes, passed in rather than assumed.
 *
 * It stood here as a constant 256 for a while, and the room it reserved was
 * fiction: the real column is the project strip plus a workspace list that is
 * resizable between 180 and 560 and folds away entirely — anything from 56 to
 * 616. At the window's own minimum of 940 the centre reached 320 rather than
 * the promised 360, and with the list dragged wide it reached nothing at all.
 * Only `App` knows both halves, so only `App` can say.
 */
function maxWidthFor(windowWidth: number, leftWidth: number, minWidth: number): number {
  return Math.max(minWidth, windowWidth - leftWidth - MIN_CENTRE_WIDTH)
}

interface RightPanelProps {
  readonly workspaces: readonly WorkspaceView[]
  readonly activeWorkspaceId: string | null
  /** The open project's colour; null before one is chosen. */
  readonly color: ProjectColor | null
  /** Absolute paths of the project's scripts; null when never written. */
  readonly scriptPaths: { readonly setup: string | null; readonly run: string | null }
  readonly onEditScripts: () => void
  readonly width: number
  /** Persists the width; called when a drag ends, not during it. */
  readonly onWidthChange: (width: number) => void
  /** The project strip plus the workspace list, or just the strip when folded. */
  readonly leftWidth: number
}

export function RightPanel({
  workspaces,
  activeWorkspaceId,
  color,
  scriptPaths,
  onEditScripts,
  width,
  onWidthChange,
  leftWidth
}: RightPanelProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [tab, setTab] = useState<RightTab>('diff')
  // The pane follows the cursor from local state; the config only hears about
  // the width once the drag is over.
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth)
  const [minWidth, setMinWidth] = useState(MIN_WIDTH)
  const tabs = useRef<HTMLDivElement>(null)

  const active = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null

  // The ceiling moves with the window: shrinking it must not leave the pane
  // covering the centre, and growing it should make the extra room available.
  useEffect(() => {
    const onResize = (): void => {
      setWindowWidth(window.innerWidth)
    }

    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
    }
  }, [])

  // Re-measured on a language change, which is when the labels get longer.
  useEffect(() => {
    const row = tabs.current
    // Attached before effects run; guarded only because the ref's type admits null.
    /* v8 ignore next */
    if (!row) return

    setMinWidth(Math.max(MIN_WIDTH, measureTabs(row)))
  }, [i18n.language])

  const maxWidth = maxWidthFor(windowWidth, leftWidth, minWidth)
  // Clamped on the way out rather than on the way in, so a width saved on a
  // wide display is kept in the config and comes back when the window does.
  const applied = Math.min(Math.max(dragWidth ?? width, minWidth), maxWidth)

  return (
    <section
      style={{
        width: applied,
        // Set on the pane rather than on the tab it currently paints, so the
        // stylesheet owns how the colour is used and anything else in here can
        // reach for it later.
        ...(color ? ({ '--project-color': `var(--project-${color})` } as React.CSSProperties) : {})
      }}
      className="border-line bg-surface relative flex shrink-0 flex-col border-l"
    >
      <ResizeHandle
        width={applied}
        min={minWidth}
        max={maxWidth}
        onResize={setDragWidth}
        onCommit={(committed) => {
          setDragWidth(null)
          onWidthChange(committed)
        }}
      />

      {/* Browser tabs rather than a row of buttons: the tabs sit on the line
          that closes the row, and the chosen one breaks through it, so it reads
          as the view below reaching up — the same relationship the project
          strip has with the sidebar. `items-end` and `-mb-px` are what put them
          on the line rather than above it. */}
      <div ref={tabs} className="border-line flex h-11 shrink-0 items-end gap-0.5 border-b px-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id)
            }}
            // Distinguished by hue, not by brightness. The muted fill it used
            // to carry sits at 1.09:1 against the pane behind it — a difference
            // that measures as barely there and looks it. The hue is the open
            // project's, falling back to the accent when none is open.
            className={`focus-ring -mb-px h-8 rounded-t-[8px] border px-3 font-medium transition-colors ${
              tab === item.id
                ? 'tab-selected'
                : 'text-ink-soft hover:bg-muted hover:text-ink border-transparent'
            }`}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      {/* Anything holding a terminal gets no padding and no scroll container
          of its own: xterm scrolls itself, and padding throws off its column
          count. The changes tab keeps both. */}
      {tab === 'diff' && (
        <div className="flex-1 overflow-auto p-4">
          <p className="text-ink-faint leading-relaxed">{t('panel.changesPlaceholder')}</p>
        </div>
      )}

      {/* Hidden, never unmounted: a session belongs to the workspace, not to
          whether its tab happens to be on screen. Switching to Changes used to
          kill every terminal in the project. */}
      <div className={`flex min-h-0 flex-1 flex-col ${tab === 'terminal' ? '' : 'hidden'}`}>
        <WorkspaceTerminals
          workspaces={workspaces}
          activeId={activeWorkspaceId}
          visible={tab === 'terminal'}
        />
      </div>

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
