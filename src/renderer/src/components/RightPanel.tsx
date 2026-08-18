import { ChevronDown, ChevronRight, ExternalLink, Play, RotateCw, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ProjectColor } from '@core/colors.js'
import type { RightPanelTab } from '@core/config.js'
import type { DiffCommentController } from '../hooks/useDiffComments.js'
import { useRunSequence } from '../hooks/useRunSequence.js'
import { useServingPort } from '../hooks/useServingPort.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { Button } from './Button.js'
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

/** What the row above the two halves says while the sequence runs its course. */
const STAGE_HINTS = {
  idle: 'scripts.runHint',
  building: 'scripts.runBuilding',
  serving: 'scripts.runServing',
  // Never read: a failed stage prints its own sentence, in the danger colour.
  failed: 'scripts.runHint'
} as const

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
  /** Opens the project's env file, which every workspace is given a copy of. */
  readonly onEditEnv: () => void
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
  onEditEnv,
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
  /*
   * Whether the build half is open.
   *
   * Not stored, unlike the tab beside it. Which tab is showing is a standing
   * preference — somebody who works with the server log open wants it back on
   * every launch — and this is a mood about the workspace in front of you: the
   * build was read, so it is out of the way until the next one.
   */
  const [buildOpen, setBuildOpen] = useState(true)
  // One button that takes a workspace from a bare checkout to a running
  // server. It lives above both halves because neither half can see the other.
  const sequence = useRunSequence()
  const activeRun = sequence.runOf(activeWorkspaceId)
  // The build is the step that takes the time, and a second press during it
  // would start it over rather than do anything anybody meant.
  const building = activeRun.stage === 'building'
  /*
   * The workspace every control here acts on, or null where there is none.
   *
   * One value for both halves of "there is nothing to act on": no workspace
   * chosen, or one whose directory has gone. A missing one matters as much as
   * an absent one — `WorkspaceScripts` drops it, which unmounts its runner and
   * disposes the session, so nothing is left for a token to reach. Left in, the
   * header would offer a link to a refused port and a Restart that nobody
   * hears.
   */
  const found = workspaces.find((item) => item.id === activeWorkspaceId) ?? null
  const activeWorkspace = found !== null && !found.missing ? found : null

  /*
   * What Run does, or nothing where it has nothing to do: no workspace chosen,
   * no server script to start, or a build already going.
   *
   * A handler that is absent rather than one that guards inside itself — the
   * guard could only ever be reached through a button that is disabled, and an
   * unreachable line is a claim about behaviour nobody can check.
   */
  const runAll =
    activeWorkspace === null || scriptPaths.run === null || building
      ? undefined
      : (): void => {
          // Skipping a build nobody wrote rather than waiting for it: §4 says
          // no step is mandatory, and the half is showing an invitation to
          // write one rather than a runner that could answer.
          sequence.start(activeWorkspace.id, scriptPaths.setup !== null)
        }

  const servingAt =
    activeWorkspace !== null && activeRun.stage === 'serving' ? activeWorkspace : null
  // Asked only while something is serving: a port nothing was told to bind is
  // not a port anybody is waiting on.
  const silentPort = useServingPort(servingAt?.id ?? null)

  const restartServer =
    servingAt === null
      ? undefined
      : (): void => {
          sequence.restart(servingAt.id)
        }

  const stopRun =
    servingAt === null
      ? undefined
      : (): void => {
          sequence.stop(servingAt.id)
        }

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
            /* `shrink-0` and no wrapping, which is what makes the measurement
               below honest: a button free to squash reports the width it was
               squashed to, and the pane then takes that for its floor and
               squashes it again. `Pull request` is where it showed — the label
               broke across two lines inside a row 32px tall. */
            className={`focus-ring -mb-px h-8 shrink-0 rounded-t-[8px] border px-3 font-medium whitespace-nowrap transition-colors ${
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
        {/* The whole point of the tab in one row: the first thing anybody does
            with a new workspace is these two steps in this order, and the
            second only makes sense after the first. The halves carry nothing —
            four buttons across two of them, two saying the same word, is what
            this replaced. */}
        <div className="border-line flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
          <span className="text-ink-faint min-w-0 flex-1 truncate text-[11px]">
            {activeRun.stage === 'failed' ? (
              <span className="text-danger">{t('scripts.buildFailed')}</span>
            ) : servingAt !== null && silentPort ? (
              /* Said rather than enforced. The script is the user's, and being
                 wrong about it must not take the link or the controls away. */
              <span className="text-warning">
                {t('scripts.portSilent', { port: servingAt.port })}
              </span>
            ) : (
              t(STAGE_HINTS[activeRun.stage])
            )}
          </span>

          {/* Every control for the tab, and none in the halves — and only ever
              the ones that can mean something. Run goes once the server is up:
              what it offers has already happened, and a rebuild from there is
              Stop and then Run, which is also the order that frees the port
              before anything tries to bind it again. */}
          {servingAt === null && (
            <Button size="sm" variant="accent" disabled={runAll === undefined} onClick={runAll}>
              <Play aria-hidden size={12} />
              {t(building ? 'scripts.running' : 'scripts.runAll')}
            </Button>
          )}

          {servingAt !== null && (
            <>
              {/* An anchor rather than a button: `setWindowOpenHandler` already
                  hands a `_blank` target to the system browser, so this needs no
                  channel of its own — and it is a link, which is what a reader
                  expects to be able to copy or open in a new tab.

                  Styled as a control because it stands in a row of them, and
                  only while something is serving: a port with nothing behind it
                  opens on a connection refused. */}
              <a
                href={`http://localhost:${String(servingAt.port)}`}
                target="_blank"
                rel="noreferrer"
                title={t('scripts.openInBrowser', { port: servingAt.port })}
                aria-label={t('scripts.openInBrowser', { port: servingAt.port })}
                className="focus-ring border-line bg-canvas text-ink hover:bg-muted inline-flex h-6 items-center justify-center gap-1.5 rounded-[var(--radius-control)] border px-2 text-[11px] font-medium transition-colors"
              >
                <ExternalLink aria-hidden size={12} />
              </a>

              {/* The common half of a restart: the code changed under a running
                  server and needs picking up, while the checkout did not. */}
              <Button
                size="sm"
                onClick={restartServer}
                title={t('scripts.serverRestart')}
                aria-label={t('scripts.serverRestart')}
              >
                <RotateCw aria-hidden size={12} />
              </Button>

              <Button size="sm" variant="danger" onClick={stopRun}>
                <Square aria-hidden size={12} />
                {t('scripts.stop')}
              </Button>
            </>
          )}
        </div>

        {/* A named region each, rather than two anonymous halves. Both are on
            screen at once now, so "the Run button" is ambiguous to anything
            reading the pane aloud — and to anything testing it. The heading is
            `aria-hidden` because the region already carries the same word. */}
        {/* The build half folds away and the server half does not, which is
            not an oversight: a build is run once when a workspace is made and
            then read, while a server runs for as long as the work does. Folding
            the one that is finished is what gives the one that is still going
            the whole pane.

            Folded by a class, never by unmounting. Unmounting the terminal is
            how Stop ends a run — the comment above says why at length — so a
            fold that removed it would kill a `setup.sh` half way through
            without saying so. */}
        <section
          aria-label={t('scripts.build')}
          className={buildOpen ? 'flex min-h-0 flex-1 flex-col' : 'shrink-0'}
        >
          {/* The row carries the border, not the toggle: the env button is a
              sibling rather than a child, so reaching for it cannot fold the
              build away by accident. */}
          <div className="border-line flex shrink-0 items-center gap-2 border-b pr-2">
            <button
              type="button"
              onClick={() => {
                setBuildOpen(!buildOpen)
              }}
              aria-expanded={buildOpen}
              // Named for what it does rather than for the word on it:
              // `Build` is also the heading it carries, and two controls with
              // one name are ambiguous to anything reading the pane aloud.
              aria-label={t(buildOpen ? 'scripts.foldBuild' : 'scripts.unfoldBuild')}
              className="focus-ring section-label hover:bg-muted flex min-w-0 flex-1 items-center gap-1.5 px-3 py-1.5 text-left"
            >
              {buildOpen ? (
                <ChevronDown aria-hidden size={12} className="text-ink-faint shrink-0" />
              ) : (
                <ChevronRight aria-hidden size={12} className="text-ink-faint shrink-0" />
              )}
              {t('scripts.build')}
            </button>

            {/* Always here, not only while the build script is missing. The env
                is the thing a build most often turns out to be lacking, and by
                then the empty state that held this button is long gone. */}
            <Button size="sm" onClick={onEditEnv}>
              {t('scripts.editEnv')}
            </Button>
          </div>

          {/* `aria-hidden` beside the class, exactly as the tabs above do it:
              the class says nothing to a screen reader, and nothing at all
              without a stylesheet — which is also the only handle a test has. */}
          <div
            aria-hidden={!buildOpen}
            className={buildOpen ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
          >
            <WorkspaceScripts
              workspaces={scriptable}
              activeId={activeWorkspaceId}
              kind="setup"
              scriptPath={scriptPaths.setup}
              visible={tab === 'scripts'}
              onOpenSettings={onEditScripts}
              tokenFor={(id) => sequence.runOf(id).build}
              stopTokenFor={(id) => sequence.runOf(id).stop}
              onOutcome={(id, ok) => {
                sequence.finished('setup', id, ok)
              }}
            />
          </div>
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
            tokenFor={(id) => sequence.runOf(id).server}
            stopTokenFor={(id) => sequence.runOf(id).stop}
            onOutcome={(id, ok) => {
              sequence.finished('run', id, ok)
            }}
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
