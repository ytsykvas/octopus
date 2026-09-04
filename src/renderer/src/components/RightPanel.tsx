import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Pencil,
  Play,
  RotateCw,
  Square
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ProjectColor } from '@core/colors.js'
import type { RightPanelTab } from '@core/config.js'
import type { ResolvedScript, ScriptsInWorkspace } from '@core/repoSource.js'
import { SCRIPT_KINDS } from '@core/scriptEnv.js'
import type { DiffCommentController } from '../hooks/useDiffComments.js'
import type { FileRevertController } from '../hooks/useFileRevert.js'
import type { PullRequestQuoteController } from '../hooks/usePullRequestQuotes.js'
import type { Failure } from '../../../preload/index.js'
import { useErrorMessage } from '../hooks/useErrorMessage.js'
import { useRunSequence } from '../hooks/useRunSequence.js'
import { useServingPort } from '../hooks/useServingPort.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { Button } from './Button.js'
import { DiffPanel } from './diff/DiffPanel.js'
import { DropdownMenu } from './DropdownMenu.js'
import type { DiffView } from './diff/DiffHunk.js'
import { ResizeHandle } from './ResizeHandle.js'
import { PullRequestPanel } from './pr/PullRequestPanel.js'
import { WorkspaceEnv } from './WorkspaceEnv.js'
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
  /** The open project's checkout, handed to every script it runs. */
  /**
   * The checkout and the base branch of a workspace's **own** project.
   *
   * A lookup rather than the open project's pair. Every runner in the pane
   * needs its own — they reach a script as `$OCTOPUS_ROOT_PATH` and
   * `CONDUCTOR_DEFAULT_BRANCH` — and it is what lets a run survive the project
   * being left, since unmounting a runner is how a run ends.
   */
  readonly projectFor: (workspaceId: string) => {
    rootPath: string
    defaultBranch: string
    envProfile: string
  }
  /**
   * Which scripts run in each workspace, and whether the repository's are read.
   *
   * Keyed by workspace rather than one answer for the project, because the
   * repository supplying a script is the one checked out in that worktree.
   */
  readonly scripts: ReadonlyMap<string, ScriptsInWorkspace>
  /** Why a workspace is missing from the map above, where there is a reason. */
  readonly scriptFailures: ReadonlyMap<string, Failure>
  /** Re-reads the map, after an approval has changed the answer. */
  readonly onScriptsChanged: () => void
  /** The open project's base branch, for a script that reads it as Conductor's. */
  /** Which set of variables the open project uses, before the list is read. */
  readonly defaultEnvProfile: string
  readonly onEditScripts: () => void
  /** Opens the list of files every workspace is given a copy of. */
  readonly onEditFiles: () => void
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
  /** Puts one file of the diff back to how the workspace found it. */
  readonly revert: FileRevertController
  /** Remarks the pull request tab pulls in from GitHub, for the same composer. */
  readonly quotes: PullRequestQuoteController
  /** The project's env file, for the warning beside the commit field. */
  readonly envFile: string
  /** Tells the window a branch's pull request has changed, so the list re-marks. */
  readonly onRequestChanged: () => void
  readonly onError: (message: string | null) => void
}

export function RightPanel({
  workspaces,
  activeWorkspaceId,
  color,
  projectId,
  scripts,
  scriptFailures,
  onScriptsChanged,
  projectFor,
  defaultEnvProfile,
  onEditScripts,
  onEditFiles,
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
  revert,
  quotes,
  envFile,
  onRequestChanged,
  onError
}: RightPanelProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const describeFailure = useErrorMessage()
  // The pane follows the cursor from local state; the config only hears about
  // the width once the drag is over.
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth)
  const [minWidth, setMinWidth] = useState(MIN_WIDTH)
  /*
   * Whether the build half is open. Folded to start with, every time.
   *
   * What a build prints is the same hundred lines of install and compile on
   * every run, and it is worth reading on exactly the run that fails — which
   * the header already says in a colour, without the log being open. Unfolded
   * by default it took half the tab from the server log, which is the half
   * anybody actually watches.
   *
   * Not stored, unlike the tab beside it. Which tab is showing is a standing
   * preference — somebody who works with the server log open wants it back on
   * every launch — and this is a mood about the run in front of you: opened to
   * read a failure, and gone again with the workspace.
   */
  const [buildOpen, setBuildOpen] = useState(false)
  const [showingEnv, setShowingEnv] = useState(false)
  /*
   * Where each workspace's server actually ended up.
   *
   * The workspaces list carries the port as it was last written to disk, and
   * nothing refreshes it after a run settles on another block — so the header
   * linked to the port the run had just moved away from.
   */
  const [settledPorts, setSettledPorts] = useState<Record<string, number>>({})
  /*
   * The env dialog belongs to the workspace it was opened from.
   *
   * Adjusted during render rather than in an effect, the way `useServingPort`
   * does it: an effect runs after the paint, and the next workspace would show
   * one frame of the last one's file.
   */
  const [envFor, setEnvFor] = useState(activeWorkspaceId)
  if (envFor !== activeWorkspaceId) {
    setEnvFor(activeWorkspaceId)
    if (showingEnv) setShowingEnv(false)
  }
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
  /**
   * The sets of variables this project holds, so a workspace can be put on one.
   *
   * Read when the tab is looked at rather than kept in `App`: it changes in the
   * settings dialog, which closes back onto this pane.
   */
  const [envProfiles, setEnvProfiles] = useState<readonly string[]>([])
  const [projectEnvProfile, setProjectEnvProfile] = useState(defaultEnvProfile)

  useEffect(() => {
    if (projectId === null) return
    const controller = new AbortController()

    void (async () => {
      const answer = await window.octopus.projects.envProfiles(projectId)
      if (controller.signal.aborted || !answer.ok) return

      setEnvProfiles(answer.value.profiles)
      setProjectEnvProfile(answer.value.projectDefault)
    })()

    return () => {
      controller.abort()
    }
  }, [projectId, defaultEnvProfile])

  const setWorkspaceProfile = async (workspaceId: string, name: string | null): Promise<void> => {
    onError(null)
    const done = await window.octopus.workspaces.setEnvProfile(workspaceId, name)
    if (done.ok) onScriptsChanged()
    else onError(describeFailure(done))
  }

  /**
   * The set of variables each running server was started with.
   *
   * A server reads its `.env` once, at boot. Moving a workspace to another set
   * rewrites the block on the **next** run, so until then the header would name
   * one environment while the process held another — which is the
   * silent-wrong-environment failure this feature exists to prevent, pointing
   * the other way.
   */
  const [servingProfiles, setServingProfiles] = useState<Readonly<Record<string, string>>>({})

  /** What this workspace would run, and whether it is allowed to yet. */
  const activeScripts = activeWorkspaceId === null ? undefined : scripts.get(activeWorkspaceId)

  const runAll =
    activeWorkspace === null ||
    activeScripts?.scripts.run === undefined ||
    // A repository's scripts that nobody has read do not run, and the panel
    // below says so rather than leaving a button that quietly does nothing.
    !activeScripts.approved ||
    building
      ? undefined
      : (): void => {
          // Skipping a build nobody wrote rather than waiting for it: §4 says
          // no step is mandatory, and the half is showing an invitation to
          // write one rather than a runner that could answer.
          sequence.start(activeWorkspace.id, activeScripts.scripts.setup !== undefined)
        }

  /**
   * What the repository supplies, gathered by the file it came from.
   *
   * Usually one file holding all three, so this is one heading rather than the
   * same path written three times.
   */
  const suppliedScripts = SCRIPT_KINDS.reduce<{ from: string; scripts: ResolvedScript[] }[]>(
    (groups, kind) => {
      const script = activeScripts?.scripts[kind]
      if (script === undefined || script.source === 'project') return groups

      const group = groups.find((candidate) => candidate.from === script.from)
      if (group === undefined) return [...groups, { from: script.from, scripts: [script] }]

      group.scripts.push(script)
      return groups
    },
    []
  )

  /** Why this workspace has no scripts, where there is a reason. */
  const scriptFailure =
    activeWorkspaceId === null ? undefined : scriptFailures.get(activeWorkspaceId)

  /** The set in force for a workspace: its own, or the project's. */
  /*
   * The workspace's own set, or its **own** project's default — not the open
   * project's, which is what `projectEnvProfile` holds for the picker below.
   */
  const profileOf = (workspace: WorkspaceView): string =>
    workspace.envProfile ?? projectFor(workspace.id).envProfile

  const staleProfile =
    activeWorkspace !== null &&
    activeRun.stage === 'serving' &&
    servingProfiles[activeWorkspace.id] !== undefined &&
    servingProfiles[activeWorkspace.id] !== profileOf(activeWorkspace)

  const servingAt =
    activeWorkspace !== null && activeRun.stage === 'serving'
      ? { ...activeWorkspace, port: settledPorts[activeWorkspace.id] ?? activeWorkspace.port }
      : null
  // Asked only while something is serving: a port nothing was told to bind is
  // not a port anybody is waiting on.
  const silentPort = useServingPort(servingAt?.id ?? null, activeRun.server)

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
   * Every project's workspaces, not the open one's.
   *
   * There used to be a filter here, and the reason it gave — that a runner from
   * another project would be handed this project's scripts and its checkout —
   * was true of everything the pane passed down as one value for whatever was
   * on screen. Unmounting a runner is how a run ends, so the filter's real
   * effect was that opening another project killed every dev server in the one
   * being left.
   *
   * Nothing is shared now: the scripts are resolved in the worktree that
   * supplies them, and `projectFor` answers the checkout, the base branch and
   * the fallback env set of a workspace's own project. A runner has what is
   * genuinely its, so it can keep running.
   */
  const scriptable = workspaces

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
      {/* Outside every tab pane, where the other dialogs of the app are.
          Mounted inside one, it survived a tab change — the pane is hidden with
          `display: none` rather than unmounted, so React never unmounted the
          `Modal` and never called `close()`. The dialog stayed open in the top
          layer, unpainted, and the whole window went inert. */}
      {showingEnv && activeWorkspaceId !== null && (
        <WorkspaceEnv
          workspaceId={activeWorkspaceId}
          onClose={() => {
            setShowingEnv(false)
          }}
        />
      )}

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
          revert={revert}
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
            ) : staleProfile ? (
              /* Said rather than enforced, like the silent port beside it: the
                 server is somebody's work in progress and taking it down to be
                 consistent would be the ruder of the two. */
              <span className="text-warning">{t('scripts.envRestart')}</span>
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

          {/* The way to the scripts themselves, and the only control here that
              does not change with the run.

              It sits before the rest deliberately. Everything after it swaps as
              a server comes up, and a button that moves under the pointer when
              something unrelated happens is one people stop aiming at.

              It exists at all because the other way in disappears exactly when
              it starts being wanted: `ScriptRunner` offers **Write the script**
              while there is no script, so a tab whose whole subject is
              `setup.sh` led nowhere the moment `setup.sh` was written. */}
          <Button
            size="sm"
            disabled={projectId === null}
            onClick={onEditScripts}
            title={t('scripts.editScripts')}
            aria-label={t('scripts.editScripts')}
          >
            <Pencil aria-hidden size={12} />
          </Button>

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

        {/* Pinned above both halves rather than inside one, and never in a
            modal: this is the answer to "why is Run doing nothing", and it has
            to be readable at the moment somebody presses it. Every byte of what
            would run is shown — an approval over a summary is an approval of
            the summary. */}
        {/* Why Run is doing nothing, in the place Run is. A repository whose
            settings will not parse resolves to no scripts at all, and without
            this the pane disabled the button and said nothing. */}
        {scriptFailure !== undefined && (
          <p className="border-line bg-muted/40 text-danger shrink-0 border-b px-3 py-2.5">
            {t('scripts.repoUnreadable', { reason: describeFailure(scriptFailure) })}
          </p>
        )}

        {activeScripts !== undefined && !activeScripts.approved && activeWorkspaceId !== null && (
          <div className="border-line bg-muted/40 shrink-0 space-y-2 border-b px-3 py-2.5">
            <p className="text-ink-soft leading-relaxed">{t('scripts.repoNotice')}</p>

            {/* Bounded, with a scroll of its own.
                
                The block around it is `shrink-0`, so without a ceiling here a
                long script simply grew: a 110-line `setup.sh` measured 1909px
                against a pane about a thousand tall, which left the Build and
                Server terminals **one pixel** each and nothing anywhere to
                scroll. The tab became the notice and nothing else. The notice
                and the button stay outside this box on purpose — they are the
                two things that must never scroll out of reach. */}
            <div className="max-h-[38vh] space-y-2 overflow-y-auto">
              {/* Grouped by the file they came from. All three usually come from
                  one `settings.toml`, and naming it above each box said the same
                  path three times without saying anything. */}
              {suppliedScripts.map(({ from, scripts: supplied }) => (
                <div key={from}>
                  <p className="text-ink-faint font-mono text-[11px]">{from}</p>
                  {supplied.map((script) => (
                    <pre
                      key={script.kind}
                      /* Wrapped rather than scrolled sideways. `overflow-x-auto`
                         alone did clip correctly — but macOS hides the scrollbar
                         until it moves, so 80-column shell in a 354px box read
                         as text simply cut off. Asking somebody to scroll every
                         line right and back is not a way to read code they are
                         being asked to approve. `overflow-x-auto` stays for the
                         one thing wrapping cannot break: an unbroken token. */
                      className="border-line bg-canvas mt-1 overflow-x-auto rounded-[var(--radius-control)] border px-2 py-1.5 font-mono text-[11px] break-words whitespace-pre-wrap"
                    >
                      {script.contents}
                    </pre>
                  ))}
                </div>
              ))}
            </div>

            <Button
              size="sm"
              onClick={() => {
                void (async () => {
                  onError(null)
                  const done = await window.octopus.workspaces.approveScripts(activeWorkspaceId)
                  if (done.ok) onScriptsChanged()
                  else onError(describeFailure(done))
                })()
              }}
            >
              {t('scripts.repoApprove')}
            </Button>
          </div>
        )}

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
                then the empty state that held this button is long gone.

                A menu rather than a button because there are now three
                answers, and they are genuinely different: the variables are
                typed, the files are copied, and the third is not an edit at
                all. One button could only ever reach one of them, which for a
                project cloned from GitHub was reliably the wrong one — nothing
                gitignored was ever on GitHub to copy. */}
            <DropdownMenu
              actions={[
                /*
                 * The choice first, the three commands after it. Shown only
                 * where there is a choice: a project with one set sees exactly
                 * the menu it always had.
                 */
                ...(envProfiles.length > 1 && activeWorkspace !== null
                  ? [
                      {
                        id: 'follow',
                        label: t('scripts.envFollow', { name: projectEnvProfile }),
                        selected: activeWorkspace.envProfile === null,
                        onSelect: () => {
                          void setWorkspaceProfile(activeWorkspace.id, null)
                        }
                      },
                      ...envProfiles.map((name) => ({
                        id: `profile-${name}`,
                        label: name,
                        selected: activeWorkspace.envProfile === name,
                        onSelect: () => {
                          void setWorkspaceProfile(activeWorkspace.id, name)
                        }
                      }))
                    ]
                  : []),
                {
                  id: 'variables',
                  label: t('scripts.editEnv'),
                  onSelect: onEditEnv
                },
                {
                  id: 'files',
                  label: t('scripts.editFiles'),
                  onSelect: onEditFiles
                },
                {
                  id: 'show',
                  label: t('scripts.showEnv'),
                  // Nothing to show without a workspace, and setting the flag
                  // anyway armed a dialog that sprang open by itself on the
                  // next one picked.
                  disabled: activeWorkspaceId === null,
                  onSelect: () => {
                    setShowingEnv(true)
                  }
                }
              ]}
              trigger={({ onClick, open }) => (
                <Button size="sm" onClick={onClick} aria-expanded={open}>
                  {t('scripts.env')}
                  {/* The resolved name, whether it is followed or chosen: "what
                      am I about to run with" has the same answer either way, and
                      the difference lives in the menu. Faint and the same size —
                      the app has no idea which of these means production, and
                      colouring a word because it matches one would be a guess. */}
                  {envProfiles.length > 1 && activeWorkspace !== null && (
                    <span className="text-ink-faint">
                      {` · ${activeWorkspace.envProfile ?? projectEnvProfile}`}
                    </span>
                  )}
                </Button>
              )}
            />
          </div>

          {/* `aria-hidden` beside the class, exactly as the tabs above do it:
              the class says nothing to a screen reader, and nothing at all
              without a stylesheet — which is also the only handle a test has.

              Folded to no height rather than to `display: none`, unlike the
              tabs. This half starts folded on every mount, so `display: none`
              was the ordinary case: `WorkspaceScripts` warns that a
              display-hidden element measures zero, and the terminal inside was
              sized from that box before a line of output was written — either
              at xterm's 80×24 default, or floored at the addon's minimum of two
              columns. Refitting when the pane opens is already wired and is not
              enough on its own: the pty was created at the wrong width and the
              program running in it has already wrapped its output to it, which
              is exactly the mangled log somebody opens this pane to read. */}
          <div
            aria-hidden={!buildOpen}
            className={buildOpen ? 'flex min-h-0 flex-1 flex-col' : 'h-0 shrink-0 overflow-hidden'}
          >
            <WorkspaceScripts
              workspaces={scriptable}
              activeId={activeWorkspaceId}
              kind="setup"
              scriptFor={(id) => scripts.get(id)?.scripts.setup ?? null}
              visible={tab === 'scripts'}
              projectFor={projectFor}
              onOpenSettings={onEditScripts}
              tokenFor={(id) => sequence.runOf(id).build}
              stopTokenFor={(id) => sequence.runOf(id).stop}
              onOutcome={(id, ok) => {
                sequence.finished('setup', id, ok)
              }}
              // A build only ever leaves `building` by reporting itself
              // finished, so a runner that goes while one is in flight would
              // strand the workspace with Run disabled and nothing to press.
              onGone={(id) => {
                sequence.abandon(id)
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
            scriptFor={(id) => scripts.get(id)?.scripts.run ?? null}
            visible={tab === 'scripts'}
            projectFor={projectFor}
            onOpenSettings={onEditScripts}
            tokenFor={(id) => sequence.runOf(id).server}
            stopTokenFor={(id) => sequence.runOf(id).stop}
            onOutcome={(id, ok) => {
              sequence.finished('run', id, ok)
            }}
            onPort={(workspace, settled) => {
              setSettledPorts((current) => ({ ...current, [workspace.id]: settled }))

              // The port settles as the server starts, which is also the moment
              // it reads its `.env` — so this is when the set it is holding
              // stops being a guess. The workspace comes with the call rather
              // than being looked up, which leaves nothing to be undefined.
              setServingProfiles((current) => ({
                ...current,
                [workspace.id]: profileOf(workspace)
              }))
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
          quotes={quotes}
          envFile={envFile}
          onRequestChanged={onRequestChanged}
          onEditInstructions={onEditInstructions}
          onError={onError}
        />
      </div>
    </section>
  )
}
