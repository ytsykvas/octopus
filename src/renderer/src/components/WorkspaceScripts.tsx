import { useState } from 'react'

import type { ResolvedScript } from '@core/repoSource.js'
import type { ScriptKind } from '@core/scripts.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { ScriptRunner } from './ScriptRunner.js'

interface WorkspaceScriptsProps {
  readonly workspaces: readonly WorkspaceView[]
  /** Workspace whose run is on screen; null when none is selected. */
  readonly activeId: string | null
  readonly kind: ScriptKind
  /**
   * Which script this kind runs in a given workspace, or null for none.
   *
   * A function of the workspace rather than one script for the pane, because
   * the answer is a fact about a **worktree**: the repository supplying it is
   * the one checked out there, and a branch may carry a different script from
   * the branch beside it. A runner left standing for another workspace also
   * keeps its own — handing it null would unmount it, and unmounting is how a
   * run ends.
   */
  readonly scriptFor: (workspaceId: string) => ResolvedScript | null
  /**
   * Whether this script's tab is the one being shown.
   *
   * A runner is mounted for a workspace the first time it is looked at here,
   * and outlives the tab being hidden. Without the distinction, moving around
   * the list while reading the diff would mount runners for workspaces nobody
   * asked about.
   */
  readonly visible: boolean
  /** The project's checkout, handed to every script as `$OCTOPUS_ROOT_PATH`. */
  /**
   * The checkout and the base branch of a workspace's **own** project.
   *
   * A lookup rather than one pair for the open project, and that is what lets
   * a runner outlive its project being left: `$OCTOPUS_ROOT_PATH` and
   * `CONDUCTOR_DEFAULT_BRANCH` reach every script, so one set for whatever is
   * on screen would build a workspace against a checkout that never asked.
   */
  readonly projectFor: (workspaceId: string) => { rootPath: string; defaultBranch: string }
  /** The base branch, for a script that reads it under Conductor's name. */
  readonly onOpenSettings: () => void
  /**
   * This half's start token for a given workspace, from the Run sequence.
   *
   * A function rather than one number: every workspace here keeps its own
   * runner, and a sequence started in one must not start the rest of them.
   */
  readonly tokenFor: (workspaceId: string) => number
  /** The token that ends a run here; both halves watch the same one. */
  readonly stopTokenFor: (workspaceId: string) => number
  readonly onOutcome: (workspaceId: string, ok: boolean) => void
  /** Where a run's server actually ended up, which the header links to. */
  readonly onPort?: (workspace: WorkspaceView, port: number) => void
  /** A runner that was still going has unmounted. */
  readonly onGone?: (workspaceId: string) => void
  /** Whether a half has something running, whenever that changes. */
  readonly onRunning?: (workspaceId: string, running: boolean) => void
}

/**
 * One script runner per workspace, for one of the two kinds.
 *
 * The same shape as `WorkspaceTerminals`, because it is the same problem: a run
 * belongs to its workspace, not to what happens to be on screen. `ScriptRunner`
 * ends a run by ceasing to render `Terminal` — that is the whole of its Stop
 * button — so a component that came and went with the selection pressed Stop on
 * every switch. `run.sh` is handed `OCTOPUS_PORT` precisely so several
 * workspaces can serve at once, which is not possible while one click ends the
 * last one.
 *
 * Cheaper than the terminals it copies: a runner holds no process at all until
 * its Run button is pressed, so the ones left standing are a line of text each.
 */
export function WorkspaceScripts({
  workspaces,
  activeId,
  kind,
  scriptFor,
  visible,
  projectFor,
  onOpenSettings,
  tokenFor,
  stopTokenFor,
  onOutcome,
  onPort,
  onRunning,
  onGone
}: WorkspaceScriptsProps): React.JSX.Element {
  const [openedIds, setOpenedIds] = useState<readonly string[]>([])
  const [lastActiveId, setLastActiveId] = useState<string | null>(null)

  // Adjusted during render rather than in an effect, the way the terminals do
  // it: an effect runs after the paint, so opening a workspace would show an
  // empty pane for one frame before its runner appeared.
  if (visible && activeId !== lastActiveId) {
    setLastActiveId(activeId)
    if (activeId !== null && !openedIds.includes(activeId)) {
      setOpenedIds([...openedIds, activeId])
    }
  }

  // A workspace that is gone takes its run with it: dropping it here unmounts
  // the runner, which ends the script. Missing ones go too — their directory no
  // longer exists, so the script has nowhere to be.
  const opened = openedIds
    .map((id) => workspaces.find((workspace) => workspace.id === id))
    .filter(
      (workspace): workspace is WorkspaceView => workspace !== undefined && !workspace.missing
    )

  return (
    <div className="relative flex-1">
      {/* Shown over the runners rather than instead of them, so a stray click
          that clears the selection does not end every run in the project. The
          runner itself owns this text; a second copy of it here would be one
          more thing to keep in step. */}
      {activeId === null && (
        <div className="absolute inset-0 flex flex-col">
          <ScriptRunner
            workspace={null}
            kind={kind}
            script={null}
            port={0}
            // No workspace, so no project of its own: this draws the "pick one"
            // text and runs nothing.
            rootPath=""
            defaultBranch=""
            onOpenSettings={onOpenSettings}
          />
        </div>
      )}

      {opened.map((workspace) => (
        <div
          key={workspace.id}
          // Hidden with `visibility`, never `display: none`: a display-hidden
          // element measures zero, so FitAddon would size the terminal to no
          // columns at all and the output would come back mangled.
          className={`absolute inset-0 flex flex-col ${workspace.id === activeId ? '' : 'invisible'}`}
          aria-hidden={workspace.id !== activeId}
        >
          <ScriptRunner
            workspace={workspace}
            kind={kind}
            script={scriptFor(workspace.id)}
            port={workspace.port}
            rootPath={projectFor(workspace.id).rootPath}
            defaultBranch={projectFor(workspace.id).defaultBranch}
            onOpenSettings={onOpenSettings}
            onPort={(settled) => {
              onPort?.(workspace, settled)
            }}
            onGone={() => {
              onGone?.(workspace.id)
            }}
            onRunning={(running) => {
              onRunning?.(workspace.id, running)
            }}
            startToken={tokenFor(workspace.id)}
            stopToken={stopTokenFor(workspace.id)}
            onOutcome={(ok) => {
              onOutcome(workspace.id, ok)
            }}
          />
        </div>
      ))}
    </div>
  )
}
