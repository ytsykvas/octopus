import { useCallback, useState } from 'react'

import type { ScriptKind } from '@core/scripts.js'

/**
 * Where a workspace is in the build-then-serve sequence.
 *
 * `failed` is only ever a failed build. A server that ends has been stopped, or
 * has crashed in a way its own output describes far better than a word here.
 */
export type RunStage = 'idle' | 'building' | 'serving' | 'failed'

export interface WorkspaceRun {
  readonly stage: RunStage
  /**
   * Bumped to ask a half to start; 0 means it never has been.
   *
   * A token rather than a boolean, because "start again" and "start" are the
   * same instruction to a runner that is already going — and a flag flipped
   * back to false would be an instruction to stop, which this never gives.
   */
  readonly build: number
  readonly server: number
  /** Bumped to end whatever is running, build or server alike. */
  readonly stop: number
}

const IDLE: WorkspaceRun = { stage: 'idle', build: 0, server: 0, stop: 0 }

export interface RunSequence {
  /** Where a workspace is; idle for one that has never been run. */
  readonly runOf: (workspaceId: string | null) => WorkspaceRun
  /**
   * Begins the sequence.
   *
   * `withBuild` is false where the project has no build script: §4 says no step
   * is mandatory, and waiting for a build nobody wrote would hang on a half
   * that is showing an invitation to write one rather than a runner.
   */
  readonly start: (workspaceId: string, withBuild: boolean) => void
  /**
   * Starts the server again without building.
   *
   * The common half of a restart: the code changed under a running server and
   * it needs picking up, while nothing about the checkout did.
   */
  readonly restart: (workspaceId: string) => void
  /** Ends whatever is running here. */
  readonly stop: (workspaceId: string) => void
  /**
   * A half is running something the sequence does not know about.
   *
   * The sequence lives above both halves and holds nothing but which step is
   * owed; the halves hold the processes. A Vite hot update is not a navigation,
   * so nothing in `main` fires and no terminal is disposed — but editing a
   * module this hook is reached through resets **this** state while the pty
   * carries on. The tab then offered `Run` over a server that was already
   * serving, and pressing it started a second one.
   *
   * One direction only. A half that is running is a fact; a half that is not
   * says nothing about whether the sequence is between steps, and demoting on
   * that would end a build the moment its own runner reported idle before the
   * server took over. Stopping and finishing are what move it back.
   */
  readonly adopt: (kind: ScriptKind, workspaceId: string, running: boolean) => void
  /** The runner that was building has gone; the workspace is not building. */
  readonly abandon: (workspaceId: string) => void
  /** A half's script ended, and whether it ended well. */
  readonly finished: (kind: ScriptKind, workspaceId: string, ok: boolean) => void
}

/**
 * One button that takes a workspace from a bare checkout to a running server.
 *
 * The two halves of the Scripts tab are separate components with a workspace
 * list each, so neither can wait on the other; this is the small amount of
 * state that sits above both. It holds nothing about the runs themselves — the
 * output, the process and the buttons stay where they are — only which step is
 * owed next.
 *
 * Keyed by workspace throughout. A sequence belongs to the workspace it was
 * started in, exactly as the run does: leaving one mid-build to look at another
 * must not report the second as building.
 */
export function useRunSequence(): RunSequence {
  const [runs, setRuns] = useState<Readonly<Record<string, WorkspaceRun>>>({})

  const start = useCallback((workspaceId: string, withBuild: boolean) => {
    setRuns((current) => {
      const run = current[workspaceId] ?? IDLE
      const next: WorkspaceRun = withBuild
        ? { ...run, stage: 'building', build: run.build + 1 }
        : { ...run, stage: 'serving', server: run.server + 1 }

      return { ...current, [workspaceId]: next }
    })
  }, [])

  /*
   * Both act on a run that exists, and do nothing where none does.
   *
   * The controls that reach them are on screen only while a server is up.
   * Inventing a run here would put a workspace into `serving` with nothing
   * serving in it — a state the pane would then draw a Stop button for.
   */
  const restart = useCallback((workspaceId: string) => {
    setRuns((current) => {
      const run = current[workspaceId]
      if (!run) return current

      return { ...current, [workspaceId]: { ...run, stage: 'serving', server: run.server + 1 } }
    })
  }, [])

  /*
   * The runner that was going has gone.
   *
   * `building` is left only by a runner reporting the build it finished, and
   * `Stop` is on screen only while `serving` — so an unmount mid-build stranded
   * the workspace with Run disabled reading "Building…" and nothing to press.
   * A build whose terminal is gone is not building, whatever the sequence
   * remembers.
   *
   * Back to `idle`, not `failed`: nothing failed, the pane was put away.
   */
  const abandon = useCallback((workspaceId: string) => {
    setRuns((current) => {
      const run = current[workspaceId]
      if (run?.stage !== 'building') return current

      return { ...current, [workspaceId]: { ...run, stage: 'idle' } }
    })
  }, [])

  const adopt = useCallback((kind: ScriptKind, workspaceId: string, running: boolean) => {
    if (!running) return

    setRuns((current) => {
      const run = current[workspaceId] ?? IDLE
      const stage = kind === 'run' ? 'serving' : 'building'
      if (run.stage === stage) return current

      // The tokens are not bumped. They are what *starts* a half, and this one
      // is already going — bumping would restart the thing being recovered.
      return { ...current, [workspaceId]: { ...run, stage } }
    })
  }, [])

  const stop = useCallback((workspaceId: string) => {
    setRuns((current) => {
      const run = current[workspaceId]
      if (!run) return current

      return { ...current, [workspaceId]: { ...run, stage: 'idle', stop: run.stop + 1 } }
    })
  }, [])

  const finished = useCallback((kind: ScriptKind, workspaceId: string, ok: boolean) => {
    setRuns((current) => {
      const run = current[workspaceId] ?? IDLE

      // Only a run this sequence asked for advances it. A half also reports the
      // run its own start token began — a remount, a restart — and the outcome
      // of one the sequence is not waiting on must not move it along.
      if (kind === 'setup' && run.stage === 'building') {
        return {
          ...current,
          [workspaceId]: ok
            ? { ...run, stage: 'serving', server: run.server + 1 }
            : { ...run, stage: 'failed' }
        }
      }

      if (kind === 'run' && run.stage === 'serving') {
        return { ...current, [workspaceId]: { ...run, stage: 'idle' } }
      }

      return current
    })
  }, [])

  const runOf = useCallback(
    (workspaceId: string | null): WorkspaceRun =>
      workspaceId === null ? IDLE : (runs[workspaceId] ?? IDLE),
    [runs]
  )

  return { runOf, start, restart, stop, adopt, abandon, finished }
}
