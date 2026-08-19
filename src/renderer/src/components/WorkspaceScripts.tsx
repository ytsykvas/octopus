import { useState } from 'react'

import type { ScriptKind } from '@core/scripts.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { ScriptRunner } from './ScriptRunner.js'

interface WorkspaceScriptsProps {
  readonly workspaces: readonly WorkspaceView[]
  /** Workspace whose run is on screen; null when none is selected. */
  readonly activeId: string | null
  readonly kind: ScriptKind
  /** Absolute path of the project's script; null when it has not been written. */
  readonly scriptPath: string | null
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
  readonly rootPath: string
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
  readonly onPort?: (workspaceId: string, port: number) => void
  /** A runner that was still going has unmounted. */
  readonly onGone?: (workspaceId: string) => void
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
  scriptPath,
  visible,
  rootPath,
  onOpenSettings,
  tokenFor,
  stopTokenFor,
  onOutcome,
  onPort,
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
            scriptPath={scriptPath}
            port={0}
            rootPath={rootPath}
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
            scriptPath={scriptPath}
            port={workspace.port}
            rootPath={rootPath}
            onOpenSettings={onOpenSettings}
            onPort={(settled) => {
              onPort?.(workspace.id, settled)
            }}
            onGone={() => {
              onGone?.(workspace.id)
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
