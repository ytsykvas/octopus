import {
  ExternalLink,
  type LucideIcon,
  NotebookPen,
  Pencil,
  Play,
  RotateCw,
  Square,
  SquareTerminal
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ProjectColor } from '@core/colors.js'
import type { RightPanelTab } from '@core/config.js'
import type { ScriptsInWorkspace } from '@core/repoSource.js'
import { SCRIPT_KINDS } from '@core/scriptEnv.js'
import type { DiffCommentController } from '../hooks/useDiffComments.js'
import type { FileRevertController } from '../hooks/useFileRevert.js'
import type { PullRequestQuoteController } from '../hooks/usePullRequestQuotes.js'
import type { Failure } from '../../../preload/index.js'
import { useErrorMessage } from '../hooks/useErrorMessage.js'
import type { ServerControls } from '../hooks/useServerControls.js'
import { useEnvProfiles } from '../hooks/useEnvProfiles.js'
import { useServingPort } from '../hooks/useServingPort.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { Button } from './Button.js'
import { DiffPanel } from './diff/DiffPanel.js'
import { FilesPanel } from './files/FilesPanel.js'
import { NotesPanel } from './NotesPanel.js'
import { DisclosureButton } from './Disclosure.js'
import { DropdownMenu } from './DropdownMenu.js'
import { EnvProfileSwitch } from './EnvProfileSwitch.js'
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
  readonly labelKey:
    | 'panel.files'
    | 'panel.changes'
    | 'panel.terminal'
    | 'panel.scripts'
    | 'panel.pullRequest'
    | 'panel.notes'
  /**
   * Drawn instead of the label, where there is one.
   *
   * The tools at the two ends have one, and the reason is the measurement
   * below: the row sets the pane's narrowest allowed width, so another **word** would
   * widen the floor for everybody for ever. An icon costs about a third of it.
   * The label is still what names the button — it moves to `aria-label` and
   * `title` rather than disappearing.
   */
  readonly Icon?: LucideIcon
}[] = [
  /*
   * An icon, four words, an icon.
   *
   * The ends are the tools somebody reaches for — a shell on one side, a
   * scratchpad on the other — and the four in the middle are about the work
   * itself, which is what the words are worth spending the width on. Icons
   * between words would read as a mistake; at the ends they read as what they
   * are. Files is a word, beside the shell: a tree icon was too easy to miss
   * for the tab most of the browsing starts in.
   */
  { id: 'terminal', labelKey: 'panel.terminal', Icon: SquareTerminal },
  { id: 'files', labelKey: 'panel.files' },
  { id: 'diff', labelKey: 'panel.changes' },
  { id: 'scripts', labelKey: 'panel.scripts' },
  { id: 'pullRequest', labelKey: 'panel.pullRequest' },
  { id: 'notes', labelKey: 'panel.notes', Icon: NotebookPen }
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
   * The checkout and the env set of a workspace's **own** project.
   *
   * A lookup rather than the open project's pair. Every runner in the pane
   * needs its own — the checkout reaches a script as `$OCTOPUS_ROOT_PATH` — and
   * it is what lets a run survive the project being left, since unmounting a
   * runner is how a run ends.
   */
  readonly projectFor: (workspaceId: string) => {
    rootPath: string
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
  /**
   * A workspace's own record changed here — the set of variables it runs with
   * — so the list it comes from has to be read again. Without it the switch
   * stayed pressed on the old set while the new one was already stored.
   */
  readonly onWorkspacesChanged: () => void
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
  /**
   * Whether the pane is showing. Folded, it is hidden rather than unmounted:
   * its terminals and the servers running in them belong to their workspaces,
   * and unmounting is how a terminal is ended.
   */
  readonly open: boolean
  /** Asked for by a drag past the floor, which folds the pane, and back. */
  readonly onOpenChange: (open: boolean) => void
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
  /** Removes a workspace, asking first — the sidebar's own flow, by id. */
  readonly onRemoveWorkspace: (workspaceId: string) => void
  /** The file tab in front of the centre, which the Files tab marks; null when a chat is. */
  readonly activeFilePath: string | null
  /** Opens a file from the Files tab in the centre, as a preview or kept open. */
  readonly onOpenFile: (path: string, pinned: boolean) => void
  /** Brings the conversation in front of any open file, before a prompt is sent to it. */
  readonly onConversation: () => void
  readonly onError: (message: string | null) => void
  /**
   * Build-then-serve for the selected workspace.
   *
   * Owned by `App` because the title bar offers the same Run and Stop, and two
   * copies of the state would disagree the moment either was pressed.
   */
  readonly server: ServerControls
}

export function RightPanel({
  workspaces,
  activeWorkspaceId,
  color,
  projectId,
  scripts,
  scriptFailures,
  onScriptsChanged,
  onWorkspacesChanged,
  projectFor,
  defaultEnvProfile,
  onEditScripts,
  onEditFiles,
  onEditEnv,
  onEditInstructions,
  chatId,
  width,
  onWidthChange,
  open,
  onOpenChange,
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
  onRemoveWorkspace,
  activeFilePath,
  onOpenFile,
  onConversation,
  onError,
  server
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
  const {
    sequence,
    activeWorkspace,
    activeRun,
    building,
    servingAt,
    runAll,
    restartServer,
    stopRun
  } = server

  /*
   * The sequence lives above both halves and holds nothing but which step is
   * owed; the halves hold the processes. A Vite hot update remakes this state
   * without unmounting a terminal, so the tab offered `Run` over a server that
   * was already serving — and pressing it started a second one.
   *
   * Stable on purpose, and taken out of the sequence rather than read off it:
   * `sequence` is rebuilt every render while `adopt` is not, and that identity
   * **is** the signal. A half announces on the listener as well as on its own
   * state, so a sequence that has just been remade is told what is running
   * without anything having to notice that it forgot.
   */
  const { adopt } = sequence

  const adoptServer = useCallback(
    (id: string, running: boolean) => {
      adopt('run', id, running)
    },
    [adopt]
  )

  const adoptBuild = useCallback(
    (id: string, running: boolean) => {
      adopt('setup', id, running)
    },
    [adopt]
  )

  /** The sets of variables this project holds, so a workspace can be put on one. */
  const {
    profiles: envProfiles,
    projectDefault: projectEnvProfile,
    setWorkspaceProfile
  } = useEnvProfiles(projectId, defaultEnvProfile, onError, onWorkspacesChanged)

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

  /**
   * The set of variables each workspace was last built with.
   *
   * Apart from the server's because a restart starts the server again without
   * building: after a switch it picks up the new `.env` while whatever the build
   * made — a database restored from the other environment's dump — stays where
   * it was. The server's record alone then said all was well.
   */
  const [builtProfiles, setBuiltProfiles] = useState<Readonly<Record<string, string>>>({})

  /** What this workspace would run, and whether it is allowed to yet. */
  const activeScripts = activeWorkspaceId === null ? undefined : scripts.get(activeWorkspaceId)

  /** What the repository supplies, in the order the scripts run. */
  const suppliedScripts = SCRIPT_KINDS.flatMap((kind) => {
    const script = activeScripts?.scripts[kind]
    return script === undefined || script.source === 'project' ? [] : [script]
  })

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

  /*
   * Only while serving. Otherwise the next press of Run builds again, and
   * warning about a build that is about to be redone would be noise.
   */
  const servingWorkspace =
    activeWorkspace !== null && activeRun.stage === 'serving' ? activeWorkspace : null
  const differs = (record: Readonly<Record<string, string>>): string | null => {
    if (servingWorkspace === null) return null
    const held = record[servingWorkspace.id]
    return held !== undefined && held !== profileOf(servingWorkspace) ? held : null
  }
  const staleBuild = differs(builtProfiles)
  /*
   * The build's first, because a restart cannot fix it and the server's
   * sentence would recommend exactly a restart.
   */
  const envWarning =
    servingWorkspace === null
      ? null
      : staleBuild !== null
        ? t('scripts.envRebuild', { built: staleBuild, current: profileOf(servingWorkspace) })
        : differs(servingProfiles) !== null
          ? t('scripts.envRestart')
          : null

  // Asked only while something is serving: a port nothing was told to bind is
  // not a port anybody is waiting on.
  const silentPort = useServingPort(servingAt?.id ?? null, activeRun.server)

  const tabs = useRef<HTMLDivElement>(null)

  /*
   * The width the pane last settled on — dragged, nudged, or read from the
   * config. The window never moves it; see `applied` below.
   */
  const [settledWidth, setSettledWidth] = useState(width)
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
  }

  // Folded, no tab is on screen, so none of them reads git or the disk.
  const showing = open ? tab : null

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

  // Re-measured on a language change, which is when the labels get longer —
  // and on unfolding, since a pane that started folded measured its tabs while
  // they had no size at all and would otherwise keep a floor of nothing.
  useEffect(() => {
    const row = tabs.current
    // Attached before effects run; guarded only because the ref's type admits null.
    /* v8 ignore next */
    if (!row) return

    if (!open) return

    setMinWidth(Math.max(MIN_WIDTH, measureTabs(row)))
  }, [i18n.language, open])

  const maxWidth = maxWidthFor(windowWidth, leftWidth, minWidth)

  /*
   * The pane keeps the width it was given, and the window's edge moves the
   * centre — the way a sidebar behaves in most desktop applications. It used to
   * be the other way round: the pane took every pixel the window gained or
   * lost, on the grounds that the conversation stops widening at 72rem. It
   * read as the pane having a mind of its own, so it went.
   *
   * Clamped on the way out rather than into what was settled: once the centre
   * is down to its floor the pane gives way, and a width the window has no
   * room for is kept and comes back when the room does.
   */
  const applied = Math.min(Math.max(dragWidth ?? settledWidth, minWidth), maxWidth)

  return (
    <section
      style={{
        width: applied,
        // Set on the pane rather than on the tab it currently paints, so the
        // stylesheet owns how the colour is used and anything else in here can
        // reach for it later.
        ...(color ? ({ '--project-color': `var(--project-${color})` } as React.CSSProperties) : {})
      }}
      // Hidden, never unmounted — see `open`. `aria-hidden` beside the class,
      // as the tabs below do it: the class means nothing without a stylesheet.
      aria-hidden={!open}
      className={`border-line bg-surface relative flex shrink-0 flex-col border-l ${open ? '' : 'hidden'}`}
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
        onFold={(folded) => {
          onOpenChange(!folded)
        }}
        onCommit={(committed) => {
          setDragWidth(null)
          // Settled here rather than waiting for the config to answer. That
          // round trip takes a frame or two, and falling back to the pre-drag
          // width in the meantime makes the release bounce.
          setSettledWidth(committed)
          // `storedWidth` is deliberately left alone: it is what the config
          // says, and the config has not said it yet. So a save that fails
          // leaves the pane where it was dragged while the config keeps the old
          // width — the banner is what says so, and yanking the pane back under
          // the cursor would say it twice and less clearly.
          onWidthChange(committed)
        }}
      />

      {/* Tiles like the project strip's, on a neutral row: the ones not chosen
          float, tinted with the project's colour, and the chosen one runs down
          to the line that closes the row and breaks through it, so it reads as
          the view below reaching up — the same relationship the project strip
          has with the sidebar, whose wash the view below now carries too
          (`project-tinted-top`, further down). `items-end` and the margins are what
          place them against the line rather than above it.

          Pinned to the right edge with `justify-end`: the pane is dragged by
          its left edge, so the tabs stay put and widening it only adds empty
          row on their left. Not a spacer or an `ml-auto` — the floor below is
          measured from this row's children, and neither may add or move one. */}
      <div
        ref={tabs}
        className="border-line flex h-11 shrink-0 items-end justify-end gap-1 border-b px-2"
      >
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
            // Named for a reader and on hover when the face is an icon. A tab
            // with no accessible name would be the real cost of dropping the
            // word, and it is not one worth paying.
            {...(item.Icon !== undefined && {
              'aria-label': t(item.labelKey),
              title: t(item.labelKey)
            })}
            className={`focus-ring flex shrink-0 items-center justify-center border font-medium whitespace-nowrap transition-colors ${
              item.Icon === undefined ? 'px-3' : 'w-8 px-0'
            } ${
              // Both start 6px from the top of the row. The idle one is a tile
              // with room beneath it; the chosen one runs on down to the line
              // and over it (`-mb-px`), squared off there, so it reads as the
              // pane below reaching up — the project strip's tab, turned a
              // quarter. The six pixels of padding under the chosen one keep
              // its label level with the others: it is taller, and centred in
              // that height the word would sit three pixels low.
              tab === item.id
                ? 'tab-selected -mb-px h-[38px] rounded-t-[10px] pb-1.5'
                : 'tab-idle mb-[5px] h-8 rounded-[10px]'
            }`}
          >
            {item.Icon === undefined ? t(item.labelKey) : <item.Icon aria-hidden size={14} />}
          </button>
        ))}
      </div>

      {/* The project's wash across the top of what is under the tabs, fading
          out within the first 160px — the way the workspace list is washed, but
          not all the way down: this pane is read for code and terminal output.
          One wrapper rather than the class on the section: the gradient starts
          at the top of the element that carries it, and it has to start exactly
          where the chosen tab ends — the tab is the colour the gradient begins
          with, and a row's height of drift is enough for the join to show.
          Without a project the class is left off and the pane keeps its plain
          surface. */}
      <div className={`flex min-h-0 flex-1 flex-col ${color ? 'project-tinted-top' : ''}`}>
        {/* Hidden rather than unmounted, like the rest: which folders were open
          and where the tree was scrolled are what a look elsewhere must not
          cost. `visible` is what stops it reading git meanwhile. */}
        <div
          aria-hidden={tab !== 'files'}
          className={`flex min-h-0 flex-1 flex-col ${tab === 'files' ? '' : 'hidden'}`}
        >
          <FilesPanel
            workspace={active}
            visible={showing === 'files'}
            activePath={activeFilePath}
            onOpen={onOpenFile}
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
            visible={showing === 'terminal'}
          />
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
            visible={showing === 'diff'}
            view={diffView}
            onView={onDiffView}
            width={applied}
            comments={comments}
            revert={revert}
            onError={onError}
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

            {/* After the button above rather than before it: the switch appears
              only once the sets are read and is held while a build runs, and
              the button that never changes must not be moved by it. */}
            {activeWorkspace !== null && (
              <EnvProfileSwitch
                profiles={envProfiles}
                value={profileOf(activeWorkspace)}
                disabled={building}
                onChange={(name) => {
                  void setWorkspaceProfile(activeWorkspace.id, name)
                }}
              />
            )}

            {/* Every control for the tab, and none in the halves — and only ever
              the ones that can mean something. Run goes once the server is up:
              what it offers has already happened, and a rebuild from there is
              Stop and then Run, which is also the order that frees the port
              before anything tries to bind it again. A build can be stopped
              too: one that hangs otherwise left Run disabled for good. */}
            {servingAt === null && (
              <Button size="sm" variant="accent" disabled={runAll === undefined} onClick={runAll}>
                <Play aria-hidden size={12} />
                {t(building ? 'scripts.running' : 'scripts.runAll')}
              </Button>
            )}

            {servingAt === null && stopRun !== undefined && (
              <Button size="sm" variant="danger" onClick={stopRun}>
                <Square aria-hidden size={12} />
                {t('scripts.stop')}
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

          {/* Under the row rather than in its text, and wrapped: while a server
            is up that row holds the switch and four controls, and the sentence
            that says which environment the data came from was cut to its first
            two words. Said rather than enforced: the server is somebody's work
            in progress, and taking it down to be consistent would be the ruder
            of the two. */}
          {envWarning !== null && (
            <p className="border-line bg-warning-bg text-warning shrink-0 border-b px-3 py-1.5 text-[11px]">
              {envWarning}
            </p>
          )}

          {/* Pinned above both halves rather than inside one, and never in a
            modal: this is the answer to "why is Run doing nothing", and it has
            to be readable at the moment somebody presses it. Every byte of what
            the repository supplies is shown — an approval over a summary is an
            approval of the summary. Where what it supplies is a command line,
            that is the whole of what can be shown, and the notice below says
            so: the file the line invokes is not read here and not digested. */}
          {/* Why Run is doing nothing, in the place Run is. A repository whose
            settings will not parse resolves to no scripts at all, and without
            this the pane disabled the button and said nothing. */}
          {scriptFailure !== undefined && (
            <p className="border-line bg-muted/40 text-danger shrink-0 border-b px-3 py-2.5">
              {t('scripts.repoUnreadable', { reason: describeFailure(scriptFailure) })}
            </p>
          )}

          {activeScripts !== undefined && !activeScripts.approved && activeWorkspace !== null && (
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
                {suppliedScripts.map((script) => (
                  <div key={script.kind}>
                    <p className="text-ink-faint font-mono text-[11px]">{script.from}</p>
                    <pre
                      /* Wrapped rather than scrolled sideways. `overflow-x-auto`
                       alone did clip correctly — but macOS hides the scrollbar
                       until it moves, so 80-column shell in a 354px box read as
                       text simply cut off. Asking somebody to scroll every line
                       right and back is not a way to read code they are being
                       asked to approve. `overflow-x-auto` stays for the one
                       thing wrapping cannot break: an unbroken token. */
                      className="border-line bg-canvas mt-1 overflow-x-auto rounded-[var(--radius-control)] border px-2 py-1.5 font-mono text-[11px] break-words whitespace-pre-wrap"
                    >
                      {script.contents}
                    </pre>
                  </div>
                ))}
              </div>

              <Button
                size="sm"
                onClick={() => {
                  void (async () => {
                    onError(null)
                    // The digest of what is on screen: a pull that rewrote a
                    // script after it was shown is refused, not approved unseen —
                    // and refreshing then shows what is there now.
                    const done = await window.octopus.projects.approveScripts(
                      activeWorkspace.projectId,
                      activeWorkspace.id,
                      activeScripts.digest
                    )
                    onScriptsChanged()
                    if (!done.ok) onError(describeFailure(done))
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
              <DisclosureButton
                open={buildOpen}
                onOpenChange={setBuildOpen}
                // Named for what it does rather than for the word on it:
                // `Build` is also the heading it carries, and two controls with
                // one name are ambiguous to anything reading the pane aloud.
                label={t(buildOpen ? 'scripts.foldBuild' : 'scripts.unfoldBuild')}
                className="focus-ring section-label hover:bg-muted flex min-w-0 flex-1 items-center gap-1.5 px-3 py-1.5 text-left"
              >
                {t('scripts.build')}
              </DisclosureButton>

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
                   * The sets themselves are a switch in the Run row, where they
                   * are seen; what stays here is the one answer that is not a
                   * set — follow the project, wherever it moves. Shown only where
                   * there is a choice: a project with one set sees exactly the
                   * menu it always had.
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
                        }
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
              className={
                buildOpen ? 'flex min-h-0 flex-1 flex-col' : 'h-0 shrink-0 overflow-hidden'
              }
            >
              <WorkspaceScripts
                workspaces={scriptable}
                activeId={activeWorkspaceId}
                kind="setup"
                scriptFor={(id) => scripts.get(id)?.scripts.setup ?? null}
                projectFor={projectFor}
                onOpenSettings={onEditScripts}
                tokenFor={(id) => sequence.runOf(id).build}
                stopTokenFor={(id) => sequence.runOf(id).stop}
                onOutcome={(id, ok) => {
                  sequence.finished('setup', id, ok)
                }}
                onProfile={(id, profile) => {
                  setBuiltProfiles((current) => ({ ...current, [id]: profile }))
                }}
                // A build only ever leaves `building` by reporting itself
                // finished, so a runner that goes while one is in flight would
                // strand the workspace with Run disabled and nothing to press.
                onGone={(id) => {
                  sequence.abandon(id)
                }}
                onRunning={adoptBuild}
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
              projectFor={projectFor}
              onOpenSettings={onEditScripts}
              tokenFor={(id) => sequence.runOf(id).server}
              stopTokenFor={(id) => sequence.runOf(id).stop}
              onOutcome={(id, ok) => {
                sequence.finished('run', id, ok)
              }}
              onRunning={adoptServer}
              onPort={(workspace, settled) => {
                server.settlePort(workspace.id, settled)
              }}
              // From the call that wrote the `.env` the server is about to read,
              // not from the list: the list can still be on the set before a
              // press, and the port settles before the env is written.
              onProfile={(id, profile) => {
                setServingProfiles((current) => ({ ...current, [id]: profile }))
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
            visible={showing === 'pullRequest'}
            chatId={chatId}
            quotes={quotes}
            envFile={envFile}
            onRequestChanged={onRequestChanged}
            onEditInstructions={onEditInstructions}
            onError={onError}
            onRemoveWorkspace={onRemoveWorkspace}
            onConversation={onConversation}
          />
        </div>
        {/* The note is the one thing a workspace carries that the agent never
          reads. Remounted per workspace by the key, which is what makes its
          debounced save safe: an editor that loads against one target and saves
          a moment later writes the old text into the newly chosen one. */}
        <div
          aria-hidden={tab !== 'notes'}
          className={`flex min-h-0 flex-1 flex-col ${tab === 'notes' ? '' : 'hidden'}`}
        >
          <NotesPanel
            key={activeWorkspaceId ?? 'none'}
            workspaceId={activeWorkspaceId}
            notes={workspaces.find((one) => one.id === activeWorkspaceId)?.notes ?? ''}
          />
        </div>
      </div>
    </section>
  )
}
