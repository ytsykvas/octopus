import { useState } from 'react'

import type { ScriptsInWorkspace } from '@core/repoSource.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { useErrorMessage } from './useErrorMessage.js'
import { type RunSequence, type WorkspaceRun, useRunSequence } from './useRunSequence.js'

export interface ServerControlsOptions {
  readonly workspaces: readonly WorkspaceView[]
  readonly activeWorkspaceId: string | null
  readonly scripts: ReadonlyMap<string, ScriptsInWorkspace>
  readonly onError: (message: string | null) => void
}

export interface ServerControls {
  /** The sequence itself, for the halves that run its steps. */
  readonly sequence: RunSequence
  /** Records where a workspace's server actually ended up. */
  readonly settlePort: (workspaceId: string, port: number) => void
  /** The port a workspace's server is on, or will start on: where it settled, else its own. */
  readonly portOf: (workspace: WorkspaceView) => number
  /**
   * The workspace every control acts on, or null where there is none.
   *
   * One value for both halves of "there is nothing to act on": no workspace
   * chosen, or one whose directory has gone. A missing one matters as much as
   * an absent one — `WorkspaceScripts` drops it, which unmounts its runner and
   * disposes the session, so nothing is left for a token to reach. Left in, the
   * controls would offer a link to a refused port and a Restart nobody hears.
   */
  readonly activeWorkspace: WorkspaceView | null
  readonly activeRun: WorkspaceRun
  /**
   * Whether this workspace has a server to start at all.
   *
   * Apart from `runAll`, which is also absent while a build is going or while
   * the scripts wait for approval — the title bar hides its control only when
   * there is nothing to start, and disables it otherwise.
   */
  readonly runnable: boolean
  readonly building: boolean
  /** The active workspace while it serves, on the port it really ended up on. */
  readonly servingAt: (WorkspaceView & { readonly port: number }) | null
  readonly runAll: (() => void) | undefined
  readonly restartServer: (() => void) | undefined
  /** Ends a build or a server; absent while neither is going. */
  readonly stopRun: (() => void) | undefined
}

/**
 * Build-then-serve for the selected workspace, shared by every place that
 * offers it.
 *
 * It lived inside the right pane until the title bar wanted the same button.
 * Two copies of this state would disagree the moment one of them was pressed,
 * so there is one, owned by `App` and handed to both.
 */
export function useServerControls({
  workspaces,
  activeWorkspaceId,
  scripts,
  onError
}: ServerControlsOptions): ServerControls {
  const describeFailure = useErrorMessage()
  const sequence = useRunSequence()

  /*
   * Where each workspace's server actually ended up.
   *
   * The workspaces list carries the port as it was last written to disk, and
   * nothing refreshes it after a run settles on another block — so the header
   * linked to the port the run had just moved away from.
   */
  const [settledPorts, setSettledPorts] = useState<Readonly<Record<string, number>>>({})

  const settlePort = (workspaceId: string, port: number): void => {
    setSettledPorts((current) => ({ ...current, [workspaceId]: port }))
  }

  const activeRun = sequence.runOf(activeWorkspaceId)
  // The build is the step that takes the time, and a second press during it
  // would start it over rather than do anything anybody meant.
  const building = activeRun.stage === 'building'

  const found = workspaces.find((item) => item.id === activeWorkspaceId) ?? null
  const activeWorkspace = found !== null && !found.missing ? found : null

  /** What this workspace would run, and whether it is allowed to yet. */
  const activeScripts = activeWorkspaceId === null ? undefined : scripts.get(activeWorkspaceId)
  const runnable = activeWorkspace !== null && activeScripts?.scripts.run !== undefined

  /*
   * What Run does, or nothing where it has nothing to do: no workspace chosen,
   * no server script to start, or a build already going.
   *
   * A handler that is absent rather than one that guards inside itself — the
   * guard could only ever be reached through a button that is disabled, and an
   * unreachable line is a claim about behaviour nobody can check.
   */
  const runAll =
    activeWorkspace === null ||
    activeScripts?.scripts.run === undefined ||
    // A repository's scripts that nobody has read do not run, and the pane
    // says so rather than leaving a button that quietly does nothing.
    !activeScripts.approved ||
    building
      ? undefined
      : (): void => {
          void (async () => {
            /*
             * The port is settled here, before the build, rather than by the
             * server half after it.
             *
             * The build prepares the workspace too, and `prepare` writes the
             * env block with whatever port the workspace holds at that moment.
             * Settled afterwards, a port that had to move left the build
             * holding the number it moved away from — and a bundler reading
             * `VITE_*` or `NEXT_PUBLIC_*` at build time bakes that in, so the
             * pages served on the new port point at the old one.
             *
             * Asking here is safe because `Run` is not offered while a server
             * is up — in the pane or the title bar, both of which read this —
             * so nothing of ours can be listening, and anything answering
             * belongs to somebody else. That is the precondition `ports.ts`
             * states in words, kept by the shape of the controls rather than
             * by a flag.
             *
             * The server half settles again on its way in, which is what covers
             * a port taken during the build — rarer than the case this fixes,
             * and there the choice is a stale bundle or a server that cannot
             * bind at all.
             */
            const settled = await window.octopus.workspaces.port(activeWorkspace.id)
            if (!settled.ok) {
              onError(describeFailure(settled))
              return
            }

            // Nothing is recorded here. `ensureWorkspacePort` commits the port
            // to the workspace, which is what the build then prepares with, and
            // the server half announces where it actually ended up — this only
            // has to happen before the build, not to be remembered.
            // Skipping a build nobody wrote rather than waiting for it: §4 says
            // no step is mandatory, and the half is showing an invitation to
            // write one rather than a runner that could answer.
            sequence.start(activeWorkspace.id, activeScripts.scripts.setup !== undefined)
          })()
        }

  const portOf = (workspace: WorkspaceView): number => settledPorts[workspace.id] ?? workspace.port

  const servingAt =
    activeWorkspace !== null && activeRun.stage === 'serving'
      ? { ...activeWorkspace, port: portOf(activeWorkspace) }
      : null

  const restartServer =
    servingAt === null
      ? undefined
      : (): void => {
          sequence.restart(servingAt.id)
        }

  // A build too, not only a server: one that hangs otherwise left Run disabled
  // with nothing to press.
  const stopRun =
    activeWorkspace === null || (servingAt === null && !building)
      ? undefined
      : (): void => {
          sequence.stop(activeWorkspace.id)
        }

  return {
    sequence,
    settlePort,
    portOf,
    activeWorkspace,
    activeRun,
    runnable,
    building,
    servingAt,
    runAll,
    restartServer,
    stopRun
  }
}
