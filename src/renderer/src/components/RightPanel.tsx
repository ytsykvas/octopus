import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ProjectColor } from '@core/colors.js'
import type { RightPanelTab } from '@core/config.js'
import type { DiffCommentController } from '../hooks/useDiffComments.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { DiffPanel } from './diff/DiffPanel.js'
import type { DiffView } from './diff/DiffHunk.js'
import { ResizeHandle } from './ResizeHandle.js'
import { PullRequestPanel } from './PullRequestPanel.js'
import { WorkspaceScripts } from './WorkspaceScripts.js'
import { WorkspaceTerminals } from './WorkspaceTerminals.js'

/**
 * Right pane — changes and terminal in tabs (§10.8).
 *
 * The changes tab gets its content with the diff viewer; the terminal is live.
 */
const TABS: readonly {
  readonly id: RightPanelTab
  readonly labelKey: 'panel.changes' | 'panel.terminal' | 'panel.scripts' | 'panel.pullRequest'
}[] = [
  { id: 'diff', labelKey: 'panel.changes' },
  { id: 'terminal', labelKey: 'panel.terminal' },
  { id: 'scripts', labelKey: 'panel.scripts' },
  { id: 'pullRequest', labelKey: 'panel.pullRequest' }
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
  /**
   * The open project, which the script paths below belong to.
   *
   * Needed as well as the active workspace, because clicking the open project
   * clears the workspace selection without closing the project — and the
   * scripts must stay standing through that.
   */
  readonly projectId: string | null
  /** Absolute paths of the project's scripts; null when never written. */
  readonly scriptPaths: { readonly setup: string | null; readonly run: string | null }
  readonly onEditScripts: () => void
  /** Opens the project's pull request instructions, from the tab about them. */
  readonly onEditInstructions: () => void
  /** The conversation a prompt would go to; null when the workspace has none. */
  readonly chatId: string | null
  readonly width: number
  /** Persists the width; called when a drag ends, not during it. */
  readonly onWidthChange: (width: number) => void
  /** The project strip plus the workspace list, or just the strip when folded. */
  readonly leftWidth: number
  /** How the reader asked for diffs to be laid out, across sessions. */
  readonly diffView: DiffView
  readonly onDiffView: (view: DiffView) => void
  /**
   * Which tab is showing, and how to change it.
   *
   * Held by `App` rather than here: the pane is unmounted while folded away,
   * so state kept in it survives neither a fold nor a restart — and `⌘⇧D` has
   * to be able to reach the tab from outside.
   */
  readonly tab: RightPanelTab
  readonly onTab: (tab: RightPanelTab) => void
  /** Review notes the diff writes and the composer sends. */
  readonly comments: DiffCommentController
  readonly onError: (message: string) => void
}

export function RightPanel({
  workspaces,
  activeWorkspaceId,
  color,
  projectId,
  scriptPaths,
  onEditScripts,
  onEditInstructions,
  chatId,
  width,
  onWidthChange,
  leftWidth,
  diffView,
  onDiffView,
  tab,
  onTab,
  comments,
  onError
}: RightPanelProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  // The pane follows the cursor from local state; the config only hears about
  // the width once the drag is over.
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth)
  const [minWidth, setMinWidth] = useState(MIN_WIDTH)
  const tabs = useRef<HTMLDivElement>(null)

  /*
   * The width the pane last settled on, and the window it settled at.
   *
   * One fact in two numbers, because either alone says nothing: what the pane
   * takes is what it was given plus everything the window has gained or lost
   * since. Held rather than accumulated — a running total drifts out of step
   * with the ceiling beside it, and would need a reset nobody would remember.
   */
  const [settledWidth, setSettledWidth] = useState(width)
  const [settledWindow, setSettledWindow] = useState(windowWidth)
  /*
   * The stored width as this last saw it.
   *
   * Kept apart from `settledWidth`, which a drag moves ahead of the config for
   * the frame or two the save takes. Comparing the prop against the settled
   * width instead put the pane straight back where the drag started: the two
   * differ precisely when the drag has just landed, which is the one moment
   * nothing should be reconciled. `useSessionUsage` keeps the same companion,
   * for the same reason.
   */
  const [storedWidth, setStoredWidth] = useState(width)

  // A different stored width means the config has answered, or changed from
  // elsewhere. Adjusted while rendering rather than in an effect: the config
  // lands a moment after mount, and a pane that spent a frame at the fallback
  // width jumps where the eye is.
  if (width !== storedWidth) {
    setStoredWidth(width)
    setSettledWidth(width)
    setSettledWindow(windowWidth)
  }

  const active = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null

  /*
   * Only the open project's workspaces may be given its scripts.
   *
   * The list carries every project's, because a terminal belongs to a
   * workspace whatever is on screen. A script does not: `scriptPaths` are this
   * project's, so a runner left standing from another one would offer to run
   * this project's `setup.sh` in a directory that never asked for it. Leaving
   * a project therefore ends its runs — the same clean edge the terminals do
   * not need, and written down as its own task.
   */
  const scriptable = workspaces.filter((workspace) => workspace.projectId === projectId)

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

  /*
   * What the pane takes if nothing stops it.
   *
   * Dragging the window's own edge drags this pane's edge with it, and the
   * centre keeps the width it had. The centre is the pane with no width of its
   * own, so until now it absorbed every pixel the window gained or lost — and
   * the conversation stops widening at 72rem, so what it absorbed was margin,
   * while the diff and the terminal stayed as narrow as they started.
   *
   * Measured from the window rather than accumulated, which is what makes it
   * symmetrical for free: put the window back where it was and the two
   * subtractions cancel, so the pane is back where it was too, with nothing
   * having had to remember the journey.
   */
  const grown = settledWidth + (windowWidth - settledWindow)
  // Clamped on the way out rather than into what was settled, so a width the
  // window has no room for is kept and comes back when the room does.
  const applied = Math.min(Math.max(dragWidth ?? grown, minWidth), maxWidth)

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
          // Settled here rather than waiting for the config to answer. That
          // round trip takes a frame or two, and falling back to the pre-drag
          // width in the meantime makes the release bounce — worse, growth
          // would be measured from the old window and counted twice.
          setSettledWidth(committed)
          setSettledWindow(windowWidth)
          // `storedWidth` is deliberately left alone: it is what the config
          // says, and the config has not said it yet. So a save that fails
          // leaves the pane where it was dragged while the config keeps the old
          // width — the banner is what says so, and yanking the pane back under
          // the cursor would say it twice and less clearly.
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
              onTab(item.id)
            }}
            // Every other chosen thing in the app announces itself; these did
            // not, so the selection reached the eye and nothing else.
            aria-current={tab === item.id ? 'page' : undefined}
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

      {/* Every pane below stays mounted and is hidden by a class. `aria-hidden`
          says the same thing to a screen reader, which the class alone only
          manages once the stylesheet has loaded — four panes speaking at once
          is what a reader would otherwise hear, and what a test would find.

          Kept mounted like the terminals below, and for a related reason: an
          unmounted diff loses which files were collapsed and where the pane was
          scrolled to, both of which a review builds up over several turns.
          `visible` is what stops it reading git while another tab is showing. */}
      <div
        aria-hidden={tab !== 'diff'}
        className={`flex min-h-0 flex-1 flex-col ${tab === 'diff' ? '' : 'hidden'}`}
      >
        <DiffPanel
          workspace={active}
          visible={tab === 'diff'}
          view={diffView}
          onView={onDiffView}
          width={applied}
          comments={comments}
          onError={onError}
        />
      </div>

      {/* Hidden, never unmounted: a session belongs to the workspace, not to
          whether its tab happens to be on screen. Switching to Changes used to
          kill every terminal in the project. */}
      <div
        aria-hidden={tab !== 'terminal'}
        className={`flex min-h-0 flex-1 flex-col ${tab === 'terminal' ? '' : 'hidden'}`}
      >
        <WorkspaceTerminals
          workspaces={workspaces}
          activeId={activeWorkspaceId}
          visible={tab === 'terminal'}
        />
      </div>

      {/* Hidden, never unmounted — the third place in this file that has to be,
          and for the sharpest reason. Unmounting the terminal is exactly how
          the Stop button ends a run, so leaving the tab pressed Stop without
          saying so: a dev server died on the way to reading the diff, and a
          `setup.sh` caught half way through left a half-populated
          `node_modules` behind it. `WorkspaceScripts` keeps the same promise
          against the other click that used to end a run — opening another
          workspace. */}
      {/* One tab, both scripts, one above the other. They were two tabs, which
          made a pair of halves of one question — what this workspace runs —
          into two places to look, and cost a fifth of a tab row whose width has
          to be measured because it barely fits. Stacked, a server can be seen
          running while a build is read.

          Each half gets `min-h-0` and half the height. A terminal measures
          itself against the box it is in, and a box that has not been told it
          may be shorter than its content grows instead of scrolling. */}
      <div
        aria-hidden={tab !== 'scripts'}
        className={`flex min-h-0 flex-1 flex-col ${tab === 'scripts' ? '' : 'hidden'}`}
      >
        {/* A named region each, rather than two anonymous halves. Both are on
            screen at once now, so "the Run button" is ambiguous to anything
            reading the pane aloud — and to anything testing it. The heading is
            `aria-hidden` because the region already carries the same word. */}
        <section aria-label={t('scripts.build')} className="flex min-h-0 flex-1 flex-col">
          <p aria-hidden className="section-label border-line shrink-0 border-b px-3 py-1.5">
            {t('scripts.build')}
          </p>
          <WorkspaceScripts
            workspaces={scriptable}
            activeId={activeWorkspaceId}
            kind="setup"
            scriptPath={scriptPaths.setup}
            visible={tab === 'scripts'}
            onOpenSettings={onEditScripts}
          />
        </section>

        <section
          aria-label={t('scripts.server')}
          className="border-line flex min-h-0 flex-1 flex-col border-t"
        >
          <p aria-hidden className="section-label border-line shrink-0 border-b px-3 py-1.5">
            {t('scripts.server')}
          </p>
          <WorkspaceScripts
            workspaces={scriptable}
            activeId={activeWorkspaceId}
            kind="run"
            scriptPath={scriptPaths.run}
            visible={tab === 'scripts'}
            onOpenSettings={onEditScripts}
          />
        </section>
      </div>

      <div
        aria-hidden={tab !== 'pullRequest'}
        className={`flex min-h-0 flex-1 flex-col ${tab === 'pullRequest' ? '' : 'hidden'}`}
      >
        <PullRequestPanel
          workspace={active}
          visible={tab === 'pullRequest'}
          chatId={chatId}
          onEditInstructions={onEditInstructions}
          onError={onError}
        />
      </div>
    </section>
  )
}
